import AudioVolumeAutomation from './AudioVolumeAutomation';
import { useRef } from 'react';
import { PanelRightClose, SlidersHorizontal, RotateCcw, ChevronDown, Move, Scan, Palette, Pipette, Volume2, Film, Type, Info, Lock } from 'lucide-react';
import { useEditor } from '../store';
import { timecode } from '../model';
import { navigatePanelTabs } from './UI';
import type { BezierVideoMask, ChromaKey, Clip, VideoMask } from '../types';
import VisualKeyframes from './VisualKeyframes';
import { visualClipAt, hasVisualKeys } from '../../shared/visual-keyframes.mjs';
import { localVisualTime } from '../visual-editing';
import AudioEnhancement from './AudioEnhancement';
import TextEffects from './TextEffects';
import GraphicEffects from './GraphicEffects';
import { MAX_MEDIA_SECONDS } from '../../shared/time.mjs';
import { clampCropEdge, DEFAULT_BEZIER_MASK, DEFAULT_VIDEO_MASK, EMPTY_CROP, MAX_BEZIER_MASK_POINTS } from '../../shared/video-mask.mjs';
import { DEFAULT_CHROMA_KEY } from '../../shared/chroma-key.mjs';
import ColorField from './ColorField';
import './mask-effects.css';
import './chroma-key.css';

