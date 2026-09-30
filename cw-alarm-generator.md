# CloudWatch Alarm Generator — 운영 규칙과 설계 기준

이 문서는 두 가지를 담는다.

1. **절대 금지 목록** — 이 도구와 관련된 실행·안전 규칙의 **정본**. AI·자동화·사람 모두 따른다.
   루트 `AGENTS.md`가 이 목록을 가리킨다.
2. **설계 기준** — 알람 이름, 카탈로그, 검증, 권한 경계처럼 코드를 고칠 때 지켜야 할 결정과 그 이유.

사용법과 실행 방법은 `README.md`, 배포·운영은 `deploy/README.md`를 본다.

- 문서 버전: v0.4
- 갱신일: 2026-09-30

---

## 절대 금지 목록 (읽기 전용 원칙)

이 도구와 관련해 **어떤 경우에도 실행하거나 만들면 안 되는 작업**이다.

**1) 고객 리소스 변경·삭제 금지**
- EC2·RDS·ALB 등 리소스의 중지·재부팅·삭제·수정
  (`terminate-instances`, `stop-instances`, `reboot-instances`, `delete-db-instance`,
  `reboot-db-instance`, `modify-*`, `delete-load-balancer` 등)
- 태그·보안그룹·IAM·네트워크 등 리소스 설정 변경

**2) 기존 알람 삭제·비활성 금지**
- `delete-alarms`, `disable-alarm-actions`, 남이 만든 알람 덮어쓰기
- 표준에 없는 기존 알람을 사람 확인 없이 삭제

**3) 조회 외 write API 금지**
- 허용되는 쓰기는 **`cloudwatch:PutMetricAlarm`(알람 생성·갱신)** 뿐이며, 사람이 CloudShell에서
  직접 실행할 때만 허용한다.
- 그 외 모든 서비스의 생성·변경·삭제 API 금지.
  (예외: 앱 자체 운영용 쓰기 — 버그 신고를 우리 계정 SNS 토픽에 발행하는 것 — 는 고객 계정과 무관하다.)

**4) 승인되지 않은 계정 대상 금지**
- 고객 계정 조회는 **자격증명 브로커를 통해서만** 한다. 브로커는 Slack 로그인한 사내 사용자이고,
  FITCLOUD에 활성 고객으로 등록된 계정일 때만 읽기 전용 세션을 발급한다.
- 역할 ARN을 직접 assume 하는 경로(로컬 개발용)는 설정 파일·환경변수로 허용한 계정과 역할 이름에만 쓴다.

**5) 자격증명·데이터 노출 금지**
- 액세스 키·세션 토큰을 브라우저·로그·산출물·프롬프트에 노출하지 않는다.
- 고객 계정 ID·ARN, 사내 인프라 식별자(내부 계정 ID, ExternalId, SSM 경로 등)를 외부로 전송하거나
  공개 저장소에 커밋하지 않는다.

**6) 파괴적·대량 작업 금지**
- 여러 리소스 일괄 삭제·변경, 스크립트에 삭제 명령 포함 금지.
- 정리(롤백) 스크립트가 필요하면 **주석 처리된 상태로만** 산출하고, 사람이 확인 후 수동 실행한다.

> 요약: **읽는다 + 알람을 만든다. 그 외에는 아무것도 건드리지 않는다.**
> 의심스러우면 실행하지 말고 사람에게 확인한다.

### 코드로 강제되는 가드

문서 규칙은 권고이고, 아래는 코드가 강제한다. 둘 다 지킨다.

| 가드 | 위치 | 내용 |
|---|---|---|
| 산출물 차단 | `src/lib/safety.ts` | 생성 스크립트에 `put-metric-alarm` 외 명령이나 파괴적 명령이 섞이면 복사·다운로드 차단 |
| 구조적 읽기 전용 | `server/core.mjs` | 백엔드에는 조회 계열 SDK 명령(Describe·List·GetMetricData 등)만 들어 있다. 생성·변경·삭제 명령은 코드에 없다 |
| 읽기 전용 세션 | 브로커 `lib/customer-assume.mjs` | 고객 AssumeRole 때 `ReadOnlyAccess` 세션 정책을 서버에서 붙인다. 클라이언트가 우회할 수 없다 |
| 인가 | 브로커 `lib/fitcloud.mjs` | FITCLOUD 활성 고객이 아니면 거부. FITCLOUD 장애 시에도 허용하지 않는다(fail-closed) |
| 로그인 | `server/lambda.mjs` | Slack OAuth 세션이 없으면 모든 API(`/api/*`)가 401 |

