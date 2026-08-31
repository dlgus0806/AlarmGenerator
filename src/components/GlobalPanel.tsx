import { useRef } from 'react';
import type { GlobalConfig, TagPair } from '../types';
import { REGIONS } from '../lib/io';

interface Props {
  value: GlobalConfig;
  onChange: (next: GlobalConfig) => void;
  onImport: (file: File) => void;
  importError: string;
}

export function GlobalPanel({ value, onChange, onImport, importError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof GlobalConfig>(key: K, v: GlobalConfig[K]) =>
    onChange({ ...value, [key]: v });
  const patchTag = (i: number, patch: Partial<TagPair>) =>
    onChange({
      ...value,
      tags: value.tags.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>전역 설정</h2>
        <div className="row-gap">
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            JSON 불러오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {importError && <p className="inline-error">{importError}</p>}

      <div className="grid2">
        <label className="field">
          <span>prefix (선택)</span>
          <input
            value={value.prefix}
            placeholder="prd-was"
            onChange={(e) => set('prefix', e.target.value)}
          />
          <small>
            소문자·숫자·하이픈. 모든 알람 이름 앞에 붙습니다. 비워두면 접두사 없이 생성됩니다.
          </small>
        </label>

        <label className="field">
          <span>리전</span>
          <select value={value.region} onChange={(e) => set('region', e.target.value)}>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <small>CloudShell 리전과 일치해야 합니다.</small>
        </label>
      </div>

      <label className="field">
        <span className="row-between">
          <span>
            SNS Topic ARN {value.splitSeverity && '(critical)'} <em>필수</em>
          </span>
          <label className="checkline">
            <input
              type="checkbox"
              checked={value.splitSeverity}
              onChange={(e) => set('splitSeverity', e.target.checked)}
            />
            심각도별로 분리
          </label>
        </span>
        <input
          value={value.snsCritical}
          placeholder={`arn:aws:sns:${value.region}:111122223333:ops-alert`}
          onChange={(e) => set('snsCritical', e.target.value)}
        />
        <small>ARN의 리전이 위 리전과 다르면 알림이 가지 않습니다. 자동으로 검사합니다.</small>
      </label>

      {value.splitSeverity && (
        <label className="field">
          <span>
            SNS Topic ARN (warning) <em>필수</em>
          </span>
          <input
            value={value.snsWarning}
            placeholder={`arn:aws:sns:${value.region}:111122223333:ops-slack`}
            onChange={(e) => set('snsWarning', e.target.value)}
          />
        </label>
      )}

      <fieldset className="field">
        <span className="row-between">
          <span>태그 (선택)</span>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => set('tags', [...value.tags, { key: '', value: '' }])}
          >
            + 태그 추가
          </button>
        </span>

        {value.tags.length === 0 ? (
          <small>태그 없이 생성됩니다. 필요하면 키·값을 원하는 만큼 추가하세요.</small>
        ) : (
          value.tags.map((t, i) => (
            <div key={i} className="dim-row" style={{ marginTop: 6 }}>
              <label className="field">
                <input
                  value={t.key}
                  placeholder="Key (예: Owner)"
                  onChange={(e) => patchTag(i, { key: e.target.value })}
                />
              </label>
              <label className="field">
                <input
                  value={t.value}
                  placeholder="Value (예: platform-team)"
                  onChange={(e) => patchTag(i, { value: e.target.value })}
                />
              </label>
              <button
                className="btn btn-danger-ghost"
                type="button"
                onClick={() => set('tags', value.tags.filter((_, idx) => idx !== i))}
              >
                삭제
              </button>
            </div>
          ))
        )}
      </fieldset>

      <fieldset className="field">
        <span>알람 이름</span>
        <div className="radio-row">
          <label className="checkline">
            <input
              type="radio"
              name="naming"
              checked={value.namingMode === 'auto'}
              onChange={() => set('namingMode', 'auto')}
            />
            자동 생성 (권장)
          </label>
          <label className="checkline">
            <input
              type="radio"
              name="naming"
              checked={value.namingMode === 'manual'}
              onChange={() => set('namingMode', 'manual')}
            />
            직접 입력 허용
          </label>
        </div>
        <small>
          이름에는 임계값을 넣지 않습니다. put-metric-alarm은 이름 기준 upsert이므로, 이름에
          임계값이 있으면 값을 조정할 때 갱신이 아니라 새 알람이 생기고 옛 알람이 남습니다.
        </small>
      </fieldset>
    </section>
  );
}