import { NumericField, EffectField } from './ClipPropertyFields';
function CropMaskEffects({clip}:{clip:Clip}){
  const mode=useEditor(s=>s.mediaEditMode),crop=clip.crop||EMPTY_CROP,mask=clip.videoMask;
  const cropPatch=(key:keyof typeof EMPTY_CROP)=>(current:Clip,value:number)=>({crop:{...(current.crop||EMPTY_CROP),[key]:clampCropEdge(current.crop||EMPTY_CROP,key,value/100)}});
  const basicMaskPatch=(key:'x'|'y'|'width'|'height')=>(current:Clip,value:number)=>{
    const currentMask=current.videoMask?.type==='bezier'?DEFAULT_VIDEO_MASK:(current.videoMask||DEFAULT_VIDEO_MASK);
    return {videoMask:{...currentMask,[key]:value/100}};
  };
  const commonMaskPatch=(key:'feather')=>(current:Clip,value:number)=>({videoMask:{...(current.videoMask||DEFAULT_VIDEO_MASK),[key]:value/100} as VideoMask});
  const updateBezier=(change:(mask:BezierVideoMask)=>BezierVideoMask)=>{
    const state=useEditor.getState(),raw=state.project.clips.find(item=>item.id===clip.id),current=raw&&visualClipAt(raw,localVisualTime(raw,state.playhead,state.project.fps));
    if(current?.videoMask?.type==='bezier')state.updateClip(clip.id,{videoMask:change(current.videoMask)});
  };
  const changeMaskType=(type:string)=>{
    const state=useEditor.getState();
    let next:VideoMask|undefined;
    if(type==='none')next=undefined;
    else if(type==='bezier')next=mask?.type==='bezier'?mask:{...DEFAULT_BEZIER_MASK,points:[],feather:mask?.feather||0,inverted:mask?.inverted||false};
    else {
      const basic=mask&&mask.type!=='bezier'?mask:DEFAULT_VIDEO_MASK;
      next={...basic,type:type as 'rectangle'|'ellipse',feather:mask?.feather||0,inverted:mask?.inverted||false};
    }
    state.updateClip(clip.id,{videoMask:next});
    if(type==='none'&&state.mediaEditMode==='mask')state.setMediaEditMode('transform');
  };
  const setPointKind=(index:number,kind:'line'|'curve')=>updateBezier(current=>{
    const points=current.points.map((point,pointIndex)=>pointIndex!==index?point:kind==='line'?{...point,kind,inX:point.x,inY:point.y,outX:point.x,outY:point.y}:{...point,kind,inX:point.x-.08,inY:point.y,outX:point.x+.08,outY:point.y});
    return {...current,points};
  });
  return <>
    <Section title="クロップ" icon={Scan} open={!!clip.crop || mode==='crop'} onReset={()=>{const state=useEditor.getState();state.updateClip(clip.id,{crop:undefined});if(state.mediaEditMode==='crop')state.setMediaEditMode('transform');}}>
      <div className="mask-edit-buttons"><button className={'secondary-button '+(mode==='crop'?'active':'')} onClick={()=>useEditor.getState().setMediaEditMode(mode==='crop'?'transform':'crop')}>モニターでクロップ</button></div>
      <EffectField clip={clip} label="上" value={crop.top*100} min={0} max={(0.99-crop.bottom)*100} step={.1} suffix="%" channel="crop.top" patch={cropPatch('top')}/>
      <EffectField clip={clip} label="右" value={crop.right*100} min={0} max={(0.99-crop.left)*100} step={.1} suffix="%" channel="crop.right" patch={cropPatch('right')}/>
      <EffectField clip={clip} label="下" value={crop.bottom*100} min={0} max={(0.99-crop.top)*100} step={.1} suffix="%" channel="crop.bottom" patch={cropPatch('bottom')}/>
      <EffectField clip={clip} label="左" value={crop.left*100} min={0} max={(0.99-crop.right)*100} step={.1} suffix="%" channel="crop.left" patch={cropPatch('left')}/>
    </Section>
    <Section title="マスク" icon={Scan} open={!!mask} onReset={()=>{const state=useEditor.getState();state.updateClip(clip.id,{videoMask:undefined});if(state.mediaEditMode==='mask')state.setMediaEditMode('transform');}}>
      <div className="property-label"><label htmlFor="video-mask-type">形</label><select id="video-mask-type" value={mask?.type||'none'} onChange={e=>changeMaskType(e.target.value)}><option value="none">なし</option><option value="rectangle">長方形</option><option value="ellipse">楕円</option><option value="bezier">ベジェペン</option></select></div>
      {mask?<>
        <div className="mask-edit-buttons"><button className={'secondary-button '+(mode==='mask'?'active':'')} onClick={()=>useEditor.getState().setMediaEditMode(mode==='mask'?'transform':'mask')}>モニターでマスクを編集</button></div>
        {mask.type==='bezier'?<div className="bezier-mask-settings">
          <div className="bezier-mask-status"><span>{mask.closed?'閉じたパス':'作成中の開いたパス'}</span><span>{mask.points.length}/{MAX_BEZIER_MASK_POINTS} 点</span></div>
          <p className="field-help">{mask.closed?'点とハンドルをドラッグして形を調整できます。':'モニターをクリックして点を追加してください。閉じるまでは映像を切り抜きません。'}</p>
          <p className="field-help">クリックで点を追加、ドラッグで曲線。Shiftで45度刻み・点の追加選択、Ctrl / ⌘で一時的にダイレクト選択、Alt / Optionで片側ハンドルを編集します。Ctrl / ⌘＋空白クリックで描画を終了できます。</p>
          <div className="mask-edit-buttons bezier-actions">
            {mask.closed?<button className="secondary-button" onClick={()=>updateBezier(current=>({...current,closed:false}))}>パスを開いて点を追加</button>:<button className="secondary-button" disabled={mask.points.length<3} onClick={()=>updateBezier(current=>({...current,closed:true}))}>パスを閉じる</button>}
          </div>
          {mask.points.map((point,index)=><div className="bezier-point-row" key={index}>
            <span>点 {index+1}</span>
            <select aria-label={`点 ${index+1}の種類`} value={point.kind} onChange={e=>setPointKind(index,e.target.value as 'line'|'curve')}><option value="line">直線</option><option value="curve">曲線</option></select>
            <button type="button" className="secondary-button" aria-label={`点 ${index+1}を削除`} onClick={()=>updateBezier(current=>{const points=current.points.filter((_,pointIndex)=>pointIndex!==index);return {...current,points,closed:current.closed&&points.length>=3};})}>削除</button>
          </div>)}
        </div>:<>
          <EffectField clip={clip} label="位置 X" value={mask.x*100} min={0} max={100} step={.1} suffix="%" channel="videoMask.x" patch={basicMaskPatch('x')}/><EffectField clip={clip} label="位置 Y" value={mask.y*100} min={0} max={100} step={.1} suffix="%" channel="videoMask.y" patch={basicMaskPatch('y')}/>
          <EffectField clip={clip} label="幅" value={mask.width*100} min={1} max={100} step={.1} suffix="%" channel="videoMask.width" patch={basicMaskPatch('width')}/><EffectField clip={clip} label="高さ" value={mask.height*100} min={1} max={100} step={.1} suffix="%" channel="videoMask.height" patch={basicMaskPatch('height')}/>
        </>}
        <EffectField clip={clip} label="境界のぼかし" value={mask.feather*100} min={0} max={50} step={.1} suffix="%" channel="videoMask.feather" patch={commonMaskPatch('feather')}/>
        <label className="mask-checkbox"><input type="checkbox" checked={mask.inverted} onChange={e=>useEditor.getState().updateClip(clip.id,{videoMask:{...mask,inverted:e.target.checked}})}/>内側と外側を反転</label>
      </>:<p className="field-help">長方形、楕円、ベジェペンを選ぶと、外側を透明にできます。</p>}
    </Section>
  </>;
}
function ChromaKeyEffects({clip}:{clip:Clip}){
  const mode=useEditor(s=>s.mediaEditMode),key=clip.chromaKey;
  const change=(property:'tolerance'|'softness'|'greenSpill'|'blueSpill')=>(current:Clip,value:number)=>({chromaKey:{...(current.chromaKey||DEFAULT_CHROMA_KEY),[property]:value/100} as ChromaKey});
  const update=(patch:Partial<ChromaKey>)=>{if(clip.chromaKey)useEditor.getState().updateClip(clip.id,{chromaKey:{...clip.chromaKey,...patch}});};
  const reset=()=>{const state=useEditor.getState();state.updateClip(clip.id,{chromaKey:undefined});if(state.mediaEditMode==='chroma')state.setMediaEditMode('transform');};
  return <Section title="クロマキー" icon={Pipette} onReset={key?reset:undefined}>
    {!key?<><p className="field-help">背景色を透明にして、下の映像や画像と合成します。</p><button type="button" className="secondary-button chroma-enable" onClick={()=>useEditor.getState().updateClip(clip.id,{chromaKey:{...DEFAULT_CHROMA_KEY}})}>クロマキーを有効にする</button></>:<>
      <ColorField id={`chroma-color-${clip.id}`} label="背景色" value={key.color} onChange={color=>update({color})}/>
      <button type="button" aria-pressed={mode==='chroma'} className={'secondary-button chroma-eyedropper '+(mode==='chroma'?'active':'')} onClick={()=>{const state=useEditor.getState();state.stop();state.setMediaEditMode(state.mediaEditMode==='chroma'?'transform':'chroma');}}><Pipette size={13}/>{mode==='chroma'?'スポイトを終了':'モニターから背景色を採る'}</button>
      <p className="field-help">{mode==='chroma'?'プログラムモニターの背景をクリックしてください。':'キー処理前の素材を5×5画素で平均して採色します。'}</p>
      <EffectField clip={clip} label="色の許容範囲" value={key.tolerance*100} min={0} max={50} step={.1} suffix="%" channel="chromaKey.tolerance" patch={change('tolerance')}/>
      <EffectField clip={clip} label="境界のなめらかさ" value={key.softness*100} min={0} max={50} step={.1} suffix="%" channel="chromaKey.softness" patch={change('softness')}/>
      <EffectField clip={clip} label="緑の色かぶり除去" value={key.greenSpill*100} min={0} max={100} step={1} suffix="%" channel="chromaKey.greenSpill" patch={change('greenSpill')}/>
      <EffectField clip={clip} label="青の色かぶり除去" value={key.blueSpill*100} min={0} max={100} step={1} suffix="%" channel="chromaKey.blueSpill" patch={change('blueSpill')}/>
      <label className="mask-checkbox"><input type="checkbox" checked={key.matte} onChange={event=>update({matte:event.target.checked})}/>キーマットを表示（プレビューのみ）</label>
    </>}
  </Section>;
}
function Section({ title, icon: Icon, children, onReset, open = true }: { title: string; icon: typeof Move; children: React.ReactNode; onReset?: () => void; open?: boolean }) {
  return <details className={`inspector-section ${title === '基本設定' ? 'basic-settings' : ''}`} open={open}><summary><ChevronDown size={12}/><Icon size={14}/><span>{title}</span>{onReset ? <button className="reset-section" type="button" aria-label={`${title}をリセット`} title="リセット" onClick={e => { e.preventDefault(); onReset(); }}><RotateCcw size={12}/></button> : null}</summary><div className="section-properties">{children}</div></details>;
}
export default function Inspector({ onCollapse, onShowEffects }: { onCollapse: () => void; onShowEffects: () => void }) {
  const p = useEditor(s => s.project); const selected = useEditor(s => s.selected); const tab = useEditor(s => s.inspectorTab);
  const playhead=useEditor(s=>s.playhead),sourceClip=p.clips.find(c=>c.id===selected[0]);
  const clip = sourceClip&&visualClipAt(sourceClip,localVisualTime(sourceClip,playhead,p.fps)); const asset = p.assets.find(a => a.id === clip?.assetId);
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
  return <aside className="inspector-panel panel"><div className="panel-heading"><div className="panel-title"><SlidersHorizontal size={15}/><span>プロパティ</span></div><div className="inspector-heading-actions"><span className="inspector-count">{selected.length ? `${selected.length} 選択` : '選択なし'}</span><button className="icon-button panel-collapse" aria-label="プロパティパネルを折りたたむ" title="プロパティパネルを折りたたむ" aria-controls="workspace-inspector" aria-expanded={true} onClick={onCollapse}><PanelRightClose size={16}/></button></div></div>
    {clip ? <><div className="inspector-clip"><span className={`inspector-clip-icon ${clip.kind}`}>{clip.kind === 'title' ? <Type size={18}/> : clip.kind === 'audio' ? <Volume2 size={18}/> : <Film size={18}/>}</span><div><input aria-label="クリップ名" value={clip.name} disabled={track?.locked} onFocus={() => { textEdit.current = null; }} onBlur={() => { textEdit.current = null; }} onChange={e => editText('name', e.target.value)}/><span>{clip.graphic ? '図形レイヤー' : clip.kind === 'title' ? 'テキストレイヤー' : asset?.codec?.toUpperCase() || 'MEDIA'} <span>·</span> {timecode(clip.duration, p.fps)}</span></div>{track?.locked ? <Lock size={15}/> : null}</div><div className="inspector-tabs" role="group" aria-label="プロパティの表示項目" onKeyDown={navigatePanelTabs}>{[{ id: 'video', label: clip.graphic ? '図形' : clip.kind === 'title' ? 'テキスト' : 'ビデオ' }, { id: 'color', label: 'カラー' }, { id: 'audio', label: 'オーディオ' }].map(t => <button className={tab === t.id ? 'selected' : ''} key={t.id} aria-pressed={tab===t.id} tabIndex={tab===t.id?0:-1} onClick={() => useEditor.getState().setInspectorTab(t.id as typeof tab)}>{t.label}</button>)}</div>
    <div className="inspector-content"><fieldset disabled={track?.locked}>
      {sourceClip&&clip.kind!=='audio'&&tab==='color'?<Section title="キーフレーム" icon={Scan} open={hasVisualKeys(sourceClip)}><VisualKeyframes key={clip.id} clip={sourceClip}/></Section>:null}
      {tab === 'video' ? <>
        <Section title="基本設定" icon={Film}><NumericField clip={clip} property="start" label="開始時間" min={0} max={MAX_MEDIA_SECONDS} step={1 / p.fps} suffix="秒" slider={false}/><NumericField clip={clip} property="duration" label="長さ" min={1 / p.fps} max={MAX_MEDIA_SECONDS} step={1 / p.fps} suffix="秒" slider={false}/>{clip.kind === 'video' || clip.kind === 'audio' ? <><NumericField clip={clip} property="in" label="素材の開始位置" min={0} max={asset?.duration || MAX_MEDIA_SECONDS} step={1 / p.fps} suffix="秒" slider={false}/><div className="property-label"><label htmlFor="playback-speed">再生速度</label><select id="playback-speed" value={clip.speed} onChange={e => patch({ speed: Number(e.target.value) })}>{[...new Set([0.25,0.5,0.75,1,1.25,1.5,2,3,4,clip.speed])].sort((a,b)=>a-b).map(v => <option value={v} key={v}>{v === 1 ? '1× 標準' : `${Number(v.toFixed(3))}×`}</option>)}</select></div></> : null}</Section>
      {sourceClip&&clip.kind!=='audio'?<Section title="キーフレーム" icon={Scan} open={hasVisualKeys(sourceClip)}><VisualKeyframes key={clip.id} clip={sourceClip}/></Section>:null}
        {clip.graphic ? <Section title="図形" icon={Move}><GraphicEffects clip={clip}/></Section> : null}
        {clip.kind === 'title' && !clip.graphic ? <Section title="テキスト" icon={Type}>
          <textarea aria-label="テロップのテキスト" rows={3} maxLength={4000} value={clip.text} onFocus={() => { textEdit.current = null; }} onBlur={() => { textEdit.current = null; }} onChange={e => editText('text', e.target.value)}/>
          <ColorField id="text-color" label="文字色" value={clip.color} onChange={color => patch({ color })}/>
          <div className="property-label"><label htmlFor="text-style">スタイル</label><select id="text-style" value={clip.textStyle} onChange={e => patch({ textStyle: e.target.value as Clip['textStyle'] })}><option value="hero">シネマタイトル</option><option value="minimal">ミニマル</option><option value="subtitle">字幕</option></select></div>
          <NumericField clip={clip} property="fontSize" label="文字サイズ" min={16} max={240} suffix="px"/>
          <TextEffects key={clip.id} clip={clip}/>
        </Section> : null}
        {clip.kind !== 'audio' ? <Section title="トランスフォーム" icon={Move} onReset={() => patch({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 })}><div className="position-fields"><NumericField clip={clip} property="x" label="位置 X" min={-p.width * 1.5} max={p.width * 2.5} factor={p.width / 100} offset={p.width / 2} step={1} suffix="px" slider={false}/><NumericField clip={clip} property="y" label="位置 Y" min={-p.height * 1.5} max={p.height * 2.5} factor={p.height / 100} offset={p.height / 2} step={1} suffix="px" slider={false}/></div><p className="field-help">画面左上を基準にした素材の中心座標です。</p><NumericField clip={clip} property="scale" label="スケール" min={10} max={300} factor={100} suffix="%"/><NumericField clip={clip} property="rotation" label="回転" min={-180} max={180} suffix="°"/><NumericField clip={clip} property="opacity" label="不透明度" min={0} max={100} factor={100} suffix="%"/></Section> : null}
        {(clip.kind === 'video' || clip.kind === 'image') ? <CropMaskEffects clip={clip}/> : null}
        <Section title="フェード" icon={Scan}><NumericField clip={clip} property="fadeIn" label="フェードイン" min={0} max={Math.min(10, clip.duration)} step={0.1} suffix="秒"/><NumericField clip={clip} property="fadeOut" label="フェードアウト" min={0} max={Math.min(10, clip.duration)} step={0.1} suffix="秒"/><p className="field-help">{clip.audioDetached ? '映像に反映されます。音声のフェードは音声クリップで調整します。' : '映像と音声に反映されます。'}</p></Section>
      </> : null}
      {tab === 'color' ? clip.kind === 'audio' || clip.kind === 'title' ? <div className="inspector-empty-small"><Palette size={24}/><p>色調整する映像・画像クリップを選択してください。</p></div> : <><Section title="基本補正" icon={Palette} onReset={() => patch({ exposure: 0, contrast: 1, saturation: 1 })}><NumericField clip={clip} property="exposure" label="露出" min={-2} max={2} step={0.01} suffix="EV"/><NumericField clip={clip} property="contrast" label="コントラスト" min={0} max={200} factor={100} suffix="%"/><NumericField clip={clip} property="saturation" label="彩度" min={0} max={200} factor={100} suffix="%"/></Section><ChromaKeyEffects clip={clip}/><div className="color-advice"><span className="eyebrow">COLOR YOUR STORY</span><p>色は、物語の温度。</p><small>左のエフェクトパネルから6種類のルックを適用できます。</small><button className="secondary-button" onClick={onShowEffects}>ルックを選ぶ</button></div></> : null}
      {tab === 'audio' ? clip.audioDetached ? <div className="inspector-empty-small"><Volume2 size={24}/><p>音声は別トラックにあります。音声クリップを選択して調整してください。</p>{clip.linkId ? <button className="secondary-button" onClick={()=>useEditor.getState().select(p.clips.filter(c=>c.linkId===clip.linkId&&c.kind==='audio').map(c=>c.id))}>リンクした音声を選択</button> : null}</div> : !asset?.hasAudio ? <div className="inspector-empty-small"><Volume2 size={24}/><p>このクリップに音声はありません。</p></div> : <><AudioEnhancement key={clip.id} clip={clip}/><AudioVolumeAutomation clip={clip}/>{clip.audioMuted ? <p className="field-help">このクリップはミュート中です。<button className="text-button" onClick={()=>useEditor.getState().patchAudio({audioMuted:false},[clip.id])}>ミュートを解除</button></p> : null}<Section title="ボリューム" icon={Volume2} onReset={() => patch({ volume: 1, volumeKeyframes:[] })}><NumericField clip={clip} property="volume" label="音量" min={0} max={200} factor={100} suffix="%"/><p className="field-help">音量ラインと同じ音量です。丸を選択中はその点、それ以外は再生ヘッドの位置を調整します。</p></Section><Section title="オーディオフェード" icon={Scan}><NumericField clip={clip} property="fadeIn" label="フェードイン" min={0} max={Math.min(10,clip.duration)} step={0.1} suffix="秒"/><NumericField clip={clip} property="fadeOut" label="フェードアウト" min={0} max={Math.min(10,clip.duration)} step={0.1} suffix="秒"/></Section><p className="audio-info">トラックの M（ミュート）と S（ソロ）は、プレビューと書き出しの両方に反映されます。</p></> : null}
      {asset ? <Section title="素材の情報" icon={Info} open={false}><dl className="asset-details"><dt>ファイル</dt><dd>{asset.name}</dd><dt>サイズ</dt><dd>{(asset.size / 1024 / 1024).toFixed(1)} MB</dd><dt>解像度</dt><dd>{asset.width} × {asset.height}</dd><dt>素材の長さ</dt><dd>{timecode(asset.duration,p.fps)}</dd>{asset.proxy ? <><dt>プレビュー</dt><dd>プロキシ使用中</dd></> : null}</dl></Section> : null}
    </fieldset></div></> : <div className="inspector-empty"><SlidersHorizontal size={32}/><h3>細部まで、思いどおりに。</h3><p>タイムラインのクリップを選択すると、<br/>映像や音声を調整できます。</p><span>SELECT A CLIP TO GET STARTED</span></div>}
  </aside>;
}