---

## 1. 무엇을 위한 도구인가

- **컨셉**: 표준화된 CloudWatch 알람을 빠짐없이, 일관되게 깔아 장애를 알림으로 먼저 인지한다.
- **문제**: 여러 사람이 여러 고객사에 알람을 설정하면 임계값·이름이 제각각이 된다.
- **해결**: 팀 표준(카탈로그·템플릿)을 고정하고, 알람 정의와 CLI 생성을 도구가, 실행은 사람이 한다.
- **동작 원칙**: 도구는 **조회와 텍스트 생성만** 한다. AI는 변환·추천·점검 의견만 내고 실행 권한이 없다.

---

## 2. 전체 흐름

1. **전역 설정** — 리전, SNS 토픽(필수). prefix·태그·이름 방식(선택)
2. **알람 구성** — 셋 중 하나
   - AI 어시스턴트: 요구사항 텍스트 → 알람 JSON. 계정을 연결하면 실제 리소스로 카드 생성·추천
   - 표준 템플릿: 저장된 알람 묶음 적용
   - 리소스 선택: 리소스·지표를 직접 토글
3. **검증** — 결정론적 사전 검증(즉시) → AI 점검(버튼)
4. **산출물** — 점검 스크립트(읽기 전용), CLI, JSON
5. **실행** — 사람이 CloudShell에서 실행 (§8)

알람 정의 생성은 결정론적 코드가 한다. AI는 2단계(변환·추천)와 3단계(점검)에서만 호출된다.

---

## 3. AI 어시스턴트 — 적용 판정

**원칙**: 리소스 ID가 최종적으로 채워지면 적용하고, 비면 적용하지 않고 경고한다.
계정을 연결하지 않았으면 텍스트에 적힌 실제 ID만 인정하고, 연결했으면 계정 인벤토리에서 이름을 ID로 매핑한다.

### 계정 미연결 · 텍스트 변환

실제 식별자(`i-…`, `arn:…`, DB 식별자)가 있어야 적용된다. 이름·별칭으로 리소스 유형을 추측하지 않는다
("서버"라고 EC2로 단정하지 않음).

| 상황 | 결과 |
|---|---|
| 실제 리소스 ID 명시 | 적용 |
| 이름·별칭만 있음 ("nuke 서버") | 경고: 요구사항에 없는 항목 — 리소스 ID |
| 리소스 언급 없음 | 경고: 리소스를 확정하지 못함. 리소스 ID를 명시 |

### 계정 연결 · 계정 읽기

계정 인벤토리에서 이름을 실제 ID로 매핑한다.

| 상황 | 결과 |
|---|---|
| 이름이 정확히 일치 | 적용 |
| 대소문자·공백만 다름, 또는 부분일치 1건 | 적용 + 경고: 리소스 ID가 맞는지 확인 |
| 부분일치 2건 이상 | 경고: 여러 리소스가 일치. 정확한 ID 지정 |
| 일치하는 리소스 없음 | 경고: 일치하는 리소스를 찾지 못함 |

계정 확인 시 불러오는 리소스와 카드로 만들 때의 규칙:

