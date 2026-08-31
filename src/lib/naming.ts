import type { Severity } from '../types';

const SEVERITY_ABBR: Record<Severity, string> = {
  critical: 'crit',
  warning: 'warn',
  info: 'info',
};

export const PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]{1,32}$/;

/** 알람 이름에 허용하는 문자셋. %, 공백, 비ASCII 는 의도적으로 배제한다. */
export const ALARM_NAME_PATTERN = /^[A-Za-z0-9._:/-]+$/;

export const MAX_ALARM_NAME_LENGTH = 255;

/** 커스텀 지표 라벨을 알람 이름에 쓸 수 있는 형태로 바꾼다. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * 리소스 ID를 이름에 넣을 짧은 형태로 줄인다.
 * ALB처럼 app/<name>/<hash> 형태면 가운데 이름 부분을 쓴다.
 */
export function shortenResourceId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return '';
  const parts = trimmed.split('/');
  const base = parts.length >= 2 ? parts[1] : parts[0];
  return base.replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 12);
}

/**
 * 알람 이름 규칙.
 * - % 지표(cpu/mem/disk 등 thresholdUnit이 percent): 끝에 임계값을 붙인다.
 *   예) ec2-i0ea431a652e-cpu-high-80 / -90.
 *   같은 리소스에 임계값별로 여러 알람을 두는 고객사가 많아서, 값을 이름에 넣어야
 *   80·90 알람이 서로 다른 알람으로 공존한다.
 * - 그 외 지표: 끝에 심각도 약어(crit/warn/info).
 *
 * 주의: % 지표는 임계값을 바꾸면 이름이 바뀌므로, 기존 80 알람은 그대로 남고 90 알람이
 * 새로 생긴다. (이 방식이 이 요구사항에서는 의도된 동작이다.)
 */
export function buildAlarmName(args: {
  prefix: string;
  shortCode: string;
  resourceId: string;
  metricKey: string;
  severity: Severity;
  threshold?: number;
  thresholdUnit?: string;
}): string {
  const usePercent =
    args.thresholdUnit === 'percent' &&
    args.threshold != null &&
    Number.isFinite(args.threshold);
  const tail = usePercent ? String(args.threshold) : SEVERITY_ABBR[args.severity];
  return [
    args.prefix.trim(),
    args.shortCode,
    shortenResourceId(args.resourceId),
    args.metricKey,
    tail,
  ]
    .filter((s) => s.length > 0)
    .join('-');
}

export function severityAbbr(severity: Severity): string {
  return SEVERITY_ABBR[severity];
}
