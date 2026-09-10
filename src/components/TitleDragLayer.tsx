import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from '../store';
import type { Clip, Project } from '../types';
import { titleBounds, fadeAt, initialTextBox, boxedTextLayout } from '../render';
import { resizeTextBox } from '../../shared/text-box.mjs';
import InlineTextEditor from './InlineTextEditor';
import './text-box.css';
import { isFontReady } from '../fonts';
import { opacityAt } from '../../shared/opacity.mjs';
import { moveMedia, visualOrder } from '../media-transform';
import { NO_SNAP, sameSnapGuides, snapMonitorPosition } from '../monitor-snap';
import MonitorSnapGuides from './MonitorSnapGuides';

const handles=[{x:-1,y:-1,name:'左上',cursor:'nwse-resize'},{x:0,y:-1,name:'上',cursor:'ns-resize'},{x:1,y:-1,name:'右上',cursor:'nesw-resize'},{x:1,y:0,name:'右',cursor:'ew-resize'},{x:1,y:1,name:'右下',cursor:'nwse-resize'},{x:0,y:1,name:'下',cursor:'ns-resize'},{x:-1,y:1,name:'左下',cursor:'nesw-resize'},{x:-1,y:0,name:'左',cursor:'ew-resize'}];
type EditSession={clip:Clip;project:Project;owner:object;time:number};
export default function TitleDragLayer({ fontVersion }: { fontVersion: number }) {
  const p = useEditor(s => s.project), time = useEditor(s => s.playhead), selected = useEditor(s => s.selected), playing = useEditor(s => s.playing);
  const order = useMemo(() => visualOrder(p), [p]);
  const cleanup = useRef<(() => void) | null>(null);
  const [guides, setGuides] = useState(NO_SNAP);
  const [editing,setEditing]=useState<EditSession|null>(null),editRef=useRef<EditSession|null>(null);
  const finishInline=(commit:boolean,text?:string,render=true)=>{
    const session=editRef.current;if(!session)return;editRef.current=null;if(render)setEditing(null);
    const state=useEditor.getState(),valid=state.gestureOwner===session.owner&&state.project===session.project;
    state.endGesture(session.owner);
    if(commit&&valid&&text!==undefined&&text!==session.clip.text)state.updateClip(session.clip.id,{text});
  };
  const edit=(clip:Clip)=>{
    if(clip.graphic||editRef.current||useEditor.getState().gestureActive)return;
    const state=useEditor.getState();if(state.project.tracks.find(t=>t.id===clip.trackId)?.locked)return;
    state.stop();state.select([clip.id]);const owner={};
    if(!state.beginGesture(owner,()=>finishInline(false)))return;
    const session={clip,project:state.project,owner,time:state.playhead};editRef.current=session;setEditing(session);
  };
  useEffect(()=>{
    const unsubscribe=useEditor.subscribe(state=>{const session=editRef.current;if(session&&(state.project!==session.project||state.playhead!==session.time||state.playing||!state.selected.includes(session.clip.id)))finishInline(false);});
    return()=>{unsubscribe();cleanup.current?.();finishInline(false,undefined,false);};
  },[]);
  const active = [...p.tracks].reverse().filter(t => !t.hidden).flatMap(t => p.clips.filter(c => c.kind === 'title' && c.trackId === t.id && time >= c.start && time < c.start + c.duration && isFontReady(c) && fadeAt(c, time) * opacityAt(c.opacityKeyframes, time - c.start, c.opacity) > 0.001).sort((a, b) => a.start - b.start).map(clip => ({ clip, locked: t.locked })));
  const drag = (event: ReactPointerEvent<HTMLButtonElement>, renderedClip: Clip, mode:'move'|'resize'|'text-resize'='move',handle={x:1,y:1}) => {
    if (event.button !== 0 || cleanup.current) return;
    event.preventDefault(); event.stopPropagation();
    // Commit an inspector field on blur, then start from its updated position.
    // Keyboard shortcuts must follow the title, not the previously used input.
    event.currentTarget.focus({ preventScroll: true });
    const initial = useEditor.getState(), p = initial.project, projectId = p.id;
    const clip = p.clips.find(item => item.id === renderedClip.id);
    if (!clip || initial.playing || initial.gestureActive) return;
    if (initial.project.tracks.find(t => t.id === clip.trackId)?.locked) return;
    const owner={};if(!initial.beginGesture(owner,()=>cancel()))return;initial.stop(); initial.select([clip.id]);
    const target = event.currentTarget, viewport = target.closest('.title-drag-layer')!, rect = viewport.getBoundingClientRect(), pointer = event.pointerId, x = event.clientX, y = event.clientY;
    const box=initialTextBox(clip,p.width,p.height);
    const bounds = clip.graphic ? titleBounds(clip,p.width,p.height) : box;
    const size = { width: bounds.width * clip.scale, height: bounds.height * clip.scale };
    const action=mode==='text-resize'?'テキスト枠のサイズを変更':mode==='resize'?'図形のサイズを変更':clip.graphic?'図形の位置を移動':'テキストの位置を移動';
    let before = initial, changed = false, closed = false;
    let snapped = NO_SNAP, lastPointer: PointerEvent | null = null;
    let previousDelta = { x: 0, y: 0 };
    const finish = () => {
      if (closed) return; closed = true; setGuides(NO_SNAP); lastPointer = null; observer.disconnect(); unsubscribe();
      cleanup.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancelPointer); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', visibility); target.removeEventListener('lostpointercapture', cancelPointer);
      if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer); useEditor.getState().endGesture(owner);
    };
    const cancel = () => {
      if (closed) return;
      const current = useEditor.getState();
      finish();
      if (changed && current.gestureOwner===owner && current.project.id === projectId) {
        const clips = current.project.clips.map(c => c.id === clip.id ? { ...c, x: clip.x, y: clip.y, captionAutoPosition: clip.captionAutoPosition, ...(mode==='resize'?{graphic:clip.graphic}:mode==='text-resize'?{textBox:clip.textBox}:{}) } : c);
        const onlyDrag = current.history.at(-1) === before.project && current.currentAction === action;
        useEditor.setState({ project: { ...current.project, clips }, ...(onlyDrag ? { history: before.history, future: before.future, historyPlayheads:before.historyPlayheads, futurePlayheads:before.futurePlayheads, historyLabels: before.historyLabels, futureLabels: before.futureLabels, currentAction: before.currentAction, dirty: before.dirty } : {}) });
      }
    };
    const move = (e: PointerEvent, bypass = e.altKey) => {
      if (e.pointerId !== pointer || closed) return;
      lastPointer = e;
      const state = useEditor.getState(), current = state.project.clips.find(c => c.id === clip.id);
      if (state.gestureOwner!==owner || state.project.id !== projectId || !current || state.project.tracks.find(t => t.id === current.trackId)?.locked) { finish(); return; }
      if (!changed && Math.hypot(e.clientX - x, e.clientY - y) < 3) return;
      if(mode==='text-resize'){
        const patch=resizeTextBox(clip,box,p,handle,(e.clientX-x)/rect.width*p.width,(e.clientY-y)/rect.height*p.height);
        if (!changed) { before = state; state.checkpoint(action); changed = true; }
        state.transient({...state.project,clips:state.project.clips.map(c=>c.id===clip.id?{...c,...patch}:c)});return;
      }
      if(mode==='resize'&&clip.graphic){
        const dx=(e.clientX-x)/rect.width*p.width/clip.scale,dy=(e.clientY-y)/rect.height*p.height/clip.scale,angle=clip.rotation*Math.PI/180;
        const graphic={...clip.graphic,width:Math.max(4,Math.min(16000,clip.graphic.width+2*(dx*Math.cos(angle)+dy*Math.sin(angle)))),height:Math.max(4,Math.min(16000,clip.graphic.height+2*(-dx*Math.sin(angle)+dy*Math.cos(angle))))};
        if (!changed) { before = state; state.checkpoint(action); changed = true; }
        state.transient({...state.project,clips:state.project.clips.map(c=>c.id===clip.id?{...c,graphic}:c)});return;
      }
      const delta = { x: (e.clientX-x)/rect.width*p.width, y: (e.clientY-y)/rect.height*p.height };
      const result = snapMonitorPosition(clip, size, p, delta, rect, snapped, previousDelta);
      previousDelta = delta; snapped = result.guides;
      const visible = bypass ? NO_SNAP : result.guides, patch = bypass ? moveMedia(clip, p, delta) : { x: result.x, y: result.y };
      setGuides(previous => sameSnapGuides(previous, visible) ? previous : visible);
      if (patch.x === current.x && patch.y === current.y) return;
      if (!changed) { before = state; state.checkpoint(action); changed = true; }
      state.transient({ ...state.project, clips: state.project.clips.map(c => c.id === clip.id ? { ...c, ...(c.captionAutoPosition ? {captionAutoPosition:false} : {}), ...patch } : c) });
    };
    const up = (e: PointerEvent) => { if (e.pointerId === pointer) finish(); };
    const cancelPointer = (e: PointerEvent) => { if (e.pointerId === pointer) cancel(); };
    const key = (e: KeyboardEvent) => {
      if (e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      if (e.key === 'Alt' && mode === 'move' && lastPointer) { e.preventDefault(); move(lastPointer, e.altKey); }
    };
    const visibility = () => { if (document.hidden) cancel(); };
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (closed) return;
      if (state.gestureOwner !== owner) { finish(); return; }
      if (state.playing || state.playhead !== previous.playhead || state.seekRevision !== previous.seekRevision || state.drawTool !== previous.drawTool || !state.selected.includes(clip.id)) cancel();
      const current = state.project.clips.find(c => c.id === clip.id);
      if (state.project.id !== projectId || !current || state.project.tracks.find(t => t.id === current.trackId)?.locked) finish();
    });
    const observer = new ResizeObserver(() => { const now = viewport.getBoundingClientRect(); if (Math.abs(now.width - rect.width) > .5 || Math.abs(now.height - rect.height) > .5 || Math.abs(now.left - rect.left) > .5 || Math.abs(now.top - rect.top) > .5) cancel(); });
    observer.observe(viewport);
    cleanup.current = cancel; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancelPointer); window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', visibility); target.addEventListener('lostpointercapture', cancelPointer); target.setPointerCapture(pointer);
  };
  return <div className="title-drag-layer" data-font-version={fontVersion}>{!playing && active.map(({clip,locked})=>{
    const isSelected=selected.includes(clip.id),bounds=isSelected&&!clip.graphic?initialTextBox(clip,p.width,p.height):titleBounds(clip,p.width,p.height),angle=clip.rotation*Math.PI/180;
    const corner=clip.graphic?{x:(clip.graphic.width*Math.cos(angle)-clip.graphic.height*Math.sin(angle))*clip.scale/2,y:(clip.graphic.width*Math.sin(angle)+clip.graphic.height*Math.cos(angle))*clip.scale/2}:null;
    return <Fragment key={clip.id}><button className={'title-drag-target '+(isSelected?'selected':'')} disabled={locked} aria-label={clip.graphic?'図形「'+clip.name+'」を移動':'テキスト「'+clip.text.slice(0,40)+'」を移動'} title={locked?'トラックがロックされています':clip.graphic?'ドラッグで移動 · 端・中央線に触れると吸着 · Altで吸着解除 · Escで取り消し':'ダブルクリックまたはF2で文字編集 · 端・中央線に触れると吸着 · Altで吸着解除'} style={{zIndex:order.get(clip.id),left:(50+clip.x)+'%',top:(50+clip.y)+'%',width:bounds.width/p.width*100+'%',height:bounds.height/p.height*100+'%',transform:'translate(-50%, -50%) rotate('+clip.rotation+'deg) scale('+clip.scale+')'}} onPointerDown={e=>drag(e,clip)} onClick={()=>useEditor.getState().select([clip.id])} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();edit(clip);}} onKeyDown={e=>{if(e.key==='F2'){e.preventDefault();e.stopPropagation();edit(clip);}}}/>{corner&&isSelected&&!locked?<button className="graphic-resize-handle" aria-label="図形のサイズを変更" title="ドラッグしてサイズを変更" style={{zIndex:900000+(order.get(clip.id)||0),left:(50+clip.x+corner.x/p.width*100)+'%',top:(50+clip.y+corner.y/p.height*100)+'%'}} onPointerDown={e=>drag(e,clip,'resize')}/>:null}
      {!clip.graphic&&isSelected&&!locked&&!editing?handles.map(handle=>{
        const dx=handle.x*bounds.width*clip.scale/2,dy=handle.y*bounds.height*clip.scale/2;
        return <button key={handle.name} className="text-box-handle" aria-label={'テキスト枠の'+handle.name+'を変更'} title={'ドラッグして'+handle.name+'のサイズを変更'} style={{zIndex:900000+(order.get(clip.id)||0),left:(50+clip.x+(dx*Math.cos(angle)-dy*Math.sin(angle))/p.width*100)+'%',top:(50+clip.y+(dx*Math.sin(angle)+dy*Math.cos(angle))/p.height*100)+'%',cursor:handle.cursor}} onPointerDown={e=>drag(e,clip,'text-resize',handle)}/>;
      }):null}</Fragment>;
  })}
    <MonitorSnapGuides guides={guides}/>
    {editing?<InlineTextEditor clip={editing.clip} project={editing.project} onFinish={finishInline}/>:null}
  </div>;
}
