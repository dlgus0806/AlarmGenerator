import type { GlobalConfig } from '../types';

function q(value: string): string {
  return `"${value.replace(/([\\"$`])/g, '\\$1')}"`;
}

/**
 * 고객사 계정에서 돌릴 읽기 전용 감사 스크립트.
 * 계정의 기존 메트릭 알람을 describe-alarms로 뽑아 JSON으로 출력한다.
 * 이 출력을 도구에 붙여넣으면 표준과 비교한다. 아무것도 생성/변경하지 않는다.
 *
 * 이름이 아니라 지표+디멘션으로 비교하므로, 다른 도구가 만든 알람도 감사에 잡힌다.
 */
export function generateAudit(global: GlobalConfig): string {
  const query =
    'MetricAlarms[].{AlarmName:AlarmName,Namespace:Namespace,MetricName:MetricName,' +
    'Dimensions:Dimensions,Threshold:Threshold,ComparisonOperator:ComparisonOperator,' +
    'Period:Period,EvaluationPeriods:EvaluationPeriods,DatapointsToAlarm:DatapointsToAlarm,' +
    'TreatMissingData:TreatMissingData,Statistic:Statistic,ExtendedStatistic:ExtendedStatistic}';

  return [
    '#!/usr/bin/env bash',
    '#',
    '# 감사 스크립트 (읽기 전용) — 고객사 계정 CloudShell에서 실행하세요.',
    '# 계정의 기존 메트릭 알람을 JSON으로 출력합니다. 아무것도 만들거나 바꾸지 않습니다.',
    '# 출력 전체를 복사해 도구의 "감사 결과 붙여넣기"에 넣으면 표준과 비교합니다.',
    '#',
    'set -uo pipefail',
    `REGION=${q(global.region)}`,
    '',
    'aws cloudwatch describe-alarms \\',
    '  --region "$REGION" \\',
    '  --alarm-types MetricAlarm \\',
    '  --output json \\',
    `  --query ${q(query)}`,
    '',
  ].join('\n');
}
