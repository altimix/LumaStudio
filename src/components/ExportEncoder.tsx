import { useEffect, useRef, useState } from 'react';
import type { EncoderCapabilities, ExportEncoder as Encoder } from '../types';
import './export-encoder.css';
export default function ExportEncoder({ value, onChange }: { value: Encoder; onChange(value: Encoder): void }) {
  const [capabilities, setCapabilities] = useState<EncoderCapabilities>(), [error, setError] = useState(''), [revision, setRevision] = useState(0), [checking, setChecking] = useState(true);
  const current = useRef({ value, onChange }); current.current = { value, onChange };
  useEffect(() => {
    let active = true; setChecking(true); setError('');
    if (!window.luma) { setChecking(false); return; }
    void window.luma.exportEncoders(revision > 0).then(result => {
      if (!active) return;
      setCapabilities(result);
      const selection = current.current;
      if (selection.value !== 'auto' && !result.encoders.some(e => e.id === selection.value && e.available)) {
        selection.onChange('auto'); setError('選択したGPUを使えないため、書き出し方式を「自動」に戻しました。');
      }
    }).catch(() => { if(active)setError('GPUを確認できませんでした。CPUを選ぶか、再確認してください。'); }).finally(() => { if(active)setChecking(false); });
    return () => { active = false; };
  }, [revision]);
  const chosen = capabilities?.encoders.find(e => e.available && e.id === (value === 'auto' ? capabilities.recommended : value));
  return <div className="encoder-settings"><label>書き出し方式<select aria-label="書き出し方式" value={value} onChange={e => onChange(e.target.value as Encoder)}><option value="auto">自動（おすすめ）</option><option value="cpu">CPU（ソフトウェア）</option>{capabilities?.encoders.filter(e => e.id !== 'cpu').map(e => <option key={e.id} value={e.id} disabled={!e.available}>{e.label}{e.available ? '' : ' — 利用不可'}</option>)}</select></label>
    <p className="field-help" role="status">{checking ? 'このPCで使えるGPUを確認しています…' : error || (chosen ? `使用予定：${chosen.label}` : 'デスクトップ版ではGPUを自動確認します。')}</p>
    <p className="field-help">対応GPUで映像の圧縮を高速化します。文字・映像の合成と音声処理にはCPUも使います。自動ではGPUが使えない場合にCPUへ切り替えます。</p>
    <button className="text-button" type="button" disabled={checking} onClick={() => setRevision(v => v + 1)}>GPUを再確認</button>
  </div>;
}
