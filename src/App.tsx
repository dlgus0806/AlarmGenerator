import { useMemo, useState } from 'react';
import type { AlarmTemplate, GlobalConfig, ResourceEntry } from './types';
import { CATALOG, getResourceType } from './catalog';
import { buildAlarms } from './lib/build';
import { generateCli } from './lib/generateCli';
import { countByLevel, validate } from './lib/validate';
import { parseProjectFile } from './lib/io';
import { useTheme } from './lib/theme';
import { useAuth } from './lib/useAuth';
import { applyTemplate, defaultSelection } from './lib/templates';
import { GlobalPanel } from './components/GlobalPanel';
import { TemplatePanel } from './components/TemplatePanel';
import { AiPanel } from './components/AiPanel';
import { intakeNotices, type IntakeApply } from './lib/intake';
import { ResourceCard } from './components/ResourceCard';
import { FindingsPanel } from './components/FindingsPanel';
import { OutputPanel } from './components/OutputPanel';
import { HelpWidget } from './components/HelpWidget';

/** 헤더 설명 문구. 여기만 고치면 됩니다. */
const HEADER_SUBTITLE =
  '토글이나 AI로 CloudWatch 알람 CLI를 만들고, 실행은 CloudShell에서 직접 합니다.';

const DEFAULT_GLOBAL: GlobalConfig = {
  prefix: '',
  region: 'ap-northeast-2',
  snsTopics: [],
  namingMode: 'auto',
  tags: [],
};

