/**
 * 웹 Slack OAuth (방법 가) — 우리 백엔드가 직접 토큰 교환/신원 검증하고 세션을 발급한다.
 *
 * 흐름:
 *   1) GET /api/auth/slack/login   → Slack authorize 로 302 (state 쿠키 심음)
 *   2) GET /api/auth/slack/callback?code&state
 *        → oauth.v2.access 로 code 교환 → authed_user.access_token(=Slack Bearer)
 *        → users.identity 로 team/email 검증
 *        → 세션 쿠키(암호화) 발급 후 앱으로 302
 *   3) 이후 /api/* 요청은 세션 쿠키로 인증. 세션 안에 Slack Bearer 를 넣어두고,
 *      계정 조회 시 브로커 POST /v1/customer-credentials 호출에 사용한다.
 *
 * 보안:
 *   - 세션 쿠키는 AES-256-GCM 로 "암호화"한다(서명만 하면 Slack Bearer 가 브라우저에 노출됨).
 *   - HttpOnly; Secure; SameSite=Lax; Path=/.  (Lax 는 Slack→callback 최상위 리다이렉트에서 쿠키 전달을 허용)
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function envCfg() {
  return {
    clientId: process.env.SLACK_CLIENT_ID ?? '',
    clientSecret: process.env.SLACK_CLIENT_SECRET ?? '',
    // 세 곳(등록/authorize/token 교환)에서 반드시 동일해야 하는 값.
    baseUrl: (process.env.APP_BASE_URL ?? 'https://cw.dlgus.fitcloud.co.kr').replace(/\/+$/, ''),
    teamId: process.env.SLACK_TEAM_ID ?? 'T192GUYE7',
    emailDomain: (process.env.ALLOWED_EMAIL_DOMAIN ?? 'saltware.co.kr').replace(/^@/, ''),
    sessionSecret: process.env.SESSION_SECRET ?? '',
    sessionTtlSec: Number(process.env.SESSION_TTL_SEC ?? 21600), // 기본 로그인 세션 수명 6시간
  };
}

export function authConfigured() {
  const c = envCfg();
  return Boolean(c.clientId && c.clientSecret && c.sessionSecret);
}

function redirectUri() {
  return `${envCfg().baseUrl}/api/auth/slack/callback`;
}

function key32() {
  // SESSION_SECRET → 32바이트 대칭키.
  return createHash('sha256').update(envCfg().sessionSecret).digest();
}

/** payload(obj) → 암호문 쿠키 값 (base64url: iv|tag|ciphertext). */
function seal(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key32(), iv);
  const pt = Buffer.from(JSON.stringify(payload), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url');
}

/** 쿠키 값 → payload(obj) 또는 null(위조/만료/복호화 실패). */
function open(value) {
  try {
    const raw = Buffer.from(String(value), 'base64url');
    if (raw.length < 28) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key32(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch {
    return null;
  }
}

/** Cookie 헤더 문자열에서 특정 쿠키 값 추출. */
function readCookie(cookieHeader, name) {
  const h = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader || '';
  for (const part of h.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

function cookie(name, value, maxAgeSec) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
  ];
  if (maxAgeSec != null) attrs.push(`Max-Age=${maxAgeSec}`);
  return attrs.join('; ');
}

const SESSION_COOKIE = 'cw_session';
const STATE_COOKIE = 'cw_oauth_state';

/** 로그인 시작: authorize URL + state 쿠키. */
export function beginLogin() {
  const c = envCfg();
  const state = randomBytes(16).toString('hex');
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('user_scope', 'identity.basic,identity.email');
  url.searchParams.set('state', state);
  return { url: url.toString(), setCookie: cookie(STATE_COOKIE, state, 600) };
}

/** code → Slack 사용자 토큰 (authed_user.access_token). */
async function exchangeCode(code) {
  const c = envCfg();
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    redirect_uri: redirectUri(),
  });
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`Slack oauth 실패: ${j.error ?? 'unknown'}`);
  const token = j.authed_user?.access_token;
  if (!token) throw new Error('Slack 사용자 토큰을 받지 못했습니다.');
  return token;
}

/** 사용자 토큰으로 신원 조회 + 팀/이메일 검증. */
async function verifyIdentity(userToken) {
  const c = envCfg();
  const res = await fetch('https://slack.com/api/users.identity', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`Slack 신원 조회 실패: ${j.error ?? 'unknown'}`);
  const teamId = j.team?.id ?? '';
  const email = j.user?.email ?? '';
  const userId = j.user?.id ?? '';
  const name = j.user?.name ?? '';
  if (teamId !== c.teamId) throw new Error('허용되지 않은 Slack 워크스페이스입니다.');
  if (!email.toLowerCase().endsWith(`@${c.emailDomain.toLowerCase()}`)) {
    throw new Error(`허용되지 않은 이메일 도메인입니다(@${c.emailDomain} 만 허용).`);
  }
  return { userId, email, name };
}

/**
 * 콜백 처리. 성공 시 { setCookies:[세션, state삭제], redirectTo } 반환, 실패 시 throw.
 * query: { code, state }, cookieHeader: 원본 Cookie 헤더.
 */
export async function handleCallback(query, cookieHeader) {
  const c = envCfg();
  const code = query.code ?? '';
  const state = query.state ?? '';
  const expected = readCookie(cookieHeader, STATE_COOKIE);
  if (!code) throw new Error('code 가 없습니다.');
  if (!state || !expected || !safeEq(state, expected)) {
    throw new Error('state 불일치(CSRF 방지).');
  }
  const slackToken = await exchangeCode(code);
  const id = await verifyIdentity(slackToken);
  const now = Math.floor(Date.now() / 1000);
  const session = {
    sub: id.userId,
    email: id.email,
    name: id.name,
    slackToken, // 브로커 /v1/customer-credentials 호출용 (쿠키는 암호화되어 있음)
    exp: now + c.sessionTtlSec,
  };
  return {
    setCookies: [cookie(SESSION_COOKIE, seal(session), c.sessionTtlSec), cookie(STATE_COOKIE, '', 0)],
    redirectTo: c.baseUrl + '/',
  };
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** /api/* 인증. 유효 세션이면 payload, 아니면 null. */
export function readSession(cookieHeader) {
  const raw = readCookie(cookieHeader, SESSION_COOKIE);
  if (!raw) return null;
  const s = open(raw);
  if (!s || typeof s !== 'object') return null;
  if (!s.exp || s.exp < Math.floor(Date.now() / 1000)) return null;
  return s;
}

/** 로그아웃: 세션 쿠키 삭제. */
export function logoutCookie() {
  return cookie(SESSION_COOKIE, '', 0);
}

/** 세션에서 화면에 보여줄 신원(민감정보 제외). */
export function publicIdentity(session) {
  if (!session) return null;
  return { email: session.email, name: session.name, userId: session.sub };
}
