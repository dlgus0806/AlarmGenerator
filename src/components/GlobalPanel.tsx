import { useRef, useState } from 'react';
import type { GlobalConfig, TagPair } from '../types';
import { REGIONS, REGION_NAMES } from '../lib/io';

interface Props {
  value: GlobalConfig;
  onChange: (next: GlobalConfig) => void;
  onImport: (file: File) => void;
  importError: string;
}

/**
 * 전역 설정.
 *  - 리전 · SNS Topic ARN: 알람 생성에 필수라 항상 펼쳐 둔다.
 *  - prefix · 태그 · 알람 이름 방식: 기본값으로도 동작하므로 같은 패널 안에서 접어 둔다.
 */
export function GlobalPanel({ value, onChange, onImport, importError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  // 패널 전체 접기(기본 펼침). 접으면 현재 값을 배지 한 줄로 요약한다.
  const [open, setOpen] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);

  const set = <K extends keyof GlobalConfig>(key: K, v: GlobalConfig[K]) =>
    onChange({ ...value, [key]: v });
  const patchTag = (i: number, patch: Partial<TagPair>) =>
    onChange({
      ...value,
      tags: value.tags.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
    });

  const snsList = value.snsTopics.length === 0 ? [''] : value.snsTopics;
  const filledTags = value.tags.filter((t) => t.key.trim()).length;
  const validSns = value.snsTopics.filter((t) => t.trim()).length;

  return (
    <section className="panel global-panel">
      <div className="panel-head">
        <h2>전역 설정</h2>
        <div className="row-gap">
          <button
            className="btn btn-ghost"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '접기' : '펼치기'}
          </button>
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

      {/* 접힘: 현재 설정 요약. SNS 가 없으면 빨간 배지로 경고 */}
      {!open && (
        <div className="global-summary">
          <span className="badge">
            {value.region}
            {REGION_NAMES[value.region] ? ` · ${REGION_NAMES[value.region]}` : ''}
          </span>
          <span className={`badge ${validSns === 0 ? 'badge-err' : ''}`}>
            {validSns === 0 ? 'SNS 미설정' : `SNS ${validSns}개`}
          </span>
          <span className="badge">
            {value.prefix.trim() ? `prefix ${value.prefix.trim()}` : 'prefix 없음'}
          </span>
          <span className="badge">태그 {filledTags}개</span>
          <span className="badge">이름 {value.namingMode === 'auto' ? '자동' : '직접'}</span>
        </div>
      )}

      {open && (
      <>
      {/* 필수: 리전(왼쪽) · SNS Topic ARN(오른쪽) 한 줄 배치 — 세로 길이를 줄인다 */}
      <div className="global-required">
      <label className="field region-field">
        <span>
          리전  <em> 필수</em>
        </span>
        <select value={value.region} onChange={(e) => set('region', e.target.value)}>
          {/* JSON 으로 목록 밖 리전을 불러온 경우에도 값이 사라지지 않도록 그대로 노출 */}
          {value.region && !REGIONS.includes(value.region) && (
            <option value={value.region}>{value.region}</option>
          )}
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r} · {REGION_NAMES[r]}
            </option>
          ))}
        </select>
        <small>CloudShell, SNS 리전과 일치해야 합니다.</small>
      </label>

      {/* 필수: SNS Topic ARN */}
      <fieldset className="field">
        <span className="row-between">
          <span>
            SNS Topic ARN <em>필수</em>
          </span>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => set('snsTopics', [...value.snsTopics, ''])}
          >
            + SNS 추가
          </button>
        </span>

        {snsList.map((arn, i) => (
          <div key={i} className="dim-row sns-row" style={{ marginTop: i === 0 ? 0 : 6 }}>
            <label className="field">
              <input
                value={arn}
                placeholder={`arn:aws:sns:${value.region}:111122223333:ops-alert`}
                onChange={(e) =>
                  set('snsTopics', snsList.map((t, idx) => (idx === i ? e.target.value : t)))
                }
              />
            </label>
            {snsList.length > 1 && (
              <button
                className="btn btn-danger-ghost"
                type="button"
                onClick={() => set('snsTopics', value.snsTopics.filter((_, idx) => idx !== i))}
              >
                삭제
              </button>
            )}
          </div>
        ))}
      </fieldset>
      </div>

      {/* 선택: 추가 설정 (같은 패널 안에서 접기) */}
      <button
        type="button"
        className="more-toggle"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((v) => !v)}
      >
        <span className="more-caret">{moreOpen ? '▾' : '▸'}</span>
        추가 설정
        {!moreOpen && (
          <span className="more-summary">
            {value.prefix.trim() ? `prefix ${value.prefix.trim()}` : 'prefix 없음'} · 태그 {filledTags}개 ·
            이름 {value.namingMode === 'auto' ? '자동' : '직접'}
          </span>
        )}
      </button>

      {moreOpen && (
        <div className="more-body">
          <label className="field">
            <span>prefix (선택)</span>
            <input
              value={value.prefix}
              placeholder="prd-was"
              onChange={(e) => set('prefix', e.target.value)}
            />
            <small>소문자·숫자·하이픈. 알람 이름 앞에 붙고, 비우면 생략됩니다.</small>
          </label>

          <fieldset className="field">
            <span className="row-between">
              <span>Tag (선택)</span>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => set('tags', [...value.tags, { key: '', value: '' }])}
              >
                + Tag 추가
              </button>
            </span>

            {value.tags.length === 0 ? (
              <small>태그 없이 생성됩니다. 필요하면 키·값을 추가하세요.</small>
            ) : (
              value.tags.map((t, i) => (
                <div key={i} className="dim-row tag-row" style={{ marginTop: 6 }}>
                  <label className="field">
                    <input
                      value={t.key}
                      placeholder="Key"
                      onChange={(e) => patchTag(i, { key: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <input
                      value={t.value}
                      placeholder="Value"
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

          <fieldset className="field" style={{ marginBottom: 0 }}>
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
                직접 입력
              </label>
            </div>
          </fieldset>
        </div>
      )}
      </>
      )}
    </section>
  );
}
