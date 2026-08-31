import { useMemo, useState } from 'react';
import { buildIntakePrompt, parseIntake, type IntakeApply } from '../lib/intake';
import { copyToClipboard } from '../lib/io';

interface Props {
  onApply: (result: IntakeApply) => void;
}

export function IntakePanel({ onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [resultJson, setResultJson] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const prompt = useMemo(() => buildIntakePrompt(text), [text]);

  function flash(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(''), 1800);
  }

  function apply() {
    setError('');
    try {
      onApply(parseIntake(resultJson));
    } catch (e) {
      setError(e instanceof Error ? e.message : '파싱 실패');
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>요구사항으로 시작 (AI)</h2>
        <button className="btn btn-ghost" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '열기'}
        </button>
      </div>

      {open && (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            고객 요구사항 문장을 붙여넣고 프롬프트를 복사 → AI에 붙여넣어 JSON을 받고 → 아래에
            붙여넣어 "적용"하면 리소스·지표가 자동으로 채워집니다. AI는 JSON만 만들고, 실제 알람은
            기존 생성기가 만듭니다.
          </p>

          <label className="field">
            <span>1. 고객 요구사항 (자연어)</span>
            <textarea
              rows={3}
              value={text}
              placeholder="예: prd-web EC2 i-0abc123def456789 CPU가 80% 넘으면 서울 리전 ops SNS로 알람 울리게 해주세요"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="actions">
            <button
              className="btn btn-primary"
              disabled={!text.trim()}
              onClick={async () => flash((await copyToClipboard(prompt)) ? '해석 프롬프트 복사됨' : '복사 실패')}
            >
              해석 프롬프트 복사
            </button>
            {msg && <span className="copied">{msg}</span>}
          </div>

          <label className="field" style={{ marginTop: 12 }}>
            <span>2. AI가 돌려준 JSON 붙여넣기</span>
            <textarea
              rows={4}
              className="mono"
              value={resultJson}
              placeholder='{ "global": {...}, "resources": [...], "unresolved": [...] }'
              onChange={(e) => setResultJson(e.target.value)}
            />
          </label>
          <div className="actions">
            <button className="btn btn-primary" disabled={!resultJson.trim()} onClick={apply}>
              결과 적용
            </button>
          </div>

          {error && <p className="inline-error">{error}</p>}
        </>
      )}
    </section>
  );
}
