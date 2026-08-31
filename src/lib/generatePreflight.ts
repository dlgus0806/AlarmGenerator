import type { AlarmSpec, GlobalConfig } from '../types';

/** 셸 큰따옴표 안 이스케이프 */
function q(value: string): string {
  return `"${value.replace(/([\\"$`])/g, '\\$1')}"`;
}

interface MetricProbe {
  namespace: string;
  metricName: string;
  dimensions: { name: string; value: string }[];
  fromCatalog: boolean;
  sampleAlarm: string;
}

/** 같은 지표(namespace+metric+dims)에 여러 알람이 걸려도 한 번만 검사한다. */
function dedupeMetrics(specs: AlarmSpec[]): MetricProbe[] {
  const map = new Map<string, MetricProbe>();
  for (const s of specs) {
    const dims = s.dimensions.filter((d) => d.value);
    const key = [
      s.namespace,
      s.metricName,
      ...dims.map((d) => `${d.name}=${d.value}`),
    ].join('|');
    if (!map.has(key)) {
      map.set(key, {
        namespace: s.namespace,
        metricName: s.metricName,
        dimensions: dims,
        fromCatalog: !s.catalogKey.startsWith('custom.'),
        sampleAlarm: s.alarmName,
      });
    }
  }
  return [...map.values()];
}

function dimArgs(dims: { name: string; value: string }[]): string {
  if (dims.length === 0) return '';
  return (
    ' --dimensions ' +
    dims.map((d) => `Name=${d.name},Value=${d.value}`).join(' ')
  );
}

/**
 * 읽기 전용 사전 점검 스크립트를 만든다.
 * 아무것도 생성/변경하지 않는다. list-metrics 와 describe-alarms 만 호출한다.
 * 사용자의 두 질문에 사실로 답한다:
 *   1) 이 이름의 알람이 이미 있는가 (있으면 실행 시 덮어써진다)
 *   2) 이 지표가 실제로 존재하는가 (특히 커스텀 지표)
 */
export function generatePreflight(global: GlobalConfig, specs: AlarmSpec[]): string {
  if (specs.length === 0) {
    return '# 선택된 알람이 없습니다.';
  }

  const names = specs.map((s) => s.alarmName);
  const probes = dedupeMetrics(specs);

  const lines: string[] = [
    '#!/usr/bin/env bash',
    '#',
    '# 사전 점검 (읽기 전용) — 알람 생성 스크립트를 실행하기 전에 먼저 돌리세요.',
    '# 이 스크립트는 아무것도 만들거나 바꾸지 않습니다.',
    '# list-metrics 와 describe-alarms(읽기 전용)만 호출합니다.',
    '#',
    '# 주의: list-metrics 는 최근 약 2주 안에 데이터가 올라온 지표만 반환합니다.',
    '#       방금 만든 리소스나 유휴 리소스는 [없음]으로 나올 수 있습니다.',
    '',
    '# -e 를 넣지 않습니다. 개별 점검이 실패해도 끝까지 진행해야 하기 때문입니다.',
    'set -uo pipefail',
    '',
    `REGION=${q(global.region)}`,
    '',
    'echo "=================================================="',
    'echo " 1) 알람 이름 충돌 검사"',
    'echo "    아래 목록에 나오는 이름은 이미 존재합니다."',
    'echo "    알람 생성 스크립트를 실행하면 경고 없이 덮어써집니다."',
    'echo "=================================================="',
    'EXISTING=$(aws cloudwatch describe-alarms --region "$REGION" \\',
    '  --alarm-names \\',
    ...names.map((n, i) => `    ${q(n)}${i === names.length - 1 ? ' \\' : ' \\'}`),
    "  --query 'MetricAlarms[].AlarmName' --output text)",
    'if [ -z "$EXISTING" ]; then',
    '  echo "  충돌 없음. 모두 신규 생성됩니다."',
    'else',
    '  echo "  이미 존재 (덮어써짐):"',
    '  for a in $EXISTING; do echo "    - $a"; done',
    'fi',
    '',
    'echo',
    'echo "=================================================="',
    'echo " 2) 지표 존재 검사"',
    'echo "    [없음]이 나오면 알람은 만들어져도 INSUFFICIENT_DATA에"',
    'echo "    머뭅니다. 커스텀 지표라면 이름/디멘션을 다시 확인하세요."',
    'echo "=================================================="',
    '',
    'check_metric() {  # $1=namespace $2=metricName $3=label 나머지=--dimensions 인자',
    '  local ns="$1" mn="$2" label="$3"; shift 3',
    '  local n',
    '  n=$(aws cloudwatch list-metrics --region "$REGION" \\',
    '    --namespace "$ns" --metric-name "$mn" "$@" \\',
    "    --query 'length(Metrics)' --output text 2>/dev/null)",
    '  if [ "$n" = "0" ] || [ "$n" = "None" ] || [ -z "$n" ]; then',
    '    echo "  [없음]  $label"',
    '  else',
    '    echo "  [존재]  $label"',
    '  fi',
    '}',
    '',
  ];

  for (const p of probes) {
    const label = `${p.namespace} ${p.metricName}${
      p.dimensions.length ? ' (' + p.dimensions.map((d) => `${d.name}=${d.value}`).join(', ') + ')' : ''
    }${p.fromCatalog ? '' : '  ← 커스텀'}`;
    lines.push(
      `check_metric ${q(p.namespace)} ${q(p.metricName)} ${q(label)}${dimArgs(p.dimensions)}`,
    );
  }

  lines.push(
    '',
    'echo',
    'echo "점검 완료. [존재] + 충돌 없음이면 생성 스크립트를 실행하세요."',
    '',
  );

  return lines.join('\n') + '\n';
}
