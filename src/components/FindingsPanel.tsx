import { useState } from 'react';
import type { Finding } from '../types';
import { countByLevel } from '../lib/validate';

const LEVEL_LABEL: Record<Finding['level'], string> = {
  error: '오류',
  warning: '경고',
  info: '참고',
};

const LEVEL_ORDER: Finding['level'][] = ['error', 'warning', 'info'];

interface FindingGroup {
  key: string;
  level: Finding['level'];
  category: string;
  fix?: string;
  items: Finding[];
  /** 묶인 항목의 메시지가 모두 같은지(같으면 제목 한 줄로 충분) */
  sameMessage: boolean;
}

/**
 * 같은 참고 사항을 하나로 묶는다.
 * 키: 수준 + 분류 + (해결 안내가 있으면 그 안내, 없으면 메시지).
 * 예: "period 30초는 고해상도 알람입니다." 가 알람 10개에 뜨면 1건 ×10 으로 합쳐진다.
 */
function groupFindings(findings: Finding[]): FindingGroup[] {
  const map = new Map<string, FindingGroup>();
  for (const f of findings) {
    const key = `${f.level}|${f.category}|${f.fix ?? f.message}`;
    const g = map.get(key);
    if (g) {
      g.items.push(f);
      if (f.message !== g.items[0].message) g.sameMessage = false;
    } else {
      map.set(key, { key, level: f.level, category: f.category, fix: f.fix, items: [f], sameMessage: true });
    }
  }
  const groups = [...map.values()];
  return LEVEL_ORDER.flatMap((lv) => groups.filter((g) => g.level === lv));
}

export function FindingsPanel({ findings }: { findings: Finding[] }) {
  const [open, setOpen] = useState(true);
  const counts = countByLevel(findings);
  const groups = groupFindings(findings);

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="header-title">
          <h2 style={{ marginBottom: 2 }}>사전 검증</h2>
          <span className="hint" style={{ margin: 0 }}>
            AI 호출 전 결정론적 규칙 검사
          </span>
        </div>
        <div className="row-gap" style={{ alignItems: 'center' }}>
          {/* 접혀 있어도 오류·경고 수는 항상 보이게 */}
          {findings.length > 0 && (
            <span className="finding-counts">
              {counts.error > 0 && <span className="tag tag-error">오류 {counts.error}</span>}
              {counts.warning > 0 && <span className="tag tag-warning">경고 {counts.warning}</span>}
              {counts.info > 0 && <span className="tag tag-info">참고 {counts.info}</span>}
            </span>
          )}
          <button className="btn btn-ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? '접기' : '펼치기'}
          </button>
        </div>
      </div>

      {findings.length === 0 ? (
        <p className="ok-line">통과. 규칙 위반 없음.</p>
      ) : (
        <>
          {counts.error > 0 && (
            <p className="hint" style={{ marginTop: 0 }}>
              오류가 있으면 다운로드가 잠깁니다.
            </p>
          )}

          {open && (
            <ul className="findings">
              {groups.map((g) => {
                const n = g.items.length;
                const title = g.sameMessage ? g.items[0].message : `${g.category} 항목 ${n}건`;
                const head = (
                  <span className="finding-head">
                    <span className={`tag tag-${g.level}`}>{LEVEL_LABEL[g.level]}</span>
                    <span className="finding-cat">{g.category}</span>
                    {n > 1 && <span className="finding-count">×{n}</span>}
                    {n === 1 && g.items[0].alarmName && (
                      <code className="finding-alarm">{g.items[0].alarmName}</code>
                    )}
                  </span>
                );

                // 1건이면 예전처럼 펼친 형태로
                if (n === 1) {
                  return (
                    <li key={g.key} className={`finding finding-${g.level}`}>
                      {head}
                      <p className="finding-msg">{g.items[0].message}</p>
                      {g.fix && <p className="finding-fix">{g.fix}</p>}
                    </li>
                  );
                }

                // 여러 건이면 하나로 묶고, 대상 목록은 토글로
                return (
                  <li key={g.key} className={`finding finding-${g.level}`}>
                    {head}
                    <p className="finding-msg">{title}</p>
                    {g.fix && <p className="finding-fix">{g.fix}</p>}
                    <details className="finding-details">
                      <summary>대상 {n}건 보기</summary>
                      <ul>
                        {g.items.map((f, i) => (
                          <li key={i}>
                            {g.sameMessage ? (
                              <code>{f.alarmName ?? f.message}</code>
                            ) : (
                              <>
                                {f.message}
                                {f.alarmName && <code> {f.alarmName}</code>}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
