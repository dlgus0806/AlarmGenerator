import type {
  AlarmSpec,
  CustomMetric,
  GlobalConfig,
  MetricPreset,
  MetricSelection,
  ResourceEntry,
  Severity,
  ThresholdUnit,
} from '../types';
import { getResourceType } from '../catalog';
import { buildAlarmName, slugify } from './naming';

const GIB = 1024 ** 3;

/**
 * 리소스 ID 정규화. ELB ARN 전체(...:loadbalancer/app/이름/해시)를 넣으면
 * CloudWatch LoadBalancer 디멘션 값(app/이름/해시)만 남긴다. 그 외는 그대로.
 */
function normalizeResourceId(id: string): string {
  const marker = 'loadbalancer/';
  const i = id.indexOf(marker);
  return i >= 0 ? id.slice(i + marker.length) : id;
}

/** 사용자가 보는 단위 -> CloudWatch API가 받는 값 */
export function toApiThreshold(value: number, unit: ThresholdUnit): number {
  return unit === 'gib' ? Math.round(value * GIB) : value;
}

export function unitLabel(unit: ThresholdUnit): string {
  switch (unit) {
    case 'percent':
      return '%';
    case 'seconds':
      return '초';
    case 'milliseconds':
      return 'ms';
    case 'gib':
      return 'GiB';
    default:
      return '';
  }
}

const OPERATOR_SYMBOL: Record<string, string> = {
  GreaterThanOrEqualToThreshold: '>=',
  GreaterThanThreshold: '>',
  LessThanThreshold: '<',
  LessThanOrEqualToThreshold: '<=',
};

export function operatorSymbol(op: string): string {
  return OPERATOR_SYMBOL[op] ?? op;
}

/** UI 드롭다운에 쓰는 선택지 */
export const PERIOD_OPTIONS = [
  { value: 10, label: '10초 (고해상도)' },
  { value: 30, label: '30초 (고해상도)' },
  { value: 60, label: '1분' },
  { value: 300, label: '5분' },
  { value: 600, label: '10분' },
  { value: 900, label: '15분' },
  { value: 1800, label: '30분' },
  { value: 3600, label: '1시간' },
  { value: 21600, label: '6시간' },
  { value: 86400, label: '1일' },
];

export const STATISTIC_OPTIONS = ['Average', 'Sum', 'Minimum', 'Maximum', 'SampleCount'];

/** 콘솔처럼 통계를 한글로 보여준다 (값은 API용 영문 그대로). */
export const STATISTIC_LABELS: Record<string, string> = {
  Average: '평균',
  Sum: '합계',
  Minimum: '최소',
  Maximum: '최대',
  SampleCount: '샘플 수',
};

/** 콘솔 "조건"의 비교 연산자 카드 (정적 임계값용). */
export const OPERATOR_CARD_OPTIONS = [
  { value: 'GreaterThanThreshold', title: '보다 큼', sub: '> 임계값' },
  { value: 'GreaterThanOrEqualToThreshold', title: '보다 크거나 같음', sub: '>= 임계값' },
  { value: 'LessThanOrEqualToThreshold', title: '보다 작거나 같음', sub: '<= 임계값' },
  { value: 'LessThanThreshold', title: '보다 작음', sub: '< 임계값' },
];

/** 이상 탐지용 비교 연산자 카드 (밴드 기준). */
export const ANOMALY_OPERATOR_CARD_OPTIONS = [
  { value: 'LessThanLowerOrGreaterThanUpperThreshold', title: '대역을 벗어남', sub: '> 또는 < 임계값' },
  { value: 'GreaterThanUpperThreshold', title: '대역보다 큼', sub: '> 임계값' },
  { value: 'LessThanLowerThreshold', title: '대역보다 작음', sub: '< 임계값' },
];

/** 이상 탐지에서만 유효한 비교 연산자. */
export const ANOMALY_OPERATORS = new Set(ANOMALY_OPERATOR_CARD_OPTIONS.map((o) => o.value));
export const DEFAULT_ANOMALY_OPERATOR = 'LessThanLowerOrGreaterThanUpperThreshold';
export const DEFAULT_BAND_WIDTH = 2;

export function isAnomalyOperator(op: string): boolean {
  return ANOMALY_OPERATORS.has(op);
}

