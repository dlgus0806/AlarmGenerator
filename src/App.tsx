import { useMemo, useState } from 'react';
import type { AlarmTemplate, GlobalConfig, ResourceEntry } from './types';
import { CATALOG, getResourceType } from './catalog';
import { buildAlarms } from './lib/build';
import { generateCli } from './lib/generateCli';
import { countByLevel, validate } from './lib/validate';
import { parseProjectFile } from './lib/io';
import { useTheme } from './lib/theme';
import { applyTemplate, defaultSelection } from './lib/templates';
import { GlobalPanel } from './components/GlobalPanel';
import { TemplatePanel } from './components/TemplatePanel';
import { IntakePanel } from './components/IntakePanel';
import { DiscoveryPanel } from './components/DiscoveryPanel';
import type { IntakeApply } from './lib/intake';
import { ResourceCard } from './components/ResourceCard';
import { FindingsPanel } from './components/FindingsPanel';
import { OutputPanel } from './components/OutputPanel';
import { AuditPanel } from './components/AuditPanel';

/** 헤더 설명 문구. 여기만 고치면 됩니다. */
const HEADER_SUBTITLE =
  '토글로 고르면 CLI가 만들어집니다. AWS API는 호출하지 않습니다 — 실행은 CloudShell에서 직접 하세요.';

const DEFAULT_GLOBAL: GlobalConfig = {
  prefix: '',
  region: 'ap-northeast-2',
  snsCritical: '',
  snsWarning: '',
  splitSeverity: false,
  namingMode: 'auto',
  tags: [],
};

export default function App() {
  const { theme, toggle } = useTheme();
  const [global, setGlobal] = useState<GlobalConfig>(DEFAULT_GLOBAL);
  const [resources, setResources] = useState<ResourceEntry[]>([]);
  const [workloadNote, setWorkloadNote] = useState('');
  const [importError, setImportError] = useState('');

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
    setResources((prev) => [
      ...prev,
      {
        uid: crypto.randomUUID(),
        typeKey,
        resourceId: '',
        selected: defaultSelection(type),
      },
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

  function handleIntake(result: IntakeApply) {
    if (
      resources.length > 0 &&
      !window.confirm(`요구사항을 적용하면 현재 리소스 ${resources.length}개가 교체됩니다. 계속할까요?`)
    ) {
      return;
    }
    setGlobal((g) => ({ ...g, ...result.global }));
    setResources(result.resources);
    const notes = [
      ...result.unresolved.map((u) => `미확정 ${u.field}: ${u.reason}`),
      ...result.warnings,
    ];
    if (notes.length > 0) {
      window.alert('적용됨. 확인 필요:\n\n' + notes.join('\n'));
    }
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
  }

  return (
    <div className="app">
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
          <GlobalPanel
            value={global}
            onChange={setGlobal}
            onImport={handleImport}
            importError={importError}
          />

          <IntakePanel onApply={handleIntake} />

          <TemplatePanel resources={resources} onApply={handleApplyTemplate} />

          <DiscoveryPanel
            global={global}
            onAdd={(entries) => {
              // 이미 있는 (타입+리소스ID) 조합은 건너뛰고 추가
              setResources((prev) => {
                const seen = new Set(prev.map((r) => `${r.typeKey}|${r.resourceId}`));
                const fresh = entries.filter((e) => !seen.has(`${e.typeKey}|${e.resourceId}`));
                return [...prev, ...fresh];
              });
            }}
          />

          <section className="panel">
            <h2>리소스 추가</h2>
            <div className="type-buttons">
              {CATALOG.map((t) => (
                <button key={t.key} className="btn" onClick={() => addResource(t.key)}>
                  + {t.label}
                </button>
              ))}
            </div>
            <p className="hint">
              Aurora와 RDS PostgreSQL은 사용 가능한 지표가 다릅니다. Aurora에는{' '}
              <code>FreeStorageSpace</code>가 없고 <code>FreeLocalStorage</code>를 씁니다.
            </p>
          </section>

          {resources.length === 0 ? (
            <section className="panel empty">
              리소스를 추가하면 지표 토글이 나타납니다.
            </section>
          ) : (
            resources.map((entry) => (
              <ResourceCard
                key={entry.uid}
                entry={entry}
                global={global}
                onChange={(patch) => updateResource(entry.uid, patch)}
                onRemove={() => removeResource(entry.uid)}
                onDuplicate={() => duplicateResource(entry.uid)}
              />
            ))
          )}
        </div>

        <div className="col-right">
          <FindingsPanel findings={findings} />
          <OutputPanel
            global={global}
            resources={resources}
            specs={specs}
            findings={findings}
            script={script}
            workloadNote={workloadNote}
            onWorkloadNoteChange={setWorkloadNote}
          />
          <AuditPanel global={global} specs={specs} />
        </div>
      </div>
    </div>
  );
}
