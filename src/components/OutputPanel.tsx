import { useMemo, useState } from 'react';
import type { AlarmSpec, Finding, GlobalConfig, ResourceEntry } from '../types';
import { buildAiPrompt } from '../lib/aiPrompt';
import { generatePreflight } from '../lib/generatePreflight';
import { buildProjectFile, copyToClipboard, downloadText } from '../lib/io';
import { scanCreationViolations, scanForbidden } from '../lib/safety';

type Tab = 'cli' | 'preflight' | 'json' | 'ai';

interface Props {
  global: GlobalConfig;
  resources: ResourceEntry[];
  specs: AlarmSpec[];
  findings: Finding[];
  script: string;
  workloadNote: string;
  onWorkloadNoteChange: (v: string) => void;
}

export function OutputPanel({
  global,
  resources,
  specs,
  findings,
  script,
  workloadNote,
  onWorkloadNoteChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('cli');
  const [copied, setCopied] = useState('');

  const hasError = findings.some((f) => f.level === 'error');

  const projectJson = useMemo(
    () => JSON.stringify(buildProjectFile(global, resources), null, 2),
    [global, resources],
  );

  const aiPrompt = useMemo(
    () => buildAiPrompt({ global, specs, findings, script, workloadNote }),
    [global, specs, findings, script, workloadNote],
  );

  const preflight = useMemo(() => generatePreflight(global, specs), [global, specs]);

  // 코드 가드: 산출 스크립트에 파괴적/비허용 명령이 섞이면 다운로드·복사를 막는다.
  const violations = useMemo(
    () => [...scanCreationViolations(script), ...scanForbidden(preflight)],
    [script, preflight],
  );

  const blocked = hasError || specs.length === 0 || violations.length > 0;

  const body =
    tab === 'cli'
      ? script
      : tab === 'preflight'
        ? preflight
        : tab === 'json'
          ? projectJson
          : aiPrompt;

  async function copy(label: string, text: string) {
    const ok = await copyToClipboard(text);
    setCopied(ok ? label : '복사 실패');
    setTimeout(() => setCopied(''), 1800);
  }

  const slug = global.prefix.trim() || 'alarms';

  return (
    <section className="panel output">
      <div className="panel-head">
        <div className="tabs">
          <button className={tab === 'cli' ? 'tab tab-on' : 'tab'} onClick={() => setTab('cli')}>
            CLI
          </button>
          <button
            className={tab === 'preflight' ? 'tab tab-on' : 'tab'}
            onClick={() => setTab('preflight')}
          >
            사전 점검
          </button>
          <button className={tab === 'json' ? 'tab tab-on' : 'tab'} onClick={() => setTab('json')}>
            JSON
          </button>
          <button className={tab === 'ai' ? 'tab tab-on' : 'tab'} onClick={() => setTab('ai')}>
            AI 검토 프롬프트
          </button>
        </div>
        {copied && <span className="copied">{copied}</span>}
      </div>

      {tab === 'preflight' && (
        <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
          읽기 전용 점검 스크립트입니다. 아무것도 만들지 않습니다. CloudShell에서 이걸 먼저
          돌리면 <strong>이미 존재하는 알람</strong>과 <strong>실제로 존재하지 않는 지표</strong>를
          알려줍니다. AI는 이 사실을 알 수 없어 API로 확인합니다.
        </p>
      )}

      {tab === 'ai' && (
        <label className="field">
          <span>워크로드 특성 (AI 판단 근거)</span>
          <textarea
            rows={2}
            value={workloadNote}
            placeholder="예: 주간 트래픽 집중 B2B API. 야간 트래픽 거의 없음. 온콜은 Slack만 운영."
            onChange={(e) => onWorkloadNoteChange(e.target.value)}
          />
          <small>
            프롬프트 복사 → AI에 붙여넣기 → 받은 JSON을 아래 "AI 응답"에 붙이면 검토 결과가
            보기 좋게 표시됩니다.
          </small>
        </label>
      )}

      <pre className="code">{body}</pre>

      {tab === 'ai' && <AiReviewResult />}

      <div className="actions">
        <button
          className="btn btn-primary"
          disabled={blocked}
          onClick={() => downloadText(`${slug}-alarms.sh`, script, 'text/x-shellscript')}
        >
          CLI 다운로드 (.sh)
        </button>
        <button
          className="btn"
          disabled={specs.length === 0}
          onClick={() => downloadText(`${slug}-preflight.sh`, preflight, 'text/x-shellscript')}
        >
          사전 점검 다운로드 (.sh)
        </button>
        <button
          className="btn"
          disabled={specs.length === 0}
          onClick={() => downloadText(`${slug}-alarms.json`, projectJson, 'application/json')}
        >
          JSON 다운로드
        </button>
        <button className="btn" disabled={blocked} onClick={() => copy('CLI 복사됨', script)}>
          CLI 복사
        </button>
        <button
          className="btn"
          disabled={specs.length === 0}
          onClick={() => copy('AI 프롬프트 복사됨', aiPrompt)}
        >
          AI 프롬프트 복사
        </button>
      </div>

      {violations.length > 0 && (
        <p className="inline-error">
          ⛔ 안전 가드: 산출물에 허용되지 않은 명령이 감지되어 다운로드·복사를 차단했습니다 —{' '}
          {violations.join(', ')}. 이 도구는 알람 생성(put-metric-alarm)만 산출해야 합니다.
        </p>
      )}
      {hasError && violations.length === 0 && (
        <p className="inline-error">
          사전 검증 오류를 먼저 해결하세요. CLI 다운로드와 복사가 잠겨 있습니다.
        </p>
      )}

      <details className="runbook">
        <summary>CloudShell 실행 순서</summary>
        <ol>
          <li>CloudShell을 열고 우상단 리전이 <code>{global.region}</code>인지 확인</li>
          <li><code>aws sts get-caller-identity</code>로 계정·역할 확인</li>
          <li>스크립트 붙여넣기 (heredoc 권장)</li>
          <li>리전, SNS ARN, 알람 개수 육안 확인</li>
          <li>
            <strong>사전 점검 스크립트(.sh)를 먼저 실행</strong> — 이미 존재하는 알람과 실제로
            존재하지 않는 지표를 알려줍니다 (읽기 전용)
          </li>
          <li>
            <strong>첫 알람 1건만 먼저 실행</strong>해 권한 확인 (특히{' '}
            <code>cloudwatch:TagResource</code>)
          </li>
          <li>전체 실행</li>
          <li><code>describe-alarms</code>로 개수·임계값 확인</li>
          <li>
            <code>--state-value INSUFFICIENT_DATA</code>로 조회 — 걸리면 지표·디멘션 오타 신호
          </li>
          <li>
            <code>set-alarm-state</code>로 1건 강제 ALARM 처리해 SNS 도달 확인
          </li>
        </ol>
      </details>
    </section>
  );
}

interface AiVerdict {
  verdict?: string;
  summary?: string;
  findings?: {
    severity?: string;
    category?: string;
    alarmName?: string | null;
    issue?: string;
    why?: string;
    fix?: string;
    confidence?: string;
  }[];
  missingRecommendations?: { metric?: string; reason?: string }[];
  readyToExport?: boolean;
}

const sevClass = (s?: string) =>
  s === 'critical' ? 'error' : s === 'warning' ? 'warning' : 'info';

/** AI가 돌려준 검토 JSON을 붙여넣으면 보기 좋게 렌더한다. */
function AiReviewResult() {
  const [raw, setRaw] = useState('');
  const [v, setV] = useState<AiVerdict | null>(null);
  const [err, setErr] = useState('');

  function parse() {
    setErr('');
    try {
      setV(JSON.parse(raw) as AiVerdict);
    } catch (e) {
      setV(null);
      setErr(e instanceof Error ? e.message : '파싱 실패');
    }
  }

  const verdictClass = v?.verdict === 'fail' ? 'err' : v?.verdict === 'pass' ? 'ok' : 'warn';

  return (
    <div style={{ marginTop: 12 }}>
      <label className="field">
        <span>AI 응답 (검토 JSON) 붙여넣기</span>
        <textarea
          rows={3}
          className="mono"
          value={raw}
          placeholder='{ "verdict": "pass_with_warnings", "findings": [...] }'
          onChange={(e) => setRaw(e.target.value)}
        />
      </label>
      <div className="actions">
        <button className="btn btn-primary" disabled={!raw.trim()} onClick={parse}>
          검토 결과 보기
        </button>
      </div>
      {err && <p className="inline-error">{err}</p>}

      {v && (
        <div className="audit-result">
          <div className="audit-counts">
            <span className={`audit-chip ${verdictClass}`}>{v.verdict ?? '?'}</span>
            {typeof v.readyToExport === 'boolean' && (
              <span className="audit-chip muted">
                {v.readyToExport ? 'export 가능' : 'export 보류'}
              </span>
            )}
          </div>
          {v.summary && <p className="hint">{v.summary}</p>}

          <ul className="findings">
            {(v.findings ?? []).map((f, i) => (
              <li key={i} className={`finding finding-${sevClass(f.severity)}`}>
                <div className="finding-head">
                  <span className={`tag tag-${sevClass(f.severity)}`}>{f.severity}</span>
                  <span className="finding-cat">{f.category}</span>
                  {f.confidence && <span className="finding-cat">확신 {f.confidence}</span>}
                  {f.alarmName && <code className="finding-alarm">{f.alarmName}</code>}
                </div>
                {f.issue && <p className="finding-msg">{f.issue}</p>}
                {f.why && <p className="finding-fix">{f.why}</p>}
                {f.fix && <p className="finding-fix">→ {f.fix}</p>}
              </li>
            ))}
          </ul>

          {(v.missingRecommendations ?? []).length > 0 && (
            <div className="audit-group">
              <h3>추천 (빠진 알람)</h3>
              <ul className="audit-flat">
                {v.missingRecommendations!.map((m, i) => (
                  <li key={i}>
                    <code>{m.metric}</code>
                    <span className="audit-existing">{m.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