export const MISSING_DATA_OPTIONS = [
  { value: 'missing', label: '누락된 데이터를 누락(으)로 처리' },
  { value: 'notBreaching', label: '누락된 데이터를 양호(임계값 위반 안 함)(으)로 처리' },
  { value: 'ignore', label: '누락된 데이터를 무시(경보 상태 유지)(으)로 처리' },
  { value: 'breaching', label: '누락된 데이터를 불량(임계값 위반)(으)로 처리' },
];

export const OPERATOR_OPTIONS = [
  { value: 'GreaterThanOrEqualToThreshold', label: '>= 이상' },
  { value: 'GreaterThanThreshold', label: '> 초과' },
  { value: 'LessThanOrEqualToThreshold', label: '<= 이하' },
  { value: 'LessThanThreshold', label: '< 미만' },
];

export const SEVERITY_OPTIONS: Severity[] = ['critical', 'warning'];

/** 레벨 지표의 초기 선택값 (모든 레벨 켜짐 + 기본 임계값). 아니면 undefined. */
export function initLevels(
  preset: MetricPreset,
): Record<string, { enabled: boolean; threshold: number }> | undefined {
  if (!preset.levels || preset.levels.length === 0) return undefined;
  return Object.fromEntries(
    preset.levels.map((l) => [l.level, { enabled: true, threshold: l.threshold }]),
  );
}

/** 세부 설정 override를 적용한 최종 값 */
export function resolveMetric(preset: MetricPreset, sel: MetricSelection) {
  return {
    period: sel.period ?? preset.period,
    evaluationPeriods: sel.evaluationPeriods ?? preset.evaluationPeriods,
    datapointsToAlarm: sel.datapointsToAlarm ?? preset.datapointsToAlarm,
    treatMissingData: sel.treatMissingData ?? preset.treatMissingData,
    // extendedStatistic을 쓰는 프리셋은 statistic override를 무시한다 (상호배타)
    statistic: preset.extendedStatistic ? undefined : (sel.statistic ?? preset.statistic),
    extendedStatistic: preset.extendedStatistic,
    comparisonOperator: sel.comparisonOperator ?? preset.comparisonOperator,
    severity: sel.severity ?? preset.severity,
  };
}

/** 카탈로그 기본값과 다른 설정이 하나라도 있는지 */
export function hasOverrides(preset: MetricPreset, sel: MetricSelection): boolean {
  const r = resolveMetric(preset, sel);
  return (
    r.period !== preset.period ||
    r.evaluationPeriods !== preset.evaluationPeriods ||
    r.datapointsToAlarm !== preset.datapointsToAlarm ||
    r.treatMissingData !== preset.treatMissingData ||
    r.statistic !== preset.statistic ||
    r.comparisonOperator !== preset.comparisonOperator ||
    r.severity !== preset.severity ||
    sel.threshold !== preset.threshold
  );
}

function describe(args: {
  label: string;
  metricName: string;
  comparisonOperator: string;
  displayThreshold: number;
  thresholdUnit: ThresholdUnit;
  period: number;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  runbook?: string;
}): string {
  const window = (args.period * args.evaluationPeriods) / 60;
  const needed = (args.period * args.datapointsToAlarm) / 60;
  const cond = `${args.metricName} ${operatorSymbol(args.comparisonOperator)} ${args.displayThreshold}${unitLabel(args.thresholdUnit)}`;
  const base = `${args.label} | ${cond} | ${fmtMinutes(window)} 중 ${fmtMinutes(needed)} 위반 시`;
  return args.runbook ? `${base} | 런북: ${args.runbook}` : base;
}

function describeAnomaly(args: {
  label: string;
  metricName: string;
  comparisonOperator: string;
  bandWidth: number;
  period: number;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  runbook?: string;
}): string {
  const window = (args.period * args.evaluationPeriods) / 60;
  const needed = (args.period * args.datapointsToAlarm) / 60;
  const dir =
    args.comparisonOperator === 'GreaterThanUpperThreshold'
      ? '상한 초과'
      : args.comparisonOperator === 'LessThanLowerThreshold'
        ? '하한 미만'
        : '밴드 벗어남';
  const cond = `${args.metricName} 이상 탐지 ±${args.bandWidth}σ ${dir}`;
  const base = `${args.label} | ${cond} | ${fmtMinutes(window)} 중 ${fmtMinutes(needed)} 위반 시`;
  return args.runbook ? `${base} | 런북: ${args.runbook}` : base;
}

function fmtMinutes(m: number): string {
  if (m < 1) return `${Math.round(m * 60)}초`;
  if (m % 60 === 0 && m >= 60) return `${m / 60}시간`;
  return `${Number(m.toFixed(1))}분`;
}

