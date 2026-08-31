import type { GlobalConfig } from '../types';

function q(value: string): string {
  return `"${value.replace(/([\\"$`])/g, '\\$1')}"`;
}

/**
 * 읽기 전용 리소스 탐색 스크립트.
 * EC2 / RDS / ALB를 나열해 하나의 JSON으로 출력한다. 아무것도 만들거나 바꾸지 않는다.
 * 출력을 앱의 "탐색 결과 붙여넣기"에 넣으면 리소스 목록이 체크박스로 뜬다.
 *
 * 나중에 백엔드가 읽기 전용 역할을 assume해 같은 호출을 하면
 * 이 붙여넣기 단계가 자동화된다 (파싱·카드 생성 로직은 동일).
 */
export function generateDiscovery(global: GlobalConfig): string {
  const region = global.region;
  const ec2q =
    "Reservations[].Instances[].{Id:InstanceId,Name:Tags[?Key=='Name']|[0].Value,State:State.Name,Type:InstanceType}";
  const rdsq = 'DBInstances[].{Id:DBInstanceIdentifier,Engine:Engine,Class:DBInstanceClass}';
  const albq = 'LoadBalancers[].{Name:LoadBalancerName,Type:Type,Arn:LoadBalancerArn}';

  return [
    '#!/usr/bin/env bash',
    '#',
    '# 리소스 탐색 (읽기 전용) — 대상 계정 CloudShell에서 실행하세요.',
    '# EC2 / RDS / ALB를 JSON으로 출력합니다. 아무것도 생성/변경하지 않습니다.',
    '# 출력 전체를 복사해 앱의 "탐색 결과 붙여넣기"에 넣으세요.',
    '#',
    'set -uo pipefail',
    `REGION=${q(region)}`,
    '',
    "echo '{'",
    `echo '"region": ${q(region)},'`,
    "echo '\"ec2\":'",
    `aws ec2 describe-instances --region "$REGION" --output json --query ${q(ec2q)}`,
    "echo ',\"rds\":'",
    `aws rds describe-db-instances --region "$REGION" --output json --query ${q(rdsq)}`,
    "echo ',\"alb\":'",
    `aws elbv2 describe-load-balancers --region "$REGION" --output json --query ${q(albq)}`,
    "echo '}'",
    '',
  ].join('\n');
}
