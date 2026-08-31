# CloudWatch Alarm Generator

표준 알람 템플릿을 골라 Amazon CloudWatch 알람 생성용 CLI/JSON을 만들어 주는 웹 도구.
반복적인 알람 설정을 표준화·자동화하고, 계정의 알람을 표준과 비교해 누락을 점검한다.

> 도구는 **조회와 산출물 생성만** 한다. 실제 알람 생성은 사람이 CloudShell에서 실행한다.
<img width="1182" height="655" alt="메인 화면" src="https://github.com/user-attachments/assets/519dc3e2-8761-4de9-a6b0-187c541222c1" />
<img width="1182" height="745" alt="구성화면1" src="https://github.com/user-attachments/assets/50e56133-9566-4dbd-885e-706df345c2a0" />
<img width="1175" height="916" alt="구성화면2" src="https://github.com/user-attachments/assets/ec9de00b-b9b2-4f43-a92c-fd8e25823f2f" />
<img width="1181" height="912" alt="구성화면3" src="https://github.com/user-attachments/assets/74ffe091-503f-49ca-968b-6718c3351a2e" />


## 주요 기능

- **표준 알람 템플릿 / 지표 카탈로그** — EC2 · ALB · RDS(Aurora PostgreSQL / RDS PostgreSQL / RDS MySQL·MariaDB)
- **토글 → CLI/JSON 생성** — Lv1/Lv2/Lv3 단계 알람, 지표 복제, 단위 자동 변환
- **리소스 조회(읽기 전용)** — 계정 리소스를 읽어 알람 대상 자동 반영 (또는 CloudShell 출력 붙여넣기)
- **다층 검증** — 결정론적 사전 검증 + 지표 실존/이름 충돌 사전 점검 + AWS 모델 재검증
- **표준 준수 감사** — 계정 알람을 표준과 비교(일치/상이/누락/표준 외) → 누락·수정분만 생성
- **안전 가드** — 조회 API 화이트리스트, 파괴적 명령 차단
- **AI 검토(설계)** — 임계값 타당성·누락·오탐을 점검하는 LLM 검토 프롬프트/스키마

## 실행

```bash
npm install
npm run dev        # 프론트엔드 (http://localhost:5173)
```

대부분의 기능(생성·검증·감사·AI 프롬프트)은 **AWS 계정 없이** 브라우저에서 동작한다.

계정 리소스 라이브 조회를 쓰려면(선택):

```bash
cp server/account.local.example.json server/account.local.json   # 허용 계정·역할 지정
cp .env.example .env.local                                        # VITE_TEST_ACCOUNT 지정
npm run server     # 로컬 조회 백엔드 (http://localhost:8787), 로컬 aws CLI 자격증명 사용
```

## 스크립트

```bash
npm run build      # 타입 검사 + 프로덕션 빌드
npm run validate   # 생성 알람을 AWS(botocore) 모델로 검증 (AWS 호출 없음)
npm run docs       # 카탈로그 → catalog-metrics.md 재생성
```

## 기술 스택

React · TypeScript · Vite / Node.js(로컬 조회 백엔드) / AWS CloudWatch · CLI · CloudShell

## 안전 원칙

읽기 + 알람 생성 스크립트 산출만 수행하며, 리소스·기존 알람의 변경/삭제는 하지 않는다.
자세한 규칙은 [`AGENTS.md`](./AGENTS.md), 설계 문서는 [`cw-alarm-generator.md`](./cw-alarm-generator.md) 참고.