/** 전역 설정의 SNS 토픽 목록을 정리한다(공백 제거, 빈 값·중복 제외). */
function snsTopicsFor(global: GlobalConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of global.snsTopics ?? []) {
    const t = raw.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * 화면 상태(global + resources)에서 알람 명세 목록을 만든다.
 * 순수 함수. 같은 입력이면 항상 같은 출력.
 */
export function buildAlarms(
  global: GlobalConfig,
  resources: ResourceEntry[],
): AlarmSpec[] {
  const specs: AlarmSpec[] = [];
  const topics = snsTopicsFor(global);

  for (const entry of resources) {
    const type = getResourceType(entry.typeKey);
    if (!type) continue;
    // ELB ARN 전체를 넣어도 CloudWatch LoadBalancer 디멘션 값(app/이름/해시)만 쓰도록 정규화.
    const resourceId = normalizeResourceId(entry.resourceId.trim());

    // ---- 카탈로그 지표 (인스턴스 배열) ----
    for (const selection of entry.selected) {
      const preset = type.metrics.find((m) => m.key === selection.metricKey);
      if (!preset) continue;
      const r = resolveMetric(preset, selection);
      const manual = selection.customName.trim();
      const isLevel = Boolean(preset.levels && preset.levels.length > 0);
      // 단계(레벨) 지표라도 이상 탐지를 켜면 단일 밴드 알람 하나로 만든다 (레벨 무시).
      const anomaly = Boolean(selection.anomaly);
      // 단일 임계값 모드: 레벨 지표를 Lv1/2/3 대신 단일 알람 하나로.
      const single = Boolean(selection.single);
      const bandWidth = selection.bandWidth ?? DEFAULT_BAND_WIDTH;
      const effectiveOp = anomaly
        ? isAnomalyOperator(r.comparisonOperator)
          ? r.comparisonOperator
          : DEFAULT_ANOMALY_OPERATOR
        : r.comparisonOperator;

      // 지표 하나에 대한 AlarmSpec 생성기. 단계(레벨)마다 재사용한다.
      const makeSpec = (
        displayThreshold: number,
        severity: Severity,
        levelName: string,
      ): AlarmSpec => {
        const nameKey = levelName
          ? `${preset.key}-${levelName.toLowerCase()}`
          : anomaly
            ? `${preset.key}-anomaly`
            : preset.key;
        const autoName = buildAlarmName({
          prefix: global.prefix,
          shortCode: type.shortCode,
          resourceId,
          metricKey: nameKey,
          severity,
          // 이상 탐지는 임계값이 이름에 들어가지 않는다 (심각도 약어를 쓴다).
          threshold: anomaly ? undefined : displayThreshold,
          thresholdUnit: anomaly ? undefined : preset.thresholdUnit,
        });
        const alarmName =
          global.namingMode === 'manual' && manual.length > 0
            ? levelName
              ? `${manual}-${levelName.toLowerCase()}`
              : manual
            : autoName;
        const label = levelName ? `${preset.label} ${levelName}` : preset.label;
        const auto = anomaly
          ? describeAnomaly({
              label,
              metricName: preset.metricName,
              comparisonOperator: effectiveOp,
              bandWidth,
              period: r.period,
              evaluationPeriods: r.evaluationPeriods,
              datapointsToAlarm: r.datapointsToAlarm,
              runbook: preset.runbook,
            })
          : describe({
              label,
              metricName: preset.metricName,
              comparisonOperator: effectiveOp,
              displayThreshold,
              thresholdUnit: preset.thresholdUnit,
              period: r.period,
              evaluationPeriods: r.evaluationPeriods,
              datapointsToAlarm: r.datapointsToAlarm,
              runbook: preset.runbook,
            });
        // 사용자가 설명을 직접 쓰면 그것을 쓴다. 레벨 알람은 레벨을 덧붙여 구분한다.
        const userDesc = selection.description?.trim();
        const description = userDesc
          ? levelName
            ? `${userDesc} (${levelName})`
            : userDesc
          : auto;
        return {
          alarmName,
          description,
          severity,
          namespace: preset.namespace,
          metricName: preset.metricName,
          dimensions: [
            // 계정 전역 타입(dimensionName 비어 있음)은 기본 디멘션을 넣지 않는다.
            ...(type.dimensionName ? [{ name: type.dimensionName, value: resourceId }] : []),
            ...(preset.extraDimensions ?? []).map((d) => ({
              name: d.name,
              value: (selection.extraDimValues[d.name] ?? d.default ?? '').trim(),
            })),
          ],
          statistic: r.statistic,
          extendedStatistic: r.extendedStatistic,
          unit: preset.unit,
          period: r.period,
          evaluationPeriods: r.evaluationPeriods,
          datapointsToAlarm: r.datapointsToAlarm,
          threshold: anomaly ? bandWidth : toApiThreshold(displayThreshold, preset.thresholdUnit),
          displayThreshold: anomaly ? bandWidth : displayThreshold,
          thresholdUnit: anomaly ? 'raw' : preset.thresholdUnit,
          comparisonOperator: effectiveOp,
          treatMissingData: r.treatMissingData,
          anomaly: anomaly || undefined,
          bandWidth: anomaly ? bandWidth : undefined,
          thresholdMetricId: anomaly ? 'ad1' : undefined,
          snsTopicArns: topics,
          catalogKey: `${type.key}.${preset.key}${levelName ? '.' + levelName.toLowerCase() : anomaly ? '.anomaly' : ''}`,
          resourceType: type.key,
          resourceId,
          runbook: preset.runbook,
          badges: anomaly ? [...preset.badges, '이상 탐지'] : preset.badges,
        };
      };

      if (isLevel && !anomaly && !single) {
        // Lv1/Lv2/Lv3 단계 알람: 켜진 레벨마다 하나씩 생성
        const levelSel = selection.levels ?? {};
        for (const lv of preset.levels!) {
          const st = levelSel[lv.level] ?? { enabled: true, threshold: lv.threshold };
          if (!st.enabled) continue;
          specs.push(makeSpec(st.threshold, lv.severity, lv.level));
        }
      } else {
        specs.push(makeSpec(selection.threshold, r.severity, ''));
      }
    }

    // ---- 커스텀 지표 ----
    for (const cm of entry.customMetrics ?? []) {
      if (!cm.enabled) continue;
      specs.push(buildCustomSpec(global, entry, cm, type.dimensionName, type.shortCode));
    }
  }

  return specs;
}

function buildCustomSpec(
  global: GlobalConfig,
  entry: ResourceEntry,
  cm: CustomMetric,
  defaultDimName: string,
  shortCode: string,
): AlarmSpec {
  const resourceId = entry.resourceId.trim();
  // 한글 라벨은 슬러그로 만들면 거의 사라지므로, 너무 짧으면 지표 이름으로 대체한다.
  // 그러지 않으면 서로 다른 커스텀 지표가 같은 알람 이름을 갖게 된다.
  const labelSlug = slugify(cm.label);
  const metricKey =
    labelSlug.length >= 3 ? labelSlug : slugify(cm.metricName) || 'custom';

  const dimensions = [
    ...(cm.useResourceDimension
      ? [{ name: defaultDimName, value: resourceId }]
      : []),
    ...cm.dimensions.map((d) => ({ name: d.name.trim(), value: d.value.trim() })),
  ];

  return {
    alarmName: buildAlarmName({
      prefix: global.prefix,
      shortCode,
      resourceId,
      metricKey,
      severity: cm.severity,
    }),
    description: describe({
      label: cm.label || cm.metricName,
      metricName: cm.metricName,
      comparisonOperator: cm.comparisonOperator,
      displayThreshold: cm.threshold,
      thresholdUnit: 'raw',
      period: cm.period,
      evaluationPeriods: cm.evaluationPeriods,
      datapointsToAlarm: cm.datapointsToAlarm,
    }),
    severity: cm.severity,
    namespace: cm.namespace.trim(),
    metricName: cm.metricName.trim(),
    dimensions,
    statistic: cm.statistic,
    extendedStatistic: undefined,
    unit: cm.unit?.trim() || undefined,
    period: cm.period,
    evaluationPeriods: cm.evaluationPeriods,
    datapointsToAlarm: cm.datapointsToAlarm,
    threshold: cm.threshold,
    displayThreshold: cm.threshold,
    thresholdUnit: 'raw',
    comparisonOperator: cm.comparisonOperator,
    treatMissingData: cm.treatMissingData,
    snsTopicArns: snsTopicsFor(global),
    catalogKey: `custom.${metricKey}`,
    resourceType: entry.typeKey,
    resourceId,
    badges: ['커스텀'],
  };
}