| 종류 | 조회 API | 카드 규칙 |
|---|---|---|
| EC2 · RDS/Aurora · ALB · Lambda | Describe·List | RDS는 엔진별 카탈로그로 매핑. NLB/GLB는 미지원 표시 |
| Auto Scaling 그룹 | `DescribeAutoScalingGroups` | 그룹 이름을 그대로 디멘션으로 |
| 대상 그룹 | `DescribeTargetGroups` | ALB에 붙은 것만. LoadBalancer 디멘션을 조회 값으로 미리 채움. LB 미연결·NLB는 미지원 |
| ECS 서비스 | `ListClusters` + `ListServices` | ClusterName 디멘션을 미리 채움. 클러스터 최대 50개 |
| CloudFront | `ListDistributions` (us-east-1) | 리전과 무관하게 항상 표시. 알람은 전역 리전이 us-east-1일 때만 만들 수 있음 |

- 종류별 최대 500개(Lambda 1000개)까지 읽는다.
- Auto Scaling·대상 그룹·ECS·CloudFront 조회가 권한 등으로 실패하면 목록 위에 "일부 조회 실패"로
  알리고 나머지는 그대로 보여준다.

### 공통 (적용을 막지 않는 경고)

| 상황 | 결과 |
|---|---|
| 단계 지표에 임계값 미지정 | 적용 (표준 Lv1/2/3 자동) |
| SNS·리전 누락 | 적용 + 경고: 전역 설정 확인 |

적용되지 않는 경우엔 "적용 되었습니다"를 띄우지 않고 기존 카드도 건드리지 않는다.

---

## 4. 알람 이름 규칙

```
{prefix}-{shortCode}[-{scope}]-{resourceShort}-{metricKey}[-{임계값}]
```

- `prefix`: 선택. 소문자·숫자·하이픈 2~33자. 비우면 생략
- `scope`: 이름에 넣도록 지정한 추가 디멘션 값. 지금은 ECS 클러스터 이름뿐이다
  (클러스터가 달라도 서비스 이름이 같은 경우가 많아서). 예 `...-ecs-prd-cluster-api-cpu-high-lv1-70`
- `resourceShort`: EC2·RDS 등은 **ID 전체**를 그대로 쓴다(축약하면 대조 시 혼동). ALB처럼
  `app/<name>/<hash>` 형태는 가운데 이름을 12자로 줄인다
- `metricKey`: 단계 알람은 `-lv1` 등, 이상 탐지는 `-anomaly`가 붙는다
- 끝의 임계값: **% 지표**(CPU·메모리·디스크 등)에만 붙는다 — 예 `...-cpu-high-lv1-70`.
  그 외 지표는 `metricKey`로 끝난다. 심각도는 이름에 넣지 않는다
  (예전 이름 `...-elb-5xx-crit`은 이제 `...-elb-5xx`. 이름이 달라 기존 알람을 덮어쓰지 않고 새로 생긴다)
- 허용 문자 `A-Z a-z 0-9 . _ : / -`. `%`·공백·비ASCII는 거부(URL 딥링크·셸 인용 문제). 최대 255자

### % 지표에 임계값을 넣는 이유와 대가

같은 리소스에 임계값별로 여러 알람(70/80/90)을 두는 고객사가 많아 이름으로 구분해야 한다.
대가: `put-metric-alarm`은 **이름 기준 upsert**라서 임계값을 바꾸면 **새 알람이 생기고 이전 알람은 남는다.**
임계값을 조정할 때는 이전 알람을 사람이 확인해 정리해야 한다(도구는 삭제 명령을 만들지 않는다).

### 이름 충돌

두 사람이 같은 이름으로 다른 임계값을 실행하면 **나중에 실행한 쪽이 조용히 덮어쓴다.**
그래서 실행 전 점검 스크립트와 AI 점검(계정 연결 시)으로 "덮어쓰기"를 먼저 보여준다.

---

## 5. 카탈로그 원칙

지표 목록·기본값은 `src/catalog/*.json`이 원본이고, 사람이 읽는 목록은 `catalog-metrics.md`(`npm run docs`로 생성)다.
이 문서에는 표를 중복해 싣지 않는다. 카탈로그를 고칠 때 지킬 점:

- **Aurora와 RDS는 분리한다.** 지표가 다르다. 예: Aurora에는 `FreeStorageSpace`가 없고
  `FreeLocalStorage`를 쓴다. 섞으면 없는 지표에 알람이 걸려 영구히 `INSUFFICIENT_DATA`가 된다.
