/**
 * 조회 백엔드 공유 코어. 로컬 HTTP 서버(discover.mjs)와 Lambda 핸들러(lambda.mjs)가 함께 쓴다.
 * AWS SDK v3만 사용한다(aws CLI 불필요) — Lambda nodejs20.x 런타임에 SDK가 내장돼 있다.
 *
 * 조회(읽기) + 승인된 역할 assume 만 한다. 생성/변경/삭제 명령은 이 코드에 아예 없다(구조적 가드).
 */
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  CloudWatchClient,
  GetMetricDataCommand,
  DescribeAlarmsCommand,
  ListMetricsCommand,
} from '@aws-sdk/client-cloudwatch';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

// 로컬 설정 파일(gitignore)이 있으면 사용, 없으면 환경변수/기본값.
let localCfg = {};
try {
  localCfg = JSON.parse(readFileSync(new URL('./account.local.json', import.meta.url), 'utf8'));
} catch {
  /* 없으면 무시 (Lambda에서는 env로 설정) */
}

const ROLE_NAME = localCfg.roleName ?? process.env.ASSUME_ROLE_NAME ?? 'monitoring-readonly';
const ALLOWED_ACCOUNTS = new Set(
  localCfg.accounts ?? process.env.ALLOWED_ACCOUNTS?.split(',') ?? ['123456789012'],
);
/** 붙여넣은 ARN으로 assume할 때 허용하는 역할 이름 화이트리스트. */
const ALLOWED_ROLE_NAMES = new Set(
  localCfg.roleNames ?? process.env.ALLOWED_ROLE_NAMES?.split(',') ?? [ROLE_NAME],
);

export const ALLOWED_ORIGIN = localCfg.allowedOrigin ?? process.env.ALLOWED_ORIGIN ?? '*';
const API_TOKEN = localCfg.apiToken ?? process.env.DISCOVER_API_TOKEN ?? '';
export const AUTH_ENABLED = Boolean(API_TOKEN);

/** Bedrock 모델 (추론 프로파일 ID). AI 조언 기능에서 사용. */
const BEDROCK_MODEL_ID =
  localCfg.bedrockModelId ?? process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-sonnet-5';

/** 자격증명 브로커 API 베이스 URL. 설정되면 계정 ID 조회를 브로커 경유로 수행. */
const BROKER_API_URL = (localCfg.brokerApiUrl ?? process.env.BROKER_API_URL ?? '').replace(/\/+$/, '');

/** 버그/오류 신고를 발행할 SNS 토픽 ARN(이메일 구독). 비면 신고 기능 비활성. */
const FEEDBACK_TOPIC_ARN = localCfg.feedbackTopicArn ?? process.env.FEEDBACK_TOPIC_ARN ?? '';

/**
 * 버그/오류 신고를 SNS로 발행한다(구독한 이메일로 전달).
 * SNS Subject 는 ASCII·100자 제한이라 고정 영문으로 두고, 한글 제목은 본문에 담는다.
 */
