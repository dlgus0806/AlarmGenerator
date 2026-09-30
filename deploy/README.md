# 배포와 운영

프론트엔드, 백엔드, 자격증명 브로커 세 부분으로 되어 있고 배포 방법이 각각 다르다.
현재 모두 dev 계정 **055253049080 (ap-northeast-2)** 에 있다. internal 계정 승격은 맨 아래 체크리스트를 따른다.

## 구성

```
브라우저
  │ https
  ▼
CloudFront  ES74LLKMAC9D9  (cw.dlgus.fitcloud.co.kr)
  ├─ /        → S3  cw-alarm-generator            프론트엔드 (dist/)
  └─ /api/*   → Lambda Function URL (AWS_IAM, CloudFront OAC 서명)
                 cw-alarm-discover                백엔드 (server/*.mjs)
                   │ 서버 간 호출, Slack Bearer 전달
                   ▼
                 API Gateway HTTP API  7ugtdyyx76
                   ▼
                 cw-crossaccount-credential-broker  자격증명 브로커
                   │ 공유 IAM User 키로 FITCLOUD 인가 → 896 조회 → 고객 AssumeRole
                   ▼
                 고객 계정 읽기 전용 세션 (ReadOnlyAccess, 최대 1시간)
```

| 구성 요소 | 이름 | 코드 위치 |
|---|---|---|
| 프론트 버킷 | `cw-alarm-generator` | `dist/` (빌드 결과) |
| CloudFront | `ES74LLKMAC9D9` | `deploy/frontend.yaml` |
| 백엔드 Lambda | `cw-alarm-discover` (handler `lambda.handler`) | `server/*.mjs`, `deploy/backend.yaml` |
| 브로커 Lambda | `cw-crossaccount-credential-broker` (nodejs24.x, handler `index.handler`, 30초, 256MB) | `crossaccount-credential-broker-630abadd-6c11-4f8e-8757-368618c639cb/` |
| 브로커 API | HTTP API `7ugtdyyx76` | 콘솔에서 생성 |

**함수마다 들어가는 코드가 다르다.** 백엔드에는 `server/*.mjs`, 브로커에는 브로커 폴더의 `index.mjs` + `lib/`.
섞어 올리면 `Runtime.ImportModuleError: Cannot find module 'lambda'` 로 백엔드가 멈춘다.

---

## 1. 프론트엔드

```bash
npm run deploy:web
```

빌드 → S3 동기화 → CloudFront 전체 무효화까지 한다. 프론트는 같은 오리진의 `/api/*`를 부르므로
`VITE_DISCOVER_API`는 비워 둔다. 전파에는 1~2분 걸린다.

최초 인프라는 `deploy/frontend.yaml`(CloudFormation)로 한 번 만든다.

주의: 버킷 버전 관리가 꺼져 있고 배포 때 이전 번들을 지우므로, **S3에서 이전 버전으로 되돌릴 수 없다.**
되돌리려면 git으로 소스를 되돌려 다시 배포한다. 배포 전에 커밋해 두는 편이 안전하다.

---

## 2. 백엔드 (`cw-alarm-discover`)

코드만 바꿀 때:

```bash
deploy/deploy-backend.sh cw-alarm-discover ap-northeast-2
```

`server/*.mjs`만 묶어 올린다. AWS SDK v3는 Lambda 런타임에 내장이라 넣지 않는다.
최초 생성·스택 갱신은 `deploy/setup-backend.sh` 와 `deploy/backend.yaml`.

### 환경변수

