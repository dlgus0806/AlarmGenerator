import type { CustomMetric, ResourceType, Severity } from '../types';
import {
  MISSING_DATA_OPTIONS,
  OPERATOR_OPTIONS,
  PERIOD_OPTIONS,
  SEVERITY_OPTIONS,
  STATISTIC_OPTIONS,
} from '../lib/build';

export function newCustomMetric(): CustomMetric {
  return {
    uid: crypto.randomUUID(),
    enabled: true,
    label: '',
    namespace: '',
    metricName: '',
    statistic: 'Average',
    period: 300,
    evaluationPeriods: 3,
    datapointsToAlarm: 2,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    threshold: 0,
    treatMissingData: 'missing',
    severity: 'warning',
    unit: '',
    useResourceDimension: true,
    dimensions: [],
  };
}

interface Props {
  metric: CustomMetric;
  type: ResourceType;
  onPatch: (patch: Partial<CustomMetric>) => void;
  onRemove: () => void;
}

export function CustomMetricEditor({ metric, type, onPatch, onRemove }: Props) {
  const patchDim = (i: number, patch: Partial<{ name: string; value: string }>) => {
    const dims = metric.dimensions.map((d, idx) => (idx === i ? { ...d, ...patch } : d));
    onPatch({ dimensions: dims });
  };

  return (
    <div className={`custom-metric ${metric.enabled ? 'on' : ''}`}>
      <div className="metric-head">
        <input
          type="checkbox"
          checked={metric.enabled}
          onChange={(e) => onPatch({ enabled: e.target.checked })}
        />
        <span className="metric-title">
          {metric.label || metric.metricName || '새 커스텀 지표'}
          <span className="badge">커스텀</span>
        </span>
        <button className="btn btn-danger-ghost" onClick={onRemove}>
          제거
        </button>
      </div>

      <div className="advanced-grid" style={{ marginTop: 10 }}>
        <label className="field">
          <span>표시 이름 (알람 이름에 사용)</span>
          <input
            value={metric.label}
            placeholder="예: 큐 적재량 과다"
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        </label>
        <label className="field">
          <span>
            Namespace <em>필수</em>
          </span>
          <input
            value={metric.namespace}
            placeholder="AWS/SQS 또는 CWAgent"
            onChange={(e) => onPatch({ namespace: e.target.value })}
          />
        </label>
        <label className="field">
          <span>
            지표 이름 <em>필수</em>
          </span>
          <input
            value={metric.metricName}
            placeholder="ApproximateNumberOfMessagesVisible"
            onChange={(e) => onPatch({ metricName: e.target.value })}
          />
        </label>
        <label className="field">
          <span>통계</span>
          <select
            value={metric.statistic}
            onChange={(e) => onPatch({ statistic: e.target.value })}
          >
            {STATISTIC_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>비교 연산자</span>
          <select
            value={metric.comparisonOperator}
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
          <span>임계값 (변환 없이 그대로)</span>
          <input
            type="number"
            step="any"
            value={metric.threshold}
            onChange={(e) => onPatch({ threshold: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>기간</span>
          <select
            value={metric.period}
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
            value={metric.evaluationPeriods}
            onChange={(e) => onPatch({ evaluationPeriods: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>알람 데이터포인트 (M)</span>
          <input
            type="number"
            min={1}
            value={metric.datapointsToAlarm}
            onChange={(e) => onPatch({ datapointsToAlarm: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>결측 데이터 처리</span>
          <select
            value={metric.treatMissingData}
            onChange={(e) => onPatch({ treatMissingData: e.target.value })}
          >
            {MISSING_DATA_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>심각도</span>
          <select
            value={metric.severity}
            onChange={(e) => onPatch({ severity: e.target.value as Severity })}
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Unit (선택)</span>
          <input
            value={metric.unit ?? ''}
            placeholder="Percent / Count / Bytes / Seconds"
            onChange={(e) => onPatch({ unit: e.target.value })}
          />
        </label>
      </div>

      <label className="checkline" style={{ marginTop: 10 }}>
        <input
          type="checkbox"
          checked={metric.useResourceDimension}
          onChange={(e) => onPatch({ useResourceDimension: e.target.checked })}
        />
        리소스 ID를 <code>{type.dimensionName}</code> 디멘션으로 사용
      </label>

      <div style={{ marginTop: 10 }}>
        <span className="hint">추가 디멘션</span>
        {metric.dimensions.map((d, i) => (
          <div key={i} className="dim-row" style={{ marginTop: 6 }}>
            <label className="field">
              <input
                value={d.name}
                placeholder="QueueName"
                onChange={(e) => patchDim(i, { name: e.target.value })}
              />
            </label>
            <label className="field">
              <input
                value={d.value}
                placeholder="prd-order-queue"
                onChange={(e) => patchDim(i, { value: e.target.value })}
              />
            </label>
            <button
              className="btn btn-danger-ghost"
              onClick={() =>
                onPatch({ dimensions: metric.dimensions.filter((_, idx) => idx !== i) })
              }
            >
              －
            </button>
          </div>
        ))}
        <button
          className="btn btn-ghost"
          style={{ marginTop: 6 }}
          onClick={() =>
            onPatch({ dimensions: [...metric.dimensions, { name: '', value: '' }] })
          }
        >
          + 디멘션
        </button>
      </div>

      <p className="metric-note" style={{ marginLeft: 0 }}>
        카탈로그를 거치지 않은 지표입니다. 실행 전 <code>list-metrics</code>로 실제 존재를
        확인하세요. 반복해서 쓸 지표라면 <code>src/catalog/*.json</code>에 추가하는 편이 좋습니다.
      </p>
    </div>
  );
}
