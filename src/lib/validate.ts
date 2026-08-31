import type { AlarmSpec, Finding, GlobalConfig, ResourceEntry } from '../types';
import { getResourceType } from '../catalog';
import { ALARM_NAME_PATTERN, MAX_ALARM_NAME_LENGTH, PREFIX_PATTERN } from './naming';

const VALID_OPERATORS = new Set([
  'GreaterThanOrEqualToThreshold',
  'GreaterThanThreshold',
  'LessThanThreshold',
  'LessThanOrEqualToThreshold',
  'LessThanLowerOrGreaterThanUpperThreshold',
  'LessThanLowerThreshold',
  'GreaterThanUpperThreshold',
]);

const VALID_MISSING_DATA = new Set(['breaching', 'notBreaching', 'ignore', 'missing']);

const SNS_ARN = /^arn:aws(-[a-z]+)*:sns:([a-z0-9-]+):(\d{12}):(.+)$/;

/** 글로벌 메트릭은 알람도 us-east-1에 있어야 한다. */
const US_EAST_1_ONLY_NAMESPACES = new Set(['AWS/CloudFront', 'AWS/Billing']);

/**
 * AI 호출 전에 돌리는 결정론적 검증. 여기서 잡히는 것들은
 * 규칙이 명확해서 AI 판단이 필요 없고, AI보다 정확하다.
 */
