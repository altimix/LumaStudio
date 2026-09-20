import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import type { Clip } from '../types';
import { fonts, fontEntry, fontStyle } from '../../shared/text-style.mjs';
import { ensureFont } from '../fonts';
import TextBoxControls from './TextBoxControls';
import ColorField from './ColorField';
import { NumericField } from './ClipPropertyFields';

export default function TextEffects({ clip }: { clip: Clip }) {
  const [search, setSearch] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const font = fontStyle(clip), entry = fontEntry(font.family)!;
  const patch = (values: Partial<Clip>) => useEditor.getState().updateClip(clip.id, values);
  const changeFont = async (family: string, weight: number) => {
    const snapshot = useEditor.getState(); setBusy(true); setStatus('フォントを読み込んでいます…');
    try {
      await ensureFont(family, weight);
      const current=useEditor.getState();
      if (alive.current && current.project === snapshot.project && current.playhead===snapshot.playhead) { patch({ fontFamily: family, fontWeight: weight }); setStatus(''); }
      else if(alive.current)setStatus('編集位置が変わったため、フォントの変更を取り消しました。');
    } catch (error) { if (alive.current) setStatus((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { if (alive.current) setBusy(false); }
  };
  const color = (property: 'shadowColor' | 'strokeColor', label: string) => <ColorField id={property} label={label} value={clip[property] || '#000000'} onChange={value => patch({ [property]: value })}/>;
  const number = (property: 'shadowBlur' | 'shadowDistance' | 'strokeWidth', label: string, fallback: number, max: number) => <NumericField clip={clip} property={property} label={label} fallback={fallback} min={0} max={max} suffix="px"/>;
  return <div className="text-effects">
    <label htmlFor="title-font">日本語フォント</label><input className="font-picker-search" aria-label="日本語フォントを検索" placeholder="フォント名で検索（Noto、Zen など）" value={search} onChange={e => setSearch(e.target.value)}/>
    <select id="title-font" value={font.family} disabled={busy} onChange={e => { const family = e.target.value, candidate = fontEntry(family)!; const weight = candidate.weights.reduce((best, next) => Math.abs(next - font.weight) < Math.abs(best - font.weight) ? next : best); void changeFont(family, weight); }}>
      {fonts.filter(f => f.family === font.family || `${f.family} ${f.label}`.toLowerCase().includes(search.trim().toLowerCase())).map(f => <option key={f.family} value={f.family}>{f.label}</option>)}
    </select><div className="property-label"><label htmlFor="title-weight">文字の太さ</label><select id="title-weight" value={font.weight} disabled={busy} onChange={e => void changeFont(font.family, Number(e.target.value))}>{[...new Set([...entry.weights, font.weight])].sort((a,b) => a-b).map(w => <option key={w} value={w}>{w}{w === 400 ? ' 標準' : w === 700 ? ' 太字' : ''}</option>)}</select></div>
    <p className="field-help">Google Fontsの日本語68書体。Noto Sans Japaneseは同梱済みです。ほかの書体は初回にダウンロードし、次回からオフラインでも使えます。</p>
    {status ? <p className="font-progress" role="status">{status}</p> : null}
    <details><summary>影・縁取りを調整</summary><label className="text-effect-toggle"><input type="checkbox" checked={clip.textShadow !== false} onChange={e => patch({ textShadow: e.target.checked })}/>文字に影を付ける</label>
    {clip.textShadow !== false ? <>{color('shadowColor', '影の色')}{number('shadowBlur', '影のぼかし', clip.fontSize*.22, 100)}{number('shadowDistance', '影の距離', clip.fontSize*.035, 100)}</> : null}
    <label className="text-effect-toggle"><input type="checkbox" checked={!!clip.textStroke} onChange={e => patch({ textStroke: e.target.checked })}/>文字に縁取りを付ける</label>
    {clip.textStroke ? <>{color('strokeColor', '縁取りの色')}{number('strokeWidth', '縁取りの幅', 3, 20)}</> : null}
    </details>
    {clip.textStyle === 'subtitle' ? <NumericField clip={clip} property="captionBackgroundOpacity" label="字幕の背景の濃さ" fallback={.65} min={0} max={100} factor={100} suffix="%"/> : null}
    <TextBoxControls clip={clip}/>
    <button className="secondary-button" onClick={() => patch({ x: 0, y: 0 })}>画面の中央に配置</button>
    <p className="field-help">プレビューの文字をドラッグして移動できます。位置X・Yには画面左上からのピクセル座標を表示します。</p>
  </div>;
}
