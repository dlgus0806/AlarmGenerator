/**
 * Lambda Function URL 핸들러 (payload format 2.0).
 * 조회 로직은 core.mjs 공유 (로컬 서버와 동일 코드). AWS SDK v3는 Lambda 런타임 내장.
 *
 * 환경변수(공개 배포 시 필수): DISCOVER_API_TOKEN, ALLOWED_ORIGIN, ALLOWED_ROLE_NAMES
 * 핸들러 설정: lambda.handler / 런타임 nodejs20.x
 */
import { ALLOWED_ORIGIN, aiAdvise, aiIntake, aiPreflight, discover, sendFeedback, tokenOk } from './core.mjs';
import {
  authConfigured,
  beginLogin,
  handleCallback,
  logoutCookie,
  publicIdentity,
  readSession,
} from './auth.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'x-api-token, content-type',
  Vary: 'Origin',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method ?? 'GET';
  if (method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };

  const path = event?.rawPath ?? '/';
  const cookies = event?.cookies ?? [];
  if (path.endsWith('/api/health')) return json(200, { ok: true });

  // ---- 인증 라우트 (세션 불필요) ----
  if (path.endsWith('/api/auth/slack/login')) {
    if (!authConfigured()) return json(500, { error: 'OAuth 미구성 (SLACK_* / SESSION_SECRET 환경변수 필요).' });
    const { url, setCookie } = beginLogin();
    return { statusCode: 302, headers: { ...corsHeaders, Location: url }, cookies: [setCookie], body: '' };
  }
  if (path.endsWith('/api/auth/slack/callback')) {
    try {
      const { setCookies, redirectTo } = await handleCallback(event?.queryStringParameters ?? {}, cookies);
      return { statusCode: 302, headers: { ...corsHeaders, Location: redirectTo }, cookies: setCookies, body: '' };
    } catch (e) {
      return json(400, { error: String(e?.message ?? e).slice(0, 300) });
    }
  }
  if (path.endsWith('/api/auth/logout')) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
      cookies: [logoutCookie()],
      body: JSON.stringify({ ok: true }),
    };
  }
  if (path.endsWith('/api/auth/me')) {
    const s = readSession(cookies);
    if (!s) return json(401, { authenticated: false });
    return json(200, { authenticated: true, identity: publicIdentity(s) });
  }

  // 버그/오류 신고 (로그인 불필요 — 로그인 문제도 신고할 수 있어야 하므로).
  // OAC+POST 본문 서명 제약을 피해 GET 쿼리도 받는다(POST 본문도 지원).
  if (path.endsWith('/api/feedback')) {
    let payload = {};
    if (method === 'POST') {
      try {
        const raw = event?.isBase64Encoded
          ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
          : (event?.body ?? '');
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        return json(400, { error: '요청 본문(JSON) 파싱 실패' });
      }
    } else {
      const q = event?.queryStringParameters ?? {};
      payload = {
        title: q.title,
        content: q.content,
        meta: { email: q.email, url: q.url, userAgent: q.ua },
      };
    }
    try {
      const data = await sendFeedback({
        title: payload.title,
        content: payload.content,
        meta: payload.meta,
      });
      return json(200, data);
    } catch (e) {
      return json(e?.status ?? 500, { error: String(e?.message ?? e).slice(0, 300) });
    }
  }

  const isDiscover = path.endsWith('/api/discover');
  const isAi = path.endsWith('/api/ai');
  const isIntake = path.endsWith('/api/intake');
  const isPreflight = path.endsWith('/api/preflight');
  if (!isDiscover && !isAi && !isIntake && !isPreflight) {
    return { statusCode: 404, headers: corsHeaders, body: 'not found' };
  }

  // ---- 인증 게이트 ----
  // OAuth 가 구성돼 있으면 세션 쿠키를 요구한다(공개 무인증 종료).
  // 아직 미구성이면(SLACK_* 환경변수 없음) 기존 토큰 방식으로 폴백 → 배포만으로는 동작이 바뀌지 않음.
  const headers = event?.headers ?? {};
  let session = null;
  // 사내 전용: 프론트가 로그인 게이트로 앱 전체를 막고, 백엔드도 모든 엔드포인트에 세션을 요구한다.
  // (공개 Bedrock 노출 방지 — /api/intake 포함 전부 로그인 필요)
  if (authConfigured()) {
    session = readSession(cookies);
    if (!session) {
      return json(401, { error: '로그인이 필요합니다. Slack 로그인 후 다시 시도하세요.' });
    }
  } else if (!tokenOk(headers['x-api-token'])) {
    return json(401, { error: '인증 실패: 유효한 접근 토큰이 필요합니다.' });
  }
  const slackToken = session?.slackToken;

  const qs = event?.queryStringParameters ?? {};
  try {
    if (isIntake) {
      const data = await aiIntake({
        text: qs.q || '',
        catalog: qs.cat || '',
        region: qs.region || 'ap-northeast-2',
      });
      return json(200, data);
    }
    if (isPreflight) {
      const data = await aiPreflight({
        roleArn: qs.roleArn || undefined,
        accountId: qs.accountId || undefined,
        slackToken,
        account: qs.account || '',
        region: qs.region || 'ap-northeast-2',
        specs: qs.specs || '[]',
      });
      return json(200, data);
    }
    if (isAi) {
      const data = await aiAdvise({
        question: qs.q || '',
        roleArn: qs.roleArn || undefined,
        accountId: qs.accountId || undefined,
        slackToken,
        account: qs.account || '',
        region: qs.region || 'ap-northeast-2',
        catalog: qs.cat || '',
      });
      return json(200, data);
    }
    const data = await discover({
      roleArn: qs.roleArn || undefined,
      accountId: qs.accountId || undefined,
      slackToken,
      account: qs.account || '',
      region: qs.region || 'ap-northeast-2',
    });
    return json(200, data);
  } catch (e) {
    return json(e?.status ?? 500, { error: String(e?.message ?? e).slice(0, 500) });
  }
}
