import { useEffect, useState } from 'react';
import { AudioLines, Check, X } from 'lucide-react';
import { linkedIds, clipsLocked } from '../../shared/clip-links.mjs';
import { AUDIO_TRANSITIONS, VIDEO_TRANSITIONS, transitionPlan } from '../../shared/transitions.mjs';
import { useEditor } from '../store';
import { looks } from '../looks';
import { transitionResizeInfo } from '../transition-editing';
import type { TransitionOptions } from '../types';

function DurationInput({duration,maximum,disabled,onChange}:{duration:number;maximum:number;disabled:boolean;onChange:(value:number)=>void}) {
  const [draft,setDraft]=useState<string|null>(null);
  useEffect(()=>setDraft(null),[duration,disabled]);
  const commit=()=>{if(draft!==null){const value=Number(draft);if(draft.trim()&&Number.isFinite(value)&&value>0)onChange(value);else useEditor.getState().notify('効果の長さには0より大きい秒数を入力してください。');setDraft(null);}};
  return <input aria-label="トランジションの長さ" type="number" min={1/useEditor.getState().project.fps} max={maximum} step={1/useEditor.getState().project.fps} value={draft??Number(duration.toFixed(6))} disabled={disabled} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setDraft(null);}}}/>;
}

export default function TransitionPanel() {
  const p=useEditor(s=>s.project),selected=useEditor(s=>s.selected),category=useEditor(s=>s.effectCategory),activeId=useEditor(s=>s.activeTransitionId),busy=useEditor(s=>s.gestureActive);
  const [newDuration,setNewDuration]=useState(.5),[autoAudio,setAutoAudio]=useState(true);
  const plans=transitionPlan(p),related=linkedIds(p,selected),active=plans.find(t=>t.id===activeId);
  const resize=active?transitionResizeInfo(p,active.id):null;
  const changeCategory=(next:typeof category)=>{
    const kind=next==='audio'?'audio':'video';
    const target=next==='looks'?active:plans.find(t=>resize?.ids.includes(t.id)&&t[kind]);
    useEditor.setState({effectCategory:next,activeTransitionId:target?.id??null});
  };
  const applied=plans.filter(t=>(category==='audio'?t.audio:t.video)&&(related.includes(t.toId)||related.includes(t.fromId)));
  const duration=active?.duration??newDuration;
  const effects:[string,string,string,Omit<TransitionOptions,'duration'>][] = category==='audio'
    ? Object.entries(AUDIO_TRANSITIONS).map(([id,name])=>[id,name,id==='constantGain'?'音量を直線的に切り替える':'異なる音を自然につなぐ',{audio:id as TransitionOptions['audio']}])
    : Object.entries(VIDEO_TRANSITIONS).map(([id,name])=>[id,name,id==='dissolve'?'2つの映像をなめらかに重ねる':id==='pageTurn'?'ページが横に回転して開く':'右下の角を折り返してめくる',{video:id as TransitionOptions['video'],autoAudio}]);
  const clip=p.clips.find(c=>selected.includes(c.id)&&['video','image'].includes(c.kind));
  const lookReason=!clip?'映像または画像クリップを選択してください。':clipsLocked(p,[clip.id])?'トラックのロックを解除してください。':'';
  return <div className="effect-browser library-browser">
    <div className="effect-categories" role="group" aria-label="エフェクトの種類">{[{id:'transitions',label:'切り替え'},{id:'looks',label:'色調'},{id:'audio',label:'音声'}].map(item=><button key={item.id} aria-pressed={category===item.id} onClick={()=>changeCategory(item.id as typeof category)}>{item.label}</button>)}</div>
    <div className="library-section-scroll">
      {category==='looks'?<div className="look-grid">{looks.map(look=><button key={look.name} className="look-card library-preset" aria-label={`${look.name} ${look.description}`} title={lookReason||look.description} disabled={busy} onClick={()=>{const s=useEditor.getState();if(lookReason||!clip){s.notify(lookReason);return;}s.updateClip(clip.id,look.patch);s.setInspectorTab('color');}}><div style={{background:look.color}}><div className="look-mountain"/>{clip&&Object.entries(look.patch).every(([key,value])=>clip[key as keyof typeof clip]===value)?<span className="look-applied"><Check size={17}/></span>:null}</div><strong>{look.name}</strong></button>)}</div>:<>
        <div className="transition-list">{effects.map(([id,name,description,options])=><button key={id} className="library-preset" aria-label={`${name} ${description}`} title={description} disabled={busy} draggable={!busy} onDragStart={e=>{e.dataTransfer.setData('application/x-luma-transition',JSON.stringify({...options,duration}));e.dataTransfer.effectAllowed='copy';}} onClick={()=>useEditor.getState().addTransition({...options,duration})}><span className={`transition-sample ${id}`} aria-hidden="true">{category==='audio'?<AudioLines size={25}/>:<><span/><span/></>}</span><strong>{name}</strong></button>)}</div>
        {applied.length?<div className="applied-transitions"><span>適用済み</span>{applied.map(t=><div className={`applied-transition${activeId===t.id?' selected':''}`} key={t.id}><button className="applied-transition-select" aria-pressed={activeId===t.id} onClick={()=>{const s=useEditor.getState();s.select([t.toId]);useEditor.setState({activeTransitionId:t.id});}}><strong>{category==='audio'?AUDIO_TRANSITIONS[t.audio!]:VIDEO_TRANSITIONS[t.video!]}</strong><span>{Number(t.duration.toFixed(3))}秒</span></button><button className="icon-button" aria-label="効果を解除" title="効果を解除" disabled={busy||clipsLocked(p,[t.fromId,t.toId])} onClick={()=>useEditor.getState().removeTransition(t.id)}><X size={13}/></button></div>)}</div>:null}
      </>}
    </div>
    {category==='looks'?<div className="library-browser-hint">{lookReason||'クリックで選択中のクリップに適用'}</div>:<div className="transition-settings library-browser-footer">
      <div className="transition-editing-target"><span>{active?'選択した効果を調整':'新しく追加する効果'}</span>{active?<button className="text-button" disabled={busy} onClick={()=>useEditor.setState({activeTransitionId:null})}>新規に切り替え</button>:null}</div>
      <label className="transition-duration">長さ <span><DurationInput key={active?.id??'new'} duration={duration} maximum={resize?.maximum??60} disabled={busy||!!resize?.reason} onChange={value=>active?useEditor.getState().resizeTransition(active.id,value):setNewDuration(Math.max(1/p.fps,Math.min(60,Math.round(value*p.fps)/p.fps)))}/>秒</span></label>
      {category==='transitions'?<label className="transition-audio"><input type="checkbox" checked={autoAudio} disabled={busy} onChange={e=>setAutoAudio(e.target.checked)}/>音声も自然につなぐ</label>:null}
      {resize?.reason?<p className="library-browser-hint" role="status">{resize.reason}</p>:!active&&!selected.length?<p className="library-browser-hint">クリップを選ぶか、つなぎ目へドラッグ</p>:null}
    </div>}
  </div>;
}
