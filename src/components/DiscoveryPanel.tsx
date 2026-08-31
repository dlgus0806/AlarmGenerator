import { useMemo, useState } from 'react';
import type { GlobalConfig, ResourceEntry } from '../types';
import { generateDiscovery } from '../lib/generateDiscovery';
import { parseDiscovery, toResourceEntries, type DiscoveredResource } from '../lib/discovery';
import { copyToClipboard, downloadText } from '../lib/io';

interface Props {
  global: GlobalConfig;
  onAdd: (entries: ResourceEntry[]) => void;
}

export function DiscoveryPanel({ global, onAdd }: Props) {
  const [showScript, setShowScript] = useState(false);
  const [pasted, setPasted] = useState('');
  const [found, setFound] = useState<DiscoveredResource[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const script = useMemo(() => generateDiscovery(global), [global]);
  const slug = global.prefix.trim() || 'discovery';

  // 대상 계정 (백엔드 allowlist와 일치). .env.local의 VITE_TEST_ACCOUNT로 설정.
  const TEST_ACCOUNT = import.meta.env.VITE_TEST_ACCOUNT ?? '123456789012';

  function flash(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(''), 1800);
  }

  function showList(list: DiscoveredResource[]) {
    setFound(list);
    setPicked(
      new Set(list.map((_, i) => i).filter((i) => !list[i].unsupported && list[i].typeKey)),
    );
  }

  function parse() {
    setError('');
    try {
      showList(parseDiscovery(pasted));
    } catch (e) {
      setFound(null);
      setError(e instanceof Error ? e.message : '파싱 실패');
    }
  }

  async function loadLive() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(
        `/api/discover?account=${TEST_ACCOUNT}&region=${encodeURIComponent(global.region)}`,
      );
      const text = await res.text();
      if (!res.ok) {
        const j = JSON.parse(text) as { error?: string };
        throw new Error(j.error ?? `백엔드 오류 (${res.status})`);
      }
      setPasted(text);
      showList(parseDiscovery(text));
      flash('라이브 불러옴');
    } catch (e) {
      setFound(null);
      const m = e instanceof Error ? e.message : String(e);
      setError(
        m.includes('fetch')
          ? '백엔드에 연결할 수 없습니다. 다른 터미널에서 `npm run server`를 실행하세요.'
          : m,
      );
    } finally {
      setLoading(false);
    }
  }

  function toggle(i: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function createCards() {
    if (!found) return;
    const selected = [...picked].map((i) => found[i]).filter((r) => r.typeKey);
    onAdd(toResourceEntries(selected));
    flash(`${selected.length}개 리소스 카드 생성됨`);
  }

  const selectableCount = found?.filter((r) => r.typeKey).length ?? 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>리소스 불러오기 (읽기 전용)</h2>
        {msg && <span className="copied">{msg}</span>}
      </div>

      <p className="hint" style={{ marginTop: 0 }}>
        라이브로 불러오거나(로컬 백엔드), CloudShell 스크립트 출력을 붙여넣어 리소스를 나열하고,
        체크로 골라 알람 카드를 만듭니다.
      </p>

      <div className="live-box">
        <div className="row-between">
          <span className="hint" style={{ margin: 0 }}>
            지금은 <code>{TEST_ACCOUNT}</code> 계정만 · 리전 <code>{global.region}</code>
          </span>
          <button className="btn btn-primary" onClick={loadLive} disabled={loading}>
            {loading ? '불러오는 중…' : '라이브 불러오기'}
          </button>
        </div>
      </div>

      <div className="audit-step" style={{ marginTop: 12 }}>
        <button className="btn btn-ghost" onClick={() => setShowScript((v) => !v)}>
          {showScript ? '▾' : '▸'} 또는 CloudShell 스크립트로 (백엔드 없이)
        </button>
        {showScript && (
          <>
            <pre className="code" style={{ maxHeight: '22vh' }}>
              {script}
            </pre>
            <div className="actions">
              <button
                className="btn"
                onClick={async () => flash((await copyToClipboard(script)) ? '복사됨' : '복사 실패')}
              >
                복사
              </button>
              <button
                className="btn"
                onClick={() => downloadText(`${slug}-discover.sh`, script, 'text/x-shellscript')}
              >
                다운로드 (.sh)
              </button>
            </div>
          </>
        )}
      </div>

      <label className="field" style={{ marginTop: 12 }}>
        <span>탐색 결과 붙여넣기 (JSON)</span>
        <textarea
          rows={4}
          className="mono"
          value={pasted}
          placeholder='{ "region": "ap-northeast-2", "ec2": [...], "rds": [...], "alb": [...] }'
          onChange={(e) => setPasted(e.target.value)}
        />
      </label>
      <div className="actions">
        <button className="btn btn-primary" disabled={!pasted.trim()} onClick={parse}>
          리소스 목록 보기
        </button>
      </div>

      {error && <p className="inline-error">{error}</p>}

      {found && (
        <>
          <p className="hint">
            {found.length}개 발견 · 카탈로그 지원 {selectableCount}개. 체크한 리소스로 카드를 만듭니다.
          </p>
          <ul className="discover-list">
            {found.map((r, i) => (
              <li key={i} className={`discover-row ${r.typeKey ? '' : 'unsupported'}`}>
                <label className="checkline">
                  <input
                    type="checkbox"
                    disabled={!r.typeKey}
                    checked={picked.has(i)}
                    onChange={() => toggle(i)}
                  />
                  <span className="discover-label">{r.label}</span>
                </label>
                <code className="discover-id">{r.resourceId}</code>
                <span className="discover-detail">
                  {r.unsupported ? `${r.detail} · ${r.unsupported}` : r.detail}
                </span>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="btn btn-primary" disabled={picked.size === 0} onClick={createCards}>
              선택한 리소스로 카드 생성
            </button>
          </div>
        </>
      )}
    </section>
  );
}