| 이름 | 용도 |
|---|---|
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | 웹 Slack OAuth 로그인 |
| `SESSION_SECRET` | 세션 쿠키 암호화 키. 있으면 로그인 게이트가 켜진다 |
| `APP_BASE_URL` | OAuth 콜백 조합 (`<APP_BASE_URL>/api/auth/slack/callback`) |
| `SLACK_TEAM_ID`, `ALLOWED_EMAIL_DOMAIN` | 허용 워크스페이스·이메일 도메인 |
| `BROKER_API_URL` | 브로커 API 베이스 URL. **없으면 브로커를 거치지 않고 직접 AssumeRole을 시도해 실패한다** |
| `BEDROCK_MODEL_ID` | AI 기능 모델(추론 프로파일 ID) |
| `FEEDBACK_TOPIC_ARN` | 버그 신고를 보낼 SNS 토픽 |
| `ALLOWED_ORIGIN` | CORS 오리진 (같은 오리진 호출이라 실제 영향은 작음) |
| `ASSUME_ROLE_NAME`, `ALLOWED_ROLE_NAMES` | 역할 ARN 직접 assume 경로용 (브로커 경로에선 안 씀) |
| `DISCOVER_API_TOKEN` | OAuth 미구성 시 쓰던 토큰 인증 (현재는 OAuth가 우선) |

- 콘솔에서 환경변수를 바꿀 땐 **하나씩 추가·수정**한다. CLI `update-function-configuration --environment`는
  목록 전체를 덮어써서 나머지 변수가 지워진다.
- 인증: OAuth가 구성돼 있으면 `/api/*` 전부 로그인 세션이 필요하다(`/api/health`, `/api/auth/*`, `/api/feedback` 제외).

---

## 3. 자격증명 브로커 (`cw-crossaccount-credential-broker`)

고객 계정마다 역할을 위임하지 않고 고객 리소스를 읽기 위한 전용 함수다.
Saltware 운영 MSP 브로커(287/370, `csg-skills`)의 고객 조회 방식을 복사했고, **운영 함수·스택과는 별개**다.

### 동작 순서

1. 백엔드가 로그인 세션의 Slack 토큰을 `Authorization: Bearer`로, `{ accountId, agent }`를 body로 보낸다.
2. Slack `users.identity`로 신원 확인 — 워크스페이스 `T192GUYE7`, 이메일 `@saltware.co.kr`.
3. 세션명 `saltware-msp-ai@{SlackUserID}`와 SourceIdentity를 서버가 정한다(요청 body 값은 무시).
4. FITCLOUD `/api/admin/v1/accounts`에서 활성 고객(`deleteFlag ≠ Y`)인지 확인. 성공 결과만 10분 캐시.
5. 896 `crossaccount-sts-api` 조회 + KMS 복호화로 고객 역할명·ExternalId·assume 유형을 얻는다.
6. 고객 역할 AssumeRole + `ReadOnlyAccess` 세션 정책. Role 유형은 370 중간 역할을 거친다.
7. 고객 세션 키만 반환한다. 공유 키·중간 세션은 응답에도 로그에도 남기지 않는다.

응답 코드: 401 로그인 문제, 403 활성 고객 아님(메시지 통일), 503 의존 서비스(FITCLOUD·896·STS·Slack) 장애.

### 배포

```bash
cd crossaccount-credential-broker-630abadd-6c11-4f8e-8757-368618c639cb
zip -r ../cw-broker.zip index.mjs lib package.json
cd ..
aws lambda update-function-code --function-name cw-crossaccount-credential-broker \
  --zip-file fileb://cw-broker.zip --region ap-northeast-2
```

업로드 전에 **함수 이름을 한 번 더 확인**한다. `cw-broker.zip`은 `.gitignore` 대상이다.

### 설정

- **SSM (SecureString)**
  - 이 앱 전용: `/slack/cw-alarm-broker/client-id`, `/slack/cw-alarm-broker/client-secret`
  - 공유: 공유 IAM User 액세스 키·시크릿 키, FITCLOUD API 키 (경로는 운영 브로커와 동일. 콘솔 SSM에서 확인)
  - 값은 코드에서 앞뒤 공백·개행을 제거해 읽는다. 콘솔에 붙여넣을 때 개행이 섞여도 동작하지만, 저장 값도 깨끗하게 두는 편이 낫다.
- **환경변수**: `ALLOWED_ORIGIN`, `REDIRECT_URI` (브라우저 직접 호출·로그인 경로용), `FITCLOUD_API_KEY_SSM_PARAM`(선택)
- **실행 역할**: 위 SSM 파라미터 5개 읽기, SSM 경유 KMS 복호화, 기본 로깅. 그 외 권한 없음.
  896 조회·KMS·STS는 실행 역할이 아니라 공유 IAM User 키로 호출한다.
