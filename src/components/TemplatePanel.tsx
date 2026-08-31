import { useMemo, useRef, useState } from 'react';
import type { AlarmTemplate, ResourceEntry } from '../types';
import {
  builtinTemplates,
  deleteUserTemplate,
  hasChoices,
  loadUserTemplates,
  parseTemplate,
  templateToJson,
  toTemplate,
  upsertUserTemplate,
} from '../lib/templates';
import { getResourceType } from '../catalog';
import { downloadText } from '../lib/io';

interface Props {
  resources: ResourceEntry[];
  onApply: (t: AlarmTemplate, choices: Record<number, string>) => void;
}

function summarize(t: AlarmTemplate): string {
  const parts = t.resources.map((r) => {
    if (r.choose && r.choose.length > 0) return 'RDS(선택)';
    const label = getResourceType(r.typeKey)?.label ?? r.typeKey;
    const n = Object.keys(r.selected).length + (r.customMetrics?.length ?? 0);
    return `${label} ${n}`;
  });
  return parts.join(' · ') || '(빈 표준)';
}

export function TemplatePanel({ resources, onApply }: Props) {
  const builtins = useMemo(() => builtinTemplates(), []);
  const [userTemplates, setUserTemplates] = useState<AlarmTemplate[]>(() =>
    loadUserTemplates(),
  );
  const [msg, setMsg] = useState('');
  const [openChooser, setOpenChooser] = useState<string | null>(null);
  const [choiceState, setChoiceState] = useState<Record<number, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const all = [...builtins, ...userTemplates];
  const activeMetricCount = resources.reduce(
    (n, r) => n + Object.keys(r.selected).length + (r.customMetrics?.length ?? 0),
    0,
  );

  function flash(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(''), 2200);
  }

  function handleSave() {
    if (activeMetricCount === 0) {
      flash('저장할 지표가 없습니다. 먼저 지표를 켜세요.');
      return;
    }
    const name = window.prompt('표준 이름을 입력하세요', '우리 팀 표준');
    if (!name?.trim()) return;
    if (builtins.some((b) => b.name === name.trim())) {
      flash('기본 제공 표준과 같은 이름은 쓸 수 없습니다.');
      return;
    }
    setUserTemplates(upsertUserTemplate(toTemplate(name, resources)));
    flash(`"${name.trim()}" 저장됨`);
  }

  function handleDelete(name: string) {
    if (!window.confirm(`"${name}" 표준을 삭제할까요?`)) return;
    setUserTemplates(deleteUserTemplate(name));
  }

  function handleImport(file: File) {
    file
      .text()
      .then((raw) => {
        const t = parseTemplate(raw);
        setUserTemplates(upsertUserTemplate(t));
        flash(`"${t.name}" 불러옴`);
      })
      .catch((e: unknown) => flash(e instanceof Error ? e.message : '불러오기 실패'));
  }

  const idOf = (t: AlarmTemplate) => (t.builtin ? 'b:' : 'u:') + t.name;

  function handleApplyClick(t: AlarmTemplate) {
    if (!hasChoices(t)) {
      onApply(t, {});
      return;
    }
    const id = idOf(t);
    if (openChooser === id) {
      setOpenChooser(null);
      return;
    }
    const defaults: Record<number, string> = {};
    t.resources.forEach((r, i) => {
      if (r.choose && r.choose.length > 0) defaults[i] = r.choose[0];
    });
    setChoiceState(defaults);
    setOpenChooser(id);
  }

  function confirmApply(t: AlarmTemplate) {
    onApply(t, choiceState);
    setOpenChooser(null);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>표준 템플릿</h2>
        <div className="row-gap">
          <button className="btn btn-ghost" onClick={handleSave}>
            현재 구성을 표준으로 저장
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            표준 불러오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {msg && <p className="hint">{msg}</p>}

      <p className="hint" style={{ marginTop: 0 }}>
        표준을 적용하면 지표·임계값이 채워지고, 고객사 리소스 ID만 입력하면 됩니다. 팀 공유는
        내보내기 JSON을 Git에 커밋하세요.
      </p>

      <ul className="template-list">
        {all.map((t) => {
          const id = idOf(t);
          const chooserOpen = openChooser === id;
          return (
            <li key={id} className="template-row-wrap">
              <div className="template-row">
                <div className="template-info">
                  <span className="template-name">
                    {t.name}
                    {t.builtin && <span className="badge badge-quiet">기본</span>}
                  </span>
                  <span className="template-sum">{summarize(t)}</span>
                </div>
                <div className="row-gap">
                  <button className="btn" onClick={() => handleApplyClick(t)}>
                    {chooserOpen ? '닫기' : '적용'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      downloadText(`template-${t.name}.json`, templateToJson(t), 'application/json')
                    }
                  >
                    내보내기
                  </button>
                  {!t.builtin && (
                    <button className="btn btn-danger-ghost" onClick={() => handleDelete(t.name)}>
                      삭제
                    </button>
                  )}
                </div>
              </div>

              {chooserOpen && (
                <div className="template-chooser">
                  {t.resources.map((r, i) =>
                    r.choose && r.choose.length > 0 ? (
                      <label key={i} className="field field-inline">
                        <span>RDS 엔진 선택</span>
                        <select
                          value={choiceState[i] ?? r.choose[0]}
                          onChange={(e) =>
                            setChoiceState((s) => ({ ...s, [i]: e.target.value }))
                          }
                        >
                          {r.choose.map((key) => (
                            <option key={key} value={key}>
                              {getResourceType(key)?.label ?? key}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null,
                  )}
                  <button className="btn btn-primary" onClick={() => confirmApply(t)}>
                    이 구성으로 적용
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
