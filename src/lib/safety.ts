/**
 * 산출물 안전 가드 (프론트엔드 방어선).
 * 금지 목록(cw-alarm-generator.md)을 코드로 강제한다.
 * 생성/감사/사전점검 스크립트에 파괴적 명령이 섞이지 않았는지 검사한다.
 */

/** 스크립트에 절대 들어가면 안 되는 파괴적 AWS 명령 패턴 */
export const FORBIDDEN_CLI: { re: RegExp; label: string }[] = [
  { re: /\bdelete-alarms\b/, label: 'delete-alarms (알람 삭제)' },
  { re: /\bdisable-alarm-actions\b/, label: 'disable-alarm-actions (알람 비활성)' },
  { re: /\bterminate-instances\b/, label: 'terminate-instances (EC2 종료)' },
  { re: /\bstop-instances\b/, label: 'stop-instances (EC2 중지)' },
  { re: /\breboot-instances\b/, label: 'reboot-instances (EC2 재부팅)' },
  { re: /\bdelete-db-instance\b/, label: 'delete-db-instance (RDS 삭제)' },
  { re: /\breboot-db-instance\b/, label: 'reboot-db-instance (RDS 재부팅)' },
  { re: /\bdelete-load-balancer\b/, label: 'delete-load-balancer (ALB 삭제)' },
  { re: /\bmodify-[a-z-]+\b/, label: 'modify-* (리소스 변경)' },
  { re: /\bdelete-[a-z-]+\b/, label: 'delete-* (삭제)' },
  { re: /\bremove-[a-z-]+\b/, label: 'remove-* (제거)' },
  { re: /\bderegister-[a-z-]+\b/, label: 'deregister-* (등록 해제)' },
  { re: /\brevoke-[a-z-]+\b/, label: 'revoke-* (권한 회수)' },
  { re: /\bterminate-[a-z-]+\b/, label: 'terminate-* (종료)' },
];

/** 주석이 아닌 라인만 대상으로 파괴적 명령을 찾는다. */
export function scanForbidden(script: string): string[] {
  const hits: string[] = [];
  for (const raw of script.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue; // 주석/빈 줄 제외
    for (const { re, label } of FORBIDDEN_CLI) {
      if (re.test(line)) hits.push(label);
    }
  }
  return [...new Set(hits)];
}

/**
 * 알람 "생성" 스크립트 전용 엄격 검사:
 * 주석이 아닌 aws 명령은 put-metric-alarm 하나만 허용한다.
 */
export function scanCreationViolations(script: string): string[] {
  const violations = scanForbidden(script);
  for (const raw of script.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('aws ')) continue; // 주석(# aws ...)은 여기서 제외됨
    if (!line.startsWith('aws cloudwatch put-metric-alarm')) {
      violations.push(`허용되지 않은 명령: ${line.slice(0, 60)}`);
    }
  }
  return [...new Set(violations)];
}
