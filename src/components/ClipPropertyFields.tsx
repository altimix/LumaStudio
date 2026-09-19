import { useEffect, useRef } from 'react';
import { volumeAt } from '../../shared/volume-automation.mjs';
import { sameVolumeCurve, setEffectiveVolume } from '../volume-editing';
import { useEditor } from '../store';
import { normalizeClip } from '../model';
import type { Clip } from '../types';
import { linkedIds, clipsLocked } from '../../shared/clip-links.mjs';
import { patchVisualClip, visualClipAt, visualFields } from '../../shared/visual-keyframes.mjs';
import { localVisualTime } from '../visual-editing';
import ScrubbableNumberInput from './ScrubbableNumberInput';
import PropertyNumberField from './PropertyNumberField';

type EditorState = ReturnType<typeof useEditor.getState>;
function restoreGesture(before: EditorState) {
  useEditor.setState({ project:before.project, history:before.history, future:before.future, historyPlayheads:before.historyPlayheads, futurePlayheads:before.futurePlayheads, historyLabels:before.historyLabels, futureLabels:before.futureLabels, currentAction:before.currentAction, dirty:before.dirty, activeVolumePoint:before.activeVolumePoint, zoom:before.zoom });
}

export function NumericField({ clip, property, label, min, max, step = 1, factor = 1, offset = 0, suffix = '', slider = true, fallback=0 }: { clip: Clip; property: keyof Clip; label: string; min: number; max: number; step?: number; factor?: number; offset?: number; suffix?: string; slider?: boolean; fallback?:number }) {
  const playhead=useEditor(s=>s.playhead);
  const active=useEditor(s=>property==='volume'?s.activeVolumePoint:null);
  const local=active?.clipId===clip.id?active.time:Math.max(0,Math.min(clip.duration,playhead-clip.start));
  if(property==='volume'&&(clip.volumeKeyframes?.length||active?.clipId===clip.id))max=400;
  const displayValue=(current:Clip)=>Number(visualClipAt(current,local)[property]??fallback)*(property==='volume'?volumeAt(current.volumeKeyframes||[],local):1)*factor+offset;
  const value = displayValue(useEditor.getState().project.clips.find(c=>c.id===clip.id)||clip);
  const dragging=useRef(false),changed=useRef(false),dragStart=useRef<{state:EditorState;clip:Clip;time:number;selected:boolean;owner:object}|null>(null);
  const finishDrag=(cancel=false)=>{
    const start=dragStart.current;if(!start)return;dragStart.current=null;dragging.current=false;
    const current=useEditor.getState(),now=current.project.clips.find(c=>c.id===start.clip.id);
    if(current.gestureOwner!==start.owner)return;
    const returned=now&&(property==='volume'?sameVolumeCurve(start.clip,now):JSON.stringify(start.clip)===JSON.stringify(now));
    if(changed.current&&(cancel||returned))restoreGesture(start.state);
    current.endGesture(start.owner);changed.current=false;
  };
  useEffect(()=>{
    const cancel=()=>finishDrag(true),escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&dragStart.current){e.preventDefault();cancel();}};
    const visibility=()=>{if(document.hidden)cancel();};
    window.addEventListener('blur',cancel);window.addEventListener('keydown',escape);document.addEventListener('visibilitychange',visibility);
    return()=>{cancel();window.removeEventListener('blur',cancel);window.removeEventListener('keydown',escape);document.removeEventListener('visibilitychange',visibility);};
  },[clip.id,property]);
  const beginDrag=()=>{
    const state=useEditor.getState(),current=state.project.clips.find(c=>c.id===clip.id);
    if(!current||state.project.tracks.find(t=>t.id===current.trackId)?.locked||state.gestureActive)return false;
    if(['start','in','duration','speed'].includes(property)&&clipsLocked(state.project,linkedIds(state.project,[clip.id]))){state.notify('リンク相手を含むトラックのロックを解除してください。');return false;}
    state.stop();const owner={},session={state,clip:current,time:property==='volume'?local:localVisualTime(current,state.playhead,state.project.fps),selected:state.activeVolumePoint?.clipId===current.id,owner};dragStart.current=session;
    if(!state.beginGesture(owner,()=>finishDrag(true))){dragStart.current=null;return false;}dragging.current=true;changed.current=false;return true;
  };
  const apply = (newValue: number) => {
    if (!Number.isFinite(newValue)) return; const s = useEditor.getState(); const current = s.project.clips.find(c => c.id === clip.id); const v = (Math.min(max, Math.max(min, newValue)) - offset) / factor;
    if (!current || s.project.tracks.find(t => t.id === current.trackId)?.locked) return;
    if (['start','in','duration','speed'].includes(property)&&clipsLocked(s.project,linkedIds(s.project,[clip.id]))){s.notify('リンク相手を含むトラックのロックを解除してください。');return;}
    const start=dragStart.current;
    if(s.gestureActive&&s.gestureOwner!==start?.owner)return;
    let patch:Partial<Clip>;try{patch=property==='volume'?setEffectiveVolume(start?.clip||current,start?.time??local,v,s.project.fps,start?.selected??(s.activeVolumePoint?.clipId===current.id)):{[property]:v};}catch(error){s.notify((error as Error).message);return;}
    let candidate:Clip;try{candidate=patchVisualClip(start?.clip||current,patch,start?.time??local);}catch(error){s.notify((error as Error).message);return;}
    if(JSON.stringify(current)===JSON.stringify(candidate))return;
    if (dragging.current) {
      if (!changed.current) { s.checkpoint(`${label}を変更`); changed.current = true; }
      const now=useEditor.getState(),baseline=start?.state.project||now.project,clips=baseline.clips.map(c=>c.id===clip.id?normalizeClip(candidate,baseline):c);
      now.transient({...baseline,clips},baseline);
    } else s.updateClip(clip.id, patch);
  };
  return <PropertyNumberField inputId={`prop-${property}`} label={label} suffix={suffix} onFocus={()=>{if(visualFields(clip).some(field=>field===property)){useEditor.getState().stop();useEditor.setState({visualChannel:property});}}}
    input={<ScrubbableNumberInput id={`prop-${property}`} value={value} min={min} max={max} step={step} onCommit={apply} onScrubStart={beginDrag} onScrubChange={apply} onScrubEnd={()=>{finishDrag();const current=useEditor.getState().project.clips.find(c=>c.id===clip.id);return current?displayValue(current):value;}} onScrubCancel={()=>finishDrag(true)}/>}
    slider={slider ? <input className="property-slider" type="range" aria-label={`${label}スライダー`} min={min} max={max} step={step} value={value} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} onPointerDown={e=>{if(e.button===0)beginDrag();}} onPointerUp={()=>finishDrag()} onPointerCancel={()=>finishDrag(true)} onLostPointerCapture={()=>finishDrag(true)} onChange={e=>apply(Number(e.target.value))}/> : null}/>;
}
export function EffectField({ clip, label, value, min, max, step = 1, suffix = '', slider=true, channel, patch }: { clip: Clip; label: string; value: number; min: number; max: number; step?: number; suffix?: string; slider?:boolean; channel:string; patch: (clip: Clip, value: number) => Partial<Clip> }) {
  const dragging=useRef(false),changed=useRef(false);
  const dragStart=useRef<{state:ReturnType<typeof useEditor.getState>;owner:object}|null>(null),inputId=`effect-${clip.id}-${label.replace(/\s/g,'-')}`;
  const finish=(cancel=false)=>{
    const start=dragStart.current;if(!start)return;dragStart.current=null;dragging.current=false;
    const current=useEditor.getState();if(current.gestureOwner!==start.owner)return;
    const before=start.state,oldClip=before.project.clips.find(c=>c.id===clip.id),nowClip=current.project.clips.find(c=>c.id===clip.id);
    if(changed.current&&(cancel||(oldClip&&nowClip&&JSON.stringify(oldClip)===JSON.stringify(nowClip))))restoreGesture(before);
    current.endGesture(start.owner);changed.current=false;
  };
  useEffect(()=>{const cancel=()=>finish(true),escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&dragStart.current){e.preventDefault();cancel();}},visibility=()=>{if(document.hidden)cancel();};window.addEventListener('blur',cancel);window.addEventListener('keydown',escape);document.addEventListener('visibilitychange',visibility);return()=>{cancel();window.removeEventListener('blur',cancel);window.removeEventListener('keydown',escape);document.removeEventListener('visibilitychange',visibility);};},[clip.id]);
  const begin=()=>{const state=useEditor.getState(),current=state.project.clips.find(c=>c.id===clip.id),owner={};if(!current||state.project.tracks.find(t=>t.id===current.trackId)?.locked||state.gestureActive)return false;dragStart.current={state,owner};if(!state.beginGesture(owner,()=>finish(true))){dragStart.current=null;return false;}dragging.current=true;changed.current=false;return true;};
  const apply=(input:number)=>{
    if(!Number.isFinite(input))return;
    const next=Math.min(max,Math.max(min,input)),state=useEditor.getState(),current=state.project.clips.find(c=>c.id===clip.id);
    if(!current||state.project.tracks.find(t=>t.id===current.trackId)?.locked)return;
    const start=dragStart.current;if(state.gestureActive&&state.gestureOwner!==start?.owner)return;
    const time=localVisualTime(current,start?.state.playhead??state.playhead,state.project.fps),values=patch(visualClipAt(current,time),next);
    let candidate:Clip;try{candidate=patchVisualClip(current,values,time);}catch(error){state.notify((error as Error).message);return;}
    if(JSON.stringify(candidate)===JSON.stringify(current))return;
    if(dragging.current){if(!changed.current){state.checkpoint(`${label}を変更`);changed.current=true;}const now=useEditor.getState();now.transient({...now.project,clips:now.project.clips.map(c=>c.id===current.id?normalizeClip(candidate,now.project):c)},start?.state.project);}
    else state.updateClip(current.id,values);
  };
  return <PropertyNumberField inputId={inputId} label={label} suffix={suffix} onFocus={()=>{useEditor.getState().stop();useEditor.setState({visualChannel:channel});}}
    input={<ScrubbableNumberInput id={inputId} value={value} min={min} max={max} step={step} onCommit={apply} onScrubStart={begin} onScrubChange={apply} onScrubEnd={()=>{finish();return value;}} onScrubCancel={()=>finish(true)}/>}
    slider={slider?<input className="property-slider" type="range" aria-label={`${label}スライダー`} min={min} max={max} step={step} value={value} style={{'--fill':`${max>min?(value-min)/(max-min)*100:100}%`} as React.CSSProperties} onPointerDown={e=>{if(e.button===0)begin();}} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)} onChange={e=>apply(Number(e.target.value))}/>:null}/>;
}
