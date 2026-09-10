import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import type { Clip } from '../types';
import { fonts, fontEntry, fontStyle } from '../../shared/text-style.mjs';
import { ensureFont } from '../fonts';
import TextBoxControls from './TextBoxControls';

export default function TextEffects({ clip }: { clip: Clip }) {
  const [search, setSearch] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const font = fontStyle(clip), entry = fontEntry(font.family)!;
  const patch = (values: Partial<Clip>) => useEditor.getState().updateClip(clip.id, values);
  const changeFont = async (family: string, weight: number) => {
    const snapshot = useEditor.getState().project.id; setBusy(true); setStatus('フォントを読み込んでいます…');
    try {
      await ensureFont(family, weight);
      if (alive.current && useEditor.getState().project.id === snapshot) { patch({ fontFamily: family, fontWeight: weight }); setStatus(''); }
    } catch (error) { if (alive.current) setStatus((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { if (alive.current) setBusy(false); }
  };
  const color = (property: 'shadowColor' | 'strokeColor', label: string) => <div className="property-label"><label htmlFor={property}>{label}</label><input id={property} type="color" value={clip[property] || '#000000'} onChange={e => patch({ [property]: e.target.value })}/></div>;
  const number = (property: 'shadowBlur' | 'shadowDistance' | 'strokeWidth', label: string, fallback: number, max: number) => <label className="text-effect-size">{label}<input type="number" min={0} max={max} step={1} key={`${clip.id}-${property}-${clip[property]}`} defaultValue={clip[property] ?? fallback} onBlur={e => { const value = Number(e.currentTarget.value); if (e.currentTarget.value !== '' && Number.isFinite(value)) patch({ [property]: Math.max(0, Math.min(max, value)) }); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></label>;
  return <div className="text-effects">
    <label htmlFor="title-font">日本語フォント</label><input className="font-picker-search" aria-label="日本語フォントを検索" placeholder="フォント名で検索（Noto、Zen など）" value={search} onChange={e => setSearch(e.target.value)}/>
    <select id="title-font" value={font.family} disabled={busy} onChange={e => { const family = e.target.value, candidate = fontEntry(family)!; const weight = candidate.weights.reduce((best, next) => Math.abs(next - font.weight) < Math.abs(best - font.weight) ? next : best); void changeFont(family, weight); }}>
      {fonts.filter(f => f.family === font.family || `${f.family} ${f.label}`.toLowerCase().includes(search.trim().toLowerCase())).map(f => <option key={f.family} value={f.family}>{f.label}</option>)}
    </select><div className="property-label"><label htmlFor="title-weight">文字の太さ</label><select id="title-weight" value={font.weight} disabled={busy} onChange={e => void changeFont(font.family, Number(e.target.value))}>{[...new Set([...entry.weights, font.weight])].sort((a,b) => a-b).map(w => <option key={w} value={w}>{w}{w === 400 ? ' 標準' : w === 700 ? ' 太字' : ''}</option>)}</select></div>
    <p className="field-help">Google Fontsの日本語68書体。Noto Sans Japaneseは同梱済みです。ほかの書体は初回にダウンロードし、次回からオフラインでも使えます。</p>
    {status ? <p className="font-progress" role="status">{status}</p> : null}
    <details><summary>影・縁取りを調整</summary><label className="text-effect-toggle"><input type="checkbox" checked={clip.textShadow !== false} onChange={e => patch({ textShadow: e.target.checked })}/>文字に影を付ける</label>
    {clip.textShadow !== false ? <>{color('shadowColor', '影の色')}{number('shadowBlur', '影のぼかし（px）', 12, 100)}{number('shadowDistance', '影の距離（px）', 4, 100)}</> : null}
    <label className="text-effect-toggle"><input type="checkbox" checked={!!clip.textStroke} onChange={e => patch({ textStroke: e.target.checked })}/>文字に縁取りを付ける</label>
    {clip.textStroke ? <>{color('strokeColor', '縁取りの色')}{number('strokeWidth', '縁取りの幅（px）', 3, 20)}</> : null}
    </details>
    {clip.textStyle === 'subtitle' ? <label className="text-effect-size">字幕の背景の濃さ（%）<input type="number" min={0} max={100} step={1} key={`${clip.id}-background-${clip.captionBackgroundOpacity}`} defaultValue={Math.round((clip.captionBackgroundOpacity ?? .65)*100)} onBlur={e=>{const value=Number(e.currentTarget.value);if(e.currentTarget.value!==''&&Number.isFinite(value))patch({captionBackgroundOpacity:Math.max(0,Math.min(100,value))/100});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label> : null}
    <TextBoxControls clip={clip}/>
    <button className="secondary-button" onClick={() => patch({ x: 0, y: 0 })}>画面の中央に配置</button>
    <p className="field-help">プレビューの文字をドラッグして移動できます。位置X・Yには画面左上からのピクセル座標を表示します。</p>
  </div>;
}
