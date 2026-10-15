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
    '# 검증 스크립트 (읽기 전용) — 알람 생성(CLI) 실행 전에 먼저 돌리세요.',
    '# 아무것도 만들거나 바꾸지 않습니다. describe-alarms / list-metrics 만 호출합니다.',
    '#',
    '# 붙여넣어 실행해도 셸 설정이 새지 않도록 pipefail 만 씁니다(set -u 미사용).',
    '# 팁: 붙여넣으면 셸이 각 줄을 ">" 로 되비칩니다(정상). 출력만 깔끔히 보려면',
    '#     파일로 저장 후  bash 파일이름.sh  로 실행하세요.',
    'set -o pipefail',
    '',
    `REGION=${q(global.region)}`,
    'MISSING_LABELS=()',
    '',
    'echo "=================================================="',
    'echo " CloudWatch 알람 사전 점검 (읽기 전용)"',
    'echo "=================================================="',
    'echo',
    'echo "[1] 이름 충돌 검사 — 이미 있으면 생성 시 \'덮어쓰기\' 됩니다."',
    'echo "--------------------------------------------------"',
    'EXISTING=$(aws cloudwatch describe-alarms --region "$REGION" \\',
    '  --alarm-names \\',
    ...names.map((n) => `    ${q(n)} \\`),
    "  --query 'MetricAlarms[].AlarmName' --output text)",
    'if [ -z "$EXISTING" ]; then',
    '  CONFLICT_COUNT=0',
    '  echo "  충돌 없음 — 모두 신규 생성됩니다."',
    'else',
    '  CONFLICT_COUNT=$(echo "$EXISTING" | wc -w | tr -d " ")',
    '  echo "  이미 존재(실행 시 덮어써짐):"',
    '  for a in $EXISTING; do echo "    - $a"; done',
    'fi',
    '',
    'echo',
    'echo "[2] 지표 존재 검사 — [없음]이면 만들어도 INSUFFICIENT_DATA 로 머뭅니다."',
    'echo "--------------------------------------------------"',
    '',
    'check_metric() {  # $1=namespace $2=metricName $3=label 나머지=--dimensions 인자',
    '  local ns="$1" mn="$2" label="$3"; shift 3',
    '  local n',
    '  n=$(aws cloudwatch list-metrics --region "$REGION" \\',
    '    --namespace "$ns" --metric-name "$mn" "$@" \\',
    "    --query 'length(Metrics)' --output text 2>/dev/null)",
    '  if [ "$n" = "0" ] || [ "$n" = "None" ] || [ -z "$n" ]; then',
    '    echo "  [없음]  $label"',
    '    MISSING_LABELS+=("$label")',
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
    'MISSING_COUNT=${#MISSING_LABELS[@]}',
    'echo',
    'echo "=================================================="',
    'echo " 요약 / 결론"',
    'echo "=================================================="',
    'echo "  덮어쓸 기존 알람 : ${CONFLICT_COUNT}건"',
    'echo "  데이터 없는 지표 : ${MISSING_COUNT}건"',
    'echo',
    'if [ "$CONFLICT_COUNT" = "0" ] && [ "$MISSING_COUNT" -eq 0 ]; then',
    '  echo "  [OK] 실행해도 됩니다 — 모두 신규 생성이고 지표도 모두 존재합니다."',
    'else',
    '  echo "  [주의] 실행 전 아래를 확인하세요:"',
    '  if [ "$CONFLICT_COUNT" != "0" ]; then',
    '    echo "기존 알람 ${CONFLICT_COUNT}건이 덮어써집니다. 의도한 설정인지 확인하세요."',
    '  fi',
    '  if [ "$MISSING_COUNT" -ne 0 ]; then',
    '    echo "    · 지표 ${MISSING_COUNT}건이 아직 없습니다(유휴 리소스/에이전트 미설치 가능)."',
    '    echo "      만들면 데이터가 올 때까지 INSUFFICIENT_DATA 로 표시됩니다:"',
    '    for m in "${MISSING_LABELS[@]}"; do echo "        - $m"; done',
    '  fi',
    '  echo "위 내용을 확인했다면 생성 스크립트를 실행해도 됩니다."',
    'fi',
    '',
  );

  return lines.join('\n') + '\n';
}