export default function App() {
  const { theme, toggle } = useTheme();
  const auth = useAuth();
  const [global, setGlobal] = useState<GlobalConfig>(DEFAULT_GLOBAL);
  const [resources, setResources] = useState<ResourceEntry[]>([]);
  const [importError, setImportError] = useState('');
  // AI 어시스턴트에서 역할 ARN을 검증하면 여기 올라온다. 점검(OutputPanel)이 공유해 쓴다.
  const [validatedRole, setValidatedRole] = useState<{ accountId: string; account: string } | null>(
    null,
  );
  // 적용(AI/템플릿/리소스 카드 생성)이 일어날 때 증가 → 우측 패널이 점검 탭으로 전환.
  const [applyNonce, setApplyNonce] = useState(0);
  // 알람 구성 방식(상단 가로 탭): AI 어시스턴트 / 표준 템플릿 / 리소스 선택.
  const [method, setMethod] = useState<'ai' | 'template' | 'manual'>('ai');

  const specs = useMemo(() => buildAlarms(global, resources), [global, resources]);
  const findings = useMemo(
    () => validate(global, resources, specs),
    [global, resources, specs],
  );
  const script = useMemo(() => generateCli(global, specs), [global, specs]);
  const counts = countByLevel(findings);

  function addResource(typeKey: string) {
    const type = getResourceType(typeKey);
    if (!type) return;
    // 새 리소스는 맨 위에 추가해 바로 보이게 한다.
    setResources((prev) => [
      {
        uid: crypto.randomUUID(),
        typeKey,
        resourceId: '',
        selected: defaultSelection(type),
      },
      ...prev,
    ]);
  }

  function updateResource(uid: string, patch: Partial<ResourceEntry>) {
    setResources((prev) =>
      prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)),
    );
  }

  function removeResource(uid: string) {
    setResources((prev) => prev.filter((r) => r.uid !== uid));
  }

  function clearAllResources() {
    if (resources.length === 0) return;
    if (!window.confirm(`리소스 카드 ${resources.length}개를 모두 삭제할까요?`)) return;
    setResources([]);
  }

  function duplicateResource(uid: string) {
    setResources((prev) => {
      const idx = prev.findIndex((r) => r.uid === uid);
      if (idx < 0) return prev;
      const src = prev[idx];
      const copy: ResourceEntry = {
        ...src,
        uid: crypto.randomUUID(),
        resourceId: '',
        selected: src.selected.map((s) => ({ ...structuredClone(s), uid: crypto.randomUUID() })),
      };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }

  function handleImport(file: File) {
    setImportError('');
    file
      .text()
      .then((raw) => {
        const parsed = parseProjectFile(raw);
        setGlobal({ ...DEFAULT_GLOBAL, ...parsed.global });
        setResources(parsed.resources);
      })
      .catch((e: unknown) => {
        setImportError(e instanceof Error ? e.message : '불러오기에 실패했습니다.');
      });
  }

  // 리소스가 새로 채워진 뒤, 확인할 수 있도록 카드 목록으로 스크롤 이동한다.
  function scrollToResources() {
    setTimeout(
      () =>
        document
          .getElementById('resource-list')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      80,
    );
  }

  // 적용했으면 true, 취소/미적용이면 false. (호출부가 성공 시에만 스크롤·피드백하도록)
  function handleIntake(result: IntakeApply): boolean {
    const notes = intakeNotices(result);

    // 적용할 리소스가 하나도 없으면(리소스 ID 미확정 등) 상태를 바꾸지 않고 경고만 띄운다.
    // → "적용 되었습니다" 없이 무엇이 빠졌는지만 안내.
    if (result.resources.length === 0) {
      if (notes.length > 0) {
        window.alert(notes.map((n) => `⚠ ${n}`).join('\n'));
      }
      return false;
    }

    if (
      resources.length > 0 &&
      !window.confirm(`요구사항을 적용하면 현재 리소스 ${resources.length}개가 교체됩니다. 계속할까요?`)
    ) {
      return false;
    }
    setGlobal((g) => ({ ...g, ...result.global }));
    setResources(result.resources);
    setApplyNonce((n) => n + 1);
    scrollToResources();
    if (notes.length > 0) {
      window.alert('적용 되었습니다.\n\n' + notes.map((n) => `⚠ ${n}`).join('\n'));
    }
    return true;
  }

  function handleApplyTemplate(t: AlarmTemplate, choices: Record<number, string>) {
    // 이미 작업 중인 리소스가 있으면 덮어쓰기 전에 확인한다.
    if (
      resources.length > 0 &&
      !window.confirm(
        `"${t.name}"을 적용하면 현재 리소스 ${resources.length}개가 교체됩니다. 계속할까요?`,
      )
    ) {
      return;
    }
    setResources(applyTemplate(t, choices));
    setApplyNonce((n) => n + 1);
    scrollToResources();
  }

  // 사내 전용: 미로그인 시 앱을 뒤에 흐리게 깔고 그 위에 로그인 모달을 띄운다.
  // (auth.configured=false = OAuth 미구성 로컬 dev → 모달 없이 통과)
  const showLoginOverlay = auth.loading || (auth.configured && !auth.authenticated);

  return (
    <div className="app">
      {showLoginOverlay && (
        <div className="login-overlay">
          <div className="login-gate">
            {auth.loading ? (
              <p>로딩 중…</p>
            ) : (
              <>
                <h1>CloudWatch Alarm Generator</h1>
                <p>Slack 로그인 후 이용 가능합니다.</p>
                <button className="btn btn-primary btn-slack" onClick={auth.login}>
                  Slack 로그인
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <header className="app-header">
        <div className="header-title">
          <h1>CloudWatch Alarm Generator</h1>
          <p className="sub">{HEADER_SUBTITLE}</p>
        </div>
        <div className="header-stats">
          <span className="stat">
            알람 <strong>{specs.length}</strong>
          </span>
          <span className={`stat ${counts.error > 0 ? 'stat-error' : ''}`}>
            오류 <strong>{counts.error}</strong>
          </span>
          <span className={`stat ${counts.warning > 0 ? 'stat-warn' : ''}`}>
            경고 <strong>{counts.warning}</strong>
          </span>
          {auth.configured &&
            (auth.authenticated ? (
              <span className="user-chip">
                <span className="user-chip-name" title={auth.identity?.email}>
                  {auth.identity?.name || auth.identity?.email || '로그인됨'}
                </span>
                <button
                  className="btn btn-primary btn-sm user-chip-logout"
                  onClick={() => void auth.logout()}
                >
                  로그아웃
                </button>
              </span>
            ) : (
              <button className="theme-btn btn-slack" onClick={auth.login}>
                Slack 로그인
              </button>
            ))}
          <button
            className="theme-btn"
            onClick={toggle}
            title={theme === 'dark' ? 'Light 모드로' : 'Dark 모드로'}
          >
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
        </div>
      </header>

      <div className="layout">
        <div className="col-left">
          <div className="col-header">
            <span className="col-step">1</span>
            <div>
              <h2 className="col-title">알람 구성</h2>
              <p className="col-sub">리소스와 지표를 골라 알람을 정의합니다 (AI·템플릿·수동)</p>
            </div>
          </div>

          <GlobalPanel
            value={global}
            onChange={setGlobal}
            onImport={handleImport}
            importError={importError}
          />

          {/* 알람 구성 방식 선택: 가로 3분할 탭. 선택한 방식의 패널만 보여준다. */}
          <div className="method-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={method === 'ai'}
              className={`method-tab ${method === 'ai' ? 'active' : ''}`}
              onClick={() => setMethod('ai')}
            >
              <span className="method-tab-title">AI 어시스턴트</span>
              <span className="method-tab-sub">자연어로 입력하면 AI가 생성</span>
            </button>
            <button
              role="tab"
              aria-selected={method === 'template'}
              className={`method-tab ${method === 'template' ? 'active' : ''}`}
              onClick={() => setMethod('template')}
            >
              <span className="method-tab-title">표준 템플릿</span>
              <span className="method-tab-sub">자주 쓰는 알람 묶음을 저장·재사용 </span>
            </button>
            <button
              role="tab"
              aria-selected={method === 'manual'}
              className={`method-tab ${method === 'manual' ? 'active' : ''}`}
              onClick={() => setMethod('manual')}
            >
              <span className="method-tab-title">리소스 선택</span>
              <span className="method-tab-sub">직접 리소스 추가</span>
            </button>
          </div>

          {/* AI 패널은 탭을 옮겨도 언마운트하지 않는다(숨김만). 계정 연결·불러온 목록·AI 결과를 유지해
              다른 탭에서 돌아와도 재조회하지 않는다. 재조회는 "계정 확인"/"새로고침"에서만. */}
          <div className="keep-alive" hidden={method !== 'ai'}>
            <AiPanel
              global={global}
              onApply={handleIntake}
              onValidatedRole={setValidatedRole}
              authenticated={auth.authenticated}
              authRequired={auth.configured}
              onLogin={auth.login}
              onAdd={(entries) => {
                if (
                  resources.length > 0 &&
                  !window.confirm(
                    `선택한 ${entries.length}개로 현재 리소스 카드 ${resources.length}개를 교체할까요?`,
                  )
                ) {
                  return false;
                }
                // 계정에서 선택한 리소스만 남기고 기존 카드 전체를 교체한다.
                setResources(entries);
                setApplyNonce((n) => n + 1);
                scrollToResources();
                return true;
              }}
            />
          </div>

          {method === 'template' && (
            <TemplatePanel resources={resources} onApply={handleApplyTemplate} />
          )}

          {method === 'manual' && (
            <section className="panel">
              <h2>리소스 선택</h2>
              <div className="type-buttons">
                {CATALOG.map((t) => (
                  <button key={t.key} className="btn" onClick={() => addResource(t.key)}>
                    + {t.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {resources.length === 0 ? (
            <section className="panel empty" id="resource-list">
              위에서 방식을 골라 적용하면 리소스 카드가 여기에 나타납니다.
            </section>
          ) : (
            <div id="resource-list" className="resource-cards">
              <div className="row-between" style={{ margin: '2px' }}>
                <span className="hint" style={{ margin: 0 }}>
                  리소스 카드 {resources.length}개
                </span>
                <button className="btn btn-danger-ghost" onClick={clearAllResources}>
                  전체 삭제
                </button>
              </div>
              {resources.map((entry) => (
                <ResourceCard
                  key={entry.uid}
                  entry={entry}
                  global={global}
                  onChange={(patch) => updateResource(entry.uid, patch)}
                  onRemove={() => removeResource(entry.uid)}
                  onDuplicate={() => duplicateResource(entry.uid)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="col-right">
          <div className="col-header">
            <span className="col-step">2</span>
            <div>
              <h2 className="col-title">검증 &amp; 산출물</h2>
              <p className="col-sub">정의를 점검하고, 실행용 점검 스크립트·CLI·JSON을 받습니다</p>
            </div>
          </div>

          <FindingsPanel findings={findings} alarmCount={specs.length} />
          <OutputPanel
            global={global}
            resources={resources}
            specs={specs}
            findings={findings}
            script={script}
            validatedRole={validatedRole}
            applyNonce={applyNonce}
            authenticated={auth.authenticated}
            authRequired={auth.configured}
          />
        </div>
      </div>

      <HelpWidget authenticated={auth.authenticated} />
    </div>
  );
}