export async function sendFeedback({ title, content, meta }) {
  if (!FEEDBACK_TOPIC_ARN) throw fail(500, '신고 채널이 구성되지 않았습니다 (FEEDBACK_TOPIC_ARN 미설정).');
  const t = String(title ?? '').trim();
  const c = String(content ?? '').trim();
  if (!c) throw fail(400, '요청 내용을 입력하세요.');
  if (t.length > 200) throw fail(400, '제목이 너무 깁니다(최대 200자).');
  if (c.length > 5000) throw fail(400, '내용이 너무 깁니다(최대 5000자).');

  // 스팸 필터가 URL·UA 문자열을 자주 격리하므로 본문은 최대한 순수 텍스트로 둔다.
  const message = [
    `제목: ${t || '(제목 없음)'}`,
    '',
    c,
    '',
    '----------------------------------------',
    `보낸 사람: ${meta?.email ? meta.email : '(비로그인)'}`,
    `시각: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n');

  const region = FEEDBACK_TOPIC_ARN.split(':')[3] || 'ap-northeast-2';
  const sns = new SNSClient({ region });
  await sns.send(
    new PublishCommand({
      TopicArn: FEEDBACK_TOPIC_ARN,
      Subject: 'CloudWatch Alarm Generator - Feedback',
      Message: message,
    }),
  );
  return { ok: true };
}

/** 12자리 AWS 계정 ID 검증. */
const ACCOUNT_ID_RE = /^\d{12}$/;

/**
 * 자격증명 브로커에서 계정 read-only 세션을 받는다 (방법 가: 로그인 세션의 Slack Bearer 사용).
 * 응답 형태가 { Credentials: {...} } / { credentials: {...} } / 평면 중 무엇이든 수용한다.
 */
async function fetchBrokerCredentials({ accountId, slackToken, region }) {
  if (!BROKER_API_URL) throw fail(500, '브로커가 구성되지 않았습니다 (BROKER_API_URL 미설정).');
  if (!slackToken) throw fail(401, '로그인 세션이 없습니다.');
  const url = `${BROKER_API_URL}/v1/customer-credentials`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${slackToken}` },
    body: JSON.stringify({ accountId, agent: 'alarm-generator' }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg;
    try {
      msg = JSON.parse(text).error;
    } catch {
      /* ignore */
    }
    throw fail(res.status, msg ?? `브로커 오류 (${res.status})`);
  }
  const j = JSON.parse(text);
  const c = j.Credentials ?? j.credentials ?? j;
  const accessKeyId = c.AccessKeyId ?? c.accessKeyId;
  const secretAccessKey = c.SecretAccessKey ?? c.secretAccessKey;
  const sessionToken = c.SessionToken ?? c.sessionToken;
  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw fail(502, '브로커 응답에 자격증명이 없습니다.');
  }
  return { credentials: { accessKeyId, secretAccessKey, sessionToken }, account: j.account ?? accountId };
}

export function securitySummary() {
  return `assume 허용 역할: ${[...ALLOWED_ROLE_NAMES].join(', ')} · CORS: ${ALLOWED_ORIGIN} · 인증: ${
    API_TOKEN ? '토큰 필요' : '없음(로컬)'
  }`;
}

/** 상수 시간 토큰 비교. API_TOKEN 미설정이면 항상 통과(로컬). */
export function tokenOk(provided) {
  if (!API_TOKEN) return true;
  const got = Array.isArray(provided) ? provided[0] : provided;
  if (typeof got !== 'string' || got.length === 0) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(API_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const ROLE_ARN_RE = /^arn:aws(?:-[a-z]+)*:iam::(\d{12}):role\/(.+)$/;
export function parseRoleArn(arn) {
  const m = ROLE_ARN_RE.exec(String(arn).trim());
  if (!m) {
    const err = new Error(`역할 ARN 형식이 아닙니다: ${String(arn).slice(0, 80)}`);
    err.status = 400;
    throw err;
  }
  return { account: m[1], roleName: m[2].split('/').pop() };
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** assume-role 결과를 SDK 자격증명 형태로 변환. */
async function assume(sts, roleArn) {
  const res = await sts.send(
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: 'alarm-gen-discovery' }),
  );
  const c = res.Credentials;
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
  };
}

async function readEc2(cfg) {
  const c = new EC2Client(cfg);
  const out = await c.send(new DescribeInstancesCommand({}));
  return (out.Reservations ?? []).flatMap((r) => r.Instances ?? []).map((i) => ({
    Id: i.InstanceId,
    Name: (i.Tags ?? []).find((t) => t.Key === 'Name')?.Value,
    State: i.State?.Name,
    Type: i.InstanceType,
  }));
}

async function readRds(cfg) {
  const c = new RDSClient(cfg);
  const out = await c.send(new DescribeDBInstancesCommand({}));
  return (out.DBInstances ?? []).map((d) => ({
    Id: d.DBInstanceIdentifier,
    Engine: d.Engine,
    Class: d.DBInstanceClass,
  }));
}

async function readAlb(cfg) {
  const c = new ElasticLoadBalancingV2Client(cfg);
  const out = await c.send(new DescribeLoadBalancersCommand({}));
  return (out.LoadBalancers ?? []).map((l) => ({
    Name: l.LoadBalancerName,
    Type: l.Type,
    Arn: l.LoadBalancerArn,
  }));
}

/**
 * 대상 계정의 IAM 계정 별칭(설정돼 있으면)을 읽는다. read-only 세션으로 조회.
 * client-iam 이 런타임에 없거나(동적 import 실패), 별칭 미설정, 권한 없음 등은
 * 모두 조용히 빈 문자열로 처리한다(조회 실패가 전체 discover 를 깨지 않게).
 * IAM 은 글로벌 서비스라 cfg.region 은 무시된다.
 */
