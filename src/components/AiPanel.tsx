import { useState } from 'react';
import type { GlobalConfig, ResourceEntry } from '../types';
import { catalogReference, intakeNotices, parseIntake, type IntakeApply } from '../lib/intake';
import { parseDiscovery, toResourceEntries, type DiscoveredResource } from '../lib/discovery';

interface Props {
  global: GlobalConfig;
  onApply: (result: IntakeApply) => boolean;
  onAdd: (entries: ResourceEntry[]) => boolean;
  /** 계정 검증 결과를 상위로 올린다(점검 패널이 공유). 무효화 시 null. */
  onValidatedRole?: (v: { accountId: string; account: string } | null) => void;
  /** 로그인 상태 (백엔드 OAuth 구성 시) */
  authenticated?: boolean;
  /** 백엔드가 로그인을 요구하는지(OAuth 구성됨) */
  authRequired?: boolean;
  onLogin?: () => void;
}

/** 답변 텍스트에서 제안 JSON을 추출한다(백엔드와 같은 규칙: ```json 펜스 우선, 없으면 균형 잡힌 {…}). */
function extractProposal(text: string): string {
  const m = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  const start = text.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1).trim();
  }
  return '';
}

const KIND_ORDER: DiscoveredResource['kind'][] = [
  'EC2',
  'ASG',
  'RDS',
  'ELB',
  'TG',
  'ECS',
  'Lambda',
  'CloudFront',
  'Route53HealthCheck',
];
const KIND_LABEL: Record<DiscoveredResource['kind'], string> = {
  EC2: 'EC2 인스턴스',
  ASG: 'Auto Scaling 그룹',
  RDS: 'RDS · Aurora',
  ELB: '로드 밸런서',
  TG: '대상 그룹 (ALB)',
  ECS: 'ECS 서비스',
  Lambda: 'Lambda 함수',
  CloudFront: 'CloudFront 배포 (글로벌)',
  Route53HealthCheck: 'Route 53 Health Check (글로벌)',
};

const DEFAULT_ACCOUNT_QUESTION =
  '이 계정의 리소스를 점검해서 리소스별로 반드시 있어야 할 핵심 알람(가용성·포화·지연 위주)을 ' +
  '우선순위대로 추천해줘. 최근 지표를 근거로 과민하지 않은 임계값을 쓰고, 오탐이 날 만한 알람은 피해줘. ' +
  '데이터가 없는 유휴 리소스나 이미 있을 법한 알람은 그렇게 표시해줘. ' +
  '또한 비용 절감 관점에서, 지속적으로 저사용(유휴)이라 축소/중지 후보인 리소스나 ' +
  '과대 프로비저닝으로 보이는 리소스가 있으면 함께 알려줘.';

/**
 * AI 어시스턴트: 요구사항 변환 + 계정 기반 추천을 하나로 합친 패널.
 *  - 계정 ID를 비우면: 요구사항 텍스트만 Bedrock으로 생성기 JSON으로 변환 (/api/intake).
 *  - 계정 ID를 넣고 검증하면: 그 계정 리소스·최근 지표를 근거로 추천한다 (/api/ai).
 * 두 경우 모두 결과 JSON을 적용하면 토글·임계값이 자동으로 채워진다.
 *
 * 레이아웃: 요구사항/질문(주 흐름)을 맨 위에, 계정 연결(선택)을 아래에 둔다.
 */
