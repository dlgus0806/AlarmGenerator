# CloudWatch Alarm Generator

팀 표준 알람을 골라 CloudWatch 알람 생성용 CLI·점검 스크립트·JSON을 만들어 주는 사내 웹 도구.

도구는 **조회와 산출물 생성만** 한다. 실제 알람 생성은 사람이 CloudShell에서 실행한다.

- 사이트: `https://cw.dlgus.fitcloud.co.kr` (Slack 로그인 필요)
- 실행·안전 규칙: [`cw-alarm-generator.md`](./cw-alarm-generator.md)의 "절대 금지 목록"

## 주요 기능

- **AI 어시스턴트 (Amazon Bedrock · Claude)**
  - 형식 없는 요구사항 텍스트를 알람 JSON으로 변환한다.
  - 계정을 연결하면(선택) 고객 계정의 EC2·RDS·ALB를 읽기 전용으로 불러와 카드로 만들거나,
    실제 리소스와 최근 CPU 지표를 근거로 알람을 추천한다.
- **표준 템플릿**: 자주 쓰는 알람 묶음을 저장하고 재사용한다. 저장은 브라우저(localStorage)에만 된다.
- **리소스 선택**: 리소스와 지표를 직접 토글하고 임계값·평가 조건·결측 처리를 조정한다. 커스텀 지표도 추가할 수 있다.
- **사전 검증**: 문법·enum·산술 규칙을 즉시 검사한다. 오류가 있으면 CLI 복사·다운로드가 잠긴다.
- **AI 점검**: 결론(실행 가능 / 주의 후 실행 / 보류)을 먼저 보여준다. 계정을 연결했으면 기존 알람과 대조해
  신규 / 덮어쓰기 / 데이터 없음을 표로 보여준다.
- **산출물**: 점검 스크립트(읽기 전용), CLI(알람 생성), JSON(재편집·이력 관리).

지원 리소스: EC2, ALB, Aurora(PostgreSQL·MySQL), RDS(PostgreSQL·MySQL·MariaDB·Oracle), Lambda,
계정 보안(CloudTrail 지표). 지표 목록은 [`catalog-metrics.md`](./catalog-metrics.md).

## 구성

```
브라우저 ── https ──> CloudFront (cw.dlgus.fitcloud.co.kr)
                        ├─ /        → S3 (프론트엔드 정적 파일)
                        └─ /api/*   → 백엔드 Lambda  cw-alarm-discover
                                        ├─ Slack OAuth 로그인·세션
                                        ├─ Bedrock (AI 변환·추천·점검)
                                        └─ 자격증명 브로커 Lambda  cw-crossaccount-credential-broker
                                             └─ 고객 계정 읽기 전용 세션 (FITCLOUD 인가 → AssumeRole + ReadOnlyAccess)
```

계정별로 역할을 위임하지 않고, 이미 고객 역할이 신뢰하고 있는 공유 주체를 브로커가 대신 사용한다.
자세한 흐름과 운영은 [`deploy/README.md`](./deploy/README.md).

## 로컬 개발

```bash
npm install
npm run dev        # 프론트엔드  http://localhost:5173  (/api/* 는 8787로 프록시)
npm run server     # 로컬 조회 백엔드  http://localhost:8787  (선택)
```

- 알람 구성·사전 검증·산출물 생성은 백엔드 없이 브라우저에서 동작한다.
- 로컬 백엔드는 로컬 aws CLI 자격증명과 `server/account.local.json`(허용 계정·역할 이름)을 쓴다.
  예시는 `server/account.local.example.json`.
- 로컬 백엔드에는 Slack 로그인과 브로커 연동이 없다. 계정 연결(브로커 경유)은 배포 환경에서 확인한다.

## 명령

```bash
npm run build       # 타입 검사 + 프로덕션 빌드
npm run validate    # 생성 알람을 botocore CloudWatch 모델로 검증 (AWS 호출 없음)
npm run docs        # 카탈로그 → catalog-metrics.md 재생성 (카탈로그를 고쳤을 때)
npm run deploy:web  # 빌드 → S3 업로드 → CloudFront 무효화
deploy/deploy-backend.sh cw-alarm-discover ap-northeast-2   # 백엔드 코드 배포
```

카탈로그나 생성기를 고쳤으면 `build`만으로 끝내지 말고 `validate`까지 통과시킨다.

## 문서 안내

| 문서 | 용도 |
|---|---|
| `README.md` | 이 문서. 개요, 기능, 로컬 개발, 명령 |
| `cw-alarm-generator.md` | 절대 금지 목록(정본)과 설계 기준 — 이름 규칙, 카탈로그 원칙, 검증, 권한 경계, 리스크 |
| `deploy/README.md` | 배포와 운영 — 프론트·백엔드·브로커, 환경변수, 승격 체크리스트 |
| `catalog-metrics.md` | 지표 카탈로그 목록 (JSON에서 자동 생성, 직접 수정하지 않음) |
| `AGENTS.md` | AI 에이전트용 작업 규칙 요약 |
| 화면 우하단 `?` | 사용자용 사용 방법 |

## 기술 스택

React · TypeScript · Vite / Node.js (AWS SDK v3) / AWS Lambda · CloudFront · S3 · Bedrock · CloudWatch
