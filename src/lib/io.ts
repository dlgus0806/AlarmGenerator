import type { GlobalConfig, ProjectFile, ResourceEntry, SelectedMetric } from '../types';

export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 내보낼 때 "실제 생성에 쓰이는 값"만 남긴다.
 * 단일 임계값(single) 또는 이상 탐지(anomaly) 모드에서는 levels 블록이 무시되므로 제외한다.
 * (재업로드 시 빠진 levels 는 기본값으로 자동 복원된다.)
 */
function exportSelected(s: SelectedMetric): SelectedMetric {
  const out: SelectedMetric = { ...s };
  if (out.single === true || out.anomaly === true) delete out.levels;
  return out;
}

export function buildProjectFile(
  global: GlobalConfig,
  resources: ResourceEntry[],
): ProjectFile {
  return {
    version: '1',
    generatedAt: new Date().toISOString(),
    global,
    resources: resources.map((r) => ({ ...r, selected: r.selected.map(exportSelected) })),
  };
}

/** 재업로드 시 최소한의 형태 검증만 한다. */
export function parseProjectFile(raw: string): ProjectFile {
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('global' in parsed) ||
    !('resources' in parsed) ||
    !Array.isArray((parsed as ProjectFile).resources)
  ) {
    throw new Error('알람 생성기가 내보낸 JSON 형식이 아닙니다.');
  }
  const file = parsed as ProjectFile;
  file.global = migrateGlobal(file.global);
  return file;
}

/**
 * 예전 형식의 전역 설정(snsCritical/snsWarning/splitSeverity)을 새 snsTopics 배열로 옮긴다.
 * 이미 snsTopics가 있으면 그대로 둔다.
 */
function migrateGlobal(global: GlobalConfig): GlobalConfig {
  if (!global || typeof global !== 'object') return global;
  const g = global as GlobalConfig & {
    snsCritical?: unknown;
    snsWarning?: unknown;
    splitSeverity?: unknown;
  };
  if (!Array.isArray(g.snsTopics)) {
    const topics: string[] = [];
    for (const v of [g.snsCritical, g.snsWarning]) {
      if (typeof v === 'string' && v.trim() && !topics.includes(v.trim())) topics.push(v.trim());
    }
    g.snsTopics = topics;
  }
  delete g.snsCritical;
  delete g.snsWarning;
  delete g.splitSeverity;
  return g;
}

/**
 * 상용(aws) 파티션 리전. 서울을 맨 위에, 나머지는 지역별로 묶었다.
 * GovCloud(aws-us-gov)·European Sovereign Cloud 는 ARN 파티션·자격증명이 달라 제외한다.
 * 이름 표시는 선택 편의용이며 값은 리전 ID 그대로 쓴다.
 */
export const REGION_NAMES: Record<string, string> = {
  'ap-northeast-2': '서울',
  'ap-northeast-1': '도쿄',
  'ap-northeast-3': '오사카',
  'ap-east-1': '홍콩',
  'ap-east-2': '타이베이',
  'ap-southeast-1': '싱가포르',
  'ap-southeast-2': '시드니',
  'ap-southeast-3': '자카르타',
  'ap-southeast-4': '멜버른',
  'ap-southeast-5': '말레이시아',
  'ap-southeast-6': '뉴질랜드',
  'ap-southeast-7': '태국',
  'ap-south-1': '뭄바이',
  'ap-south-2': '하이데라바드',
  'us-east-1': '버지니아 북부',
  'us-east-2': '오하이오',
  'us-west-1': '캘리포니아 북부',
  'us-west-2': '오레곤',
  'ca-central-1': '캐나다 중부',
  'ca-west-1': '캘거리',
  'mx-central-1': '멕시코 중부',
  'sa-east-1': '상파울루',
  'eu-central-1': '프랑크푸르트',
  'eu-central-2': '취리히',
  'eu-west-1': '아일랜드',
  'eu-west-2': '런던',
  'eu-west-3': '파리',
  'eu-north-1': '스톡홀름',
  'eu-south-1': '밀라노',
  'eu-south-2': '스페인',
  'il-central-1': '텔아비브',
  'me-central-1': 'UAE',
  'me-south-1': '바레인',
  'af-south-1': '케이프타운',
};

export const REGIONS = Object.keys(REGION_NAMES);
