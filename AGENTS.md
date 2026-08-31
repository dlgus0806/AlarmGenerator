# AGENTS.md

AI 에이전트가 이 저장소에서 작업하기 전에 **반드시 먼저 읽고 준수**할 규칙입니다.
여러 AI 도구가 루트의 `AGENTS.md`를 자동으로 읽습니다.

## 0. 먼저 읽을 것 (정본)

- **[`cw-alarm-generator.md`](./cw-alarm-generator.md) 의 "⛔ 절대 금지 목록"** — 실행·안전 규칙의
  **정본**. 이 AGENTS.md는 포인터일 뿐이며, 규칙이 다르면 `cw-alarm-generator.md`가 우선한다.
- [`catalog-metrics.md`](./catalog-metrics.md) — 지표 카탈로그 목록 (JSON에서 자동 생성).

## 1. 한 줄 요약 (상세는 정본 참조)

> **읽는다 + 알람을 만든다. 그 외에는 아무것도 건드리지 않는다.**
> 리소스 변경·삭제, 기존 알람 삭제, 조회 외 write, 승인 안 된 계정 대상, 자격증명 노출은 금지.
> 의심스러우면 실행하지 말고 사람에게 확인.

허용 계정은 설정 파일/환경변수로 지정한 계정으로 한정한다(`server/account.local.json` 또는
`ALLOWED_ACCOUNTS`). 허용되는 쓰기는 `cloudwatch:PutMetricAlarm`(사람이 CloudShell에서 직접
실행)뿐이다.

## 2. 실행 환경

| 프로세스 | 명령 | 포트 | AWS 접근 |
|---|---|---|---|
| 프론트엔드 | `npm run dev` | 5173 | 없음 |
| 백엔드(리소스 조회) | `npm run server` | 8787 | 있음(로컬 aws CLI, 조회 전용) |

- 브라우저: `http://localhost:5173/` (dev가 `/api/*`를 8787로 프록시)
- cwd는 항상 저장소 루트.

## 3. 변경 후 검증 (항상)

```
npm run build      # tsc 타입검사 + vite 빌드
npm run validate   # 생성 알람을 botocore CloudWatch 모델로 검증 (AWS 호출 없음)
npm run docs       # 카탈로그 → catalog-metrics.md 재생성 (카탈로그를 고쳤을 때)
```

빌드 성공만으로 "산출물이 맞다"고 보지 않는다. 카탈로그·생성기를 바꿨으면 `npm run validate`까지 통과시킨다.

## 4. 코드로 강제되는 가드 (문서와 별개로 항상 동작)

- `server/discover.mjs` — 조회 API 화이트리스트만 실행(그 외 403 차단).
- `src/lib/safety.ts` — 산출 스크립트에 `put-metric-alarm` 외/파괴적 명령이 섞이면 차단.

문서 규칙은 권고, 위 코드 가드는 강제. 둘 다 지킨다.