- **단위를 명시한다.** `FreeStorageSpace`·`FreeableMemory`는 바이트, Aurora `AuroraReplicaLag`는 밀리초,
  RDS `ReplicaLag`는 초. UI는 사람이 읽는 단위로 받아 변환한다.
- **인스턴스 의존 임계값**(메모리·스토리지·연결 수)은 표시해 두고, 기본값을 그대로 쓰지 않게 안내한다.
- **카운트 지표**(5xx, 오류 수 등)는 트래픽이 없으면 데이터가 없으므로 `notBreaching`을 쓴다.
  `breaching`이면 야간에 오탐이 쏟아진다.
- **리전 고정 지표**: CloudFront·Billing 등은 `us-east-1`에만 있다. 사전 검증이 경고한다.
- 임계값은 팀 자산이다. 코드에 박지 않고 카탈로그 JSON을 PR로 리뷰한다.

현재 카탈로그: EC2, Auto Scaling 그룹, ALB, ALB 대상 그룹, ECS 서비스, Lambda, CloudFront,
Aurora PostgreSQL, Aurora MySQL, RDS PostgreSQL, RDS MySQL, RDS MariaDB, RDS Oracle, RDS SQL Server,
계정 보안(CloudTrail 지표).

새 카탈로그는 AWS 공식 문서의 권장 알람(Recommended alarms)과 서비스별 지표·디멘션 표를 기준으로 만든다.
사전 조건이 있는 지표는 배지로 표시한다.
- Auto Scaling `GroupInServiceInstances`: 그룹 지표 수집을 켜야 데이터가 생긴다.
- ECS `RunningTaskCount`(`ECS/ContainerInsights`): Container Insights가 필요하다.
- CloudFront `OriginLatency`: 배포의 추가 지표(유료)를 켜야 한다. CloudFront 알람은 us-east-1에만 만든다.
- 대상 그룹 지표는 `TargetGroup`과 `LoadBalancer` 디멘션이 모두 필요하다.

---

## 6. 산출물

- **CLI (`{prefix}-alarms.sh`)**: `put-metric-alarm` 블록의 반복. 플래그 순서를 고정해 diff 노이즈를 없앤다.
- **점검 스크립트 (`{prefix}-check.sh`)**: 읽기 전용. 이미 있는 같은 이름의 알람과, 데이터가 없는 지표를 알려준다.
- **JSON (`{prefix}-alarms.json`)**: 화면 상태 전체. 다시 불러와 이어서 편집하거나 Git으로 이력을 남긴다.
  **JSON이 원본이고 CLI는 파생물**이다. 수정은 JSON(화면 상태)을 고치고 CLI를 다시 만든다.

알아둘 제약:
- `put-metric-alarm`은 생성·갱신만 한다. 카드를 지워도 계정의 알람은 지워지지 않는다.
- `--tags`는 **신규 생성 때만 적용**되고 기존 알람 갱신 때는 에러 없이 무시된다.
  생성 시 태그를 붙이려면 실행자에게 `cloudwatch:TagResource` 권한도 필요하다.
- 태그는 전역 설정에서 사용자가 넣은 것만 들어간다(자동 주입 태그 없음).

### SNS 라우팅

- SNS 토픽은 전역 설정에 원하는 만큼 넣는다. 심각도별 분리는 없다.
- 지표마다 "추가 구성 → 알림 보낼 SNS 토픽"에서 그중 일부를 고를 수 있다.
  고르지 않으면 전역 토픽 전부로 보내고, 나중에 추가한 토픽도 자동으로 포함된다.
- 단계 지표는 Lv1/2/3 알람이 모두 같은 토픽으로 보낸다.
- 전역 설정에서 지운 토픽은 선택에서도 빠진다. 선택이 비면 사전 검증 오류로 다운로드가 잠긴다.
- CLI: 전역 토픽 전부로 보내는 알람은 공통 배열 `SNS_TOPICS`를, 일부만 고른 알람은 ARN을 직접 쓴다.
- 표준 템플릿에는 토픽 선택을 저장하지 않는다(ARN이 계정마다 다르므로).
- 심각도는 화면·알람 이름·알림 경로 어디에도 쓰지 않는다.

