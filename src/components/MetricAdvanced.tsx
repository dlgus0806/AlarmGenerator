import type { MetricPreset, MetricSelection } from '../types';
import { MISSING_DATA_OPTIONS, hasOverrides, resolveMetric, routeTopics } from '../lib/build';

interface Props {
  preset: MetricPreset;
  selection: MetricSelection;
  /** 전역 설정의 SNS 토픽 목록(정리된 형태). 이 중에서 알림 보낼 토픽을 고른다. */
  topics: string[];
  onPatch: (patch: Partial<MetricSelection>) => void;
  onReset: () => void;
}

function fmt(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  if (seconds % 3600 === 0) return `${seconds / 3600}시간`;
  return `${seconds / 60}분`;
}

/** ARN 끝의 토픽 이름만 (arn:aws:sns:리전:계정:이름 → 이름) */
function topicName(arn: string): string {
  const parts = arn.split(':');
  return parts.length >= 6 ? parts.slice(5).join(':') : arn;
}

/**
 * 콘솔의 "추가 구성"에 해당하는 접이식 영역.
 * 네임스페이스·지표·통계·기간·연산자·임계값은 상위의 지표/조건 그룹에서 다루고,
 * 여기서는 평가 기간·데이터포인트·결측 데이터·알림 보낼 SNS 토픽을 조정한다.
 * (알림 경로는 심각도가 아니라 토픽 선택으로 정한다. 심각도는 카탈로그 기본값을 쓴다)
 */
export function MetricAdvanced({ preset, selection, topics, onPatch, onReset }: Props) {
  const r = resolveMetric(preset, selection);
  const changed = hasOverrides(preset, selection);
  const totalWindow = r.period * r.evaluationPeriods;
  const needed = r.period * r.datapointsToAlarm;

  // SNS 라우팅: 선택 없음(undefined) = 전역 토픽 전부
  const routeAll = selection.snsTopics === undefined;
  const routed = routeTopics(topics, selection.snsTopics);
  const toggleTopic = (arn: string, on: boolean) => {
    const current = new Set(routed);
    if (on) current.add(arn);
    else current.delete(arn);
    const next = topics.filter((t) => current.has(t));
    // 전부 고르면 "전체"로 되돌려, 나중에 추가하는 토픽도 자동 포함되게 한다.
    onPatch({ snsTopics: next.length === topics.length ? undefined : next });
  };

  const snsSummary =
    topics.length === 0
      ? 'SNS 없음'
      : routeAll
        ? `SNS 전체 ${topics.length}`
        : `SNS ${routed.length}/${topics.length}`;

  return (
    <details className="advanced mc-conditions">
      <summary>
        추가 구성
        {changed && (
          <span className="override-badge" title="카탈로그 기본값과 다릅니다. 아래 버튼으로 되돌릴 수 있습니다.">
            변경됨
          </span>
        )}
        <span className="mc-cond-summary">
          {r.datapointsToAlarm}/{r.evaluationPeriods} · {r.treatMissingData} · {snsSummary}
        </span>
      </summary>

      <div className="mc-group mc-group-open">
        <div className="advanced-grid" style={{ marginTop: 0 }}>
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
            <small>{MISSING_DATA_OPTIONS.find((o) => o.value === r.treatMissingData)?.desc}</small>
          </label>

        </div>

        <p className="eval-summary">
          {fmt(totalWindow)} 창을 {r.evaluationPeriods}개 구간으로 보고, 그중{' '}
          {r.datapointsToAlarm}개({fmt(needed)} 분량)가 위반이면 ALARM.
          {preset.extendedStatistic && ' 백분위 통계는 변경할 수 없습니다.'}
        </p>

        {/* 알림 보낼 SNS 토픽 — 전역 설정에 넣은 토픽 중에서 고른다 */}
        <fieldset className="field sns-route" style={{ marginTop: 12 }}>
          <span className="row-between">
            <span>알림 보낼 SNS 토픽</span>
            {topics.length > 1 && !routeAll && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onPatch({ snsTopics: undefined })}
              >
                전체 선택
              </button>
            )}
          </span>
          {topics.length === 0 ? (
            <small>전역 설정에 SNS 토픽을 먼저 추가하세요.</small>
          ) : (
            <>
              <ul className="sns-route-list">
                {topics.map((arn) => (
                  <li key={arn}>
                    <label className="checkline" title={arn}>
                      <input
                        type="checkbox"
                        checked={routed.includes(arn)}
                        onChange={(e) => toggleTopic(arn, e.target.checked)}
                      />
                      <span className="sns-route-name">{topicName(arn)}</span>
                      <code className="sns-route-arn">{arn}</code>
                    </label>
                  </li>
                ))}
              </ul>
              {routed.length === 0 ? (
                <p className="inline-error" style={{ margin: '6px 0 0' }}>
                  하나 이상 선택하세요. 선택이 없으면 알림이 가지 않습니다.
                </p>
              ) : (
                <small>
                  {routeAll
                    ? '전역 설정의 모든 토픽으로 보냅니다. 나중에 추가한 토픽도 자동 포함됩니다.'
                    : '선택한 토픽으로만 보냅니다.'}
                  {preset.levels && preset.levels.length > 0 && ' 단계(Lv1/2/3) 알람 모두에 적용됩니다.'}
                </small>
              )}
            </>
          )}
        </fieldset>

        <label className="field field-inline" style={{ marginTop: 12, marginBottom: 0 }}>
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

        {changed && (
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onReset}>
            카탈로그 기본값으로 되돌리기
          </button>
        )}
      </div>
    </details>
  );
}
