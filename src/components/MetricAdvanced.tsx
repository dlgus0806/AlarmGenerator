import type { MetricPreset, MetricSelection, Severity } from '../types';
import { MISSING_DATA_OPTIONS, SEVERITY_OPTIONS, hasOverrides, resolveMetric } from '../lib/build';

interface Props {
  preset: MetricPreset;
  selection: MetricSelection;
  /** 레벨 지표는 심각도가 레벨별로 정해지므로 공통 심각도 선택을 숨긴다. */
  hideSeverity?: boolean;
  onPatch: (patch: Partial<MetricSelection>) => void;
  onReset: () => void;
}

function fmt(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  if (seconds % 3600 === 0) return `${seconds / 3600}시간`;
  return `${seconds / 60}분`;
}

/**
 * 콘솔의 "추가 구성"에 해당하는 접이식 영역.
 * 네임스페이스·지표·통계·기간·연산자·임계값은 상위의 지표/조건 그룹에서 다루고,
 * 여기서는 평가 기간·데이터포인트·결측 데이터·심각도만 조정한다.
 */
export function MetricAdvanced({ preset, selection, hideSeverity, onPatch, onReset }: Props) {
  const r = resolveMetric(preset, selection);
  const changed = hasOverrides(preset, selection);
  const totalWindow = r.period * r.evaluationPeriods;
  const needed = r.period * r.datapointsToAlarm;

  return (
    <details className="advanced">
      <summary>
        추가 구성
        {changed && (
          <span className="override-badge" title="카탈로그 기본값과 다릅니다. 아래 버튼으로 되돌릴 수 있습니다.">
            변경됨
          </span>
        )}
        <span className="mc-cond-summary">
          {r.datapointsToAlarm}/{r.evaluationPeriods} · {r.treatMissingData}
        </span>
      </summary>

      <div className="advanced-grid">
        <label className="field">
          <span>평가 기간 (N)</span>
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={r.evaluationPeriods}
            onChange={(e) =>
              onPatch({ evaluationPeriods: Math.max(1, Math.round(Number(e.target.value) || 1)) })
            }
          />
        </label>

        <label className="field">
          <span>경보 데이터포인트 (M)</span>
          <input
            type="number"
            min={1}
            max={r.evaluationPeriods}
            step={1}
            value={r.datapointsToAlarm}
            onChange={(e) =>
              onPatch({ datapointsToAlarm: Math.max(1, Math.round(Number(e.target.value) || 1)) })
            }
          />
        </label>

        <label className="field">
          <span>결측 데이터 처리</span>
          <select
            value={r.treatMissingData}
            onChange={(e) => onPatch({ treatMissingData: e.target.value })}
          >
            {MISSING_DATA_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {!hideSeverity && (
          <label className="field">
            <span>심각도 (SNS 라우팅)</span>
            <select
              value={r.severity}
              onChange={(e) => onPatch({ severity: e.target.value as Severity })}
            >
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="field field-inline" style={{ marginTop: 10 }}>
        <span>
          경보 설명 <em>선택</em>
        </span>
        <textarea
          rows={2}
          value={selection.description ?? ''}
          placeholder="비워두면 지표·조건으로 자동 생성된 설명이 들어갑니다."
          onChange={(e) => onPatch({ description: e.target.value })}
        />
      </label>

      <p className="eval-summary">
        {fmt(totalWindow)} 창을 {r.evaluationPeriods}개 구간으로 보고, 그중{' '}
        {r.datapointsToAlarm}개({fmt(needed)} 분량)가 위반이면 ALARM.
        {preset.extendedStatistic && ' 백분위 통계는 변경할 수 없습니다.'}
      </p>

      {changed && (
        <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onReset}>
          카탈로그 기본값으로 되돌리기
        </button>
      )}
    </details>
  );
}
