import { useEffect, useMemo, useState } from 'react';
import type { AlarmSpec, Finding, GlobalConfig, ResourceEntry } from '../types';
import { generatePreflight } from '../lib/generatePreflight';
import { buildProjectFile, copyToClipboard, downloadText } from '../lib/io';
import { scanCreationViolations, scanForbidden } from '../lib/safety';

type Tab = 'ai' | 'preflight' | 'cli' | 'json';
type FileTab = Exclude<Tab, 'ai'>;

interface Props {
  global: GlobalConfig;
  resources: ResourceEntry[];
  specs: AlarmSpec[];
  findings: Finding[];
  script: string;
  /** AI 어시스턴트에서 검증된 계정(있으면 계정 대조 AI 점검 가능). */
  validatedRole?: { accountId: string; account: string } | null;
  /** 적용 이벤트가 일어날 때마다 증가. 바뀌면 점검 탭으로 전환한다. */
  applyNonce?: number;
  /** 로그인 상태 (백엔드 OAuth 구성 시) */
  authenticated?: boolean;
  authRequired?: boolean;
}

interface PreflightRow {
  name: string;
  metric: string;
  status: 'new' | 'update';
  metricMissing: boolean;
  metricUnknown: boolean;
  thresholdChanged: boolean;
  existingThreshold: number | null;
  newThreshold: number | null;
}
interface PreflightResult {
  mode: 'account' | 'review';
  account?: string;
  rows?: PreflightRow[];
  summary?: { total: number; create: number; update: number; missing: number; thresholdChanged: number };
  judgment: string;
}

type Verdict = 'ok' | 'warn' | 'hold' | 'none';
const VERDICT_LABEL: Record<Verdict, string> = {
  ok: '✅ 실행 가능',
  warn: '⚠️ 주의 후 실행',
  hold: '⛔ 보류',
  none: '결론',
};

/**
 * AI 판단 텍스트에서 "결론:" 줄을 뽑아 맨 앞에 보여준다.
 * 프롬프트가 첫 줄을 "결론: [판정] ..." 으로 쓰게 하지만, 모델이 형식을 어기면
 * 결론 없이 전체를 근거로만 보여준다(내용은 절대 버리지 않는다).
 */
