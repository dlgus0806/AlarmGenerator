import type { AlarmSpec } from '../types';

/** describe-alarms 출력의 알람 하나 (감사 스크립트의 --query 형태) */
export interface ExistingAlarm {
  AlarmName?: string;
  Namespace?: string;
  MetricName?: string;
  Dimensions?: { Name: string; Value: string }[];
  Threshold?: number;
  ComparisonOperator?: string;
  Period?: number;
  EvaluationPeriods?: number;
  DatapointsToAlarm?: number | null;
  TreatMissingData?: string;
  Statistic?: string;
  ExtendedStatistic?: string;
}

export interface FieldDiff {
  field: string;
  expected: string;
  actual: string;
}

export interface MismatchItem {
  spec: AlarmSpec;
  existingName: string;
  diffs: FieldDiff[];
}

export interface AuditResult {
  matches: AlarmSpec[];
  mismatches: MismatchItem[];
  missing: AlarmSpec[];
  extra: ExistingAlarm[];
  ambiguous: string[];
}

/** describe-alarms 결과 JSON을 파싱한다. 배열 또는 {MetricAlarms:[...]} 둘 다 받는다. */
export function parseExistingAlarms(raw: string): ExistingAlarm[] {
  const parsed = JSON.parse(raw) as unknown;
  let arr: unknown;
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && typeof parsed === 'object' && 'MetricAlarms' in parsed) {
    arr = (parsed as { MetricAlarms: unknown }).MetricAlarms;
  } else {
    throw new Error('describe-alarms 출력(JSON 배열 또는 {MetricAlarms:[...]})이 아닙니다.');
  }
  if (!Array.isArray(arr)) throw new Error('알람 목록을 찾을 수 없습니다.');
  return arr as ExistingAlarm[];
}

function dimsKey(dims: { name?: string; Name?: string; value?: string; Value?: string }[]): string {
  return dims
    .map((d) => `${d.name ?? d.Name ?? ''}=${d.value ?? d.Value ?? ''}`)
    .filter((s) => !s.startsWith('=') && !s.endsWith('='))
    .sort()
    .join(',');
}

function specStat(s: AlarmSpec): string {
  return s.extendedStatistic ?? s.statistic ?? '';
}
function existingStat(a: ExistingAlarm): string {
  return a.ExtendedStatistic ?? a.Statistic ?? '';
}

/** 지표+통계+디멘션으로 매칭 키를 만든다. 이름이나 임계값은 넣지 않는다. */
function specKey(s: AlarmSpec): string {
  return [s.namespace, s.metricName, specStat(s), dimsKey(s.dimensions)].join('|');
}
function existingKey(a: ExistingAlarm): string {
  return [
    a.Namespace ?? '',
    a.MetricName ?? '',
    existingStat(a),
    dimsKey(a.Dimensions ?? []),
  ].join('|');
}

function compare(spec: AlarmSpec, a: ExistingAlarm): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const push = (field: string, expected: unknown, actual: unknown) => {
    if (String(expected) !== String(actual)) {
      diffs.push({ field, expected: String(expected), actual: String(actual) });
    }
  };

  push('threshold', spec.threshold, a.Threshold);
  push('comparisonOperator', spec.comparisonOperator, a.ComparisonOperator);
  push('period', spec.period, a.Period);
  push('evaluationPeriods', spec.evaluationPeriods, a.EvaluationPeriods);
  // datapointsToAlarm이 비어 있으면 AWS는 evaluationPeriods와 같게 취급한다.
  push('datapointsToAlarm', spec.datapointsToAlarm, a.DatapointsToAlarm ?? a.EvaluationPeriods);
  // treatMissingData 미지정 시 AWS 기본값은 missing.
  push('treatMissingData', spec.treatMissingData, a.TreatMissingData ?? 'missing');
  return diffs;
}

/**
 * 표준으로부터 기대되는 알람(specs)과 계정의 기존 알람을 비교한다.
 */
export function auditAlarms(specs: AlarmSpec[], existing: ExistingAlarm[]): AuditResult {
  const byKey = new Map<string, ExistingAlarm[]>();
  for (const a of existing) {
    const k = existingKey(a);
    const list = byKey.get(k) ?? [];
    list.push(a);
    byKey.set(k, list);
  }

  const matches: AlarmSpec[] = [];
  const mismatches: MismatchItem[] = [];
  const missing: AlarmSpec[] = [];
  const ambiguous: string[] = [];
  const matchedExisting = new Set<ExistingAlarm>();

  for (const spec of specs) {
    const candidates = byKey.get(specKey(spec)) ?? [];
    if (candidates.length === 0) {
      missing.push(spec);
      continue;
    }
    if (candidates.length > 1) ambiguous.push(spec.alarmName);
    const a = candidates[0];
    matchedExisting.add(a);
    const diffs = compare(spec, a);
    if (diffs.length === 0) matches.push(spec);
    else mismatches.push({ spec, existingName: a.AlarmName ?? '(이름 없음)', diffs });
  }

  const extra = existing.filter((a) => !matchedExisting.has(a));

  return { matches, mismatches, missing, extra, ambiguous };
}

/** 감사 결과에서 새로 만들거나 고쳐야 할 알람 이름 집합 */
export function remediationAlarmNames(result: AuditResult): Set<string> {
  return new Set([
    ...result.missing.map((s) => s.alarmName),
    ...result.mismatches.map((m) => m.spec.alarmName),
  ]);
}
