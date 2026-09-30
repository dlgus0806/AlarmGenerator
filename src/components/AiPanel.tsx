import { useState } from 'react';
import type { GlobalConfig, ResourceEntry } from '../types';
import { catalogReference, intakeNotices, parseIntake, type IntakeApply } from '../lib/intake';
import { parseDiscovery, toResourceEntries, type DiscoveredResource } from '../lib/discovery';

interface Props {
  global: GlobalConfig;
  onApply: (result: IntakeApply) => boolean;
  onAdd: (entries: ResourceEntry[]) => void;
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

  const [answer, setAnswer] = useState('');
  const [resultJson, setResultJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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

  function createCards() {
    if (!found) return;
    const selected = [...picked].map((i) => found[i]).filter((r) => r.typeKey);
    onAdd(toResourceEntries(selected));
    flash(`${selected.length}개 리소스 카드 생성됨`);
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
    const d = JSON.parse(t) as { account?: string; alias?: string };
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
    setError('');
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
      setError(m.includes('fetch') ? '백엔드에 연결할 수 없습니다.' : m);
    } finally {
      setValidating(false);
    }
  }

  // "새로고침" — 이미 검증된 계정의 리소스를 현재 리전 기준으로 다시 불러온다.
  // (중간에 리소스를 추가했거나 리전을 바꿔 다시 조회하고 싶을 때) 검증 상태는 유지.
  async function refreshResources() {
    if (!validatedId) return;
    setError('');
    setRefreshing(true);
    try {
      await loadResources(validatedId, false);
      flash('새로고침 완료');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m.includes('fetch') ? '백엔드에 연결할 수 없습니다.' : m);
    } finally {
      setRefreshing(false);
    }
  }

  const selectableCount = found?.filter((r) => r.typeKey).length ?? 0;

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

      {/* 2) 선택: 계정 연결 (항상 표시). runbook 클래스로 구분선 — needsLogin 여부와 무관하게 노출 */}
      <div className="runbook">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>계정 연결 (선택)</div>
        <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
          계정을 연결하면 리소스를 읽어 더 정확히 추천합니다. 
        </p>

        {/* 계정 ID 입력 + 확인 버튼을 한 줄에 */}
        <label className="field" style={{ marginBottom: 0 }}>
          <span>계정 ID (12자리 숫자)</span>
          <div className="account-row">
            <input
              value={accountId}
              placeholder=" 055251234567"
              inputMode="numeric"
              onChange={(e) => editAccount(e.target.value)}
            />
            <button
              className={`btn ${validated ? 'btn-done' : 'btn-primary'}`}
              onClick={validateRole}
              disabled={!accountIdComplete || validating || validated || needsLogin}
            >
              {validating ? '확인 중…' : validated ? '확인됨 ✓' : '계정 확인'}
            </button>
          </div>
        </label>

        {/* 연결 상태: 어느 계정을 · 어느 리전으로 읽었는지 한눈에 */}
        {validated && (
          <div className="account-status">
            <span className="account-status-main">
              <span className="account-status-dot" aria-hidden="true" />
              연결됨
              <strong>{validatedAccount}</strong>
              {validatedAlias && <span className="account-status-alias">({validatedAlias})</span>}
              <span className="badge">{global.region}</span>
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={refreshResources}
              disabled={refreshing}
              title="현재 리전 기준으로 이 계정 리소스를 다시 불러옵니다"
            >
              {refreshing ? '새로고침 중…' : '↻ 새로고침'}
            </button>
          </div>
        )}

        {found && (
          <div style={{ marginTop: 12 }}>
            {/* 목록 툴바: 개수 요약(왼쪽) + 선택 버튼(오른쪽) */}
            <div className="list-toolbar">
              <span className="list-toolbar-count">
                리소스 <strong>{found.length}</strong>개 · 지원 <strong>{selectableCount}</strong>개 ·
                선택 <strong>{picked.size}</strong>개
              </span>
              <span className="row-gap">
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={selectableCount === 0}
                  onClick={selectAll}
                >
                  전체 선택
                </button>
                <button className="btn btn-ghost btn-sm" disabled={picked.size === 0} onClick={clearAll}>
                  전체 해제
                </button>
              </span>
            </div>
            <ul className="discover-list">
              {found.map((r, i) => (
                <li key={i} className={`discover-row ${r.typeKey ? '' : 'unsupported'}`}>
                  <label className="checkline">
                    <input
                      type="checkbox"
                      disabled={!r.typeKey}
                      checked={picked.has(i)}
                      onChange={() => toggle(i)}
                    />
                    <span className="discover-label">{r.label}</span>
                  </label>
                  <code className="discover-id">{r.resourceId}</code>
                  <span className="discover-detail">
                    {r.unsupported ? `${r.detail} · ${r.unsupported}` : r.detail}
                  </span>
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn btn-primary" disabled={picked.size === 0} onClick={createCards}>
                선택한 리소스로 카드 생성
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="inline-error">{error}</p>}
    </section>
  );
}
