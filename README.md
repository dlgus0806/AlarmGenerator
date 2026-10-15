# CloudWatch Alarm Generator

AWS 리소스에 적용할 CloudWatch 알람을 표준화하고, CloudShell에서 실행할 AWS CLI 스크립트를 만드는 사내 웹 도구입니다.

이 도구는 고객 계정의 리소스를 읽고 알람 정의와 스크립트를 생성합니다. 알람을 직접 실행하거나 기존 리소스를 변경·삭제하지 않으며, 최종 실행은 사용자가 CloudShell에서 수행합니다.

## 화면

<img width="1182" height="655" alt="메인 화면" src="https://github.com/user-attachments/assets/519dc3e2-8761-4de9-a6b0-187c541222c1" />
<img width="1182" height="745" alt="구성화면1" src="https://github.com/user-attachments/assets/50e56133-9566-4dbd-885e-706df345c2a0" />
<img width="1175" height="916" alt="구성화면2" src="https://github.com/user-attachments/assets/ec9de00b-b9b2-4f43-a92c-fd8e25823f2f" />
<img width="1181" height="912" alt="구성화면3" src="https://github.com/user-attachments/assets/74ffe091-503f-49ca-968b-6718c3351a2e" />

## 주요 기능

- **AI 어시스턴트**: 자연어 요구사항을 알람 구성으로 변환하고, 연결한 계정의 실제 리소스를 기준으로 알람을 추천합니다.
- **표준 템플릿**: 자주 사용하는 알람 구성을 저장하고 재사용합니다.
- **리소스 직접 선택**: 리소스와 지표를 선택하고 임계값, 평가 조건, 결측 데이터 처리를 조정합니다.
- **계정 리소스 조회**: 고객 계정을 읽기 전용으로 연결해 실제 리소스를 불러오고, 선택한 리소스를 카드로 적용합니다.
- **사전 검증과 AI 점검**: 문법·설정 오류를 즉시 검사하고, 기존 알람·지표 데이터와의 충돌 가능성을 점검합니다.
- **산출물 생성**: 점검 스크립트, 알람 생성 CLI, 재편집용 JSON을 제공합니다.

지원 리소스는 EC2, Auto Scaling 그룹, ALB와 대상 그룹, ECS, Lambda, CloudFront, Route 53 Health Check, Aurora, RDS 등입니다. 상세 지표는 [`catalog-metrics.md`](./catalog-metrics.md)에서 확인할 수 있습니다.

## 사용 흐름

1. 전역 설정에서 리전과 SNS 토픽을 입력합니다.
2. AI 어시스턴트, 표준 템플릿, 리소스 직접 선택 중 하나로 알람을 구성합니다.
3. 사전 검증과 AI 점검 결과를 확인합니다.
4. 점검 스크립트와 CLI를 내려받거나 복사합니다.
5. 대상 계정의 CloudShell에서 계정과 리전을 확인한 뒤 사용자가 직접 실행합니다.

## 구조

```text
브라우저
  ├─ 알람 구성·검증·스크립트 생성
  └─ 백엔드 API
       ├─ Slack 로그인
       ├─ AI 변환·추천·점검
       └─ 자격증명 브로커
            └─ 고객 계정 읽기 전용 세션
```

프론트엔드는 React 기반 정적 웹이며, 백엔드는 AWS Lambda에서 동작합니다. 고객 계정 자격증명은 브라우저로 전달하지 않고 백엔드에서만 사용합니다.

## 로컬 실행

Node.js와 npm이 필요합니다.

```bash
npm install
```

터미널 1에서 조회 백엔드를 실행합니다.

```bash
npm run server
```

터미널 2에서 프론트엔드를 실행합니다.

```bash
npm run dev
```

브라우저에서 `http://localhost:5173`에 접속합니다. 계정 조회 없이 알람 구성·사전 검증·산출물 생성 기능만 사용할 수도 있습니다.

## 변경 후 검증

```bash
npm run docs       # 카탈로그 문서 재생성
npm run build      # TypeScript 검사와 프로덕션 빌드
npm run validate   # CloudWatch API 모델 기준 알람 파라미터 검증
```

카탈로그나 생성 로직을 변경했다면 세 명령을 모두 통과시킵니다.

## 문서 안내

| 문서 | 내용 |
|---|---|
| [`README.md`](./README.md) | 프로젝트 용도, 기능, 구조, 실행 방법 |
| [`cw-alarm-generator.md`](./cw-alarm-generator.md) | 안전 규칙과 설계 기준 |
| [`catalog-metrics.md`](./catalog-metrics.md) | 리소스별 알람 지표 목록 |
| [`deploy/README.md`](./deploy/README.md) | 배포와 운영 방법 |
| [`AGENTS.md`](./AGENTS.md) | AI 에이전트 작업 규칙 |
| 화면 우측 하단 `?` | 사용자용 설정 안내 |

## 안전 원칙

- 고객 계정 조회는 읽기 전용 세션만 사용합니다.
- 생성 스크립트에는 CloudWatch 알람 생성 명령만 포함합니다.
- 기존 알람과 AWS 리소스를 자동으로 삭제하거나 변경하지 않습니다.
- 액세스 키와 세션 토큰을 브라우저, 로그, 문서, 산출물에 저장하지 않습니다.

상세 규칙은 [`cw-alarm-generator.md`](./cw-alarm-generator.md)의 절대 금지 목록을 따릅니다.