async function readAccountAlias(cfg) {
  try {
    const { IAMClient, ListAccountAliasesCommand } = await import('@aws-sdk/client-iam');
    const iam = new IAMClient(cfg);
    const out = await iam.send(new ListAccountAliasesCommand({}));
    return out.AccountAliases?.[0] ?? '';
  } catch {
    return '';
  }
}

/**
 * 대상 자격증명을 해결한다. roleArn이 있으면 그 역할을 assume, 없으면 레거시 account 경로.
 * 반환: { caller, cfg, account } — cfg는 대상 계정용 SDK 클라이언트 설정.
 */
async function resolveTarget({ roleArn, account, region, accountId, slackToken }) {
  const sts = new STSClient({ region });
  const caller = await sts.send(new GetCallerIdentityCommand({}));

  // 계정 ID 기반 경로 (로그인 이후 신규 방식).
  if (accountId) {
    if (!ACCOUNT_ID_RE.test(String(accountId).trim())) {
      throw fail(400, '계정 ID 형식이 올바르지 않습니다(12자리 숫자).');
    }
    const id = String(accountId).trim();
    // (1) 브로커가 구성돼 있으면 브로커 경유 read-only 세션.
    if (BROKER_API_URL) {
      const { credentials, account: acct } = await fetchBrokerCredentials({ accountId: id, slackToken, region });
      return { caller, cfg: { region, credentials }, account: acct };
    }
    // (2) 브로커 미구성 시 임시 폴백: 고정 역할명으로 ARN 조합 후 직접 assume
    //     (해당 계정이 이 백엔드 ExecRole 을 신뢰하는 경우에만 성공 — 테스트 계정용).
    const arn = `arn:aws:iam::${id}:role/${ROLE_NAME}`;
    const credentials = await assume(sts, arn);
    return { caller, cfg: { region, credentials }, account: id };
  }

  let credentials;
  let targetAccount;
  if (roleArn) {
    const parsed = parseRoleArn(roleArn); // 형식 검증
    if (!ALLOWED_ROLE_NAMES.has(parsed.roleName)) {
      throw fail(
        403,
        `차단됨: 승인되지 않은 역할 이름 '${parsed.roleName}'. 허용: ${[...ALLOWED_ROLE_NAMES].join(', ')}`,
      );
    }
    credentials = await assume(sts, roleArn.trim());
    targetAccount = parsed.account;
  } else {
    if (!ALLOWED_ACCOUNTS.has(account)) {
      throw fail(403, `허용되지 않은 계정: ${account} (허용: ${[...ALLOWED_ACCOUNTS].join(', ')})`);
    }
    if (account !== caller.Account) {
      credentials = await assume(sts, `arn:aws:iam::${account}:role/${ROLE_NAME}`);
    }
    targetAccount = account || caller.Account;
  }
  const cfg = credentials ? { region, credentials } : { region };
  return { caller, cfg, account: targetAccount };
}

/**
 * 리소스 조회.
 */
export async function discover({ roleArn, account, region, accountId, slackToken }) {
  const { caller, cfg, account: targetAccount } = await resolveTarget({
    roleArn,
    account,
    region,
    accountId,
    slackToken,
  });
  const [ec2, rds, alb] = await Promise.all([readEc2(cfg), readRds(cfg), readAlb(cfg)]);
  const alias = await readAccountAlias(cfg);
  return { account: targetAccount, alias, region, callerArn: caller.Arn, ec2, rds, alb };
}

