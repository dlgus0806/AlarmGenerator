/**
 * 로컬 전용 리소스 탐색 백엔드 (개발/테스트용).
 * 조회 로직은 core.mjs 공유 (Lambda 핸들러와 동일 코드).
 * 로컬 aws 자격증명(환경/프로파일)을 사용하며 브라우저에 노출하지 않는다.
 *
 * 실행:  npm run server
 */
import { createServer } from 'node:http';
import {
  ALLOWED_ORIGIN,
  AUTH_ENABLED,
  aiAdvise,
  aiIntake,
  aiPreflight,
  discover,
  securitySummary,
  tokenOk,
} from './core.mjs';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-api-token, content-type');
  res.setHeader('Access-Control-Max-Age', '600');
}

const server = createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  const isDiscover = url.pathname === '/api/discover';
  const isAi = url.pathname === '/api/ai';
  const isIntake = url.pathname === '/api/intake';
  const isPreflight = url.pathname === '/api/preflight';
  if (!isDiscover && !isAi && !isIntake && !isPreflight) {
    res.writeHead(404).end('not found');
    return;
  }
  if (!tokenOk(req.headers['x-api-token'])) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '인증 실패: 유효한 접근 토큰이 필요합니다.' }));
    return;
  }
  const roleArn = url.searchParams.get('roleArn') ?? '';
  const account = url.searchParams.get('account') ?? '';
  const region = url.searchParams.get('region') ?? 'ap-northeast-2';
  try {
    const data = isIntake
      ? await aiIntake({
          text: url.searchParams.get('q') ?? '',
          catalog: url.searchParams.get('cat') ?? '',
          region,
        })
      : isPreflight
        ? await aiPreflight({
            roleArn: roleArn || undefined,
            account,
            region,
            specs: url.searchParams.get('specs') ?? '[]',
          })
        : isAi
          ? await aiAdvise({
              question: url.searchParams.get('q') ?? '',
              roleArn: roleArn || undefined,
              account,
              region,
              catalog: url.searchParams.get('cat') ?? '',
            })
          : await discover({ roleArn: roleArn || undefined, account, region });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (e) {
    const status = e.status ?? 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message ?? e).slice(0, 500) }));
  }
});

server.listen(PORT, () => {
  console.log(`[discover] http://localhost:${PORT}/api/discover  (${securitySummary()})`);
  if (!AUTH_ENABLED && ALLOWED_ORIGIN === '*') {
    console.warn(
      '[discover] 경고: 인증 없음 + CORS 개방. 공개 배포 시 DISCOVER_API_TOKEN 과 ALLOWED_ORIGIN 을 반드시 설정하세요.',
    );
  }
});
