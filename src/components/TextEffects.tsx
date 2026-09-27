import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Search } from 'lucide-react';
import './text-properties.css';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import type { Clip } from '../types';
import { fonts, fontEntry, fontStyle } from '../../shared/text-style.mjs';
import { ensureFont } from '../fonts';
import TextBoxControls from './TextBoxControls';
import ColorField from './ColorField';
import { NumericField } from './ClipPropertyFields';

export default function TextEffects({ clip }: { clip: Clip }) {
  const [search, setSearch] = useState(''), [searchOpen, setSearchOpen] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
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
  return <div className="text-effects" onFocusCapture={()=>useEditor.getState().stop()}>
    <div className="text-font-row">
      <select id="title-font" aria-label="日本語フォント" value={font.family} disabled={busy} onChange={e => { const family = e.target.value, candidate = fontEntry(family)!; const weight = candidate.weights.reduce((best, next) => Math.abs(next - font.weight) < Math.abs(best - font.weight) ? next : best); void changeFont(family, weight); }}>
        {fonts.filter(f => f.family === font.family || `${f.family} ${f.label}`.toLowerCase().includes(search.trim().toLowerCase())).map(f => <option key={f.family} value={f.family}>{f.label}</option>)}
      </select>
      <button type="button" className="icon-button" aria-label="フォント検索を切り替え" title="フォントを検索" aria-expanded={searchOpen} aria-controls="text-font-search" onClick={()=>{setSearchOpen(!searchOpen);if(searchOpen)setSearch('');}}><Search size={14}/></button>
    </div>
    {searchOpen?<input id="text-font-search" className="font-picker-search" aria-label="日本語フォントを検索" placeholder="フォントを検索" value={search} onChange={e=>setSearch(e.target.value)}/>:null}
    <div className="text-format-row">
      <div className="property-label"><label htmlFor="title-weight">文字の太さ</label><select id="title-weight" value={font.weight} disabled={busy} onChange={e => void changeFont(font.family, Number(e.target.value))}>{[...new Set([...entry.weights, font.weight])].sort((a,b) => a-b).map(w => <option key={w} value={w}>{w}{w === 400 ? ' 標準' : w === 700 ? ' 太字' : ''}</option>)}</select></div>
      <NumericField clip={clip} property="fontSize" label="文字サイズ" min={16} max={240} suffix="px"/>
    </div>
    <div className="text-format-row text-color-style">
      <ColorField id="text-color" label="文字色" value={clip.color} onChange={color=>patch({color})}/>
      <div className="property-label"><label htmlFor="text-style">スタイル</label><select id="text-style" value={clip.textStyle} onChange={e=>patch({textStyle:e.target.value as Clip['textStyle']})}><option value="hero">タイトル</option><option value="minimal">ミニマル</option><option value="subtitle">字幕</option></select></div>
    </div>
    <div className="text-alignment" role="group" aria-label="文字揃え">
      {([{value:'left',label:'左揃え',short:'左',icon:AlignLeft},{value:'center',label:'中央揃え',short:'中央',icon:AlignCenter},{value:'right',label:'右揃え',short:'右',icon:AlignRight},{value:'justify',label:'均等割付',short:'均等',icon:AlignJustify}] as const).map(({value,label,short,icon:Icon})=><button type="button" key={value} aria-label={label} title={label} aria-pressed={(clip.textAlign??'center')===value} onFocus={()=>useEditor.setState({visualChannel:'textAlign'})} onClick={()=>patch({textAlign:value})}><Icon size={15}/><span>{short}</span></button>)}
    </div>
    {status ? <p className="font-progress" role="status">{status}</p> : null}
    <div className="text-decoration" role="group" aria-label="縁取り">
      <div className="text-decoration-heading"><label className="text-effect-toggle"><input type="checkbox" aria-label="文字に縁取りを付ける" checked={!!clip.textStroke} onChange={e=>patch({textStroke:e.target.checked})}/>縁取り</label>{color('strokeColor','縁取りの色')}</div>
      {clip.textStroke?number('strokeWidth','縁取りの幅',3,20):null}
    </div>
    <div className="text-decoration" role="group" aria-label="影">
      <div className="text-decoration-heading"><label className="text-effect-toggle"><input type="checkbox" aria-label="文字に影を付ける" checked={clip.textShadow!==false} onChange={e=>patch({textShadow:e.target.checked})}/>影</label>{color('shadowColor','影の色')}</div>
      {clip.textShadow!==false?<div className="text-format-row">{number('shadowBlur','影のぼかし',clip.fontSize*.22,100)}{number('shadowDistance','影の距離',clip.fontSize*.035,100)}</div>:null}
    </div>
    {clip.textStyle==='subtitle'?<NumericField clip={clip} property="captionBackgroundOpacity" label="字幕の背景の濃さ" fallback={.65} min={0} max={100} factor={100} suffix="%"/>:null}
    <TextBoxControls clip={clip}/>
    <button className="secondary-button text-center-position" onClick={()=>patch({x:0,y:0})}>画面の中央に配置</button>
  </div>;
}
