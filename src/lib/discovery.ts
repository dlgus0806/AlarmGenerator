import type { ResourceEntry } from '../types';
import { getResourceType } from '../catalog';
import { defaultSelection } from './templates';

export interface DiscoveredResource {
  /** 리소스 카드로 만들 때 쓸 카탈로그 타입 키 (매핑 불가면 null) */
  typeKey: string | null;
  /** 디멘션 값으로 들어갈 리소스 식별자 */
  resourceId: string;
  /** 화면 표시용 이름 */
  label: string;
  /** 부가 정보 (엔진, 타입 등) */
  detail: string;
  /** 매핑 불가 사유 (있으면 카드 생성 불가) */
  unsupported?: string;
}

/** RDS 엔진 문자열 -> 카탈로그 타입 키 */
function mapRdsEngine(engine: string): { typeKey: string | null; reason?: string } {
  switch (engine) {
    case 'aurora-postgresql':
      return { typeKey: 'aurora-pg' };
    case 'postgres':
      return { typeKey: 'rds-pg' };
    case 'mysql':
    case 'mariadb':
      return { typeKey: 'rds-mysql' };
    default:
      // aurora-mysql, oracle, sqlserver 등은 아직 카탈로그가 없다.
      return { typeKey: null, reason: `카탈로그 없음(${engine})` };
  }
}

interface RawDiscovery {
  ec2?: { Id: string; Name?: string | null; State?: string; Type?: string }[];
  rds?: { Id: string; Engine?: string; Class?: string }[];
  alb?: { Name: string; Type?: string; Arn: string }[];
}

/** 탐색 스크립트 출력(JSON)을 파싱해 리소스 목록으로 변환한다. */
export function parseDiscovery(raw: string): DiscoveredResource[] {
  const parsed = JSON.parse(raw) as RawDiscovery;
  const out: DiscoveredResource[] = [];

  for (const i of parsed.ec2 ?? []) {
    out.push({
      typeKey: 'ec2',
      resourceId: i.Id,
      label: i.Name || i.Id,
      detail: `EC2 · ${i.Type ?? '?'} · ${i.State ?? '?'}`,
    });
  }

  for (const d of parsed.rds ?? []) {
    const { typeKey, reason } = mapRdsEngine(d.Engine ?? '');
    out.push({
      typeKey,
      resourceId: d.Id,
      label: d.Id,
      detail: `RDS · ${d.Engine ?? '?'} · ${d.Class ?? '?'}`,
      unsupported: reason,
    });
  }

  for (const l of parsed.alb ?? []) {
    // ALB만 지원 (NLB/GLB는 카탈로그 없음). LoadBalancer 디멘션 값은 ARN에서 추출.
    const dim = l.Arn.split('loadbalancer/')[1] ?? l.Arn;
    const isApp = (l.Type ?? 'application') === 'application';
    out.push({
      typeKey: isApp ? 'alb' : null,
      resourceId: dim,
      label: l.Name,
      detail: `ELB · ${l.Type ?? '?'}`,
      unsupported: isApp ? undefined : `카탈로그 없음(${l.Type})`,
    });
  }

  return out;
}

/** 선택한 탐색 리소스들을 리소스 카드(ResourceEntry)로 변환한다. */
export function toResourceEntries(selected: DiscoveredResource[]): ResourceEntry[] {
  const entries: ResourceEntry[] = [];
  for (const r of selected) {
    if (!r.typeKey) continue;
    const type = getResourceType(r.typeKey);
    if (!type) continue;
    entries.push({
      uid: crypto.randomUUID(),
      typeKey: r.typeKey,
      resourceId: r.resourceId,
      selected: defaultSelection(type),
    });
  }
  return entries;
}