- **API 라우트**: `POST/OPTIONS /v1/customer-credentials`(사용 중), `POST/OPTIONS /v1/credentials`(로그인 교환, 현재 앱에서 안 씀)

### 운영 브로커 대비 바꾼 점

- `REDIRECT_URI`, `ALLOWED_ORIGIN`을 환경변수로 뺐다.
- CORS 허용 헤더에 `Authorization` 추가.
- Slack 자격증명 SSM 경로를 `/slack/cw-alarm-broker/*`로 분리.
- SSM 값 `trim()` (후행 개행이 SigV4 서명 헤더에 섞여 `ERR_INVALID_CHAR`가 나던 문제).

### 고객 CloudTrail에 남는 값

- 주체: `arn:aws:sts::<고객계정>:assumed-role/<고객역할>/saltware-msp-ai@<SlackUserID>`
- `userIdentity.accessKeyId`: 발급된 임시 키(`ASIA…`)
- `sourceIdentity`: Slack 사용자 ID (고객 역할이 허용할 때)

AI 도구 이름은 고객 쪽에 남지 않는다. 브로커 로그(`/aws/lambda/cw-crossaccount-credential-broker`)의
`event: audit` 줄에 `agent`, `accountId`, `issuedAccessKeyId`와 함께 남는다.

### 세션명을 바꿀 때

- `@` 뒤는 로그인한 사람의 Slack 사용자 ID라 고정이다.
- 앞 라벨은 `index.mjs`의 `roleSessionName`을 고치면 바뀐다.
- **`saltware-` 접두사는 바꾸지 않는다.** 고객 역할 신뢰 정책이 `saltware-*`를 조건으로 걸고 있으면
  접두사를 바꾸는 순간 그 고객 접근이 끊기고, 복구는 고객 계정에서만 할 수 있다. 운영 감사 파이프라인도 접두사로 매칭한다.
- 바꾸려면 접두사는 두고 뒤만 조정한다(예 `saltware-alarmgen@…`). 허용 문자 `A-Za-z0-9_+=,.@-`, 2~64자.

---

## 4. 문제 해결

| 증상 | 원인 | 조치 |
|---|---|---|
| `...cw-alarm-discover is not authorized to perform: sts:AssumeRole` | 백엔드에 `BROKER_API_URL` 없음 | 백엔드 환경변수 추가 |
| `Cannot find module 'lambda'` | 백엔드에 브로커 zip 업로드 | `deploy-backend.sh`로 백엔드 재배포 |
| `Dependency temporarily unavailable` (503) | 브로커 의존 서비스 실패 | 브로커 로그의 오류 확인 (FITCLOUD·896·STS) |
| `Account not authorized.` (403) | FITCLOUD 활성 고객 아님 | FITCLOUD에서 계정 상태 확인 |
| 화면 변경이 안 보임 | CloudFront 캐시 | 1~2분 후 하드 리프레시 |

---

## 5. internal 계정 승격 체크리스트

- [ ] 브로커를 internal 계정에 같은 이름·설정으로 생성, SSM 파라미터는 internal 계정 값 사용
- [ ] 백엔드 `BROKER_API_URL`을 internal 브로커 API로 교체
- [ ] 브로커 `ALLOWED_ORIGIN`·`REDIRECT_URI`, 백엔드 `APP_BASE_URL`이 실제 도메인과 일치하는지
- [ ] 승격 후 **dev(055) SSM에 복사해 둔 공유 IAM User 키와 FITCLOUD 키 삭제**
- [ ] dev 브로커와 API Gateway 삭제 또는 비활성
- [ ] 운영 감사 파이프라인(370)이 이 경로의 접근을 잡는지 확인

## 보안 체크리스트

- [ ] 백엔드는 로그인 세션 없이는 `/api/*`에 응답하지 않는다
- [ ] 브로커 실행 역할에는 SSM 읽기 외 권한이 없다
- [ ] 공유 키·세션 키가 로그·응답·코드·환경변수에 없다
- [ ] 사내 인프라 정보가 담긴 문서·코드(브로커 폴더, `ADMIN.md`)를 공개 저장소에 올리지 않는다