/** 실행 중인 EC2의 최근 CPU(기본 3일, 1시간 간격) 평균·최대를 읽는다. 최대 10대. */
async function readRecentCpu(cfg, instances, region) {
  const running = instances.filter((i) => i.State === 'running').slice(0, 10);
  if (running.length === 0) return [];
  const cw = new CloudWatchClient(cfg);
  const end = new Date();
  const start = new Date(end.getTime() - 3 * 24 * 3600 * 1000);
  const queries = running.flatMap((inst, i) => {
    const dim = [{ Name: 'InstanceId', Value: inst.Id }];
    const metric = { Namespace: 'AWS/EC2', MetricName: 'CPUUtilization', Dimensions: dim };
    return [
      { Id: `avg${i}`, MetricStat: { Metric: metric, Period: 3600, Stat: 'Average' }, ReturnData: true },
      { Id: `max${i}`, MetricStat: { Metric: metric, Period: 3600, Stat: 'Maximum' }, ReturnData: true },
    ];
  });
  const out = await cw.send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      MetricDataQueries: queries,
      ScanBy: 'TimestampDescending',
    }),
  );
  const byId = new Map((out.MetricDataResults ?? []).map((r) => [r.Id, r.Values ?? []]));
  const avgOf = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const maxOf = (a) => (a.length ? Math.max(...a) : null);
  return running.map((inst, i) => {
    const avgVals = byId.get(`avg${i}`) ?? [];
    const maxVals = byId.get(`max${i}`) ?? [];
    const avg = avgOf(avgVals);
    const max = maxOf(maxVals);
    return {
      id: inst.Id,
      name: inst.Name,
      type: inst.Type,
      avgCpu: avg == null ? null : Number(avg.toFixed(1)),
      maxCpu: max == null ? null : Number(max.toFixed(1)),
      points: avgVals.length,
    };
  });
}

/** Bedrock Converse 호출 공통 함수. */
async function converse(systemText, userText, region) {
  const bedrock = new BedrockRuntimeClient({ region: region || 'ap-northeast-2' });
  const res = await bedrock.send(
    new ConverseCommand({
      modelId: BEDROCK_MODEL_ID,
      system: [{ text: systemText }],
      messages: [{ role: 'user', content: [{ text: userText }] }],
      // 일부 최신 모델(Sonnet 5 등)은 temperature 를 받지 않는다. maxTokens 만 지정.
      // 계정 추천은 산문 + JSON 제안을 함께 내므로, JSON 블록이 잘리지 않도록 넉넉히 준다.
      inferenceConfig: { maxTokens: 4096 },
    }),
  );
  return (res.output?.message?.content ?? [])
    .map((c) => c.text ?? '')
    .join('')
    .trim();
}

/**
 * 답변에서 제안 JSON을 추출한다.
 * 1) ```json ...``` 코드블록 우선.
 * 2) 펜스가 없으면(모델이 생략) 첫 번째 균형 잡힌 { ... } 객체를 찾아 반환.
 */
