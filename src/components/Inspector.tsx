import { volumeAt } from '../../shared/volume-automation.mjs';
import { sameVolumeCurve, setEffectiveVolume } from '../volume-editing';
import AudioVolumeAutomation from './AudioVolumeAutomation';
import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, RotateCcw, ChevronDown, Move, Scan, Palette, Volume2, Film, Type, Info, Lock } from 'lucide-react';
import { useEditor } from '../store';
import { normalizeClip, timecode } from '../model';
import { IconButton } from './UI';
import type { Clip } from '../types';
import TitleOpacity from './TitleOpacity';
import AudioEnhancement from './AudioEnhancement';
import TextEffects from './TextEffects';
import GraphicEffects from './GraphicEffects';
import { linkedIds, clipsLocked } from '../../shared/clip-links.mjs';
import { MAX_MEDIA_SECONDS } from '../../shared/time.mjs';

function NumericField({ clip, property, label, min, max, step = 1, factor = 1, offset = 0, suffix = '', slider = true }: { clip: Clip; property: keyof Clip; label: string; min: number; max: number; step?: number; factor?: number; offset?: number; suffix?: string; slider?: boolean }) {
  const playhead=useEditor(s=>property==='volume'?s.playhead:0);
  const active=useEditor(s=>property==='volume'?s.activeVolumePoint:null);
  const local=active?.clipId===clip.id?active.time:Math.max(0,Math.min(clip.duration,playhead-clip.start));
  if(property==='volume'&&(clip.volumeKeyframes?.length||active?.clipId===clip.id))max=400;
  const value = Number(clip[property]) * (property==='volume'?volumeAt(clip.volumeKeyframes||[],local):1) * factor + offset; const [draft, setDraft] = useState(String(Number(value.toFixed(2)))); const [focused, setFocused] = useState(false); const edited = useRef(false); const dragging = useRef(false); const changed = useRef(false);
  const volumeDrag=useRef<{state:ReturnType<typeof useEditor.getState>;clip:Clip;time:number;selected:boolean;owner:object}|null>(null);
  const finishVolumeDrag=(cancel=false)=>{
    const start=volumeDrag.current;if(!start)return;volumeDrag.current=null;dragging.current=false;
    const current=useEditor.getState(),now=current.project.clips.find(c=>c.id===start.clip.id);
    if(current.gestureOwner!==start.owner)return;
    if(changed.current&&(cancel||(now&&sameVolumeCurve(start.clip,now)))){
      const before=start.state;
      useEditor.setState({project:before.project,history:before.history,future:before.future,historyPlayheads:before.historyPlayheads,futurePlayheads:before.futurePlayheads,historyLabels:before.historyLabels,futureLabels:before.futureLabels,currentAction:before.currentAction,dirty:before.dirty,activeVolumePoint:before.activeVolumePoint});
    }
    current.endGesture(start.owner);changed.current=false;
  };
  useEffect(()=>{
    if(property!=='volume')return;
    const cancel=()=>finishVolumeDrag(true),escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&volumeDrag.current){e.preventDefault();cancel();}};
    const visibility=()=>{if(document.hidden)cancel();};
    window.addEventListener('blur',cancel);window.addEventListener('keydown',escape);document.addEventListener('visibilitychange',visibility);
    return()=>{cancel();window.removeEventListener('blur',cancel);window.removeEventListener('keydown',escape);document.removeEventListener('visibilitychange',visibility);};
  },[property]);
  useEffect(() => { if (!focused) setDraft(String(Number(value.toFixed(2)))); }, [value, focused]);
  const apply = (newValue: number) => {
    if (!Number.isFinite(newValue)) return; const s = useEditor.getState(); const current = s.project.clips.find(c => c.id === clip.id); const v = (Math.min(max, Math.max(min, newValue)) - offset) / factor;
    if (!current || s.project.tracks.find(t => t.id === current.trackId)?.locked || (property!=='volume'&&current[property] === v)) return;
    if (['start','in','duration','speed'].includes(property)&&clipsLocked(s.project,linkedIds(s.project,[clip.id]))){s.notify('リンク相手を含むトラックのロックを解除してください。');return;}
    const start=volumeDrag.current;
    if(s.gestureActive&&s.gestureOwner!==start?.owner)return;
    let patch:Partial<Clip>;try{patch=property==='volume'?setEffectiveVolume(start?.clip||current,start?.time??local,v,s.project.fps,start?.selected??(s.activeVolumePoint?.clipId===current.id)):{[property]:v};}catch(error){s.notify((error as Error).message);return;}
    if(property==='volume'&&sameVolumeCurve(current,{...current,...patch}))return;
    if (dragging.current) {
      if (!changed.current) { s.checkpoint(`${label}を変更`); changed.current = true; }
      const clips = s.project.clips.map(c => c.id === clip.id ? normalizeClip({ ...c, ...patch }, s.project) : c);
      s.transient({ ...s.project, clips });
    } else s.updateClip(clip.id, patch);
  };
  return <div className={`property-field ${slider ? '' : 'no-slider'}`}><div className="property-label"><label htmlFor={`prop-${property}`}>{label}</label><div className="number-wrap"><input id={`prop-${property}`} type="number" min={min} max={max} step={step} value={draft} onFocus={() => { setFocused(true); edited.current = false; }} onChange={e => { setDraft(e.target.value); edited.current = true; }} onBlur={() => { setFocused(false); const wasEdited = edited.current; edited.current = false; if (wasEdited && draft !== '' && Number(draft) !== value) apply(Number(draft)); else setDraft(String(Number(value.toFixed(2)))); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>{suffix}</span></div></div>{slider ? <input className="property-slider" type="range" aria-label={`${label}スライダー`} min={min} max={max} step={step} value={value} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} onPointerDown={e => { if(e.button!==0)return;const state=useEditor.getState();if(state.gestureActive)return;if(property==='volume'){const owner={};if(!state.beginGesture(owner,()=>finishVolumeDrag(true)))return;volumeDrag.current={state,clip,time:local,selected:state.activeVolumePoint?.clipId===clip.id,owner};}dragging.current=true;changed.current=false; }} onPointerUp={() => { finishVolumeDrag();dragging.current=false; }} onPointerCancel={() => { finishVolumeDrag(true);dragging.current=false; }} onLostPointerCapture={() => { finishVolumeDrag(true);dragging.current=false; }} onChange={e => apply(Number(e.target.value))}/> : null}</div>;
}
function Section({ title, icon: Icon, children, onReset, open = true }: { title: string; icon: typeof Move; children: React.ReactNode; onReset?: () => void; open?: boolean }) {
  return <details className="inspector-section" open={open}><summary><ChevronDown size={12}/><Icon size={14}/><span>{title}</span>{onReset ? <button className="reset-section" type="button" aria-label={`${title}をリセット`} title="リセット" onClick={e => { e.preventDefault(); onReset(); }}><RotateCcw size={12}/></button> : null}</summary><div className="section-properties">{children}</div></details>;
}
export default function Inspector() {
  const p = useEditor(s => s.project); const selected = useEditor(s => s.selected); const tab = useEditor(s => s.inspectorTab);
  const clip = p.clips.find(c => c.id === selected[0]); const asset = p.assets.find(a => a.id === clip?.assetId);
  const track = p.tracks.find(t => t.id === clip?.trackId);
  const textEdit = useRef<string | null>(null);
  const editText = (property: 'name' | 'text', value: string) => {
    const s = useEditor.getState(); const current = s.project.clips.find(c => c.id === clip?.id);
    if (!current || s.project.tracks.find(t => t.id === current.trackId)?.locked || current[property] === value) return;
    const key = `${current.id}:${property}`;
    if (textEdit.current !== key) { s.checkpoint(property === 'text' ? 'テロップの文字を変更' : 'クリップ名を変更'); textEdit.current = key; }
    s.transient({ ...s.project, clips: s.project.clips.map(c => c.id === current.id ? { ...c, [property]: value } : c) });
  };
  const patch = (values: Partial<Clip>) => { if (clip) useEditor.getState().updateClip(clip.id, values); };
  return <aside className="inspector-panel panel"><div className="panel-heading"><div className="panel-title"><SlidersHorizontal size={15}/><span>プロパティ</span></div><span className="inspector-count">{selected.length ? `${selected.length} 選択` : '選択なし'}</span></div>
    {clip ? <><div className="inspector-clip"><span className={`inspector-clip-icon ${clip.kind}`}>{clip.kind === 'title' ? <Type size={18}/> : clip.kind === 'audio' ? <Volume2 size={18}/> : <Film size={18}/>}</span><div><input aria-label="クリップ名" value={clip.name} disabled={track?.locked} onFocus={() => { textEdit.current = null; }} onBlur={() => { textEdit.current = null; }} onChange={e => editText('name', e.target.value)}/><span>{clip.graphic ? '図形レイヤー' : clip.kind === 'title' ? 'テキストレイヤー' : asset?.codec?.toUpperCase() || 'MEDIA'} <span>·</span> {timecode(clip.duration, p.fps)}</span></div>{track?.locked ? <Lock size={15}/> : null}</div><div className="inspector-tabs">{[{ id: 'video', label: clip.graphic ? '図形' : clip.kind === 'title' ? 'テキスト' : 'ビデオ' }, { id: 'color', label: 'カラー' }, { id: 'audio', label: 'オーディオ' }].map(t => <button className={tab === t.id ? 'selected' : ''} key={t.id} onClick={() => useEditor.getState().setInspectorTab(t.id as typeof tab)}>{t.label}</button>)}</div>
    <div className="inspector-content"><fieldset disabled={track?.locked}>
      {tab === 'video' ? <>
        {clip.graphic ? <Section title="図形" icon={Move}><GraphicEffects clip={clip}/></Section> : null}
        {clip.kind === 'title' && !clip.graphic ? <Section title="テキスト" icon={Type}><textarea aria-label="テロップのテキスト" rows={3} maxLength={4000} value={clip.text} onFocus={() => { textEdit.current = null; }} onBlur={() => { textEdit.current = null; }} onChange={e => editText('text', e.target.value)}/><div className="property-label"><label htmlFor="text-style">スタイル</label><select id="text-style" value={clip.textStyle} onChange={e => patch({ textStyle: e.target.value as Clip['textStyle'] })}><option value="hero">シネマタイトル</option><option value="minimal">ミニマル</option><option value="subtitle">字幕</option></select></div><NumericField clip={clip} property="fontSize" label="文字サイズ" min={16} max={240} suffix="px"/><TextEffects key={clip.id} clip={clip}/><div className="property-label"><label htmlFor="text-color">文字色</label><div className="color-field"><span>{clip.color.toUpperCase()}</span><input id="text-color" type="color" value={clip.color} onChange={e => patch({ color: e.target.value })}/></div></div></Section> : null}
        {clip.kind !== 'audio' ? <Section title="トランスフォーム" icon={Move} onReset={() => patch({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 })}><div className="position-fields"><NumericField clip={clip} property="x" label="位置 X" min={clip.kind === 'title' ? -p.width * 1.5 : -200} max={clip.kind === 'title' ? p.width * 2.5 : 200} factor={clip.kind === 'title' ? p.width / 100 : 1} offset={clip.kind === 'title' ? p.width / 2 : 0} step={clip.kind === 'title' ? 1 : 0.1} suffix={clip.kind === 'title' ? 'px' : '%'} slider={false}/><NumericField clip={clip} property="y" label="位置 Y" min={clip.kind === 'title' ? -p.height * 1.5 : -200} max={clip.kind === 'title' ? p.height * 2.5 : 200} factor={clip.kind === 'title' ? p.height / 100 : 1} offset={clip.kind === 'title' ? p.height / 2 : 0} step={clip.kind === 'title' ? 1 : 0.1} suffix={clip.kind === 'title' ? 'px' : '%'} slider={false}/></div><NumericField clip={clip} property="scale" label="スケール" min={10} max={300} factor={100} suffix="%"/><NumericField clip={clip} property="rotation" label="回転" min={-180} max={180} suffix="°"/>{clip.opacityKeyframes?.length ? <p className="field-help">不透明度は下のキーフレームで変化します。すべて削除すると基本値 {Math.round(clip.opacity * 100)}% に戻ります。</p> : <NumericField clip={clip} property="opacity" label="不透明度" min={0} max={100} factor={100} suffix="%"/>}</Section> : null}
        {clip.kind === 'title' ? <Section title="不透明度キーフレーム" icon={Scan}><TitleOpacity key={clip.id} clip={clip} fps={p.fps}/></Section> : null}
        <Section title="タイミング" icon={Film}><NumericField clip={clip} property="start" label="開始時間" min={0} max={MAX_MEDIA_SECONDS} step={1 / p.fps} suffix="秒" slider={false}/><NumericField clip={clip} property="duration" label="長さ" min={1 / p.fps} max={MAX_MEDIA_SECONDS} step={1 / p.fps} suffix="秒" slider={false}/>{clip.kind === 'video' || clip.kind === 'audio' ? <><NumericField clip={clip} property="in" label="素材の開始位置" min={0} max={asset?.duration || MAX_MEDIA_SECONDS} step={1 / p.fps} suffix="秒" slider={false}/><div className="property-label"><label htmlFor="playback-speed">再生速度</label><select id="playback-speed" value={clip.speed} onChange={e => patch({ speed: Number(e.target.value) })}>{[...new Set([0.25,0.5,0.75,1,1.25,1.5,2,3,4,clip.speed])].sort((a,b)=>a-b).map(v => <option value={v} key={v}>{v === 1 ? '1× 標準' : `${Number(v.toFixed(3))}×`}</option>)}</select></div></> : null}</Section>
        <Section title="フェード" icon={Scan}><NumericField clip={clip} property="fadeIn" label="フェードイン" min={0} max={Math.min(10, clip.duration)} step={0.1} suffix="秒"/><NumericField clip={clip} property="fadeOut" label="フェードアウト" min={0} max={Math.min(10, clip.duration)} step={0.1} suffix="秒"/><p className="field-help">{clip.audioDetached ? '映像に反映されます。音声のフェードは音声クリップで調整します。' : '映像と音声に反映されます。'}</p></Section>
      </> : null}
      {tab === 'color' ? clip.kind === 'audio' || clip.kind === 'title' ? <div className="inspector-empty-small"><Palette size={24}/><p>色調整する映像・画像クリップを選択してください。</p></div> : <><Section title="基本補正" icon={Palette} onReset={() => patch({ exposure: 0, contrast: 1, saturation: 1 })}><NumericField clip={clip} property="exposure" label="露出" min={-2} max={2} step={0.01} suffix="EV"/><NumericField clip={clip} property="contrast" label="コントラスト" min={0} max={200} factor={100} suffix="%"/><NumericField clip={clip} property="saturation" label="彩度" min={0} max={200} factor={100} suffix="%"/></Section><div className="color-advice"><span className="eyebrow">COLOR YOUR STORY</span><p>色は、物語の温度。</p><small>左のエフェクトパネルから6種類のルックを適用できます。</small><button className="secondary-button" onClick={() => useEditor.getState().setPanel('effects')}>ルックを選ぶ</button></div></> : null}
      {tab === 'audio' ? clip.audioDetached ? <div className="inspector-empty-small"><Volume2 size={24}/><p>音声は別トラックにあります。音声クリップを選択して調整してください。</p>{clip.linkId ? <button className="secondary-button" onClick={()=>useEditor.getState().select(p.clips.filter(c=>c.linkId===clip.linkId&&c.kind==='audio').map(c=>c.id))}>リンクした音声を選択</button> : null}</div> : !asset?.hasAudio ? <div className="inspector-empty-small"><Volume2 size={24}/><p>このクリップに音声はありません。</p></div> : <><AudioEnhancement key={clip.id} clip={clip}/><AudioVolumeAutomation clip={clip}/>{clip.audioMuted ? <p className="field-help">このクリップはミュート中です。<button className="text-button" onClick={()=>useEditor.getState().patchAudio({audioMuted:false},[clip.id])}>ミュートを解除</button></p> : null}<Section title="ボリューム" icon={Volume2} onReset={() => patch({ volume: 1, volumeKeyframes:[] })}><NumericField clip={clip} property="volume" label="音量" min={0} max={200} factor={100} suffix="%"/><p className="field-help">音量ラインと同じ音量です。丸を選択中はその点、それ以外は再生ヘッドの位置を調整します。</p></Section><Section title="オーディオフェード" icon={Scan}><NumericField clip={clip} property="fadeIn" label="フェードイン" min={0} max={Math.min(10,clip.duration)} step={0.1} suffix="秒"/><NumericField clip={clip} property="fadeOut" label="フェードアウト" min={0} max={Math.min(10,clip.duration)} step={0.1} suffix="秒"/></Section><p className="audio-info">トラックの M（ミュート）と S（ソロ）は、プレビューと書き出しの両方に反映されます。</p></> : null}
      {asset ? <Section title="素材の情報" icon={Info} open={false}><dl className="asset-details"><dt>ファイル</dt><dd>{asset.name}</dd><dt>サイズ</dt><dd>{(asset.size / 1024 / 1024).toFixed(1)} MB</dd><dt>解像度</dt><dd>{asset.width} × {asset.height}</dd><dt>素材の長さ</dt><dd>{timecode(asset.duration,p.fps)}</dd>{asset.proxy ? <><dt>プレビュー</dt><dd>プロキシ使用中</dd></> : null}</dl></Section> : null}
    </fieldset></div></> : <div className="inspector-empty"><SlidersHorizontal size={32}/><h3>細部まで、思いどおりに。</h3><p>タイムラインのクリップを選択すると、<br/>映像や音声を調整できます。</p><span>SELECT A CLIP TO GET STARTED</span></div>}
  </aside>;
}
