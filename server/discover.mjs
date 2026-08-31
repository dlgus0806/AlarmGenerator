/**
 * 로컬 전용 리소스 탐색 백엔드 (테스트용).
 * localhost에서만 돌고, 로컬 aws CLI 자격증명을 사용한다. 브라우저에 크레덴셜을 노출하지 않는다.
 *
 *   - 대상 == 호출자 자기 계정  → 직접 읽기
 *   - 대상 != 자기 계정         → 읽기 전용 역할 assume 후 읽기
 *
 * 허용 계정·역할명은 환경변수 또는 server/account.local.json(gitignore)로 설정한다.
 * 실행:  npm run server
 */
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const pexec = promisify(execFile);
const PORT = 8787;

// 로컬 설정 파일(gitignore)이 있으면 사용, 없으면 환경변수/플레이스홀더.
let localCfg = {};
try {
  localCfg = JSON.parse(readFileSync(new URL('./account.local.json', import.meta.url), 'utf8'));
} catch {
  /* 없으면 무시 */
}
const ALLOWED_ACCOUNTS = new Set(
  localCfg.accounts ?? (process.env.ALLOWED_ACCOUNTS?.split(',')) ?? ['123456789012'],
);
const ROLE_NAME = localCfg.roleName ?? process.env.ASSUME_ROLE_NAME ?? 'monitoring-readonly';

/**
 * 코드 가드 (강제): 이 백엔드가 실행할 수 있는 AWS 작업의 화이트리스트.
 * 조회(읽기)와 역할 assume만 허용한다. 목록에 없는 모든 작업은 물리적으로 차단된다.
 * 리소스 생성/변경/삭제, 알람 삭제 등은 여기 없으므로 절대 실행되지 않는다.
 */
const ALLOWED_OPS = new Set([
  'sts:get-caller-identity',
  'sts:assume-role',
  'ec2:describe-instances',
  'rds:describe-db-instances',
  'elbv2:describe-load-balancers',
]);

function assertAllowedOp(args) {
  const service = args[0];
  const op = args[1];
  const key = `${service}:${op}`;
  if (!ALLOWED_OPS.has(key)) {
    const err = new Error(
      `차단됨: 허용되지 않은 AWS 작업 '${key}'. 이 백엔드는 조회 전용입니다 (허용: ${[...ALLOWED_OPS].join(', ')}).`,
    );
    err.status = 403;
    throw err;
  }
}

const EC2_Q =
  "Reservations[].Instances[].{Id:InstanceId,Name:Tags[?Key=='Name']|[0].Value,State:State.Name,Type:InstanceType}";
const RDS_Q = 'DBInstances[].{Id:DBInstanceIdentifier,Engine:Engine,Class:DBInstanceClass}';
const ALB_Q = 'LoadBalancers[].{Name:LoadBalancerName,Type:Type,Arn:LoadBalancerArn}';

async function awsJson(args, env = process.env) {
  assertAllowedOp(args); // 화이트리스트에 없는 작업은 여기서 차단
  const { stdout } = await pexec('aws', [...args, '--output', 'json'], {
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** 대상 계정용 자격증명 환경변수를 만든다. 자기 계정이면 그대로, 아니면 역할 assume. */
async function credsFor(account, callerAccount) {
  if (account === callerAccount) return process.env;
  // 승인된 역할·계정으로만 assume (금지 목록 4번)
  if (!ALLOWED_ACCOUNTS.has(account)) {
    const err = new Error(`차단됨: 승인되지 않은 계정 assume 시도 (${account})`);
    err.status = 403;
    throw err;
  }
  const roleArn = `arn:aws:iam::${account}:role/${ROLE_NAME}`;
  const res = await awsJson([
    'sts',
    'assume-role',
    '--role-arn',
    roleArn,
    '--role-session-name',
    'alarm-gen-discovery',
  ]);
  const c = res.Credentials;
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: c.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: c.SecretAccessKey,
    AWS_SESSION_TOKEN: c.SessionToken,
  };
}

async function discover(account, region) {
  const caller = await awsJson(['sts', 'get-caller-identity']);
  if (!ALLOWED_ACCOUNTS.has(account)) {
    const err = new Error(`허용되지 않은 계정: ${account} (지금은 ${[...ALLOWED_ACCOUNTS].join(', ')}만 가능)`);
    err.status = 403;
    throw err;
  }
  const env = await credsFor(account, caller.Account);
  const region_ = ['--region', region];
  const [ec2, rds, alb] = await Promise.all([
    awsJson(['ec2', 'describe-instances', ...region_, '--query', EC2_Q], env),
    awsJson(['rds', 'describe-db-instances', ...region_, '--query', RDS_Q], env),
    awsJson(['elbv2', 'describe-load-balancers', ...region_, '--query', ALB_Q], env),
  ]);
  return { account, region, callerArn: caller.Arn, ec2, rds, alb };
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/api/discover') {
    res.writeHead(404).end('not found');
    return;
  }
  const account = url.searchParams.get('account') ?? '';
  const region = url.searchParams.get('region') ?? 'ap-northeast-2';
  try {
    const data = await discover(account, region);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (e) {
    const status = e.status ?? 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message ?? e).slice(0, 500) }));
  }
});

server.listen(PORT, () => {
  console.log(`[discover] http://localhost:${PORT}/api/discover  (허용 계정: ${[...ALLOWED_ACCOUNTS].join(', ')})`);
});