function extractFencedJson(answer) {
  const m = answer.match(/```json\s*([\s\S]*?)```/i) ?? answer.match(/```\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  // 펜스가 없으면 첫 번째 완전한 {...} 객체를 중괄호 균형으로 찾는다.
  const start = answer.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < answer.length; i++) {
    const ch = answer[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return answer.slice(start, i + 1).trim();
  }
  return '';
}

const AI_SYSTEM_PROMPT = `당신은 AWS CloudWatch 알람을 조언하는 시니어 SRE입니다.
사용자의 질문과 아래 라이브 인벤토리·최근 CPU 데이터를 근거로, 어떤 알람을 추가하거나 보완하면
좋을지 한국어로 간결히 설명하세요. 그런 다음 생성기에 넣을 제안을 JSON으로 출력하세요.

규칙:
- 답변(한국어 산문)을 먼저 쓰고, 마지막에 반드시 \`\`\`json 코드블록으로 제안 JSON 하나만 출력.
- JSON은 아래 [카탈로그]의 typeKey와 metricKey만 사용. 없으면 넣지 말 것.
- 리소스 ID는 [라이브 인벤토리]에 실제로 있는 것만 사용(지어내지 말 것). 사용자가 이름·별칭으로 말하면 인벤토리에서 매핑:
  · 이름이 인벤토리 리소스와 "정확히 일치" → 그 리소스의 실제 ID를 resourceId 로 사용(unresolved 없음).
  · 정확히는 아니지만 대소문자·앞뒤 공백만 다르거나, 부분 문자열로 "딱 1건"만 일치 → 그 ID를 사용하되
    unresolved 에 field "resource.resourceId.approx" 로 기록.
  · 부분 일치가 2건 이상 → resources 에 넣지 말고 unresolved 에 field "resource.resourceId.multiple".
  · 어디에도 일치하는 리소스가 없음 → resources 에 넣지 말고 unresolved 에 field "resource.resourceId.notfound".
  · 이름/유형을 단어로 추측하지 말 것("서버"=EC2 아님).
- 단계 지표(cpu-high 등)는 threshold 를 특정 값으로 주면 그 값 하나짜리 "단일 알람"으로,
  생략하면 표준 단계(Lv1/2/3)로 적용됩니다. 답변 끝에 이 정책을 한 줄로 안내하세요
  (예: "임계값을 명시하면 단일 알람, 생략하면 표준 3단계로 만들어집니다").
  % 지표는 %값 그대로.
- 최근 CPU가 낮으면 과민한 임계값을 피하고, 높거나 변동이 크면 단계 알람/이상 탐지를 제안.
- 데이터로 확신이 어려우면 그렇게 명시. 실행/변경을 시도하지 말 것(당신은 조언만).

제안 JSON 스키마:
{
  "resources": [
    { "typeKey": "ec2", "resourceId": "i-...", "metrics": [ { "metricKey": "cpu-high", "threshold": 80 } ] }
  ]
}`;

/**
 * 라이브 리소스 + 최근 CPU를 읽어 Bedrock에 조언을 요청한다.
 * CloudWatch 읽기는 대상 역할(assume) 자격증명, Bedrock 호출은 홈 계정(실행 역할) 자격증명 사용.
 */
export async function aiAdvise({ question, roleArn, account, region, catalog, accountId, slackToken }) {
  if (!question || !question.trim()) throw fail(400, '질문(q)이 비어 있습니다.');
  const { cfg } = await resolveTarget({ roleArn, account, region, accountId, slackToken });
  const [ec2, rds, alb] = await Promise.all([readEc2(cfg), readRds(cfg), readAlb(cfg)]);
  const cpu = await readRecentCpu(cfg, ec2, region);

  const inventory = { ec2, rds, alb };
  const cpuText =
    cpu.length === 0
      ? '(실행 중인 EC2 없음 또는 CPU 데이터 없음)'
      : cpu
          .map(
            (c) =>
              `- ${c.id}${c.name ? `(${c.name})` : ''} ${c.type}: 평균 ${c.avgCpu ?? '데이터없음'}%, 최대 ${c.maxCpu ?? '데이터없음'}% (최근 3일)`,
          )
          .join('\n');

  const userText = `## 질문
${question.trim()}

## 라이브 인벤토리 (리전 ${region})
${JSON.stringify(inventory)}

## 최근 CPU (실행 중 EC2)
${cpuText}

## 카탈로그 (사용 가능한 typeKey / metricKey)
${catalog || '(카탈로그 미제공 — 일반 지식으로 조언하되 typeKey/metricKey는 ec2/alb/rds 계열 표준을 따르세요)'}`;

  const answer = await converse(AI_SYSTEM_PROMPT, userText, region);
  return { answer, proposal: extractFencedJson(answer), model: BEDROCK_MODEL_ID, cpu, inventory };
}

const INTAKE_SYSTEM_PROMPT = `당신은 자유 형식으로 쓰인 고객의 CloudWatch 알람 요구사항을,
알람 생성기가 바로 쓸 수 있는 JSON으로 변환하는 도우미입니다. 아무리 형식 없이 길게 써 있어도
핵심(리소스, 지표, 임계값, 리전, SNS)을 뽑아내세요.

규칙:
- 답변 없이 오직 \`\`\`json 코드블록 하나만 출력합니다.
- [카탈로그]에 있는 typeKey / metricKey 만 사용. 없으면 넣지 말고 unresolved 에 기록.
- resourceId 는 요구사항 텍스트에 있는 "실제 식별자"만 사용합니다(i-..., arn:..., DB 인스턴스 식별자 등).
  "nuke 서버", "웹 서버", "결제 DB" 같은 이름·별칭·일반 명사는 resourceId 로 쓰지 마세요(지어내지도 말 것).
- 리소스 유형을 이름의 단어로 추측하지 마세요. "서버"라고 EC2 로 단정 금지(EC2·RDS·Fargate 등 무엇이든 될 수 있음).
  실제 ID나 유형이 불명확하면 그 리소스는 resources 에 넣지 말고, unresolved 에 field "resource.resourceId" 로 기록.
- 임계값·기간이 불명확하면 threshold 를 생략(카탈로그 기본값 사용)하고 unresolved 에 사유를 남김.
- % 지표는 %값 그대로 숫자만.
- global(prefix / region / snsCritical / snsWarning)은 앱에서 이미 설정·관리합니다.
  요구사항 문장에 명시된 값만 global 에 채우고, 명시가 없으면 global 은 전부 빈 문자열로 두세요.
  특히 SNS·prefix·region 이 문장에 없다고 해서 절대 unresolved 에 넣지 마세요(앱 전역 설정이 채웁니다).

출력 스키마:
{
  "global": { "prefix": "", "region": "ap-northeast-2", "snsCritical": "", "snsWarning": "" },
  "resources": [
    { "typeKey": "ec2", "resourceId": "i-...", "metrics": [ { "metricKey": "cpu-high", "threshold": 80 } ] }
  ],
  "unresolved": [ { "field": "무엇", "reason": "왜 확정 못했는지" } ]
}`;

/**
 * 자유 형식 요구사항 텍스트를 Bedrock으로 생성기 JSON으로 변환한다.
 * 계정 조회/역할 assume 없이 텍스트만 처리한다(Bedrock 호출은 홈 계정 실행 역할).
 */
export async function aiIntake({ text, catalog, region }) {
  if (!text || !text.trim()) throw fail(400, '요구사항 텍스트가 비어 있습니다.');
  const userText = `## 카탈로그 (사용 가능한 typeKey / metricKey)
${catalog || '(미제공 — ec2/alb/rds 계열 표준 키를 따르세요)'}

## 고객 요구사항 (자유 형식)
${text.trim()}`;
  const answer = await converse(INTAKE_SYSTEM_PROMPT, userText, region || 'ap-northeast-2');
  return { answer, proposal: extractFencedJson(answer) || answer, model: BEDROCK_MODEL_ID };
}

/** 기존 알람을 이름으로 조회 → name → {threshold, comparison, metricName, namespace} 맵. */
async function readExistingAlarms(cfg, names) {
  const cw = new CloudWatchClient(cfg);
  const map = new Map();
  // describe-alarms 의 AlarmNames 는 호출당 최대 100개.
  for (let i = 0; i < names.length; i += 100) {
    const chunk = names.slice(i, i + 100);
    const out = await cw.send(
      new DescribeAlarmsCommand({ AlarmNames: chunk, AlarmTypes: ['MetricAlarm'] }),
    );
    for (const a of out.MetricAlarms ?? []) {
      map.set(a.AlarmName, {
        threshold: a.Threshold ?? null,
        comparison: a.ComparisonOperator ?? '',
        metricName: a.MetricName ?? '',
        namespace: a.Namespace ?? '',
      });
    }
  }
  return map;
}

/** 지표(namespace+metric+dims) 실존 여부. list-metrics 결과가 1건 이상이면 존재. */
async function metricExists(cw, probe) {
  const dims = (probe.dims ?? []).filter((d) => d.value);
  const params = { Namespace: probe.ns, MetricName: probe.metric };
  if (dims.length) params.Dimensions = dims.map((d) => ({ Name: d.name, Value: d.value }));
  const out = await cw.send(new ListMetricsCommand(params));
  return (out.Metrics ?? []).length > 0;
}

const PREFLIGHT_SYSTEM_PROMPT = `당신은 CloudWatch 알람을 배포하기 직전에 점검하는 시니어 SRE입니다.
아래는 "이번에 실행하면 생길 결과"를 대상 계정에서 실제로 읽어 결정적으로 분류한 사실입니다.
이 사실만 근거로, 실행해도 되는지와 주의할 점을 한국어로 3~5문장으로 판단하세요.

규칙:
- 표를 새로 만들거나 숫자를 바꾸지 마세요(사실은 이미 확정됨). 오직 판단·주의만 서술.
- 알람 이름에 들어간 리소스 표기(예: i030e7c3d36c)는 길이 제한으로 축약된 "슬러그"입니다.
  실제 리소스는 각 줄의 "대상" 필드(예: InstanceId=i-030e7c3d36c937197)이니, 이름 슬러그를
  리소스 ID로 착각하거나 "읽을 수 없다"고 단정하지 마세요.
- "데이터: 있음/없음/확인불가"는 계정을 실제로 조회해 이미 확정한 값입니다(최근 ~2주 내 데이터
  유무 기준). "없음"은 지표 이름이 틀렸다는 뜻이 아니라 아직 데이터가 안 올라왔다는 의미일 수 있습니다.
  임의로 뒤집지 마세요.
- 위험 위주로: (1) 덮어쓰기로 기존 임계값이 바뀌는 알람이 있는지, (2) 데이터가 "없음"이라
  당분간 INSUFFICIENT_DATA 에 머물 알람이 있는지, (3) 전부 신규이고 데이터도 있으면 안전하다고 명시.
- 확신이 어려우면 그렇게 말하세요. 실행/변경을 시도하지 마세요(당신은 조언만).

출력 형식(반드시 지킬 것):
- 첫 줄: "결론: " 으로 시작하는 1~2문장 요약. 판정은 [실행 가능] / [주의 후 실행] / [보류] 중 하나로 시작.
  예) 결론: [주의 후 실행] 덮어쓰기 2건이 기존 임계값을 바꿉니다. 나머지는 신규이며 데이터가 있습니다.
- 둘째 줄부터: 위 판단의 근거와 주의점을 3~5문장으로.`;

const PREFLIGHT_REVIEW_PROMPT = `당신은 CloudWatch 알람을 생성하기 직전에 "정의 자체"를 검토하는 시니어 SRE입니다.
계정 상태는 볼 수 없습니다(계정 조회 없음). 아래 알람 정의만 보고 정확성과 흔한 실수를 한국어로 3~6문장으로 점검하세요.

점검 관점:
- 임계값이 지표·단위에 비해 타당한지(예: 퍼센트 지표에 100 초과 값, 지연(초) 지표에 ms 스케일 값 등).
- 비교 연산자 방향이 지표 의미와 맞는지(사용률은 초과, 여유 메모리/스토리지/여유량은 미만 등).
- period·평가횟수(N)·데이터포인트(M) 조합이 합리적인지(M<=N 여야 하며, 과민/둔감 여부).
- 필수 디멘션 누락이나 오탈자 가능성.
- 결측 데이터 처리(treatMissingData)가 카운트성 지표 등에 적절한지.
문제가 없으면 "정의상 문제 없음"이라고 명시하세요. 계정에 이미 존재하는 알람 여부는 알 수 없다고 전제하고, 그 부분은 단정하지 마세요.

출력 형식(반드시 지킬 것):
- 첫 줄: "결론: " 으로 시작하는 1~2문장 요약. 판정은 [실행 가능] / [주의 후 실행] / [보류] 중 하나로 시작.
  예) 결론: [실행 가능] 정의상 문제 없음. 임계값·비교 방향·평가 기간이 모두 타당합니다.
- 둘째 줄부터: 점검 근거와 주의점을 3~6문장으로.`;

/** specs 를 사람이 읽는 정의 목록 텍스트로. (계정 미연결 검토용) */
function specsFactText(list) {
  return list
    .map((s) => {
      const dims = (s.dims ?? []).filter((d) => d.value).map((d) => `${d.name}=${d.value}`).join(', ');
      const parts = [
        s.name,
        `${s.ns}/${s.metric}`,
        dims || '디멘션 없음',
        s.stat ? `통계 ${s.stat}` : '',
        s.anomaly ? '이상탐지' : `${s.comparison ?? ''} ${s.displayThreshold ?? s.threshold ?? ''}${s.unit && s.unit !== 'raw' ? s.unit : ''}`,
        s.period ? `period ${s.period}s` : '',
        s.evaluationPeriods != null ? `N ${s.evaluationPeriods}/M ${s.datapointsToAlarm}` : '',
        s.treatMissingData ? `결측 ${s.treatMissingData}` : '',
      ].filter(Boolean);
      return `- ${parts.join(' | ')}`;
    })
    .join('\n');
}

/**
 * 배포 직전 AI 점검. 두 모드:
 *  - 계정 미연결(accountId 없음): 정의 자체(문법·설정 타당성)만 Bedrock으로 검토. mode:'review'.
 *  - 계정 연결(accountId 있음): 계정을 읽어 기존 알람·데이터 지표를 결정적으로 대조 + 판단. mode:'account'.
 * specs: [{ name, ns, metric, dims:[{name,value}], threshold, displayThreshold, unit, comparison,
 *          stat, period, evaluationPeriods, datapointsToAlarm, treatMissingData, anomaly }]
 */
export async function aiPreflight({ roleArn, account, region, specs, accountId, slackToken }) {
  const list = Array.isArray(specs) ? specs : JSON.parse(specs || '[]');
  if (list.length === 0) throw fail(400, '점검할 알람이 없습니다.');
  if (list.length > 200) throw fail(400, '알람이 너무 많습니다(최대 200건). 나눠서 점검하세요.');

  // 계정 미연결: 정의 검토만(계정 조회 없음).
  if (!accountId) {
    const factText = `총 ${list.length}건의 알람 정의:\n${specsFactText(list)}`;
    let judgment = '';
    try {
      judgment = await converse(PREFLIGHT_REVIEW_PROMPT, factText, region || 'ap-northeast-2');
    } catch (e) {
      judgment = `(AI 검토를 가져오지 못했습니다: ${String(e.message ?? e).slice(0, 200)})`;
    }
    return { mode: 'review', region, count: list.length, judgment, model: BEDROCK_MODEL_ID };
  }

  const { cfg, account: targetAccount } = await resolveTarget({
    roleArn,
    account,
    region,
    accountId,
    slackToken,
  });
  const cw = new CloudWatchClient(cfg);

  const names = list.map((s) => s.name);
  const existing = await readExistingAlarms(cfg, names);

  // 지표 프로브 중복 제거 후 실존 검사(같은 지표는 한 번만).
  const probeMap = new Map();
  for (const s of list) {
    const dims = (s.dims ?? []).filter((d) => d.value);
    const key = [s.ns, s.metric, ...dims.map((d) => `${d.name}=${d.value}`)].join('|');
    if (!probeMap.has(key)) probeMap.set(key, { ns: s.ns, metric: s.metric, dims });
  }
  const probeKeys = [...probeMap.keys()];
  const existResults = await Promise.all(
    [...probeMap.values()].map((p) => metricExists(cw, p).catch(() => null)),
  );
  const existsByKey = new Map(probeKeys.map((k, i) => [k, existResults[i]]));

  const rows = list.map((s) => {
    const dims = (s.dims ?? []).filter((d) => d.value);
    const key = [s.ns, s.metric, ...dims.map((d) => `${d.name}=${d.value}`)].join('|');
    const ex = existing.get(s.name);
    const present = existsByKey.get(key); // true | false | null(조회 실패)
    const thresholdChanged =
      ex && ex.threshold != null && s.threshold != null && Number(ex.threshold) !== Number(s.threshold);
    return {
      name: s.name,
      metric: `${s.ns} / ${s.metric}`,
      // 실제 대상(디멘션). 알람 이름의 슬러그가 아니라 이 값이 진짜 리소스 식별자다.
      target: dims.map((d) => `${d.name}=${d.value}`).join(', ') || '(디멘션 없음)',
      status: ex ? 'update' : 'new',
      metricMissing: present === false,
      metricUnknown: present === null,
      thresholdChanged: Boolean(thresholdChanged),
      existingThreshold: ex ? ex.threshold : null,
      newThreshold: s.threshold ?? null,
    };
  });

  const summary = {
    total: rows.length,
    create: rows.filter((r) => r.status === 'new').length,
    update: rows.filter((r) => r.status === 'update').length,
    missing: rows.filter((r) => r.metricMissing).length,
    thresholdChanged: rows.filter((r) => r.thresholdChanged).length,
  };

  const factText = `대상 계정: ${targetAccount} (리전 ${region})
총 ${summary.total}건 — 신규 ${summary.create}, 덮어쓰기 ${summary.update}, 지표없음 ${summary.missing}, 임계값변경 ${summary.thresholdChanged}
${rows
  .map(
    (r) =>
      `- ${r.name} | 대상 ${r.target} | ${r.metric} | ${r.status === 'new' ? '신규' : '덮어쓰기'}${
        r.thresholdChanged ? `(임계값 ${r.existingThreshold}→${r.newThreshold})` : ''
      } | 데이터: ${r.metricMissing ? '없음(아직 미수집)' : r.metricUnknown ? '확인불가' : '있음'}`,
  )
  .join('\n')}`;

  let judgment = '';
  try {
    judgment = await converse(PREFLIGHT_SYSTEM_PROMPT, factText, region);
  } catch (e) {
    judgment = `(AI 판단을 가져오지 못했습니다: ${String(e.message ?? e).slice(0, 200)})`;
  }

  return { mode: 'account', account: targetAccount, region, rows, summary, judgment, model: BEDROCK_MODEL_ID };
}
