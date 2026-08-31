import { useMemo, useState } from 'react';
import type { AlarmSpec, GlobalConfig } from '../types';
import { generateAudit } from '../lib/generateAudit';
import {
  auditAlarms,
  parseExistingAlarms,
  remediationAlarmNames,
  type AuditResult,
} from '../lib/audit';
import { generateCli } from '../lib/generateCli';
import { copyToClipboard, downloadText } from '../lib/io';
import { scanCreationViolations } from '../lib/safety';

interface Props {
  global: GlobalConfig;
  specs: AlarmSpec[];
}

export function AuditPanel({ global, specs }: Props) {
  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [showScript, setShowScript] = useState(false);

  const auditScript = useMemo(() => generateAudit(global), [global]);
  const slug = global.prefix.trim() || 'audit';

  const remediation = useMemo(() => {
    if (!result) return '';
    const names = remediationAlarmNames(result);
    const subset = specs.filter((s) => names.has(s.alarmName));
    return generateCli(global, subset);
  }, [result, specs, global]);

  // 코드 가드: 수정 스크립트도 put-metric-alarm 외 명령이 있으면 차단
  const remediationViolations = useMemo(() => scanCreationViolations(remediation), [remediation]);

  async function copy(label: string, text: string) {
    const ok = await copyToClipboard(text);
    setCopied(ok ? label : '복사 실패');
    setTimeout(() => setCopied(''), 1800);
  }

  function runDiff() {
    setError('');
    try {
      const existing = parseExistingAlarms(pasted);
      setResult(auditAlarms(specs, existing));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : '파싱 실패');
    }
  }

  const canAudit = specs.length > 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>감사 — 표준 준수 검사</h2>
        {copied && <span className="copied">{copied}</span>}
      </div>

      <p className="hint" style={{ marginTop: 0 }}>
        표준을 적용하고 고객사 리소스 ID를 채운 상태에서, 그 고객사 계정에 이미 무엇이 있고 무엇이
        빠졌는지 비교합니다. 지표+디멘션으로 매칭하므로 다른 도구가 만든 알람도 잡힙니다.
      </p>

      {!canAudit && (
        <p className="hint">먼저 표준을 적용하고 리소스 ID를 입력하세요.</p>
      )}

      {canAudit && (
        <>
          <div className="audit-step">
            <button className="btn btn-ghost" onClick={() => setShowScript((v) => !v)}>
              {showScript ? '▾' : '▸'} 1. 감사 스크립트 (읽기 전용)
            </button>
            {showScript && (
              <>
                <pre className="code" style={{ maxHeight: '22vh' }}>
                  {auditScript}
                </pre>
                <div className="actions">
                  <button className="btn" onClick={() => copy('감사 스크립트 복사됨', auditScript)}>
                    복사
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      downloadText(`${slug}-audit.sh`, auditScript, 'text/x-shellscript')
                    }
                  >
                    다운로드 (.sh)
                  </button>
                </div>
                <p className="hint">
                  고객사 CloudShell에서 실행 → 출력 전체를 아래에 붙여넣으세요.
                </p>
              </>
            )}
          </div>

          <label className="field" style={{ marginTop: 12 }}>
            <span>2. 감사 결과 붙여넣기 (describe-alarms JSON)</span>
            <textarea
              rows={4}
              className="mono"
              value={pasted}
              placeholder='[ { "AlarmName": "...", "Namespace": "AWS/EC2", ... } ]'
              onChange={(e) => setPasted(e.target.value)}
            />
          </label>
          <div className="actions">
            <button className="btn btn-primary" disabled={!pasted.trim()} onClick={runDiff}>
              표준과 비교
            </button>
          </div>

          {error && <p className="inline-error">{error}</p>}

          {result && <AuditResultView result={result} />}

          {result && (result.missing.length > 0 || result.mismatches.length > 0) && (
            <div style={{ marginTop: 14 }}>
              <div className="panel-head">
                <h2 style={{ fontSize: 13 }}>
                  누락·수정분만 생성 (
                  {result.missing.length + result.mismatches.length}건)
                </h2>
              </div>
              <pre className="code" style={{ maxHeight: '30vh' }}>
                {remediation}
              </pre>
              {remediationViolations.length > 0 && (
                <p className="inline-error">
                  ⛔ 안전 가드: 허용되지 않은 명령 감지 ({remediationViolations.join(', ')}). 차단됨.
                </p>
              )}
              <div className="actions">
                <button
                  className="btn btn-primary"
                  disabled={remediationViolations.length > 0}
                  onClick={() => copy('CLI 복사됨', remediation)}
                >
                  CLI 복사
                </button>
                <button
                  className="btn"
                  disabled={remediationViolations.length > 0}
                  onClick={() =>
                    downloadText(`${slug}-remediation.sh`, remediation, 'text/x-shellscript')
                  }
                >
                  다운로드 (.sh)
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AuditResultView({ result }: { result: AuditResult }) {
  return (
    <div className="audit-result">
      <div className="audit-counts">
        <span className="audit-chip ok">일치 {result.matches.length}</span>
        <span className="audit-chip warn">임계값 다름 {result.mismatches.length}</span>
        <span className="audit-chip err">누락 {result.missing.length}</span>
        <span className="audit-chip muted">표준 외 {result.extra.length}</span>
      </div>

      {result.ambiguous.length > 0 && (
        <p className="hint">
          지표+디멘션이 같은 기존 알람이 여러 개라 매칭이 모호한 항목: {result.ambiguous.length}건.
          첫 번째 것과 비교했습니다.
        </p>
      )}

      {result.mismatches.length > 0 && (
        <div className="audit-group">
          <h3>임계값 다름 — 표준과 어긋남</h3>
          {result.mismatches.map((m) => (
            <div key={m.spec.alarmName} className="audit-item">
              <code>{m.spec.alarmName}</code>
              <span className="audit-existing">기존: {m.existingName}</span>
              <ul>
                {m.diffs.map((d) => (
                  <li key={d.field}>
                    {d.field}: 표준 <b>{d.expected}</b> ← 현재 {d.actual}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {result.missing.length > 0 && (
        <div className="audit-group">
          <h3>누락 — 표준엔 있는데 계정엔 없음</h3>
          <ul className="audit-flat">
            {result.missing.map((s) => (
              <li key={s.alarmName}>
                <code>{s.alarmName}</code>
                <span className="audit-existing">
                  {s.namespace} {s.metricName}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.extra.length > 0 && (
        <div className="audit-group">
          <h3>표준 외 — 계정엔 있지만 표준에 없음 (참고)</h3>
          <ul className="audit-flat">
            {result.extra.map((a, i) => (
              <li key={i}>
                <code>{a.AlarmName ?? '(이름 없음)'}</code>
                <span className="audit-existing">
                  {a.Namespace ?? '?'} {a.MetricName ?? '?'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
