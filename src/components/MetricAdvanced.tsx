import type { MetricPreset, MetricSelection, Severity } from '../types';
import {
  MISSING_DATA_OPTIONS,
  OPERATOR_OPTIONS,
  PERIOD_OPTIONS,
  SEVERITY_OPTIONS,
  STATISTIC_OPTIONS,
  hasOverrides,
  resolveMetric,
} from '../lib/build';

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

/** 지표별 세부 설정. 기본값은 카탈로그에서 오고, 여기서 개별 override 한다. */
export function MetricAdvanced({ preset, selection, hideSeverity, onPatch, onReset }: Props) {
  const r = resolveMetric(preset, selection);
  const changed = hasOverrides(preset, selection);
  const totalWindow = r.period * r.evaluationPeriods;
  const needed = r.period * r.datapointsToAlarm;

  return (
    <details className="advanced">
      <summary>
        세부 설정
        {changed && <span className="override-dot" title="기본값에서 변경됨" />}
        <span style={{ marginLeft: 'auto' }}>
          {fmt(r.period)} · {r.datapointsToAlarm}/{r.evaluationPeriods} · {r.treatMissingData}
        </span>
      </summary>

      <div className="advanced-grid">
        <label className="field">
          <span>기간 (period)</span>
          <select
            value={r.period}
            onChange={(e) => onPatch({ period: Number(e.target.value) })}
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>평가 횟수 (N)</span>
          <input
            type="number"
            min={1}
            max={100}
            value={r.evaluationPeriods}
            onChange={(e) => onPatch({ evaluationPeriods: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span>알람 데이터포인트 (M)</span>
          <input
            type="number"
            min={1}
            max={r.evaluationPeriods}
            value={r.datapointsToAlarm}
            onChange={(e) => onPatch({ datapointsToAlarm: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span>통계 (statistic)</span>
          {preset.extendedStatistic ? (
            <input value={preset.extendedStatistic} disabled />
          ) : (
            <select
              value={r.statistic ?? 'Average'}
              onChange={(e) => onPatch({ statistic: e.target.value })}
            >
              {STATISTIC_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="field">
          <span>비교 연산자</span>
          <select
            value={r.comparisonOperator}
            onChange={(e) => onPatch({ comparisonOperator: e.target.value })}
          >
            {OPERATOR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
