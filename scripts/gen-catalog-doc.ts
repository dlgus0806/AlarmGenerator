/**
 * 카탈로그 JSON에서 지표 목록 문서를 생성한다.
 * 사용: npm run docs  →  catalog-metrics.md 갱신
 * 카탈로그를 손으로 고친 뒤 이 명령을 다시 돌리면 문서가 최신화된다.
 */
import { CATALOG } from '../src/catalog';
import type { MetricPreset } from '../src/types';

function stat(m: MetricPreset): string {
  return m.extendedStatistic ? `${m.extendedStatistic} (백분위)` : (m.statistic ?? '-');
}

function thr(m: MetricPreset): string {
  const unit =
    m.thresholdUnit === 'percent'
      ? '%'
      : m.thresholdUnit === 'seconds'
        ? '초'
        : m.thresholdUnit === 'milliseconds'
          ? 'ms'
          : m.thresholdUnit === 'gib'
            ? 'GiB'
            : '';
  return `${m.threshold}${unit}`;
}

function esc(s: string | undefined): string {
  return (s ?? '').replace(/\|/g, '\\|');
}

const lines: string[] = [];
lines.push('# 알람 지표 카탈로그');
lines.push('');
lines.push('> 이 문서는 `src/catalog/*.json` 에서 자동 생성됩니다. **직접 고치지 마세요.**');
lines.push('> 지표를 추가/수정하려면 아래 "파일 위치"의 JSON을 편집하고 `npm run docs`로 이 문서를 다시 생성하세요.');
lines.push('');
lines.push(`생성 시각: ${new Date().toISOString()}`);
lines.push('');

lines.push('## 파일 위치');
lines.push('');
lines.push('| 리소스 | 파일 |');
lines.push('|---|---|');
for (const r of CATALOG) {
  lines.push(`| ${esc(r.label)} | \`src/catalog/${fileOf(r.key)}\` |`);
}
lines.push('| (리소스 등록) | `src/catalog/index.ts` |');
lines.push('');

lines.push('## 컬럼 의미');
lines.push('');
lines.push('- **N/M**: N=평가 구간 수(evaluationPeriods), M=그중 위반이면 알람인 개수(datapointsToAlarm)');
lines.push('- **결측**: treatMissingData (breaching / notBreaching / ignore / missing)');
lines.push('- **기본**: 리소스 추가 시 기본으로 켜지는지 (defaultOn)');
lines.push('- **임계값 단위**: percent=%, gib=GiB(내부에서 바이트로 변환), 그 외 raw');
lines.push('');

for (const r of CATALOG) {
  lines.push(`## ${r.label}`);
  lines.push('');
  lines.push(`- 리소스 키: \`${r.key}\``);
  lines.push(`- 기본 디멘션: \`${r.dimensionName}\``);
  lines.push(`- 파일: \`src/catalog/${fileOf(r.key)}\``);
  lines.push('');
  lines.push('| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const m of r.metrics) {
    lines.push(
      `| ${esc(m.label)} | \`${m.metricName}\` | ${stat(m)} | ${m.period}s | ${m.datapointsToAlarm}/${m.evaluationPeriods} | ${opSym(m.comparisonOperator)} | ${thr(m)} | ${m.treatMissingData} | ${m.defaultOn ? '●' : ''} | ${(m.badges ?? []).join(', ')} |`,
    );
  }
  lines.push('');
  const notes = r.metrics.filter((m) => m.note);
  if (notes.length > 0) {
    lines.push('참고:');
    for (const m of notes) lines.push(`- **${esc(m.label)}**: ${esc(m.note)}`);
    lines.push('');
  }
}

function opSym(op: string): string {
  const map: Record<string, string> = {
    GreaterThanOrEqualToThreshold: '>=',
    GreaterThanThreshold: '>',
    LessThanThreshold: '<',
    LessThanOrEqualToThreshold: '<=',
  };
  return map[op] ?? op;
}

function fileOf(key: string): string {
  const map: Record<string, string> = {
    ec2: 'ec2.json',
    alb: 'alb.json',
    'aurora-pg': 'aurora-postgresql.json',
    'rds-pg': 'rds-postgresql.json',
    'rds-mysql': 'rds-mysql.json',
  };
  return map[key] ?? `${key}.json`;
}

process.stdout.write(lines.join('\n') + '\n');