---

## 7. 검증

| 검증 대상 | 담당 |
|---|---|
| 문법·enum·필수값·산술 제약 | 사전 검증 (`src/lib/validate.ts`, 즉시) |
| 지표 실존·이름 충돌 | 점검 스크립트, AI 점검(계정 연결 시 계정 조회로 확정) |
| 임계값 타당성·비교 방향·오탐 가능성 | AI 점검 |
| AWS API 모델 적합성 | `npm run validate` (botocore 모델 대조, AWS 호출 없음) |

### 사전 검증 규칙 (요지)

- 이름 중복 없음, 255자 이내, 허용 문자만
- `datapointsToAlarm ≤ evaluationPeriods`, 둘 다 1 이상 정수
- `period`는 10/20/30 또는 60의 배수
- `period × evaluationPeriods ≤ 604800`초, `period < 3600`이면 `≤ 86400`초
- `period < 60`은 고해상도 알람 경고(요금↑, `INSUFFICIENT_DATA` 잦음)
- `treatMissingData`는 `breaching` / `notBreaching` / `ignore` / `missing` (대소문자 구분)
- SNS 토픽 리전 == 알람 리전
- **오류가 하나라도 있으면 CLI 복사·다운로드를 잠근다.** 같은 참고 사항은 한 건으로 묶어 보여준다

CloudWatch에는 `--dry-run`이 없다. 지표가 없어도 알람은 만들어지고 `INSUFFICIENT_DATA`에 머문다.
그래서 점검 스크립트의 `list-metrics` 확인이 사실상의 드라이런이다.

### AI 점검 출력 형식

- 첫 줄은 `결론: [실행 가능|주의 후 실행|보류] …` 1~2문장. 화면은 이 줄을 색 박스로 맨 위에 보여준다.
- 계정 연결 시: 계정을 실제로 읽어 신규 / 덮어쓰기 / 데이터 없음을 **결정론적으로** 분류한 표를 먼저 만들고,
  AI는 그 사실만 근거로 판단한다(표의 숫자는 AI가 바꾸지 않는다).
- 알람 구성이 바뀌어도 결과는 지우지 않고 "이전 기준"으로 표시한다. 재점검은 버튼이나 새로고침으로만 한다.

주니어 팀원이 AI 의견을 그대로 따를 수 있으므로, 결정론적 검증이 항상 먼저 걸러야 한다.

---

## 8. CloudShell 실행 절차

| # | 동작 | 확인할 것 |
|---|---|---|
| 1 | CloudShell 열기 | 우상단 리전이 전역 설정 리전과 일치 |
| 2 | `aws sts get-caller-identity` | 의도한 계정·역할인지 |
| 3 | 스크립트를 **파일로 저장** | Actions → Upload file, 또는 heredoc(`cat > x.sh <<'EOF'` … `EOF`) |
| 4 | 육안 확인 | 리전, SNS ARN, 알람 개수 |
| 5 | 점검 스크립트 실행 | 이미 있는 알람(덮어쓰게 됨), 데이터 없는 지표 |
| 6 | **첫 알람 1건만 실행** | 권한 확인. 특히 `TagResource` |
| 7 | `bash {prefix}-alarms.sh` | 전체 실행 |
| 8 | `describe-alarms` | 개수와 임계값 |
| 9 | `--state-value INSUFFICIENT_DATA` 조회 | 걸리면 지표·디멘션 오타이거나 아직 데이터 없음 |
| 10 | `set-alarm-state`로 1건 ALARM 처리 | SNS 알림이 실제로 오는지 |