export function AiPanel({
  global,
  onApply,
  onAdd,
  onValidatedRole,
  authenticated = false,
  authRequired = false,
}: Props) {
  // 백엔드가 로그인을 요구하는데 아직 로그인 안 했으면 AI/계정 동작을 잠근다.
  const needsLogin = authRequired && !authenticated;
  const [text, setText] = useState('');
  const [accountId, setAccountId] = useState<string>(import.meta.env.VITE_TEST_ACCOUNT_ID ?? '');

  // 검증 상태: 어떤 계정 ID가 검증됐는지 기억해, 값을 고치면 다시 검증하도록 한다.
  const [validating, setValidating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [validatedId, setValidatedId] = useState('');
  const [validatedAccount, setValidatedAccount] = useState('');
  const [validatedAlias, setValidatedAlias] = useState('');

  // 검증(계정 조회) 결과로 만든 리소스 목록. 체크해서 카드로 만든다.
  const [found, setFound] = useState<DiscoveredResource[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  // 목록 검색어 (이름·ID 부분 일치)
  const [query, setQuery] = useState('');
  // 일부 서비스 조회 실패(권한 없음 등) 안내. 나머지 목록은 그대로 보여준다.
  const [discoverWarnings, setDiscoverWarnings] = useState<string[]>([]);

  const [answer, setAnswer] = useState('');
  const [resultJson, setResultJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 계정 확인·새로고침 오류는 계정 연결 패널에 따로 보여준다.
  const [accountError, setAccountError] = useState('');
  const [msg, setMsg] = useState('');
  const [applied, setApplied] = useState<{
    resources: number;
    metrics: number;
    notices: string[];
  } | null>(null);
  const API = import.meta.env.VITE_DISCOVER_API ?? '';

  const useAccount = accountId.trim().length > 0;
  // 계정 ID가 정확히 12자리 숫자로 완성됐는지. "계정 확인" 버튼 활성화 기준.
  const accountIdComplete = /^\d{12}$/.test(accountId.trim());
  const validated = useAccount && validatedId === accountId.trim();

  function flash(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(''), 1800);
  }

  // 계정 ID 입력값만 갱신한다. 값이 검증된 ID와 달라지면 `validated`가 자동으로 false가 되어
  // "계정 확인" 버튼이 다시 활성화된다. 단, 이미 불러온 리소스 목록·AI 결과는 지우지 않는다.
  // 리스트 재로드는 오직 "계정 확인"(validateRole) 또는 "새로고침"(refreshResources)에서만.
  function editAccount(v: string) {
    setAccountId(v);
  }

  function showList(list: DiscoveredResource[]) {
    setFound(list);
    setQuery('');
    setPicked(
      new Set(list.map((_, i) => i).filter((i) => !list[i].unsupported && list[i].typeKey)),
    );
  }

  function toggle(i: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function selectAll() {
    if (!found) return;
    setPicked(new Set(found.map((_, i) => i).filter((i) => found[i].typeKey)));
  }

  function clearAll() {
    setPicked(new Set());
  }

  /** 한 묶음(EC2/RDS/ELB)의 선택 가능한 항목을 한 번에 켜거나 끈다. */
  function toggleGroup(indexes: number[], on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const i of indexes) {
        if (on) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  }

  function createCards() {
    if (!found) return;
    const selected = [...picked].map((i) => found[i]).filter((r) => r.typeKey);
    if (!onAdd(toResourceEntries(selected))) return;
    flash(`${selected.length}개 리소스 카드로 교체됨`);
  }

  function apply(json: string) {
    setError('');
    try {
      const result = parseIntake(json);
      // 확인창에서 취소하면 적용/스크롤/피드백 없이 그대로 둔다.
      if (!onApply(result)) return;
      const metrics = result.resources.reduce((s, r) => s + r.selected.length, 0);
      setApplied({
        resources: result.resources.length,
        metrics,
        notices: intakeNotices(result),
      });
      flash('제안 적용됨');
    } catch (e) {
      setError(e instanceof Error ? e.message : '파싱 실패');
    }
  }

  // 공통 로더: 주어진 계정 ID로 현재 리전 기준 리소스를 조회해 목록을 갱신한다.
  // markValidated=true 면 그 계정을 "검증됨"으로 승격한다(계정 확인 경로).
  async function loadResources(id: string, markValidated: boolean) {
    const res = await fetch(
      `${API}/api/discover?accountId=${encodeURIComponent(id)}&region=${encodeURIComponent(
        global.region,
      )}`,
      { credentials: 'same-origin' },
    );
    const t = await res.text();
    if (!res.ok) {
      const j = JSON.parse(t) as { error?: string };
      throw new Error(j.error ?? `백엔드 오류 (${res.status})`);
    }
    const d = JSON.parse(t) as { account?: string; alias?: string; warnings?: string[] };
    setDiscoverWarnings(Array.isArray(d.warnings) ? d.warnings : []);
    setValidatedAccount(d.account ?? id);
    setValidatedAlias(d.alias ?? '');
    if (markValidated) {
      setValidatedId(id);
      onValidatedRole?.({ accountId: id, account: d.account ?? id });
    }
    showList(parseDiscovery(t));
  }

  // "계정 확인" — 입력한 계정 ID를 검증하고 리소스를 불러온다.
  // 리스트 재로드는 이 버튼(그리고 아래 새로고침)에서만 일어난다.
  async function validateRole() {
    setAccountError('');
    setValidating(true);
    try {
      await loadResources(accountId.trim(), true);
      flash('계정 확인됨 · 리소스 불러옴');
    } catch (e) {
      setValidatedId('');
      setValidatedAccount('');
      setValidatedAlias('');
      setFound(null);
      setPicked(new Set());
      onValidatedRole?.(null);
      const m = e instanceof Error ? e.message : String(e);
      setAccountError(m.includes('fetch') ? '백엔드에 연결할 수 없습니다.' : m);
    } finally {
      setValidating(false);
    }
  }

  // "새로고침" — 이미 검증된 계정의 리소스를 현재 리전 기준으로 다시 불러온다.
  // (중간에 리소스를 추가했거나 리전을 바꿔 다시 조회하고 싶을 때) 검증 상태는 유지.
  async function refreshResources() {
    if (!validatedId) return;
    setAccountError('');
    setRefreshing(true);
    try {
      await loadResources(validatedId, false);
      flash('새로고침 완료');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setAccountError(m.includes('fetch') ? '백엔드에 연결할 수 없습니다.' : m);
    } finally {
      setRefreshing(false);
    }
  }

  const selectableCount = found?.filter((r) => r.typeKey).length ?? 0;

  // 검색어로 거른 뒤 종류별로 묶는다. 인덱스(i)는 원래 목록 기준이라 선택 상태와 그대로 맞는다.
  const q = query.trim().toLowerCase();
  const visibleGroups = KIND_ORDER.map((kind) => ({
    kind,
    items: (found ?? [])
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r }) =>
          r.kind === kind &&
          (!q ||
            r.label.toLowerCase().includes(q) ||
            r.resourceId.toLowerCase().includes(q) ||
            // ECS 클러스터 이름, 엔진 등 칩 정보로도 찾을 수 있게
            r.meta.some((m) => m.toLowerCase().includes(q))),
      ),
  })).filter((g) => g.items.length > 0);

  async function run() {
    setError('');
    setAnswer('');
    setResultJson('');
    setLoading(true);
    try {
      const params = new URLSearchParams({
        region: global.region,
        cat: catalogReference(),
      });
      // 계정 ID가 있으면(검증 후) 계정을 읽어 추천(/api/ai), 없으면 텍스트만 변환(/api/intake).
      let path = '/api/intake';
      if (useAccount) {
        params.set('q', text.trim() || DEFAULT_ACCOUNT_QUESTION);
        params.set('accountId', accountId.trim());
        path = '/api/ai';
      } else {
        params.set('q', text.trim());
      }
      const res = await fetch(`${API}${path}?${params.toString()}`, { credentials: 'same-origin' });
      const t = await res.text();
      if (!res.ok) {
        const j = JSON.parse(t) as { error?: string };
        throw new Error(j.error ?? `백엔드 오류 (${res.status})`);
      }
      const d = JSON.parse(t) as { answer?: string; proposal?: string };
      // 계정 추천은 사람이 읽을 답변을 함께 보여주고, 텍스트 변환은 JSON만 노출한다.
      if (useAccount) setAnswer(d.answer ?? '');
      // 백엔드가 준 proposal을 쓰되, 비어 있으면 답변에서 직접 JSON을 뽑아 적용 버튼이 뜨게 한다.
      setResultJson(d.proposal?.trim() || extractProposal(d.answer ?? ''));
      flash('완료 — 확인 후 적용하세요');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m.includes('fetch') ? '백엔드에 연결할 수 없습니다.' : m);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    {/* 계정 연결 (선택) — AI 어시스턴트 위에 별도 패널로 둔다 */}
    <section className="panel">
      <div className="panel-head">
        <div className="header-title">
          <h2 style={{ marginBottom: 2 }}>계정 연결 (선택)</h2>
          <span className="hint" style={{ margin: 0 }}>
            계정을 연결하면 리소스를 읽어 카드로 만들거나, 그 리소스 기준으로 추천받습니다.
          </span>
        </div>
      </div>

      {/* 한 줄: [계정 ID(연결되면 초록 + 별칭)] [리전] [확인] [새로고침] */}
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="account-id-input">계정 ID (12자리 숫자)</label>
        <div className="account-row">
          <span className={`account-input ${validated ? 'is-connected' : ''}`}>
            <input
              id="account-id-input"
              value={accountId}
              placeholder="055251234567"
              inputMode="numeric"
              aria-describedby={validated ? 'account-connected' : undefined}
              title={
                validated
                  ? `연결됨 · ${validatedAccount}${validatedAlias ? ` (${validatedAlias})` : ''}`
                  : undefined
              }
              onChange={(e) => editAccount(e.target.value)}
            />
            {validated && (
              <span id="account-connected" className="account-input-suffix">
                {validatedAlias ? validatedAlias : '연결됨'}
              </span>
            )}
          </span>
          <button
            className={`btn ${validated ? 'btn-done' : 'btn-primary'}`}
            onClick={validateRole}
            disabled={!accountIdComplete || validating || validated || needsLogin}
          >
            {validating ? '확인 중…' : validated ? '확인됨 ✓' : '계정 확인'}
          </button>
          {validated && (
            <button
              className="btn btn-ghost"
              title={`현재 리전(${global.region}) 기준으로 이 계정 리소스를 다시 불러옵니다`}
              onClick={refreshResources}
              disabled={refreshing}
            >
              {refreshing ? '새로고침 중…' : '↻ 새로고침'}
            </button>
          )}
        </div>
      </div>

      {found && (
        <div className="discover">
          {/* 툴바: 검색(왼쪽) + 개수·일괄 선택(오른쪽) */}
          <div className="discover-toolbar">
            <input
              className="discover-search"
              value={query}
              placeholder="이름 또는 ID로 찾기"
              aria-label="리소스 검색"
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="discover-count">
              선택 <strong>{picked.size}</strong> / {selectableCount}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={selectableCount === 0 || picked.size === selectableCount}
              onClick={selectAll}
            >
              전체 선택
            </button>
            <button className="btn btn-ghost btn-sm" disabled={picked.size === 0} onClick={clearAll}>
              전체 해제
            </button>
          </div>

          {discoverWarnings.length > 0 && (
            <p className="discover-warn" role="status">
              일부 조회 실패: {discoverWarnings.join(' · ')}
            </p>
          )}

          {/* 목록: 종류별 묶음. 길어지면 이 안에서만 스크롤 */}
          <div className="discover-scroll">
            {found.length === 0 && <p className="discover-empty">이 리전에 불러올 리소스가 없습니다.</p>}
            {found.length > 0 && visibleGroups.length === 0 && (
              <p className="discover-empty">“{query}”와 일치하는 리소스가 없습니다.</p>
            )}
            {visibleGroups.map(({ kind, items }) => {
              const selectable = items.filter(({ r }) => r.typeKey).map(({ i }) => i);
              const pickedInGroup = selectable.filter((i) => picked.has(i)).length;
              const all = selectable.length > 0 && pickedInGroup === selectable.length;
              return (
                <div key={kind} className="discover-group">
                  <label className="discover-group-head">
                    <input
                      type="checkbox"
                      disabled={selectable.length === 0}
                      checked={all}
                      ref={(el) => {
                        if (el) el.indeterminate = pickedInGroup > 0 && !all;
                      }}
                      onChange={() => toggleGroup(selectable, !all)}
                    />
                    <span className="discover-group-name">{KIND_LABEL[kind]}</span>
                    <span className="discover-group-count">{items.length}</span>
                  </label>
                  <ul className="discover-list">
                    {items.map(({ r, i }) => {
                      const on = picked.has(i);
                      return (
                        <li key={i}>
                          <label
                            className={`discover-row ${on ? 'on' : ''} ${r.typeKey ? '' : 'unsupported'}`}
                            title={r.unsupported ?? r.resourceId}
                          >
                            <input
                              type="checkbox"
                              disabled={!r.typeKey}
                              checked={on}
                              onChange={() => toggle(i)}
                            />
                            <span className="discover-main">
                              <span className="discover-label">{r.label}</span>
                              {/* Lambda·RDS 처럼 이름과 ID가 같으면 같은 글자를 두 번 쓰지 않는다 */}
                              {r.resourceId !== r.label && (
                                <code className="discover-id">{r.resourceId}</code>
                              )}
                            </span>
                            <span className="discover-chips">
                              {r.meta.map((m) => (
                                <span key={m} className="d-chip">
                                  {m}
                                </span>
                              ))}
                              {r.state && (
                                <span className={`d-chip state-${r.state === 'running' ? 'ok' : r.state === 'stopped' ? 'off' : 'warn'}`}>
                                  {r.state}
                                </span>
                              )}
                              {r.unsupported && <span className="d-chip state-warn">미지원</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="discover-footer">
            <span className="hint" style={{ margin: 0 }}>
              선택한 리소스만 카드로 적용되며 기존 카드는 교체됩니다.
            </span>
            <button className="btn btn-primary" disabled={picked.size === 0} onClick={createCards}>
              {picked.size > 0 ? `선택한 ${picked.size}개 카드 적용` : '리소스를 선택하세요'}
            </button>
          </div>
        </div>
      )}

      {accountError && <p className="inline-error">{accountError}</p>}
    </section>

    <section className="panel">
      <div className="panel-head">
        <div className="header-title">
          <h2 style={{ marginBottom: 2 }}>AI 어시스턴트</h2>
          <span className="hint" style={{ margin: 0 }}>
            Amazon Bedrock · Claude Sonnet 5
          </span>
        </div>
        <div className="row-gap">{msg && <span className="copied">{msg}</span>}</div>
      </div>

      <p className="hint" style={{ marginTop: 0 }}>
        요구사항을 적으면 생성기 JSON으로 변환합니다.
        <br />
        결과를 적용하면 토글·임계값이 자동으로 채워집니다.
        AI는 제안만 하며 실제로 생성하지 않습니다.
      </p>

      {/* 1) 주 입력: 요구사항/질문 (계정 없이도 동작 — 맨 위에 배치) */}
      <label className="field" style={{ marginTop: 12 }}>
        <span>요구사항·질문{useAccount ? ' (선택)' : ''}</span>
        <textarea
          rows={4}
          value={text}
          placeholder="웹 서버 CPU, Memory 80% 넘으면 알람 걸어주세요."
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      <div className="actions">
        <button
          className="btn btn-primary"
          disabled={loading || (useAccount ? needsLogin || !validated : !text.trim())}
          onClick={run}
        >
          {loading ? '처리 중…' : useAccount ? 'AI에게 질문하기' : 'AI로 변환'}
        </button>
      </div>

      {answer && (
        <label className="field" style={{ marginTop: 12 }}>
          <span>AI 추천 (아래 모서리를 끌어 크기 조절)</span>
          <pre
            className="code"
            style={{
              height: '32vh',
              maxHeight: 'none',
              resize: 'vertical',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
            }}
          >
            {answer}
          </pre>
        </label>
      )}

      {resultJson && (
        <>
          <label className="field" style={{ marginTop: 12 }}>
            <span>제안 결과 (JSON)</span>
            <textarea
              rows={6}
              className="mono"
              value={resultJson}
              onChange={(e) => setResultJson(e.target.value)}
            />
          </label>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => apply(resultJson)}>
              적용 (토글·임계값 자동 입력)
            </button>
          </div>
        </>
      )}

      {useAccount && answer && !resultJson && (
        <p className="hint" style={{ marginTop: 8 }}>
          추천에서 적용할 JSON 제안을 추출하지 못했습니다. 다시 질문하거나 요구사항을 조금 더
          구체적으로 입력해 주세요.
        </p>
      )}

      {applied && (
        <div className="apply-summary">
          <div className="row-gap" style={{ flexWrap: 'wrap' }}>
            <span className="audit-chip ok">리소스 {applied.resources}개 추가</span>
            <span className="audit-chip ok">지표 {applied.metrics}개</span>
            {applied.notices.length > 0 && (
              <span className="audit-chip warn">확인 필요 {applied.notices.length}건</span>
            )}
          </div>
          {applied.notices.map((n, i) => (
            <p key={`n${i}`} className="inline-error" style={{ margin: '4px 0 0' }}>
              ⚠ {n}
            </p>
          ))}
        </div>
      )}

      {error && <p className="inline-error">{error}</p>}
    </section>
    </>
  );
}
