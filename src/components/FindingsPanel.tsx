import type { Finding } from '../types';
import { countByLevel } from '../lib/validate';

const LEVEL_LABEL: Record<Finding['level'], string> = {
  error: '오류',
  warning: '경고',
  info: '참고',
};

export function FindingsPanel({ findings }: { findings: Finding[] }) {
  const counts = countByLevel(findings);
  const ordered = [
    ...findings.filter((f) => f.level === 'error'),
    ...findings.filter((f) => f.level === 'warning'),
    ...findings.filter((f) => f.level === 'info'),
  ];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>사전 검증</h2>
        <span className="hint">AI 호출 전 결정론적 규칙 검사</span>
      </div>

      {findings.length === 0 ? (
        <p className="ok-line">통과. 규칙 위반 없음.</p>
      ) : (
        <>
          <p className="hint">
            오류 {counts.error} · 경고 {counts.warning} · 참고 {counts.info}
            {counts.error > 0 && ' — 오류가 있으면 다운로드가 잠깁니다.'}
          </p>
          <ul className="findings">
            {ordered.map((f, i) => (
              <li key={i} className={`finding finding-${f.level}`}>
                <div className="finding-head">
                  <span className={`tag tag-${f.level}`}>{LEVEL_LABEL[f.level]}</span>
                  <span className="finding-cat">{f.category}</span>
                  {f.alarmName && <code className="finding-alarm">{f.alarmName}</code>}
                </div>
                <p className="finding-msg">{f.message}</p>
                {f.fix && <p className="finding-fix">{f.fix}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