export function validate(
  global: GlobalConfig,
  resources: ResourceEntry[],
  specs: AlarmSpec[],
): Finding[] {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  // ---- 전역 설정 ----
  // prefix는 선택. 입력한 경우에만 형식을 검사한다.
  if (global.prefix.trim() && !PREFIX_PATTERN.test(global.prefix.trim())) {
    add({
      level: 'error',
      category: 'prefix',
      message: `prefix "${global.prefix}" 형식이 올바르지 않습니다.`,
      fix: '소문자·숫자·하이픈 2~33자. 첫 글자는 소문자 또는 숫자. 비워두면 접두사 없이 생성됩니다.',
    });
  }

  // 사용자 태그 검증 (선택 항목이므로 있을 때만)
  const TAG_SAFE = /^[\p{L}\p{N}+\-=._:/@]+$/u;
  global.tags.forEach((t, i) => {
    const key = t.key.trim();
    const val = t.value.trim();
    if (!key && !val) return; // 빈 행은 무시
    if (!key || !val) {
      add({
        level: 'error',
        category: 'tag',
        message: `태그 ${i + 1}번: 키와 값을 모두 채우거나 행을 비우세요.`,
      });
      return;
    }
    if (!TAG_SAFE.test(key) || !TAG_SAFE.test(val)) {
      add({
        level: 'error',
        category: 'tag',
        message: `태그 "${key}": 사용할 수 없는 문자가 있습니다.`,
        fix: '태그는 문자·숫자와 + - = . _ : / @ 만 허용합니다. %와 쉼표는 쓸 수 없습니다.',
      });
    }
  });
  const tagKeys = global.tags.map((t) => t.key.trim()).filter(Boolean);
  const dupKey = tagKeys.find((k, i) => tagKeys.indexOf(k) !== i);
  if (dupKey) {
    add({
      level: 'error',
      category: 'tag',
      message: `태그 키 "${dupKey}"가 중복됩니다.`,
    });
  }

  const topics: [string, string][] = global.splitSeverity
    ? [
        ['critical SNS', global.snsCritical],
        ['warning SNS', global.snsWarning],
      ]
    : [['SNS', global.snsCritical]];

  for (const [label, arn] of topics) {
    const value = arn.trim();
    if (!value) {
      add({ level: 'error', category: 'sns', message: `${label} Topic ARN을 입력하세요.` });
      continue;
    }
    const m = SNS_ARN.exec(value);
    if (!m) {
      add({
        level: 'error',
        category: 'sns',
        message: `${label} Topic ARN 형식이 올바르지 않습니다.`,
        fix: 'arn:aws:sns:<리전>:<계정12자리>:<토픽이름> 형태여야 합니다.',
      });
      continue;
    }
    if (m[2] !== global.region) {
      add({
        level: 'error',
        category: 'sns',
        message: `${label} Topic이 ${m[2]} 리전인데 알람은 ${global.region}에 만들어집니다.`,
        fix: 'SNS 토픽은 알람과 같은 리전이어야 합니다. 알람은 생성되지만 알림이 가지 않습니다.',
      });
    }
  }

  // ---- 리소스 입력 ----
  for (const entry of resources) {
    const type = getResourceType(entry.typeKey);
    if (!type) continue;
    const id = entry.resourceId.trim();
    const label = `${type.label}`;
    const activeCustom = (entry.customMetrics ?? []).filter((c) => c.enabled);

    if (entry.selected.length === 0 && activeCustom.length === 0) continue;

    // 커스텀 지표 입력 검증
    for (const cm of activeCustom) {
      const name = cm.label || cm.metricName || '(이름 없음)';
      if (!cm.namespace.trim()) {
        add({
          level: 'error',
          category: 'custom',
          message: `${label} / 커스텀 "${name}": Namespace가 비어 있습니다.`,
          fix: '예: AWS/EC2, CWAgent, 또는 직접 만든 네임스페이스',
        });
      }
      if (!cm.metricName.trim()) {
        add({
          level: 'error',
          category: 'custom',
          message: `${label} / 커스텀 "${name}": 지표 이름이 비어 있습니다.`,
        });
      }
      const dimCount =
        (cm.useResourceDimension && id ? 1 : 0) +
        cm.dimensions.filter((d) => d.name.trim() && d.value.trim()).length;
      if (dimCount === 0) {
        add({
          level: 'warning',
          category: 'custom',
          message: `${label} / 커스텀 "${name}": 디멘션이 하나도 없습니다.`,
          fix: '디멘션 없는 지표도 존재하지만, 대개는 리소스 디멘션이 필요합니다. list-metrics로 확인하세요.',
        });
      }
      for (const d of cm.dimensions) {
        const hasName = Boolean(d.name.trim());
        const hasValue = Boolean(d.value.trim());
        if (hasName !== hasValue) {
          add({
            level: 'error',
            category: 'custom',
            message: `${label} / 커스텀 "${name}": 디멘션 이름과 값 중 하나만 입력되었습니다.`,
          });
        }
      }
      add({
        level: 'info',
        category: 'custom',
        message: `${label} / 커스텀 "${name}": 카탈로그를 거치지 않은 지표입니다.`,
        fix: '실행 전 list-metrics로 지표와 디멘션이 실제로 존재하는지 확인하세요. 반복해서 쓸 지표라면 카탈로그 JSON에 추가하는 편이 좋습니다.',
      });
    }

    if (!id) {
      add({
        level: 'error',
        category: 'resource',
        message: `${label}: 리소스 ID가 비어 있습니다.`,
      });
    } else if (type.idPattern && !new RegExp(type.idPattern).test(id)) {
      add({
        level: 'warning',
        category: 'resource',
        message: `${label}: 리소스 ID "${id}" 형식이 예상과 다릅니다.`,
        fix: `예: ${type.idPlaceholder}`,
      });
    }

    for (const sel of entry.selected) {
      const preset = type.metrics.find((m) => m.key === sel.metricKey);
      if (!preset) continue;
      for (const dim of preset.extraDimensions ?? []) {
        if (!(sel.extraDimValues[dim.name] ?? '').trim()) {
          add({
            level: 'error',
            category: 'dimension',
            message: `${label} / ${preset.label}: ${dim.name} 디멘션 값이 비어 있습니다.`,
            fix: '디멘션이 하나라도 어긋나면 알람이 지표를 찾지 못해 영구히 INSUFFICIENT_DATA가 됩니다.',
          });
        }
      }
      if (!Number.isFinite(sel.threshold)) {
        add({
          level: 'error',
          category: 'threshold',
          message: `${label} / ${preset.label}: 임계값이 숫자가 아닙니다.`,
        });
      }
    }
  }

  // ---- 알람별 검증 ----
  const seen = new Map<string, number>();

  for (const spec of specs) {
    const n = spec.alarmName;
    seen.set(n, (seen.get(n) ?? 0) + 1);

    if (n.length > MAX_ALARM_NAME_LENGTH) {
      add({
        level: 'error',
        category: 'name',
        alarmName: n,
        message: `알람 이름이 ${n.length}자입니다. 최대 255자.`,
      });
    }
    if (!ALARM_NAME_PATTERN.test(n)) {
      add({
        level: 'error',
        category: 'name',
        alarmName: n,
        message: '알람 이름에 사용할 수 없는 문자가 있습니다.',
        fix: '영문·숫자·하이픈·밑줄·점·콜론·슬래시만 사용하세요. %와 공백은 콘솔 링크를 깨뜨립니다.',
      });
    }

    if (spec.datapointsToAlarm > spec.evaluationPeriods) {
      add({
        level: 'error',
        category: 'evaluation',
        alarmName: n,
        message: `datapoints-to-alarm(${spec.datapointsToAlarm})이 evaluation-periods(${spec.evaluationPeriods})보다 큽니다.`,
      });
    }

    const validPeriod = [10, 20, 30].includes(spec.period) || spec.period % 60 === 0;
    if (!validPeriod) {
      add({
        level: 'error',
        category: 'period',
        alarmName: n,
        message: `period ${spec.period}는 유효하지 않습니다.`,
        fix: '10, 20, 30 또는 60의 배수만 가능합니다.',
      });
    }

    const total = spec.period * spec.evaluationPeriods;
    if (total > 604800) {
      add({
        level: 'error',
        category: 'period',
        alarmName: n,
        message: `총 평가 기간이 ${total}초입니다. 상한은 604800초(7일).`,
      });
    } else if (spec.period < 3600 && total > 86400) {
      add({
        level: 'error',
        category: 'period',
        alarmName: n,
        message: `period가 1시간 미만일 때 총 평가 기간은 86400초(1일) 이하여야 합니다. 현재 ${total}초.`,
      });
    }

    if (spec.period < 60) {
      add({
        level: 'warning',
        category: 'period',
        alarmName: n,
        message: `period ${spec.period}초는 고해상도 알람입니다.`,
        fix: '표준 알람보다 요금이 비싸고, 1분 해상도 지표에서는 INSUFFICIENT_DATA가 잦습니다.',
      });
    }

    const hasStat = Boolean(spec.statistic);
    const hasExt = Boolean(spec.extendedStatistic);
    if (hasStat === hasExt) {
      add({
        level: 'error',
        category: 'statistic',
        alarmName: n,
        message: 'statistic과 extended-statistic 중 정확히 하나만 있어야 합니다.',
      });
    }

    if (!VALID_OPERATORS.has(spec.comparisonOperator)) {
      add({
        level: 'error',
        category: 'enum',
        alarmName: n,
        message: `comparison-operator "${spec.comparisonOperator}"는 유효하지 않습니다.`,
      });
    }
    if (!VALID_MISSING_DATA.has(spec.treatMissingData)) {
      add({
        level: 'error',
        category: 'enum',
        alarmName: n,
        message: `treat-missing-data "${spec.treatMissingData}"는 유효하지 않습니다.`,
        fix: 'breaching / notBreaching / ignore / missing (대소문자 구분)',
      });
    }

    if (US_EAST_1_ONLY_NAMESPACES.has(spec.namespace) && global.region !== 'us-east-1') {
      add({
        level: 'error',
        category: 'region',
        alarmName: n,
        message: `${spec.namespace} 지표는 us-east-1에만 존재합니다. 현재 리전 ${global.region}.`,
      });
    }

    if (spec.badges.includes('인스턴스 의존')) {
      add({
        level: 'info',
        category: 'threshold',
        alarmName: n,
        message: '이 지표의 적정 임계값은 인스턴스 클래스에 따라 달라집니다.',
        fix: '실제 인스턴스 스펙을 확인하고 임계값을 조정하세요. 기본값은 임의 값입니다.',
      });
    }
    if (spec.badges.includes('에이전트 필요')) {
      add({
        level: 'info',
        category: 'prerequisite',
        alarmName: n,
        message: 'CloudWatch Agent가 설치되어 있어야 지표가 존재합니다.',
        fix: '실행 전 list-metrics로 지표와 디멘션을 확인하세요.',
      });
    }
  }

  for (const [name, count] of seen) {
    if (count > 1) {
      add({
        level: 'error',
        category: 'name',
        alarmName: name,
        message: `알람 이름이 ${count}번 중복됩니다.`,
        fix: 'put-metric-alarm은 이름 기준 upsert이므로 마지막 것만 남습니다.',
      });
    }
  }

  return findings;
}

export function countByLevel(findings: Finding[]) {
  return {
    error: findings.filter((f) => f.level === 'error').length,
    warning: findings.filter((f) => f.level === 'warning').length,
    info: findings.filter((f) => f.level === 'info').length,
  };
}
