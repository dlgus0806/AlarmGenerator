import { useState } from 'react';
import type {
  CustomMetric,
  GlobalConfig,
  MetricPreset,
  MetricSelection,
  ResourceEntry,
  SelectedMetric,
} from '../types';
import { getResourceType } from '../catalog';
import { buildAlarmName } from '../lib/naming';
import {
  ANOMALY_OPERATOR_CARD_OPTIONS,
  DEFAULT_ANOMALY_OPERATOR,
  DEFAULT_BAND_WIDTH,
  OPERATOR_CARD_OPTIONS,
  PERIOD_OPTIONS,
  STATISTIC_LABELS,
  STATISTIC_OPTIONS,
  initLevels,
  operatorSymbol,
  resolveMetric,
  unitLabel,
} from '../lib/build';
import { MetricAdvanced } from './MetricAdvanced';
import { CustomMetricEditor, newCustomMetric } from './CustomMetricEditor';

interface Props {
  entry: ResourceEntry;
  global: GlobalConfig;
  onChange: (patch: Partial<ResourceEntry>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

export function ResourceCard({ entry, global, onChange, onRemove, onDuplicate }: Props) {
  const [showHidden, setShowHidden] = useState(false);
  const type = getResourceType(entry.typeKey);
  if (!type) return null;

  // ---- 인스턴스 조작 ----
  const setSelected = (next: SelectedMetric[]) => onChange({ selected: next });

  const instancesOf = (key: string) => entry.selected.filter((s) => s.metricKey === key);

  const toggleMetric = (preset: MetricPreset, on: boolean) => {
    if (on) {
      setSelected([
        ...entry.selected,
        {
          uid: crypto.randomUUID(),
          metricKey: preset.key,
          threshold: preset.threshold,
          customName: '',
          extraDimValues: {},
          levels: initLevels(preset),
        },
      ]);
    } else {
      setSelected(entry.selected.filter((s) => s.metricKey !== preset.key));
    }
  };

  const duplicateInstance = (inst: SelectedMetric) => {
    // 복제본에만 표시를 남긴다(원본은 그대로).
    const copy: SelectedMetric = {
      ...structuredClone(inst),
      uid: crypto.randomUUID(),
      duplicated: true,
    };
    const idx = entry.selected.findIndex((s) => s.uid === inst.uid);
    setSelected([...entry.selected.slice(0, idx + 1), copy, ...entry.selected.slice(idx + 1)]);
  };

  const removeInstance = (uid: string) =>
    setSelected(entry.selected.filter((s) => s.uid !== uid));

  const patchInstance = (uid: string, patch: Partial<MetricSelection>) =>
    setSelected(entry.selected.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));

  const patchLevel = (
    uid: string,
    level: string,
    patch: Partial<{ enabled: boolean; threshold: number }>,
  ) =>
    setSelected(
      entry.selected.map((s) => {
        if (s.uid !== uid) return s;
        const levels = { ...(s.levels ?? {}) };
        levels[level] = { ...(levels[level] ?? { enabled: true, threshold: 0 }), ...patch };
        return { ...s, levels };
      }),
    );

  const resetInstance = (uid: string, preset: MetricPreset) =>
    setSelected(
      entry.selected.map((s) =>
        s.uid === uid
          ? {
              uid: s.uid,
              metricKey: s.metricKey,
              threshold: preset.threshold,
              customName: s.customName,
              extraDimValues: s.extraDimValues,
              levels: initLevels(preset),
              duplicated: s.duplicated,
            }
          : s,
      ),
    );

  const customMetrics = entry.customMetrics ?? [];
  const patchCustom = (uid: string, patch: Partial<CustomMetric>) =>
    onChange({
      customMetrics: customMetrics.map((c) => (c.uid === uid ? { ...c, ...patch } : c)),
    });

  const onCount = entry.selected.length + customMetrics.filter((c) => c.enabled).length;
  const nonHidden = type.metrics.filter((m) => !m.hidden);
  const hiddenMetrics = type.metrics.filter((m) => m.hidden);

  // ---- 지표 인스턴스 하나의 설정 박스 (AWS 콘솔의 지표/조건 레이아웃을 흉내) ----
  const renderInstanceBox = (preset: MetricPreset, inst: SelectedMetric) => {
    const isLevel = Boolean(preset.levels && preset.levels.length > 0);
    const r = resolveMetric(preset, inst);
    const anomaly = Boolean(inst.anomaly);
    const single = Boolean(inst.single) && isLevel; // 레벨 지표를 단일 알람으로
    const bandWidth = inst.bandWidth ?? DEFAULT_BAND_WIDTH;
    const unit = unitLabel(preset.thresholdUnit) || 'count';
    const autoName = buildAlarmName({
      prefix: global.prefix,
      shortCode: type.shortCode,
      resourceId: entry.resourceId,
      metricKey: anomaly ? `${preset.key}-anomaly` : preset.key,
      severity: r.severity,
      threshold: anomaly ? undefined : inst.threshold,
      thresholdUnit: anomaly ? undefined : preset.thresholdUnit,
    });

    // 조건 토글이 접혀 있을 때 한눈에 보여줄 요약 문구.
    const conditionSummary = anomaly
      ? `이상 탐지 ±${bandWidth}σ`
      : isLevel && !single
        ? `단계 ${preset
            .levels!.filter((lv) => inst.levels?.[lv.level]?.enabled ?? true)
            .map((lv) => lv.level)
            .join('/')}`
        : `${operatorSymbol(r.comparisonOperator)} ${inst.threshold}${unit === 'count' ? '' : unit}`;

    return (
      <div key={inst.uid} className="metric-config">
        {/* ── 상단: 생성될 이름(맨 앞) + 지표 복제(우측 상단) ── */}
        <div className="mc-top">
          <div className="alarm-name-preview">
            <span>생성될 이름</span>
            {isLevel && !anomaly && !single ? (
              <span className="name-list">
                {preset.levels!
                  .filter((lv) => inst.levels?.[lv.level]?.enabled ?? true)
                  .map((lv) => (
                    <code key={lv.level}>
                      {buildAlarmName({
                        prefix: global.prefix,
                        shortCode: type.shortCode,
                        resourceId: entry.resourceId,
                        metricKey: `${preset.key}-${lv.level.toLowerCase()}`,
                        severity: lv.severity,
                        threshold: inst.levels?.[lv.level]?.threshold ?? lv.threshold,
                        thresholdUnit: preset.thresholdUnit,
                      })}
                    </code>
                  ))}
              </span>
            ) : (
              <code>
                {global.namingMode === 'manual' && inst.customName.trim()
                  ? inst.customName.trim()
                  : autoName}
              </code>
            )}
          </div>
          <div className="mc-top-actions">
            {inst.duplicated && <span className="instance-tag">복제본</span>}
            {inst.duplicated && (
              <button className="btn btn-danger-ghost" onClick={() => removeInstance(inst.uid)}>
                복제본 삭제
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => duplicateInstance(inst)}>
              지표 복제
            </button>
          </div>
        </div>

        {/* ── 지표 (접이식, 기본 닫힘) ── */}
        <details className="advanced mc-conditions">
          <summary>
            지표
            <span className="mc-cond-summary">
              {preset.namespace} · {preset.metricName}
            </span>
          </summary>
          <div className="mc-group mc-group-open">
          <div className="mc-grid">
            <div className="mc-ro">
              <span>네임스페이스</span>
              <div className="mc-ro-val">{preset.namespace}</div>
            </div>
            <div className="mc-ro">
              <span>지표 이름</span>
              <div className="mc-ro-val">{preset.metricName}</div>
            </div>
            {type.dimensionName && (
              <div className="mc-ro">
                <span>{type.dimensionName}</span>
                <div className="mc-ro-val">
                  {entry.resourceId.trim() || <em className="mc-empty">{type.idPlaceholder}</em>}
                </div>
              </div>
            )}

            {(preset.extraDimensions ?? []).map((dim) => (
              <label key={dim.name} className="field">
                <span>
                  {dim.name} {dim.required !== false && <em>필수</em>}
                </span>
                <input
                  value={inst.extraDimValues[dim.name] ?? dim.default ?? ''}
                  placeholder={dim.placeholder}
                  onChange={(e) =>
                    patchInstance(inst.uid, {
                      extraDimValues: { ...inst.extraDimValues, [dim.name]: e.target.value },
                    })
                  }
                />
              </label>
            ))}

            <label className="field">
              <span>통계</span>
              {preset.extendedStatistic ? (
                <input value={preset.extendedStatistic} disabled />
              ) : (
                <select
                  value={r.statistic ?? 'Average'}
                  onChange={(e) => patchInstance(inst.uid, { statistic: e.target.value })}
                >
                  {STATISTIC_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATISTIC_LABELS[s] ?? s}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <label className="field">
              <span>기간</span>
              <select
                value={r.period}
                onChange={(e) => patchInstance(inst.uid, { period: Number(e.target.value) })}
              >
                {PERIOD_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          </div>
        </details>

        {/* ── 조건 (접이식: 지표만 기본 노출, 조건은 열어야 보임) ── */}
        <details className="advanced mc-conditions">
          <summary>
            조건 설정
            <span className="mc-cond-summary">{conditionSummary}</span>
          </summary>
          <div className="mc-group mc-group-open">
            <div className="mc-sub">임계값 유형</div>
          <div className="mc-cards mc-cards-2">
            <label className={`mc-card ${!anomaly ? 'on' : ''}`}>
              <input
                type="radio"
                name={`thtype-${inst.uid}`}
                checked={!anomaly}
                onChange={() =>
                  patchInstance(inst.uid, {
                    anomaly: false,
                    comparisonOperator: preset.comparisonOperator,
                  })
                }
              />
              <div>
                <b>정적</b>
                <small>값을 임계값으로 사용</small>
              </div>
            </label>
            <label className={`mc-card ${anomaly ? 'on' : ''}`}>
              <input
                type="radio"
                name={`thtype-${inst.uid}`}
                checked={anomaly}
                onChange={() =>
                  patchInstance(inst.uid, {
                    anomaly: true,
                    comparisonOperator: DEFAULT_ANOMALY_OPERATOR,
                    bandWidth: inst.bandWidth ?? DEFAULT_BAND_WIDTH,
                  })
                }
              />
              <div>
                <b>이상 탐지</b>
                <small>대역을 임계값으로 사용</small>
              </div>
            </label>
          </div>

          <div className="mc-sub">
            {anomaly ? (
              <>
                <code>{preset.metricName}</code> 값이 예상 대역과 비교해 다음 조건일 때 알람이
                울립니다.
              </>
            ) : (
              <>
                <code>{preset.metricName}</code> 값이 다음 조건을 만족할 때 알람이 울립니다.
              </>
            )}
          </div>
          <div className="mc-cards mc-cards-2">
            {(anomaly ? ANOMALY_OPERATOR_CARD_OPTIONS : OPERATOR_CARD_OPTIONS).map((op) => (
              <label
                key={op.value}
                className={`mc-card ${r.comparisonOperator === op.value ? 'on' : ''}`}
              >
                <input
                  type="radio"
                  name={`op-${inst.uid}`}
                  checked={r.comparisonOperator === op.value}
                  onChange={() => patchInstance(inst.uid, { comparisonOperator: op.value })}
                />
                <div>
                  <b>{op.title}</b>
                  <small>{op.sub}</small>
                </div>
              </label>
            ))}
          </div>

          {isLevel && !anomaly && (
            <>
              <div className="mc-sub">알람 방식</div>
              <div className="mc-cards mc-cards-2">
                <label className={`mc-card ${!single ? 'on' : ''}`}>
                  <input
                    type="radio"
                    name={`lvmode-${inst.uid}`}
                    checked={!single}
                    onChange={() => patchInstance(inst.uid, { single: false })}
                  />
                  <div>
                    <b>단계 (Lv1/2/3)</b>
                    <small>레벨별 알람 1개씩 생성</small>
                  </div>
                </label>
                <label className={`mc-card ${single ? 'on' : ''}`}>
                  <input
                    type="radio"
                    name={`lvmode-${inst.uid}`}
                    checked={single}
                    onChange={() => patchInstance(inst.uid, { single: true })}
                  />
                  <div>
                    <b>단일 임계값</b>
                    <small>알람 1개만</small>
                  </div>
                </label>
              </div>
            </>
          )}

          {anomaly ? (
            <label className="field field-inline mc-threshold">
              <span>이상 탐지 임계값 (양수)</span>
              <span className="input-unit">
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={bandWidth}
                  onChange={(e) => patchInstance(inst.uid, { bandWidth: Number(e.target.value) })}
                />
              </span>
              <small>
                표준 편차를 기반으로 합니다. 숫자가 클수록 대역폭이 더 크고, 작을수록 대역폭이 더 작습니다.
              </small>
            </label>
          ) : isLevel && !single ? (
            <div className="level-box">
              <span className="level-title">
                레벨별 임계값 — 체크한 레벨마다 알람이 1개씩 생성됩니다
              </span>
              {preset.levels!.map((lv) => {
                const st = inst.levels?.[lv.level] ?? { enabled: true, threshold: lv.threshold };
                return (
                  <div key={lv.level} className="level-row">
                    <div className="level-row-head">
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={st.enabled}
                          onChange={(e) =>
                            patchLevel(inst.uid, lv.level, { enabled: e.target.checked })
                          }
                        />
                        <b>{lv.level}</b>
                      </label>
                      <span className={`sev sev-${lv.severity}`}>{lv.severity}</span>
                    </div>
                    <span className="input-unit">
                      <input
                        type="number"
                        step="any"
                        value={st.threshold}
                        disabled={!st.enabled}
                        onChange={(e) =>
                          patchLevel(inst.uid, lv.level, { threshold: Number(e.target.value) })
                        }
                      />
                      <em>{unit}</em>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <label className="field field-inline mc-threshold">
              <span>임계값</span>
              <span className="input-unit">
                <input
                  type="number"
                  step="any"
                  value={inst.threshold}
                  onChange={(e) => patchInstance(inst.uid, { threshold: Number(e.target.value) })}
                />
                <em>{unit}</em>
              </span>
              {preset.thresholdUnit === 'gib' && (
                <small>
                  {inst.threshold} GiB ={' '}
                  {Math.round(inst.threshold * 1024 ** 3).toLocaleString()} bytes 로 변환됩니다.
                </small>
              )}
            </label>
            )}
          </div>
        </details>

        {global.namingMode === 'manual' && (
          <label className="field field-inline">
            <span>알람 이름 직접 입력</span>
            <input
              value={inst.customName}
              placeholder={autoName}
              onChange={(e) => patchInstance(inst.uid, { customName: e.target.value })}
            />
          </label>
        )}

        <MetricAdvanced
          preset={preset}
          selection={inst}
          hideSeverity={isLevel && !anomaly && !single}
          onPatch={(patch) => patchInstance(inst.uid, patch)}
          onReset={() => resetInstance(inst.uid, preset)}
        />
      </div>
    );
  };

  // ---- 지표 하나(카탈로그 항목) 렌더 ----
  const renderMetric = (preset: MetricPreset) => {
    const instances = instancesOf(preset.key);
    const on = instances.length > 0;
    const headSeverity = on ? resolveMetric(preset, instances[0]).severity : preset.severity;

    return (
      <div key={preset.key} className={`metric ${on ? 'metric-on' : ''}`}>
        <label className="metric-head">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => toggleMetric(preset, e.target.checked)}
          />
          <span className="metric-title">
            {preset.label}
            <code className="metric-name">{preset.metricName}</code>
          </span>
          <span className={`sev sev-${headSeverity}`}>{headSeverity}</span>
        </label>

        <div className="metric-badges">
          {preset.badges.map((b) => (
            <span key={b} className="badge">
              {b}
            </span>
          ))}
          <span className="badge badge-quiet">
            {preset.namespace} · {preset.statistic ?? preset.extendedStatistic} · {preset.period}s ·{' '}
            {preset.datapointsToAlarm}/{preset.evaluationPeriods} · {preset.treatMissingData}
          </span>
        </div>

        {preset.note && <p className="metric-note">{preset.note}</p>}

        {instances.map((inst) => renderInstanceBox(preset, inst))}
      </div>
    );
  };

  return (
    <section className="panel resource">
      <div className="panel-head">
        <h2>
          {type.label}
          <span className="badge badge-count">{onCount}</span>
        </h2>
        <div className="row-gap">
          <button className="btn btn-ghost" onClick={onDuplicate}>
            리소스 복제
          </button>
          <button className="btn btn-danger-ghost" onClick={onRemove}>
            삭제
          </button>
        </div>
      </div>

      <label className="field">
        <span>{type.dimensionName ? (type.idHint ?? '리소스 ID') : '이름 라벨 (선택)'}</span>
        <input
          value={entry.resourceId}
          placeholder={type.idPlaceholder}
          onChange={(e) => onChange({ resourceId: e.target.value })}
        />
        <small>
          {type.dimensionName ? (
            <>
              디멘션 <code>{type.dimensionName}</code> 값으로 사용됩니다.
            </>
          ) : (
            '계정 전역 알람이라 디멘션이 없습니다. (알람 이름 라벨로만 쓰이며 비워도 됩니다)'
          )}
        </small>
      </label>

      <div className="metric-list">{nonHidden.map(renderMetric)}</div>

      {hiddenMetrics.length > 0 && (
        <button className="btn btn-ghost more-metrics" onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? '기타 지표 접기' : `기타 지표 ${hiddenMetrics.length}개 더보기`}
        </button>
      )}

      {showHidden && hiddenMetrics.length > 0 && (
        <div className="hidden-metric-box">
          <span className="hidden-box-title">기타 지표</span>
          <div className="metric-list">{hiddenMetrics.map(renderMetric)}</div>
        </div>
      )}

      <div className="custom-section">
        {customMetrics.map((cm) => (
          <CustomMetricEditor
            key={cm.uid}
            metric={cm}
            type={type}
            onPatch={(patch) => patchCustom(cm.uid, patch)}
            onRemove={() =>
              onChange({ customMetrics: customMetrics.filter((c) => c.uid !== cm.uid) })
            }
          />
        ))}
        <button
          className="btn btn-ghost"
          style={{ marginTop: 8 }}
          onClick={() => onChange({ customMetrics: [...customMetrics, newCustomMetric()] })}
        >
          + 카탈로그에 없는 지표 추가
        </button>
      </div>
    </section>
  );
}
