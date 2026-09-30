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
  /** 목록 묶음 */
  kind: DiscoveredKind;
  /** 칩으로 보여줄 부가 정보 (인스턴스 타입, 엔진, 클래스 등) */
  meta: string[];
  /** EC2 상태 (running / stopped …) */
  state?: string;
  /** 카드로 만들 때 지표의 추가 디멘션에 미리 채울 값 (ECS ClusterName, TG LoadBalancer) */
  extraDims?: Record<string, string>;
}

export type DiscoveredKind = 'EC2' | 'ASG' | 'ELB' | 'TG' | 'ECS' | 'Lambda' | 'CloudFront' | 'RDS';

/** RDS 엔진 문자열 -> 카탈로그 타입 키 */
function mapRdsEngine(engine: string): { typeKey: string | null; reason?: string } {
  switch (engine) {
    case 'aurora-postgresql':
      return { typeKey: 'aurora-pg' };
    case 'aurora-mysql':
      return { typeKey: 'aurora-mysql' };
    case 'postgres':
      return { typeKey: 'rds-pg' };
    case 'mysql':
      return { typeKey: 'rds-mysql' };
    case 'mariadb':
      return { typeKey: 'rds-mariadb' };
    default:
      // oracle-ee, oracle-se2 등 오라클 계열은 공통 RDS 지표로 매핑.
      if (engine.startsWith('oracle')) return { typeKey: 'rds-oracle' };
      // sqlserver-ee / -se / -ex / -web
      if (engine.startsWith('sqlserver')) return { typeKey: 'rds-sqlserver' };
      // 그 외 엔진은 아직 카탈로그가 없다.
      return { typeKey: null, reason: `카탈로그 없음(${engine})` };
  }
}

interface RawDiscovery {
  ec2?: { Id: string; Name?: string | null; State?: string; Type?: string }[];
  rds?: { Id: string; Engine?: string; Class?: string }[];
  alb?: { Name: string; Type?: string; Arn: string }[];
  lambda?: { Name: string; Runtime?: string; Memory?: number }[];
  asg?: { Name: string; Min?: number; Max?: number; Desired?: number; Instances?: number }[];
  ecs?: { Cluster: string; Service: string }[];
  targetGroups?: {
    Name: string;
    Arn: string;
    Protocol?: string;
    TargetType?: string;
    LoadBalancerArns?: string[];
  }[];
  cloudfront?: { Id: string; Domain?: string; Aliases?: string[]; Enabled?: boolean; Comment?: string }[];
}

/** ELB ARN 에서 CloudWatch 디멘션 값(app/…, net/…, targetgroup/…) 을 뽑는다. */
function elbDim(arn: string, marker: 'loadbalancer/' | ':targetgroup/'): string {
  if (marker === ':targetgroup/') {
    const rest = arn.split(':targetgroup/')[1];
    return rest ? `targetgroup/${rest}` : arn;
  }
  return arn.split('loadbalancer/')[1] ?? arn;
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
      kind: 'EC2',
      meta: i.Type ? [i.Type] : [],
      state: i.State,
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
      kind: 'RDS',
      meta: [d.Engine, d.Class].filter((v): v is string => Boolean(v)),
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
      kind: 'ELB',
      meta: [isApp ? 'ALB' : (l.Type ?? '?').toUpperCase()],
    });
  }

  for (const f of parsed.lambda ?? []) {
    // Lambda 지표의 디멘션은 FunctionName (함수 이름 그대로).
    out.push({
      typeKey: 'lambda',
      resourceId: f.Name,
      label: f.Name,
      detail: `Lambda · ${f.Runtime ?? '?'}`,
      kind: 'Lambda',
      meta: [f.Runtime, f.Memory ? `${f.Memory}MB` : undefined].filter((v): v is string => Boolean(v)),
    });
  }

  for (const g of parsed.asg ?? []) {
    // 디멘션은 AutoScalingGroupName (그룹 이름 그대로).
    const size = g.Desired != null ? `${g.Min ?? '?'}/${g.Desired}/${g.Max ?? '?'}` : undefined;
    out.push({
      typeKey: 'asg',
      resourceId: g.Name,
      label: g.Name,
      detail: `ASG · 최소/희망/최대 ${size ?? '?'}`,
      kind: 'ASG',
      meta: [size ? `min/desired/max ${size}` : undefined, g.Instances != null ? `인스턴스 ${g.Instances}` : undefined].filter(
        (v): v is string => Boolean(v),
      ),
    });
  }

  for (const t of parsed.targetGroups ?? []) {
    // 대상 그룹 지표는 TargetGroup + LoadBalancer 두 디멘션이 필요하다. ALB(app/)에 붙은 것만 지원.
    const lbDims = (t.LoadBalancerArns ?? []).map((a) => elbDim(a, 'loadbalancer/'));
    const albDim = lbDims.find((d) => d.startsWith('app/'));
    const reason = !lbDims.length
      ? '로드 밸런서에 연결되지 않음'
      : !albDim
        ? `ALB 아님(${lbDims[0].split('/')[0]})`
        : undefined;
    const meta = [t.Protocol, t.TargetType, albDim ? albDim.split('/')[1] : undefined];
    if (lbDims.length > 1) meta.push(`LB ${lbDims.length}개 중 첫 ALB`);
    out.push({
      typeKey: reason ? null : 'target-group',
      resourceId: elbDim(t.Arn, ':targetgroup/'),
      label: t.Name,
      detail: `대상 그룹 · ${t.Protocol ?? '?'}`,
      unsupported: reason,
      kind: 'TG',
      meta: meta.filter((v): v is string => Boolean(v)),
      extraDims: albDim ? { LoadBalancer: albDim } : undefined,
    });
  }

  for (const s of parsed.ecs ?? []) {
    // 디멘션은 ServiceName + ClusterName. 같은 서비스 이름이 여러 클러스터에 있을 수 있어 클러스터를 함께 표시.
    out.push({
      typeKey: 'ecs',
      resourceId: s.Service,
      label: s.Service,
      detail: `ECS · ${s.Cluster}`,
      kind: 'ECS',
      meta: [`클러스터 ${s.Cluster}`],
      extraDims: { ClusterName: s.Cluster },
    });
  }

  for (const d of parsed.cloudfront ?? []) {
    // 디멘션은 DistributionId (+ Region=Global 고정). 알람은 us-east-1 에서만 만들 수 있다.
    const name = d.Aliases?.[0] || d.Comment || d.Domain || d.Id;
    out.push({
      typeKey: 'cloudfront',
      resourceId: d.Id,
      label: name,
      detail: `CloudFront · ${d.Domain ?? '?'}`,
      kind: 'CloudFront',
      meta: [d.Enabled === false ? '비활성' : undefined, 'us-east-1 알람'].filter(
        (v): v is string => Boolean(v),
      ),
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
    const hints = r.extraDims;
    entries.push({
      uid: crypto.randomUUID(),
      typeKey: r.typeKey,
      resourceId: r.resourceId,
      // 조회로 알아낸 추가 디멘션(ClusterName, LoadBalancer)을 해당 디멘션이 있는 지표에 미리 채운다.
      selected: defaultSelection(type).map((sel) => {
        if (!hints) return sel;
        const preset = type.metrics.find((m) => m.key === sel.metricKey);
        const dims: Record<string, string> = {};
        for (const d of preset?.extraDimensions ?? []) {
          if (hints[d.name]) dims[d.name] = hints[d.name];
        }
        return { ...sel, extraDimValues: { ...sel.extraDimValues, ...dims } };
      }),
      dimHints: hints,
    });
  }
  return entries;
}
