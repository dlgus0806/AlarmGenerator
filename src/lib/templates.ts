import type {
  AlarmTemplate,
  CustomMetric,
  ResourceEntry,
  ResourceType,
  SelectedMetric,
  TemplateResource,
} from '../types';
import { CATALOG } from '../catalog';
import { initLevels } from './build';

const STORAGE_KEY = 'cw-alarm-generator.templates';

/** 리소스 타입의 defaultOn 지표만 켠 기본 선택 (지표 인스턴스 배열) */
export function defaultSelection(type: ResourceType): SelectedMetric[] {
  return type.metrics
    .filter((m) => m.defaultOn)
    .map((m) => ({
      uid: crypto.randomUUID(),
      metricKey: m.key,
      threshold: m.threshold,
      customName: '',
      extraDimValues: {},
      levels: initLevels(m),
    }));
}

/** 현재 리소스 목록에서 리소스 ID를 떼어내 표준으로 만든다. */
export function toTemplate(name: string, resources: ResourceEntry[]): AlarmTemplate {
  return {
    version: '1',
    name: name.trim(),
    createdAt: new Date().toISOString(),
    resources: resources
      .filter((r) => r.selected.length > 0 || (r.customMetrics ?? []).length > 0)
      .map((r) => ({
        typeKey: r.typeKey,
        selected: structuredClone(r.selected),
        customMetrics: r.customMetrics ? structuredClone(r.customMetrics) : undefined,
      })),
  };
}

/** RDS 엔진 선택 슬롯의 후보 (Aurora PostgreSQL / RDS PostgreSQL / RDS MySQL·MariaDB) */
export const RDS_ENGINE_CHOICES = ['aurora-pg', 'rds-pg', 'rds-mysql'];

/** choose 슬롯이 하나라도 있는지 */
export function hasChoices(t: AlarmTemplate): boolean {
  return t.resources.some((r) => r.choose && r.choose.length > 0);
}

/**
 * 표준을 적용해 리소스 카드를 만든다. 리소스 ID는 빈 채로 둔다.
 * choices[슬롯 인덱스] = 선택된 typeKey. choose 슬롯인데 선택이 없으면 첫 후보를 쓴다.
 */
export function applyTemplate(
  t: AlarmTemplate,
  choices: Record<number, string> = {},
): ResourceEntry[] {
  return t.resources.map((tr: TemplateResource, i) => {
    if (tr.choose && tr.choose.length > 0) {
      const chosen = choices[i] ?? tr.choose[0];
      const type = CATALOG.find((c) => c.key === chosen);
      return {
        uid: crypto.randomUUID(),
        typeKey: chosen,
        resourceId: '',
        selected: type ? defaultSelection(type) : [],
      };
    }
    return {
      uid: crypto.randomUUID(),
      typeKey: tr.typeKey,
      resourceId: '',
      // 인스턴스 uid는 새로 발급
      selected: tr.selected.map((s) => ({ ...structuredClone(s), uid: crypto.randomUUID() })),
      customMetrics: tr.customMetrics
        ? tr.customMetrics.map((c: CustomMetric) => ({
            ...structuredClone(c),
            uid: crypto.randomUUID(),
          }))
        : undefined,
    };
  });
}

/** 고정 타입 슬롯 (카탈로그 기본 지표로 채움) */
function typeSlot(key: string): TemplateResource {
  const type = CATALOG.find((c) => c.key === key);
  return { typeKey: key, selected: type ? defaultSelection(type) : [] };
}

/** 적용 시 타입을 고르는 슬롯 */
function chooseSlot(candidates: string[]): TemplateResource {
  return { typeKey: candidates[0], selected: [], choose: candidates };
}

export function builtinTemplates(): AlarmTemplate[] {
  const base = { version: '1' as const, createdAt: '1970-01-01T00:00:00.000Z', builtin: true };
  return [
    {
      ...base,
      name: '웹 워크로드 알람 (EC2 + ALB + RDS)',
      resources: [typeSlot('ec2'), typeSlot('alb'), chooseSlot(RDS_ENGINE_CHOICES)],
    },
    {
      ...base,
      name: 'RDS 알람',
      resources: [chooseSlot(RDS_ENGINE_CHOICES)],
    },
    {
      ...base,
      name: 'EC2 알람',
      resources: [typeSlot('ec2')],
    },
  ];
}

// ---- 사용자 표준 저장소 (localStorage) ----

export function loadUserTemplates(): AlarmTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AlarmTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveUserTemplates(list: AlarmTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/** 같은 이름이면 덮어쓴다. builtin 이름과 충돌하면 저장 측에서 막는다. */
export function upsertUserTemplate(t: AlarmTemplate): AlarmTemplate[] {
  const list = loadUserTemplates();
  const idx = list.findIndex((x) => x.name === t.name);
  if (idx >= 0) list[idx] = t;
  else list.push(t);
  saveUserTemplates(list);
  return list;
}

export function deleteUserTemplate(name: string): AlarmTemplate[] {
  const list = loadUserTemplates().filter((x) => x.name !== name);
  saveUserTemplates(list);
  return list;
}

/** 팀 공유용: 표준 하나를 파일 형태 문자열로. */
export function templateToJson(t: AlarmTemplate): string {
  return JSON.stringify({ ...t, builtin: undefined }, null, 2);
}

export function parseTemplate(raw: string): AlarmTemplate {
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('resources' in parsed) ||
    !Array.isArray((parsed as AlarmTemplate).resources)
  ) {
    throw new Error('표준(템플릿) JSON 형식이 아닙니다.');
  }
  const t = parsed as AlarmTemplate;
  return { ...t, version: '1', builtin: false, name: t.name || '불러온 표준' };
}
