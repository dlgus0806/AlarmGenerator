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
import { initLevels, operatorSymbol, resolveMetric, unitLabel } from '../lib/build';
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
    const copy: SelectedMetric = { ...structuredClone(inst), uid: crypto.randomUUID() };
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

  // ---- 지표 인스턴스 하나의 설정 박스 ----
  const renderInstanceBox = (preset: MetricPreset, inst: SelectedMetric, count: number) => {
    const isLevel = Boolean(preset.levels && preset.levels.length > 0);
    const autoName = buildAlarmName({
      prefix: global.prefix,
      shortCode: type.shortCode,
      resourceId: entry.resourceId,
      metricKey: preset.key,
      severity: resolveMetric(preset, inst).severity,
      threshold: inst.threshold,
      thresholdUnit: preset.thresholdUnit,
    });

    return (
      <div key={inst.uid} className="metric-config">
        {count > 1 && <span className="instance-tag">복제본</span>}

        {isLevel ? (
          <div className="level-box">
            <span className="level-title">
              단계 알람 (켠 레벨마다 1개씩 생성) {operatorSymbol(preset.comparisonOperator)}
            </span>
            {preset.levels!.map((lv) => {
              const st = inst.levels?.[lv.level] ?? { enabled: true, threshold: lv.threshold };
              return (
                <div key={lv.level} className="level-row">
                  <label className="checkline">
                    <input
                      type="checkbox"
                      checked={st.enabled}
                      onChange={(e) => patchLevel(inst.uid, lv.level, { enabled: e.target.checked })}
                    />
                    <b>{lv.level}</b>
                  </label>
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
                    <em>{unitLabel(preset.thresholdUnit) || 'count'}</em>
                  </span>
                  <span className={`sev sev-${lv.severity}`}>{lv.severity}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <label className="field field-inline">
            <span>임계값 {operatorSymbol(preset.comparisonOperator)}</span>
            <span className="input-unit">
              <input
                type="number"
                step="any"
                value={inst.threshold}
                onChange={(e) => patchInstance(inst.uid, { threshold: Number(e.target.value) })}
              />
              <em>{unitLabel(preset.thresholdUnit) || 'count'}</em>
            </span>
            {preset.thresholdUnit === 'gib' && (
              <small>
                {inst.threshold} GiB ={' '}
                {Math.round(inst.threshold * 1024 ** 3).toLocaleString()} bytes 로 변환됩니다.
              </small>
            )}
          </label>
        )}

        {(preset.extraDimensions ?? []).map((dim) => (
          <label key={dim.name} className="field field-inline">
            <span>
              {dim.label} <em>필수</em>
            </span>
            <input
              value={inst.extraDimValues[dim.name] ?? ''}
              placeholder={dim.placeholder}
              onChange={(e) =>
                patchInstance(inst.uid, {
                  extraDimValues: { ...inst.extraDimValues, [dim.name]: e.target.value },
                })
              }
            />
          </label>
        ))}

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

        <div className="alarm-name-preview">
          <span>생성될 이름</span>
          {isLevel ? (
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

        <MetricAdvanced
          preset={preset}
          selection={inst}
          hideSeverity={isLevel}
          onPatch={(patch) => patchInstance(inst.uid, patch)}
          onReset={() => resetInstance(inst.uid, preset)}
        />

        <div className="instance-actions">
          <button className="btn btn-ghost" onClick={() => duplicateInstance(inst)}>
            지표 복제
          </button>
          {count > 1 && (
            <button className="btn btn-danger-ghost" onClick={() => removeInstance(inst.uid)}>
              이 복제본 삭제
            </button>
          )}
        </div>
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

        {instances.map((inst) => renderInstanceBox(preset, inst, instances.length))}
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
        <span>{type.idHint ?? '리소스 ID'}</span>
        <input
          value={entry.resourceId}
          placeholder={type.idPlaceholder}
          onChange={(e) => onChange({ resourceId: e.target.value })}
        />
        <small>
          디멘션 <code>{type.dimensionName}</code> 값으로 사용됩니다.
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
          <span className="hidden-box-title">기타 지표 (활용도 낮음)</span>
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
