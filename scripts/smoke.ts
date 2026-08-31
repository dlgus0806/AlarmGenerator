/**
 * 생성기 검증용 임시 스크립트. 실제 카탈로그로 CLI를 만들어 stdout에 출력한다.
 * 사용: node_modules/.bin/esbuild scripts/smoke.ts --bundle --platform=node --format=esm | node --input-type=module
 */
import type { GlobalConfig, ResourceEntry } from '../src/types';
import { CATALOG, getResourceType } from '../src/catalog';
import { buildAlarms } from '../src/lib/build';
import { generateCli } from '../src/lib/generateCli';
import { generatePreflight } from '../src/lib/generatePreflight';
import { validate } from '../src/lib/validate';

const global: GlobalConfig = {
  prefix: 'prd-was',
  region: 'ap-northeast-2',
  snsCritical: 'arn:aws:sns:ap-northeast-2:111122223333:ops-page',
  snsWarning: 'arn:aws:sns:ap-northeast-2:111122223333:ops-slack',
  splitSeverity: true,
  namingMode: 'auto',
  tags: [
    { key: 'Owner', value: 'platform-team' },
    { key: 'Environment', value: 'prod' },
  ],
};

function entry(typeKey: string, resourceId: string, extra?: Record<string, Record<string, string>>): ResourceEntry {
  const type = getResourceType(typeKey)!;
  const selected: ResourceEntry['selected'] = [];
  for (const m of type.metrics) {
    if (!m.defaultOn) continue;
    selected.push({
      uid: `${typeKey}-${m.key}`,
      metricKey: m.key,
      threshold: m.threshold,
      customName: '',
      extraDimValues: extra?.[m.key] ?? {},
      levels: m.levels
        ? Object.fromEntries(m.levels.map((l) => [l.level, { enabled: true, threshold: l.threshold }]))
        : undefined,
    });
  }
  return { uid: `uid-${typeKey}`, typeKey, resourceId, selected };
}

const ec2 = entry('ec2', 'i-0abc123def456789');
// 세부 설정 override 커버리지 (mem-high 인스턴스에)
const mem = ec2.selected.find((s) => s.metricKey === 'mem-high');
if (mem) {
  mem.period = 60;
  mem.evaluationPeriods = 5;
  mem.datapointsToAlarm = 3;
  mem.statistic = 'Maximum';
  mem.severity = 'critical';
}
// 지표 복제 커버리지: mem-high 하나 더 (다른 임계값)
if (mem) {
  ec2.selected.push({ ...structuredClone(mem), uid: 'ec2-mem-high-2', threshold: 95 });
}
// 커스텀 지표 커버리지
ec2.customMetrics = [
  {
    uid: 'cm-1',
    enabled: true,
    label: 'SQS 큐 적재량',
    namespace: 'AWS/SQS',
    metricName: 'ApproximateNumberOfMessagesVisible',
    statistic: 'Average',
    period: 300,
    evaluationPeriods: 3,
    datapointsToAlarm: 2,
    comparisonOperator: 'GreaterThanThreshold',
    threshold: 1000,
    treatMissingData: 'notBreaching',
    severity: 'warning',
    unit: 'Count',
    useResourceDimension: false,
    dimensions: [{ name: 'QueueName', value: 'prd-order-queue' }],
  },
];

const resources: ResourceEntry[] = [
  ec2,
  entry('alb', 'app/prd-front-alb/50dc6c495c0c9188', {
    'unhealthy-hosts': { TargetGroup: 'targetgroup/prd-web-tg/73e2d6bc24d8a067' },
  }),
  entry('aurora-pg', 'prd-orders-aurora-instance-1'),
  entry('rds-pg', 'prd-billing-db'),
];

const specs = buildAlarms(global, resources);
const findings = validate(global, resources, specs);
const script = generateCli(global, specs);

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        catalogTypes: CATALOG.map((c) => ({ key: c.key, metrics: c.metrics.length })),
        alarmCount: specs.length,
        globalTags: global.tags,
        findings,
        specs,
      },
      null,
      2,
    ),
  );
} else if (process.argv.includes('--preflight')) {
  console.log(generatePreflight(global, specs));
} else {
  console.log(script);
}
