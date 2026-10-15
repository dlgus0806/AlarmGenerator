import type { ResourceType } from '../types';
// (levels 등 optional 필드 포함) JSON을 ResourceType으로 취급
import ec2 from './ec2.json';
import alb from './alb.json';
import auroraPg from './aurora-postgresql.json';
import auroraMysql from './aurora-mysql.json';
import rdsPg from './rds-postgresql.json';
import rdsMysql from './rds-mysql.json';
import rdsMariadb from './rds-mariadb.json';
import rdsOracle from './rds-oracle.json';
import rdsSqlserver from './rds-sqlserver.json';
import lambda from './lambda.json';
import asg from './asg.json';
import ecs from './ecs.json';
import targetGroup from './target-group.json';
import cloudfront from './cloudfront.json';
import route53HealthCheck from './route53-health-check.json';
import accountSecurity from './account-security.json';

/**
 * 카탈로그는 JSON으로 분리해 두었다. 임계값 변경은 코드 수정이 아니라
 * 이 JSON 파일의 PR로 처리한다.
 */
export const CATALOG: ResourceType[] = [
  ec2 as ResourceType,
  asg as ResourceType,
  alb as ResourceType,
  targetGroup as ResourceType,
  ecs as ResourceType,
  lambda as ResourceType,
  cloudfront as ResourceType,
  route53HealthCheck as ResourceType,
  auroraPg as ResourceType,
  auroraMysql as ResourceType,
  rdsPg as ResourceType,
  rdsMysql as ResourceType,
  rdsMariadb as ResourceType,
  rdsOracle as ResourceType,
  rdsSqlserver as ResourceType,
  accountSecurity as ResourceType,
];

export function getResourceType(key: string): ResourceType | undefined {
  return CATALOG.find((r) => r.key === key);
}

export function getMetric(typeKey: string, metricKey: string) {
  return getResourceType(typeKey)?.metrics.find((m) => m.key === metricKey);
}