function splitJudgment(text: string): { verdict: Verdict; conclusion: string; detail: string } {
  const lines = text.split('\n');
  // 마크다운 강조(**결론:**) 가 섞여도 찾을 수 있게 * 와 앞뒤 공백을 무시한다.
  const idx = lines.findIndex((l) => /^\s*[*#\s]*결론\s*[:：]/.test(l));
  if (idx === -1) return { verdict: 'none', conclusion: '', detail: text.trim() };

  let conclusion = lines[idx].replace(/^\s*[*#\s]*결론\s*[:：]\s*/, '').replace(/\*\*/g, '').trim();
  let verdict: Verdict = 'none';
  const m = conclusion.match(/^\[(실행 가능|주의 후 실행|보류)\]\s*/);
  if (m) {
    verdict = m[1] === '실행 가능' ? 'ok' : m[1] === '보류' ? 'hold' : 'warn';
    conclusion = conclusion.slice(m[0].length);
  }
  const detail = lines
    .filter((_, i) => i !== idx)
    .join('\n')
    .trim();
  return { verdict, conclusion, detail };
}

function toPreflightPayload(specs: AlarmSpec[]) {
  return specs.map((s) => ({
    name: s.alarmName,
    ns: s.namespace,
    metric: s.metricName,
    dims: s.dimensions.filter((d) => d.value).map((d) => ({ name: d.name, value: d.value })),
    threshold: s.threshold,
    displayThreshold: s.displayThreshold,
    unit: s.thresholdUnit,
    comparison: s.comparisonOperator,
    stat: s.statistic ?? s.extendedStatistic,
    period: s.period,
    evaluationPeriods: s.evaluationPeriods,
    datapointsToAlarm: s.datapointsToAlarm,
    treatMissingData: s.treatMissingData,
    anomaly: s.anomaly,
  }));
}

export function OutputPanel({
  global,
  resources,
  specs,
  findings,
  script,
  validatedRole,
  applyNonce,
  authenticated = false,
  authRequired = false,
}: Props) {
  const needsLogin = authRequired && !authenticated;
  const [tab, setTab] = useState<Tab>('ai');
  const [copied, setCopied] = useState('');
  const [nonce, setNonce] = useState(0); // 새로고침 시 파생 산출물 재계산 트리거

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<PreflightResult | null>(null);
  // 결과를 만들 때의 알람 구성·계정 시그니처. 현재와 다르면 "이전 기준 결과"로 표시한다.
  const [aiSig, setAiSig] = useState('');
  const API = import.meta.env.VITE_DISCOVER_API ?? '';

  async function runAiPreflight() {
    if (specs.length === 0) return;
    const sigAtRun = currentSig;
    setAiError('');
    setAiLoading(true);
    setAiResult(null);
    try {
      const payload = toPreflightPayload(specs);
      const params = new URLSearchParams({
        region: global.region,
        specs: JSON.stringify(payload),
      });
      // 계정이 검증돼 있으면 계정 대조까지, 없으면 정의 검토만.
      if (validatedRole) params.set('accountId', validatedRole.accountId);
      const res = await fetch(`${API}/api/preflight?${params.toString()}`, {
        credentials: 'same-origin',
      });
      const t = await res.text();
      if (!res.ok) {
        const j = JSON.parse(t) as { error?: string };
        throw new Error(j.error ?? `백엔드 오류 (${res.status})`);
      }
      setAiResult(JSON.parse(t) as PreflightResult);
      setAiSig(sigAtRun);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setAiError(m.includes('fetch') ? '백엔드에 연결할 수 없습니다.' : m);
    } finally {
      setAiLoading(false);
    }
  }

  function refresh() {
    setNonce((n) => n + 1);
    setCopied('새로고침됨');
    setTimeout(() => setCopied(''), 1500);
    // 이미 AI 점검 결과가 있으면 새로고침 때 현재 구성으로 다시 점검한다.
    if ((aiResult || aiError) && !needsLogin && !aiLoading && specs.length > 0) {
      void runAiPreflight();
    }
  }

  // AI 점검 요청에 실제로 전달되는 전체 정의를 시그니처로 사용한다.
  // 기간·통계·M/N·연산자·결측 처리 변경도 즉시 "이전 기준"으로 표시된다.
  const preflightSig = useMemo(() => JSON.stringify(toPreflightPayload(specs)), [specs]);

  // 적용(AI/템플릿/카드 생성)이 일어나면 점검 탭으로 전환한다.
  useEffect(() => {
    if (applyNonce && applyNonce > 0) setTab('ai');
  }, [applyNonce]);

  // 알람 구성·계정이 바뀌어도 이전 결과는 지우지 않는다. 대신 "이전 기준" 으로 표시하고,
  // 재점검은 "AI 점검(다시 점검)" 또는 "새로고침"을 눌렀을 때만 한다(불필요한 호출 방지).
  const currentSig = `${preflightSig}|${validatedRole?.accountId ?? ''}|${global.region}`;
  const aiStale = Boolean(aiResult) && aiSig !== currentSig;

  const hasError = findings.some((f) => f.level === 'error');

  // 매 렌더마다 현재 global/resources 로 즉시 생성 → 좌측 카드 변경이 항상 반영된다.
  // (nonce 는 "새로고침"으로 generatedAt 만 갱신하고 싶을 때를 위해 참조만 해 둔다)
  void nonce;
  const projectJson = JSON.stringify(buildProjectFile(global, resources), null, 2);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const preflight = useMemo(() => generatePreflight(global, specs), [global, specs, nonce]);

  // 코드 가드: 산출 스크립트에 파괴적/비허용 명령이 섞이면 다운로드·복사를 막는다.
  const violations = useMemo(
    () => [...scanCreationViolations(script), ...scanForbidden(preflight)],
    [script, preflight],
  );

  const blocked = hasError || specs.length === 0 || violations.length > 0;

  // 파일 산출물 탭(점검 스크립트·CLI·JSON). AI 점검 탭은 파일이 없다.
  const fileTab: FileTab | null = tab === 'ai' ? null : tab;
  const body = fileTab === 'cli' ? script : fileTab === 'preflight' ? preflight : projectJson;

  const slug = global.prefix.trim() || 'alarms';
  const files: Record<FileTab, { file: string; mime: string; label: string; disabled: boolean }> = {
    cli: { file: `${slug}-alarms.sh`, mime: 'text/x-shellscript', label: 'CLI', disabled: blocked },
    preflight: {
      file: `${slug}-check.sh`,
      mime: 'text/x-shellscript',
      label: '점검 스크립트',
      disabled: specs.length === 0,
    },
    json: {
      file: `${slug}-alarms.json`,
      mime: 'application/json',
      label: 'JSON',
      disabled: specs.length === 0,
    },
  };
  const dl = fileTab ? files[fileTab] : null;

  async function copy(label: string, text: string) {
    const ok = await copyToClipboard(text);
    setCopied(ok ? label : '복사 실패');
    setTimeout(() => setCopied(''), 1800);
  }

  return (
    <section className="panel output">
      <div className="panel-head">
        <div className="tabs">
          <button className={tab === 'ai' ? 'tab tab-on' : 'tab'} onClick={() => setTab('ai')}>
            AI 점검
            {aiStale && <span className="tab-dot" title="점검 후 구성이 바뀌었습니다" />}
          </button>
          <button
            className={tab === 'preflight' ? 'tab tab-on' : 'tab'}
            onClick={() => setTab('preflight')}
          >
            점검 스크립트
          </button>
          <button className={tab === 'cli' ? 'tab tab-on' : 'tab'} onClick={() => setTab('cli')}>
            CLI
          </button>
          <button className={tab === 'json' ? 'tab tab-on' : 'tab'} onClick={() => setTab('json')}>
            JSON
          </button>
        </div>
        <div className="row-gap">
          {copied && <span className="copied">{copied}</span>}
          <button className="btn btn-ghost" onClick={refresh}>
            새로고침
          </button>
          {dl && (
            <>
              <button
                className="btn btn-ghost"
                disabled={dl.disabled}
                onClick={() =>
                  copy(
                    `${dl.label} 복사됨`,
                    // CLI·사전점검은 bash로 파이프하는 형태로 복사 → 붙여넣어도 명령이 되비치지
                    // 않고 결과만 출력된다. JSON은 그대로.
                    fileTab === 'json' ? body : `bash <<'CWALARM_EOF'\n${body}\nCWALARM_EOF\n`,
                  )
                }
              >
                복사
              </button>
              <button
                className="btn btn-primary"
                disabled={dl.disabled}
                onClick={() => downloadText(dl.file, body, dl.mime)}
              >
                다운로드
              </button>
            </>
          )}
        </div>
      </div>

      {tab === 'ai' && (
        <div className="ai-preflight-card">
          <div className="ai-preflight-head">
            <div className="ai-preflight-title">
              <strong>AI 점검</strong>
              <span className="hint" style={{ margin: 0 }}>
                {validatedRole
                  ? `계정 ${validatedRole.account} 대조 · 알람 ${specs.length}건`
                  : `정의·설정 검토 · 알람 ${specs.length}건 (계정 미연결)`}
              </span>
            </div>
            {!needsLogin && (
              <button
                className="btn btn-primary"
                disabled={aiLoading || specs.length === 0}
                onClick={runAiPreflight}
              >
                {aiLoading ? '점검 중…' : aiResult ? '↻ 다시 점검' : 'AI 점검'}
              </button>
            )}
          </div>

          {needsLogin ? (
            <div style={{ marginTop: 8 }}>
              <p className="hint" style={{ margin: 0 }}>
                AI 점검은 우측 상단에서 Slack 로그인 후 사용할 수 있습니다.
              </p>
            </div>
          ) : aiLoading ? (
            <p className="hint" style={{ margin: '8px 0 0', color: 'var(--accent)' }}>
              ⏳ AI가 분석 중입니다...
            </p>
          ) : aiError ? (
            <p className="inline-error" style={{ margin: '8px 0 0' }}>
              {aiError}
            </p>
          ) : aiResult ? (
            <>
              {aiStale && (
                <div className="ai-stale">
                  <span>
                    ⚠ 점검 후 알람 구성(또는 계정·리전)이 바뀌었습니다. 아래 결과는 <b>이전 기준</b>입니다.
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={aiLoading || specs.length === 0}
                    onClick={runAiPreflight}
                  >
                    ↻ 다시 점검
                  </button>
                </div>
              )}
              {/* 결론·판단 근거를 표보다 먼저 */}
              {aiResult.judgment &&
                (() => {
                  const j = splitJudgment(aiResult.judgment);
                  return (
                    <>
                      {/* 결론 1~2줄을 맨 앞에 */}
                      {j.conclusion && (
                        <div className={`ai-verdict ai-verdict-${j.verdict}`}>
                          <span className="ai-verdict-label">{VERDICT_LABEL[j.verdict]}</span>
                          <span>{j.conclusion}</span>
                        </div>
                      )}
                      {j.detail && (
                        <div className="ai-judgment">
                          <strong>AI 판단 근거</strong>
                          <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{j.detail}</p>
                        </div>
                      )}
                    </>
                  );
                })()}
              {aiResult.mode === 'account' && aiResult.summary && aiResult.rows ? (
                <>
                  <div className="row-gap" style={{ flexWrap: 'wrap', margin: '10px 0 8px' }}>
                    <span className="audit-chip ok">신규 {aiResult.summary.create}</span>
                    <span className="audit-chip">덮어쓰기 {aiResult.summary.update}</span>
                    {aiResult.summary.thresholdChanged > 0 && (
                      <span className="audit-chip warn">
                        임계값 변경 {aiResult.summary.thresholdChanged}
                      </span>
                    )}
                    {aiResult.summary.missing > 0 && (
                      <span className="audit-chip err">데이터 없음 {aiResult.summary.missing}</span>
                    )}
                  </div>
                  <div className="preflight-table-wrap">
                    <table className="preflight-table">
                      <colgroup>
                        <col className="pt-col-name" />
                        <col className="pt-col-metric" />
                        <col className="pt-col-status" />
                        <col className="pt-col-note" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>알람 이름</th>
                          <th>지표</th>
                          <th>상태</th>
                          <th>비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiResult.rows.map((r, i) => {
                          // "AWS/EC2 / CPUUtilization" → 네임스페이스(위, 흐리게) + 지표 이름(아래)
                          const cut = r.metric.lastIndexOf(' / ');
                          const ns = cut >= 0 ? r.metric.slice(0, cut) : '';
                          const metric = cut >= 0 ? r.metric.slice(cut + 3) : r.metric;
                          const note = r.metricMissing
                            ? { cls: 'err', text: '데이터 없음', title: '아직 수집된 데이터가 없습니다' }
                            : r.metricUnknown
                              ? { cls: 'muted', text: '확인 불가', title: '지표 존재 여부를 조회하지 못했습니다' }
                              : r.thresholdChanged
                                ? {
                                    cls: 'warn',
                                    text: `임계값 ${r.existingThreshold} → ${r.newThreshold}`,
                                    title: '기존 알람의 임계값이 바뀝니다',
                                  }
                                : r.status === 'new'
                                  ? { cls: 'ok', text: '지표 있음', title: '' }
                                  : { cls: 'muted', text: '동일 갱신', title: '' };
                          return (
                            <tr key={i}>
                              <td className="pt-name">
                                {/* 하이픈 뒤에서만 줄바꿈되게 해 단어가 중간에서 끊기지 않게 한다 */}
                                {r.name.split('-').map((part, j, arr) => (
                                  <span key={j}>
                                    {part}
                                    {j < arr.length - 1 && (
                                      <>
                                        -<wbr />
                                      </>
                                    )}
                                  </span>
                                ))}
                              </td>
                              <td className="pt-metric">
                                {ns && <span className="pt-ns">{ns}</span>}
                                <span className="pt-metric-name">{metric}</span>
                              </td>
                              <td>
                                <span className={`pt-chip ${r.status === 'new' ? 'ok' : 'warn'}`}>
                                  {r.status === 'new' ? '신규' : '덮어쓰기'}
                                </span>
                              </td>
                              <td>
                                <span className={`pt-chip ${note.cls}`} title={note.title || undefined}>
                                  {note.text}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {aiResult.summary.missing > 0 && (
                    <p className="hint" style={{ margin: '6px 0 0' }}>
                      “데이터 없음”은 지표 이름이 틀렸다는 뜻이 아니라 아직 수집된 데이터가 없다는 뜻일 수
                      있습니다. 생성 후 한동안 INSUFFICIENT_DATA로 보일 수 있습니다.
                    </p>
                  )}
                </>
              ) : (
                <p className="hint" style={{ margin: '10px 0 0' }}>
                  계정 미연결 상태라 정의·설정만 검토했습니다. 기존 알람·데이터 지표 대조는{' '}
                  <strong>AI 어시스턴트에서 계정을 검증</strong>하면 함께 확인됩니다.
                </p>
              )}
            </>
          ) : (
            <p className="hint" style={{ margin: '8px 0 0' }}>
              {validatedRole ? (
                <>
                  지표 정의를 검토하고 기존 알람·지표와 대조하여 신규 / 덮어쓰기 / 데이터 없음으로 구분해 표로 제공합니다.
                </>
              ) : (
                <>
                  <strong>AI 점검</strong>을 누르면 알람 정의의 문법·설정 타당성을 검토합니다. 계정을
                  연결(AI 어시스턴트에서 검증)하면 기존 알람·데이터까지 대조합니다.
                </>
              )}
            </p>
          )}
        </div>
      )}

      {tab === 'preflight' && (
        <p className="hint" style={{ margin: '0 0 6px' }}>
          읽기 전용 <strong>점검 스크립트</strong>입니다. CloudShell에서 실행하면 이미 존재하는 알람과 데이터
          없는 지표를 직접 확인할 수 있습니다.
        </p>
      )}

      {fileTab && <pre className="code">{body}</pre>}

      {fileTab && violations.length > 0 && (
        <p className="inline-error">
          ⛔ 안전 가드: 산출물에 허용되지 않은 명령이 감지되어 다운로드·복사를 차단했습니다 —{' '}
          {violations.join(', ')}. 이 도구는 알람 생성(put-metric-alarm)만 산출해야 합니다.
        </p>
      )}
      {fileTab && hasError && violations.length === 0 && (
        <p className="inline-error">
          사전 검증 오류를 먼저 해결하세요. CLI 다운로드와 복사가 잠겨 있습니다.
        </p>
      )}

      {fileTab && (
      <details className="runbook">
        <summary>CloudShell 실행 순서</summary>
        <ol>
          <li>CloudShell을 열고 우상단 리전이 <code>{global.region}</code>인지 확인</li>
          <li><code>aws sts get-caller-identity</code>로 계정·역할 확인</li>
          <li>
            스크립트를 <strong>파일로 저장</strong> — 둘 중 하나:
            <ul>
              <li>
                CloudShell 우상단 <strong>Actions → Upload file</strong> 로 다운로드한{' '}
                <code>{`${global.prefix.trim() || 'alarms'}-alarms.sh`}</code> 업로드
              </li>
              <li>
                또는 <code>{`cat > ${global.prefix.trim() || 'alarms'}-alarms.sh <<'EOF'`}</code> 입력 → 스크립트
                붙여넣기 → 마지막 줄에 <code>EOF</code> 입력 (heredoc)
              </li>
            </ul>
            <span className="hint" style={{ display: 'block', margin: '2px 0 0' }}>
              터미널에 바로 붙여넣으면 긴 스크립트가 줄 단위로 섞이거나 중간 오류 뒤에도 계속 실행될 수
              있습니다. 파일로 두면 실행 전 <code>less</code>로 내용을 다시 보고 같은 파일로 재실행할 수 있습니다.
            </span>
          </li>
          <li>리전, SNS ARN, 알람 개수 육안 확인</li>
          <li>
            <strong>점검 스크립트(.sh)를 먼저 실행</strong> — 이미 존재하는 알람과 실제로
            존재하지 않는 지표를 알려줍니다 (읽기 전용)
          </li>
          <li>
            <strong>첫 알람 1건만 먼저 실행</strong>해 권한 확인 (특히{' '}
            <code>cloudwatch:TagResource</code>)
          </li>
          <li>
            전체 실행: <code>{`bash ${global.prefix.trim() || 'alarms'}-alarms.sh`}</code>
          </li>
          <li><code>describe-alarms</code>로 개수·임계값 확인</li>
          <li>
            <code>--state-value INSUFFICIENT_DATA</code>로 조회 — 걸리면 지표·디멘션 오타 신호
          </li>
          <li>
            <code>set-alarm-state</code>로 1건 강제 ALARM 처리해 SNS 도달 확인
          </li>
        </ol>
      </details>
      )}
    </section>
  );
}
