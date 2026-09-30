import { useEffect, useState, type ReactNode } from 'react';

/** 카드 하나: 제목 + 한 줄 설명 + (선택) 따라 하는 순서 */
interface HelpCard {
  title: string;
  desc: ReactNode;
  steps?: ReactNode[];
  tag?: '필수' | '선택';
}

interface HelpSection {
  id: string;
  step?: string; // 상단 스테퍼에 표시할 번호. 없으면 보조 탭(문제 해결 등)
  label: string;
  lead: ReactNode;
  cards: HelpCard[];
}

const SECTIONS: HelpSection[] = [
  {
    id: 'global',
    step: '1',
    label: '전역 설정',
    lead: '모든 알람에 공통으로 들어가는 값입니다.',
    cards: [
      {
        title: '리전',
        tag: '필수',
        desc: '알람을 만들 리전. CloudShell 리전, SNS 토픽 리전과 같아야 합니다.',
      },
      {
        title: 'SNS Topic ARN',
        tag: '필수',
        desc: '알림을 보낼 토픽. 여러 개 넣을 수 있고, 지표마다 "추가 구성"에서 보낼 토픽을 고를 수 있습니다.',
      },
      {
        title: '추가 설정',
        tag: '선택',
        desc: 'prefix(알람 이름 앞 접두사), 태그, 알람 이름 자동/직접. 직접 입력한 이름에도 prefix가 붙습니다.',
      },
      {
        title: 'JSON 불러오기',
        tag: '선택',
        desc: '전에 받아 둔 JSON으로 작업을 그대로 이어서 합니다.',
      },
      {
        title: '알람 이름 규칙',
        desc: (
          <>
            <code>prefix-종류-리소스-지표</code>. % 지표만 끝에 임계값이 붙습니다(
            <code>…-cpu-high-lv1-70</code>). 심각도는 이름에 넣지 않습니다.
          </>
        ),
      },
      {
        title: '같은 이름은 덮어쓰기',
        desc: '실행 시 같은 이름의 알람은 덮어씁니다. 이름이 바뀌면(임계값 변경 등) 새 알람이 생기고 이전 알람은 남습니다.',
      },
    ],
  },
  {
    id: 'build',
    step: '2',
    label: '알람 구성',
    lead: '세 탭 중 편한 방법으로 알람을 정의합니다. 탭을 오가도 각 탭의 내용은 유지됩니다.',
    cards: [
      {
        title: '계정 연결',
        tag: '선택',
        desc: (
          <>
            고객 계정 리소스를 읽기 전용으로 불러옵니다. EC2 · Auto Scaling · RDS/Aurora · ALB ·
            대상 그룹 · ECS · Lambda · CloudFront.
          </>
        ),
        steps: [
          '계정 ID 12자리',
          <>
            <b>계정 확인</b>
          </>,
          '리소스 체크',
          <>
            <b>카드 생성</b>
          </>,
        ],
      },
      {
        title: '연결 유지 · 다시 불러오기',
        desc: (
          <>
            다른 탭에 다녀와도 연결과 목록이 그대로입니다. 다시 읽으려면 <b>↻ 새로고침</b>, 다른 계정은
            ID를 바꾸고 <b>계정 확인</b>.
          </>
        ),
      },
      {
        title: '불러온 리소스 → 카드',
        desc: (
          <>
            기본 지표가 켜진 카드가 추가됩니다(이미 있는 리소스는 건너뜀). 대상 그룹의 LoadBalancer,
            ECS의 클러스터 이름은 자동으로 채워집니다.
          </>
        ),
      },
      {
        title: '목록에서 미지원·경고',
        desc: 'LB에 연결 안 된 대상 그룹, NLB, 카탈로그 없는 엔진은 "미지원"입니다. 권한 등으로 일부 조회가 실패하면 목록 위에 표시됩니다.',
      },
      {
        title: 'AI 어시스턴트',
        desc: '요구사항을 자연어로 쓰면 알람 JSON으로 바꿉니다. 계정을 연결했으면 실제 리소스·최근 CPU를 근거로 추천합니다. 적용하면 현재 카드가 교체됩니다.',
        steps: [
          '요구사항 입력',
          <>
            <b>AI로 변환 / AI에게 질문하기</b>
          </>,
          'JSON 확인',
          <>
            <b>적용</b>
          </>,
        ],
      },
      {
        title: '표준 템플릿',
        desc: '자주 쓰는 알람 묶음을 저장해 두고 한 번에 적용합니다. 적용하면 현재 카드가 교체됩니다.',
      },
      {
        title: '리소스 선택',
        desc: '리소스 종류를 골라 카드를 직접 추가하고, 지표를 켜고 임계값·조건을 조정합니다.',
      },
      {
        title: '카드에서 할 수 있는 것',
        desc: (
          <>
            단계(Lv1/2/3)·단일 임계값·이상 탐지 전환, 지표 복제, <b>추가 구성</b>(기간·통계·결측 처리·알림
            보낼 SNS 토픽), <b>+ 카탈로그에 없는 지표 추가</b>.
          </>
        ),
      },
    ],
  },
  {
    id: 'check',
    step: '3',
    label: '검증',
    lead: '실행 전에 정의를 점검하고 산출물을 받습니다.',
    cards: [
      {
        title: '사전 검증',
        desc: (
          <>
            입력값을 규칙으로 즉시 검사합니다. <b>오류</b>가 있으면 CLI 복사·다운로드가 잠깁니다.
          </>
        ),
      },
      {
        title: 'AI 점검',
        desc: (
          <>
            결론(<span className="help-v ok">실행 가능</span> <span className="help-v warn">주의 후 실행</span>{' '}
            <span className="help-v hold">보류</span>)을 맨 위에 보여줍니다. 계정 연결 시 기존 알람·데이터
            유무를 대조한 표가 함께 나옵니다.
          </>
        ),
      },
      {
        title: '점검 결과 유지',
        desc: '알람 구성을 바꿔도 결과는 지우지 않고 "이전 기준"으로 표시합니다. 다시 점검하려면 버튼을 누르세요.',
      },
      {
        title: '산출물 탭',
        desc: (
          <>
            <b>AI 점검</b> · <b>점검 스크립트</b>(읽기 전용 사전 확인) · <b>CLI</b>(알람 생성) ·{' '}
            <b>JSON</b>(저장·재편집)
          </>
        ),
      },
    ],
  },
  {
    id: 'run',
    step: '4',
    label: '실행',
    lead: 'CloudShell에서 사람이 직접 실행합니다. 도구는 알람을 만들지 않습니다.',
    cards: [
      {
        title: '실행 전 확인',
        desc: '리전과 계정이 맞는지 먼저 봅니다.',
        steps: [
          '우상단 리전 확인',
          <code key="c">aws sts get-caller-identity</code>,
        ],
      },
      {
        title: '스크립트를 파일로',
        desc: (
          <>
            <b>Actions → Upload file</b> 로 받은 .sh 업로드. 또는 heredoc:
          </>
        ),
        steps: [<code key="h">{"cat > alarms.sh <<'EOF'"}</code>, '붙여넣기', <code key="e">EOF</code>],
      },
      {
        title: '실행',
        desc: '점검 스크립트 → 알람 1건 → 전체 순서로 진행합니다.',
        steps: ['점검 스크립트', '1건 먼저', <code key="b">bash alarms.sh</code>],
      },
      {
        title: '결과 확인',
        desc: (
          <>
            <code>describe-alarms</code>로 개수·임계값, <code>set-alarm-state</code>로 SNS 도달을 확인합니다.
          </>
        ),
      },
    ],
  },
  {
    id: 'faq',
    label: '문제 해결',
    lead: '자주 막히는 곳과 안전 장치입니다.',
    cards: [
      {
        title: '계속 INSUFFICIENT_DATA',
        desc: '지표·디멘션 오타이거나 아직 데이터가 안 쌓인 지표입니다. 점검 스크립트를 확인하세요.',
      },
      {
        title: '알림이 안 옴',
        desc: 'SNS 토픽 리전이 알람과 다르거나, 토픽 구독(이메일 확인 등)이 안 된 상태입니다.',
      },
      {
        title: '계정 확인 실패',
        desc: 'Slack 로그인, 계정 ID 12자리, 해당 계정이 활성 고객으로 등록됐는지 확인하세요.',
      },
      {
        title: '리소스가 목록에 없음',
        desc: '전역 설정의 리전 기준으로 읽습니다. 리전을 바꿨거나 새로 만든 리소스라면 ↻ 새로고침을 누르세요.',
      },
      {
        title: 'CloudFront 리전 오류',
        desc: 'CloudFront 알람은 us-east-1에만 만들 수 있습니다. 전역 리전을 us-east-1로 두고 따로 생성하세요.',
      },
      {
        title: '예전 -crit / -warn 알람',
        desc: '이름 규칙이 바뀌어 예전 알람을 덮어쓰지 않고 새로 생깁니다. 이전 알람은 확인 후 직접 정리하세요.',
      },
      {
        title: '안전 장치',
        desc: 'CLI에는 알람 생성만 들어갑니다. 계정 조회는 읽기 전용이고, AI는 제안만 합니다.',
      },
    ],
  },
];