- 3번: 터미널에 바로 붙이면 긴 스크립트가 섞이거나 중간 오류 뒤에도 계속 실행될 수 있다. 파일로 두면 다시 보고 재실행할 수 있다.
- 6번을 건너뛰지 않는다. 50개 중 20번째에서 권한 오류로 멈추면 상태가 어중간해진다. 재실행은 멱등이라 안전하다.
- 알람이 많으면 API 스로틀링이 날 수 있다. 생성 스크립트에는 아직 호출 간 대기가 없으니, 실패하면 같은 파일로 다시 실행한다.

---

## 9. 권한 경계

| 구성요소 | 권한 |
|---|---|
| 프론트엔드 | 없음 (정적 파일) |
| 백엔드 `cw-alarm-discover` | Bedrock 호출, 피드백 SNS 발행, 브로커 호출. 고객 계정은 브로커가 준 읽기 전용 세션으로만 조회 |
| 브로커 `cw-crossaccount-credential-broker` | SSM(자기 파라미터만) 읽기. 공유 IAM User 키로 896 조회·KMS 복호화·고객 AssumeRole |
| 고객 세션 | `ReadOnlyAccess` 세션 정책, 최대 1시간 |
| 실행자(사람, CloudShell) | `PutMetricAlarm`, `DescribeAlarms`, `ListMetrics`, `TagResource` |

**도구 어디에도 고객 계정 쓰기 권한은 없다.** 이 경계가 무너지면 "AI가 알람을 잘못 만들었다"가 아니라
"도구가 프로덕션을 바꿨다"가 된다. 구체적인 IAM 정책 내용은 콘솔에서 확인한다.

화면에는 계정 ID·리소스 ID·SNS ARN이 보이므로 **로그인 없이 접근할 수 없게** 한다(Slack OAuth, 사내 워크스페이스·이메일 도메인 제한).

---

## 10. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| % 지표 임계값 변경 | 이전 임계값 알람이 남음 | 조정 시 이전 알람을 사람이 확인·정리 (§4) |
| 팀원 간 이름 충돌 | 나중 실행이 조용히 덮어씀 | 점검 스크립트·AI 점검의 "덮어쓰기" 확인 |
| `--tags` 갱신 시 무시 | 태그 기반 관리가 어긋남 | 태그 변경은 `tag-resource`로 별도 처리 |
| Aurora/RDS 지표 혼용 | 영구 `INSUFFICIENT_DATA` | 카탈로그 분리 (§5) |
| 단위 착각(바이트·초·ms) | 무의미한 임계값 | UI 단위 변환, 카탈로그 단위 명시 |
| `treatMissingData` 오설정 | 야간 오탐 | 카운트 지표는 `notBreaching` |
| AI 의견 무비판 적용 | 잘못된 임계값 | 결정론적 검증 우선, 결론·근거 분리 표시 |
| 브로커 인가가 "존재 여부"만 봄 | 로그인한 사내 사용자는 모든 활성 고객 조회 가능 | FITCLOUD에 담당 정보가 생기면 강화. 조회 기록은 브로커 감사 로그로 추적 |
| 리전당 알람 쿼터 | 생성 실패 | 실행 전 개수 확인, Service Quotas 확인 |

---

## 11. 남은 과제

1. **알람 삭제 책임** — 리소스가 없어졌을 때 알람을 지우는 주체와 절차가 없다.
2. **생성 스크립트 스로틀링 대기** — 대량 생성 시 호출 간 대기 추가.
3. **복합 알람·태그 기반 Metrics Insights 알람** — 노이즈 감소, 새 리소스 자동 포함.
4. **Terraform 출력** — 삭제·드리프트 추적이 필요해질 때. JSON이 원본이라 렌더러만 추가하면 된다.
5. **카탈로그 승인 절차** — 임계값 변경 PR의 리뷰어 지정.

---

## 참고 문서

- [put-metric-alarm — AWS CLI Command Reference](https://docs.aws.amazon.com/cli/latest/reference/cloudwatch/put-metric-alarm.html)
- [PutMetricAlarm — CloudWatch API Reference](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricAlarm.html)
- [Notifying users on alarm changes](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html)
- [Amazon CloudWatch dimensions for Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/metrics_dimensions.html)
- [Suppressing composite alarm actions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Composite_Alarm_Suppression.html)
