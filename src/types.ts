export type Severity = 'critical' | 'warning' | 'info';

/** 임계값을 사용자에게 어떤 단위로 보여줄지. 'gib'는 입력받아 바이트로 변환한다. */
export type ThresholdUnit =
  | 'percent'
  | 'count'
  | 'seconds'
  | 'milliseconds'
  | 'gib'
  | 'raw';

/** 리소스 ID 외에 추가로 필요한 디멘션 (예: ALB의 TargetGroup, CWAgent의 path) */
export interface ExtraDimension {
  name: string;
  label: string;
  placeholder: string;
}

/** Lv1/Lv2/Lv3 단계 알람 정의. 한 지표를 임계값·심각도별로 여러 알람으로 만든다. */
export interface AlarmLevel {
  level: string; // 'Lv1' | 'Lv2' | 'Lv3'
  threshold: number;
  severity: Severity;
}

export interface MetricPreset {
  key: string;
  label: string;
  namespace: string;
  metricName: string;
  /** statistic 과 extendedStatistic 은 상호배타 */
  statistic?: string;
  extendedStatistic?: string;
  unit?: string;
  period: number;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  comparisonOperator: string;
  threshold: number;
  thresholdUnit: ThresholdUnit;
  treatMissingData: string;
  severity: Severity;
  defaultOn: boolean;
  /** true면 기본 목록에서 숨기고 "더보기"로만 노출 (활용도 낮은 지표). */
  hidden?: boolean;
  badges: string[];
  note?: string;
  runbook?: string;
  extraDimensions?: ExtraDimension[];
  /** 있으면 Lv1/Lv2/Lv3 단계 알람으로 한 번에 생성한다 (threshold/severity는 각 레벨 값 사용). */
  levels?: AlarmLevel[];
}

export interface ResourceType {
  key: string;
  label: string;
  /** 알람 이름에 들어가는 축약 코드 */
  shortCode: string;
  dimensionName: string;
  idPlaceholder: string;
  /** 리소스 ID 형식 검증용 정규식 문자열 */
  idPattern?: string;
  idHint?: string;
  metrics: MetricPreset[];
}

export interface TagPair {
  key: string;
  value: string;
}

export interface GlobalConfig {
  prefix: string;
  region: string;
  snsCritical: string;
  snsWarning: string;
  splitSeverity: boolean;
  namingMode: 'auto' | 'manual';
  /** 사용자가 자유롭게 추가하는 태그. 비어 있으면 --tags 를 아예 넣지 않는다. */
  tags: TagPair[];
}

/**
 * 켜진 지표 하나에 대한 사용자 수정값.
 * 세부 설정은 optional이고, 없으면 카탈로그 기본값을 쓴다.
 * 그래서 예전에 내보낸 JSON도 그대로 불러올 수 있다.
 */
export interface MetricSelection {
  /** 사용자가 보는 단위의 임계값 (gib면 GiB) */
  threshold: number;
  customName: string;
  extraDimValues: Record<string, string>;

  // ---- 세부 설정 override ----
  period?: number;
  evaluationPeriods?: number;
  datapointsToAlarm?: number;
  treatMissingData?: string;
  statistic?: string;
  comparisonOperator?: string;
  severity?: Severity;

  /** 단계(Lv1/Lv2/Lv3) 알람의 레벨별 선택·임계값. 레벨 지표에서만 사용. */
  levels?: Record<string, { enabled: boolean; threshold: number }>;
}

/**
 * 리소스에 켜진 지표 하나의 인스턴스. 같은 지표를 여러 번(복제) 가질 수 있어
 * uid로 구분하고 metricKey로 카탈로그 지표를 참조한다.
 */
export interface SelectedMetric extends MetricSelection {
  uid: string;
  metricKey: string;
}

/** 카탈로그에 없는 지표를 리소스에 직접 추가할 때 쓴다. */
export interface CustomMetric {
  uid: string;
  enabled: boolean;
  label: string;
  namespace: string;
  metricName: string;
  statistic: string;
  period: number;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  comparisonOperator: string;
  threshold: number;
  treatMissingData: string;
  severity: Severity;
  unit?: string;
  /** 리소스 ID를 이 리소스 타입의 기본 디멘션으로 쓸지 */
  useResourceDimension: boolean;
  /** 추가 디멘션 (이름/값 직접 입력) */
  dimensions: { name: string; value: string }[];
}

export interface ResourceEntry {
  uid: string;
  typeKey: string;
  resourceId: string;
  selected: SelectedMetric[];
  customMetrics?: CustomMetric[];
}

/** 생성기에 넘어가는 최종 알람 명세 */
export interface AlarmSpec {
  alarmName: string;
  description: string;
  severity: Severity;
  namespace: string;
  metricName: string;
  dimensions: { name: string; value: string }[];
  statistic?: string;
  extendedStatistic?: string;
  unit?: string;
  period: number;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  threshold: number;
  /** 사용자가 입력한 값 (단위 변환 전). 태그와 설명에 쓴다. */
  displayThreshold: number;
  thresholdUnit: ThresholdUnit;
  comparisonOperator: string;
  treatMissingData: string;
  snsTopicArn: string;
  catalogKey: string;
  resourceType: string;
  resourceId: string;
  runbook?: string;
  badges: string[];
}

export type FindingLevel = 'error' | 'warning' | 'info';

export interface Finding {
  level: FindingLevel;
  category: string;
  alarmName?: string;
  message: string;
  fix?: string;
}

/** JSON 다운로드 / 재업로드 포맷 */
export interface ProjectFile {
  version: '1';
  generatedAt: string;
  global: GlobalConfig;
  resources: ResourceEntry[];
}

/** 표준(템플릿) 안의 리소스 한 종류. 리소스 ID는 없다 — 고객사마다 다르므로. */
export interface TemplateResource {
  typeKey: string;
  selected: SelectedMetric[];
  customMetrics?: CustomMetric[];
  /**
   * 적용 시점에 리소스 타입을 고르게 하는 슬롯 (예: RDS 엔진).
   * 값이 있으면 typeKey는 후보 중 하나로 대체되고 selected는 해당 타입 기본값으로 채워진다.
   */
  choose?: string[];
}

/**
 * 재사용 가능한 알람 표준.
 * 지표·임계값·세부설정만 담고, 리소스 ID와 SNS/prefix(고객사별 값)는 담지 않는다.
 */
export interface AlarmTemplate {
  version: '1';
  name: string;
  createdAt: string;
  /** true면 카탈로그에서 생성된 기본 제공 표준. 삭제/덮어쓰기 불가. */
  builtin?: boolean;
  resources: TemplateResource[];
}