/** 우하단 고정 원형 버튼(?) + 사용법 안내 모달(탭형). */
export function HelpWidget() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(SECTIONS[0].id);
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  // Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button className="fab" onClick={() => setOpen(true)} title="사용 방법" aria-label="사용 방법">
        ?
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="modal modal-help"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2 id="help-title" style={{ margin: 0, fontSize: 17 }}>
                  사용 방법
                </h2>
                <p className="hint" style={{ margin: '2px 0 0' }}>
                  알람 정의 → CLI 생성 → CloudShell에서 직접 실행
                </p>
              </div>
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>

            {/* 스테퍼 탭: 1~4 흐름 + 보조 탭 */}
            <div className="help-tabs" role="tablist">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={s.id === active}
                  className={`help-tab ${s.id === active ? 'active' : ''} ${s.step ? '' : 'aux'}`}
                  onClick={() => setActive(s.id)}
                >
                  {s.step && <span className="help-tab-num">{s.step}</span>}
                  {s.label}
                </button>
              ))}
            </div>

            <div className="help-panel" role="tabpanel">
              <p className="help-lead">{section.lead}</p>
              <div className="help-cards">
                {section.cards.map((c) => (
                  <div key={c.title} className="help-card">
                    <div className="help-card-head">
                      <strong>{c.title}</strong>
                      {c.tag && (
                        <span className={`help-tag ${c.tag === '필수' ? 'req' : ''}`}>{c.tag}</span>
                      )}
                    </div>
                    <p className="help-card-desc">{c.desc}</p>
                    {c.steps && (
                      <div className="help-flow">
                        {c.steps.map((st, i) => (
                          <span key={i} className="help-flow-item">
                            {i > 0 && <span className="help-flow-arrow">→</span>}
                            <span className="help-chip">{st}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 이전/다음 */}
            <div className="help-nav">
              {(() => {
                const idx = SECTIONS.findIndex((s) => s.id === active);
                const prev = SECTIONS[idx - 1];
                const next = SECTIONS[idx + 1];
                return (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={!prev}
                      onClick={() => prev && setActive(prev.id)}
                    >
                      ← {prev?.label ?? '이전'}
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!next}
                      onClick={() => next && setActive(next.id)}
                    >
                      {next?.label ?? '다음'} →
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
