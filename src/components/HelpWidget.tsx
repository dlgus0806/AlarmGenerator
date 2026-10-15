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
  /** 알람 구성처럼 먼저 나란히 강조할 선택 방법 */
  methods?: HelpCard[];
  cards: HelpCard[];
}

const HELP_COACHMARK_KEY = 'cw-alarm-help-coachmark-dismissed-v1';

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
        desc: (
          <>
            알림을 보낼 토픽. 사전 구성이 필요합니다. 여러 개 넣을 수 있고, 지표마다 <b>추가 구성</b>에서
            보낼 토픽을 고를 수 있습니다.
          </>
        ),
      },
      {
        title: '추가 설정',
        tag: '선택',
        desc: 'prefix(알람 접두사), 태그, 알람 이름 자동/직접을 설정할 수 있습니다.',
      },
      {
        title: 'JSON 불러오기',
        tag: '선택',
        desc: '저장해둔 JSON을 불러오면 동일한 구성으로 설정값이 입력됩니다.',
      },
      {
        title: '알람 이름 규칙',
        desc: (
          <>
            % 지표 끝에는 임계값이 붙습니다.<br />(ex. <code>prefix-cpu-high-lv1-70</code>)
          </>
        ),
      },
      {
        title: '같은 이름은 덮어쓰기',
        desc: '실행 시 같은 이름의 알람은 덮어씁니다.',
      },
    ],
  },
  {
    id: 'build',
    step: '2',
    label: '알람 구성',
    lead: '세 방법 중 원하는 방법으로 알람을 정의합니다.',
    methods: [
      {
        title: 'AI 어시스턴트',
        desc: '자연어 요구사항을 알람 구성으로 바꾸거나, 연결한 계정의 실제 리소스와 최근 CPU를 근거로 알람을 추천합니다.',
        steps: [
          '요구사항 입력',
          <>
            <b>AI 실행</b>
          </>,
          '결과 확인',
          <>
            <b>적용</b>
          </>,
        ],
      },
      {
        title: '표준 템플릿',
        desc: '표준 알람 묶음을 골라 한 번에 적용합니다. 내 커스텀 구성을 만들고 저장해서 재사용할 수 있습니다.',
        steps: [
          '템플릿 선택',
          '리소스 ID 입력',
          <>
            <b>적용</b>
          </>,
        ],
      },
      {
        title: '리소스 선택',
        desc: '리소스 종류를 골라 카드를 직접 추가하고, 필요한 지표를 켜서 임계값과 조건을 조정합니다.',
        steps: [
          '리소스 선택',
          '지표 토글',
          '조건 조정',
        ],
      },
    ],
    cards: [
      {
        title: '계정 연결',
        tag: '선택',
        desc: (
          <>
            고객 계정 리소스를 읽기 전용으로 불러옵니다.
            <br />EC2 · Auto Scaling · RDS/Aurora · ALB ·
            대상 그룹 · ECS · Lambda · CloudFront · Route 53 Health Check 등
          </>
        ),
        steps: [
          '계정 ID 입력',
          <>
            <b>계정 확인</b>
          </>,
          '리소스 체크',
          <>
            <b>카드 적용</b>
          </>,
        ],
      },
      {
        title: '연결 유지 · 다시 불러오기',
        desc: (
          <>
            다른 탭에 교차해서 설정이 가능합니다. 다시 읽으려면 <b>↻ 새로고침</b>, 다른 계정 입력은
            ID를 바꾸고 <b>계정 확인</b> 클릭
          </>
        ),
      },
      {
        title: '불러온 리소스 → 카드',
        desc: (
          <>
            선택한 리소스만 남기고 기존 카드 전체를 교체합니다. 각 카드에는 기본 지표가 켜집니다. 대상 그룹의 LoadBalancer,
            ECS의 클러스터 이름은 자동으로 채워집니다.
          </>
        ),
      },
      {
        title: '목록에서 미지원·경고',
        desc: 'ALB에 연결 안 된 대상 그룹, NLB, 카탈로그 없는 엔진은 "미지원"으로 표시됩니다. 권한 등으로 일부 조회가 실패하면 목록 위에 표시됩니다.',
      },
      {
        title: '카드에서 할 수 있는 것',
        desc: (
          <>
            <b>알람 방식</b>: 단계(Lv1/Lv2/Lv3), 단일 임계값 또는 이상 탐지로 설정할 수 있습니다.
            <br />
            <b>세부 설정</b>: 지표를 복제하고 기간·통계·결측 데이터 처리·알림 SNS 토픽을 조정할 수 있습니다.
            <br />
            <b>커스텀 지표</b>: 카탈로그에 없는 지표도 직접 추가할 수 있습니다.
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
            결론 (<span className="help-v ok">실행 가능</span> <span className="help-v warn">주의 후 실행</span>{' '}
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
        title: '산출물',
        desc: (
          <>
            <b>AI 점검</b> · <b>점검 스크립트</b>(읽기 전용 사전 확인) · <b>CLI</b>(알람 생성) ·{' '}
            <b>JSON</b>(저장·재편집·재사용)
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
        title: '점검 스크립트 실행',
        desc: (
          <>
            <b>Actions → Upload file</b> 로 다운로드 받은 .sh 업로드
            <br />또는 heredoc 으로 직접 추가
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
        title: 'INSUFFICIENT_DATA',
        desc: '지표·디멘션 오타이거나 아직 데이터가 안 쌓인 지표입니다. 점검 스크립트를 확인하세요.',
      },
      {
        title: '알림 미수신',
        desc: 'SNS 토픽 리전이 알람과 다르거나, 토픽 구독(이메일 확인 등)이 안 된 상태입니다.',
      },
      {
        title: '계정 확인 실패',
        desc: 'Slack 로그인, 계정 ID 12자리, 해당 계정이 FitCloud 고객으로 등록됐는지 확인하세요.',
      },
      {
        title: '리소스가 목록에 없음',
        desc: '전역 설정의 리전 기준으로 읽습니다. 리전을 바꿨거나 새로 만든 리소스라면 ↻ 새로고침을 누르세요.',
      },
      {
        title: '글로벌 지표 리전 오류',
        desc: 'CloudFront와 Route 53 Health Check 알람은 us-east-1에만 만들 수 있습니다. 전역 리전을 us-east-1로 두고 따로 생성하세요.',
      },
      {
        title: '안전 장치',
        desc: 'CLI에는 알람 생성만 들어갑니다. 계정 조회는 읽기 전용이고, AI는 제안만 합니다.',
      },
    ],
  },
];

function HelpCardView({ card, className = '' }: { card: HelpCard; className?: string }) {
  return (
    <div className={`help-card ${className}`.trim()}>
      <div className="help-card-head">
        <strong>{card.title}</strong>
        {card.tag && (
          <span className={`help-tag ${card.tag === '필수' ? 'req' : ''}`}>{card.tag}</span>
        )}
      </div>
      <p className="help-card-desc">{card.desc}</p>
      {card.steps && (
        <div className="help-flow">
          {card.steps.map((step, i) => (
            <span key={i} className="help-flow-item">
              {i > 0 && <span className="help-flow-arrow">→</span>}
              <span className="help-chip">{step}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface HelpWidgetProps {
  /** Slack 로그인 완료 여부. 최초 로그인 안내를 표시할 때 사용한다. */
  authenticated: boolean;
}

/** 우하단 고정 원형 버튼(?) + 최초 로그인 안내 말풍선 + 사용법 안내 모달(탭형). */
export function HelpWidget({ authenticated }: HelpWidgetProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(SECTIONS[0].id);
  const [showCoachmark, setShowCoachmark] = useState(false);
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  // 이 브라우저에서 Slack 로그인 후 안내를 아직 확인하지 않은 경우에만 한 번 보여준다.
  // 확인하거나 사용 방법을 열면 localStorage에 기록되어 새로고침·재로그인 후에도 다시 뜨지 않는다.
  useEffect(() => {
    if (!authenticated) {
      setShowCoachmark(false);
      return;
    }
    try {
      setShowCoachmark(localStorage.getItem(HELP_COACHMARK_KEY) !== '1');
    } catch {
      // 저장소 접근이 막힌 브라우저에서는 현재 로그인 세션에 한 번 보여준다.
      setShowCoachmark(true);
    }
  }, [authenticated]);

  // Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const dismissCoachmark = () => {
    setShowCoachmark(false);
    try {
      localStorage.setItem(HELP_COACHMARK_KEY, '1');
    } catch {
      // localStorage 사용 불가 시 현재 세션에서만 닫는다.
    }
  };

  const openHelp = () => {
    dismissCoachmark();
    setOpen(true);
  };

  return (
    <>
      {showCoachmark && !open && (
        <>
          <div className="help-coachmark-backdrop" aria-hidden="true" />
          <aside className="help-coachmark" aria-label="사용 방법 안내">
            <strong>사용 방법을 확인해 보세요</strong>
            <div className="help-coachmark-actions">
              <button className="btn btn-primary btn-sm" onClick={openHelp}>
                확인
              </button>
            </div>
            <span className="help-coachmark-arrow" aria-hidden="true" />
          </aside>
        </>
      )}

      <button className="fab" onClick={openHelp} title="사용 방법" aria-label="사용 방법">
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

              {section.methods && (
                <div className="help-methods" aria-label="알람 구성 방법 3가지">
                  {section.methods.map((method, i) => (
                    <div key={method.title} className="help-method-wrap">
                      <span className="help-method-number">방법 {i + 1}</span>
                      <HelpCardView card={method} className="help-method-card" />
                    </div>
                  ))}
                </div>
              )}

              {section.methods && <h3 className="help-subtitle">공통 기능</h3>}
              <div className="help-cards">
                {section.cards.map((card) => (
                  <HelpCardView key={card.title} card={card} />
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
