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
  // ALB 등 app/<name>/<hash> 형태(슬래시 포함)는 가운데 이름 부분만 짧게 쓴다.
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    const base = parts.length >= 2 ? parts[1] : parts[0];
    return base.replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 12);
  }
  // 그 외(EC2 인스턴스 ID, RDS 식별자 등)는 전체 ID를 그대로 쓴다(허용 문자만 유지).
  // 예) i-030e7c3d36c937197 → 그대로. 축약하면 지표/알람 대조 시 혼동이 생긴다.
  return trimmed.replace(/[^A-Za-z0-9._:-]/g, '');
}

/**
 * 알람 이름 규칙: {prefix}-{shortCode}[-{scope}]-{resourceId}-{metricKey}[-{임계값}]
 * - scope: 이름에 넣도록 표시한 추가 디멘션 값(ECS 클러스터 이름). 대부분의 타입은 없다.
 * - % 지표(thresholdUnit이 percent): 끝에 임계값을 붙인다.
 *   예) ec2-i0ea431a652e-cpu-high-80 / -90.
 *   같은 리소스에 임계값별로 여러 알람을 두는 고객사가 많아서, 값을 이름에 넣어야
 *   80·90 알람이 서로 다른 알람으로 공존한다.
 * - 그 외 지표: metricKey 로 끝난다(단계 알람은 metricKey 에 -lv1 등, 이상 탐지는 -anomaly 포함).
 *   심각도는 이름에 넣지 않는다.
 *
 * 주의: % 지표는 임계값을 바꾸면 이름이 바뀌므로, 기존 80 알람은 그대로 남고 90 알람이
 * 새로 생긴다. (이 방식이 이 요구사항에서는 의도된 동작이다.)
 */
export function buildAlarmName(args: {
  prefix: string;
  shortCode: string;
  resourceId: string;
  metricKey: string;
  threshold?: number;
  thresholdUnit?: string;
  /** 리소스 앞에 넣을 구분값 (예: ECS 클러스터 이름). 없으면 생략. */
  scope?: string;
}): string {
  const usePercent =
    args.thresholdUnit === 'percent' &&
    args.threshold != null &&
    Number.isFinite(args.threshold);
  const tail = usePercent ? String(args.threshold) : '';
  return [
    args.prefix.trim(),
    args.shortCode,
    (args.scope ?? '').trim().replace(/[^A-Za-z0-9._:-]/g, ''),
    shortenResourceId(args.resourceId),
    args.metricKey,
    tail,
  ]
    .filter((s) => s.length > 0)
    .join('-');
}
