import type { GlobalConfig, ProjectFile, ResourceEntry } from '../types';

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

export function buildProjectFile(
  global: GlobalConfig,
  resources: ResourceEntry[],
): ProjectFile {
  return {
    version: '1',
    generatedAt: new Date().toISOString(),
    global,
    resources,
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
  return parsed as ProjectFile;
}

export const REGIONS = [
  'ap-northeast-2',
  'ap-northeast-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
];
