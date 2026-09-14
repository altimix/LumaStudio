import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { transitionPlan, VIDEO_TRANSITIONS, AUDIO_TRANSITIONS } from '../../shared/transitions.mjs';
import { clipsLocked } from '../../shared/clip-links.mjs';
import { useEditor } from '../store';
import { draggedTransitionDuration, resizeTransition, transitionResizeInfo } from '../transition-editing';
import type { Project } from '../types';
import '../clip-context-menu.css';
import './timeline-transition.css';

export default function TimelineTransition({ transition: t, zoom }: { transition: ReturnType<typeof transitionPlan>[number]; zoom: number }) {
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; project: Project } | null>(null);
  const project = useEditor(s => s.project), menuOpen = useEditor(s => s.clipMenuOpen);
  const locked = clipsLocked(project, [t.fromId, t.toId]);
  const resizeInfo = useMemo(() => transitionResizeInfo(project, t.id), [project, t.id]);
  const close = useCallback(() => { setAnchor(null); useEditor.setState({ clipMenuOpen: false }); }, []);
  const selectEffect = () => { const s=useEditor.getState();s.select([t.toId]);useEditor.setState({activeTransitionId:t.id,effectCategory:t.video?'transitions':'audio'}); };
  const adjust = () => { if(useEditor.getState().gestureActive)return;selectEffect();useEditor.getState().setPanel('effects');useEditor.getState().seek(t.start); };
  const remove = () => { close(); useEditor.getState().removeTransition(t.id); };
  const open = (x: number, y: number) => {
    const state = useEditor.getState(); if (state.gestureActive) return;
    state.stop(); setAnchor({ x, y, project: state.project }); useEditor.setState({ clipMenuOpen: true, trackMenuOpen: false });
  };
  useLayoutEffect(() => {
    if (!anchor || !menuOpen) return;
    const element = menu.current!;
    const place = () => { element.style.left = `${Math.max(8, Math.min(anchor.x, innerWidth - element.offsetWidth - 8))}px`; element.style.top = `${Math.max(8, Math.min(anchor.y, innerHeight - element.offsetHeight - 8))}px`; };
    place(); element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) close(); };
    window.addEventListener('pointerdown', outside, true); window.addEventListener('blur', close); window.addEventListener('resize', place);
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', close); window.removeEventListener('resize', place); button.current?.focus({ preventScroll: true }); };
  }, [anchor, menuOpen, close]);
  useLayoutEffect(() => { if (anchor && (anchor.project !== project || !menuOpen)) close(); }, [anchor, project, menuOpen, close]);
  useLayoutEffect(() => () => { if (menu.current) useEditor.setState({ clipMenuOpen: false }); }, []);
  useLayoutEffect(() => () => cancelDrag.current?.(), []);
  const drag = (event: React.PointerEvent<HTMLButtonElement>, side: 'start' | 'end') => {
    event.stopPropagation();if(event.button!==0)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});
    const state=useEditor.getState();if(state.gestureActive)return;
    const before=state.project, info=transitionResizeInfo(before,t.id);if(info.reason){state.notify(info.reason);return;}
    const owner={},capture=event.currentTarget,pointerId=event.pointerId,originX=event.clientX;
    const scroll=capture.closest<HTMLElement>('.timeline-scroll'),scrollStart=scroll?.scrollLeft||0;
    let changed=false,ended=false,preview=before;
    const restore=()=>useEditor.setState({project:before,selected:state.selected,activeTransitionId:state.activeTransitionId,activeVolumePoint:state.activeVolumePoint,zoom:state.zoom,history:state.history,future:state.future,historyPlayheads:state.historyPlayheads,futurePlayheads:state.futurePlayheads,historyLabels:state.historyLabels,futureLabels:state.futureLabels,currentAction:state.currentAction,dirty:state.dirty});
    const end=()=>{
      if(ended)return;ended=true;cancelDrag.current=null;
      capture.removeEventListener('lostpointercapture',cancel);
      if(capture.hasPointerCapture(pointerId))capture.releasePointerCapture(pointerId);
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',pointerCancel);window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',visibility);
      delete document.documentElement.dataset.transitionResize;useEditor.getState().endGesture(owner);setDragging(false);
    };
    const cancel=()=>{if(ended)return;const current=useEditor.getState();if(changed&&current.gestureOwner===owner&&current.project===preview)restore();end();};
    const move=(event:PointerEvent)=>{
      if(event.pointerId!==pointerId)return;
      const current=useEditor.getState();if(current.gestureOwner!==owner||current.project!==preview||current.zoom!==zoom){cancel();return;}
      const delta=event.clientX-originX+(scroll?.scrollLeft||0)-scrollStart;
      if(!changed&&Math.abs(delta)<3)return;
      const duration=draggedTransitionDuration(info.transition.duration,side,delta,zoom,before.fps,info.maximum);
      try{
        const next=resizeTransition(before,t.id,duration);
        if(!changed&&next===before)return;
        if(preview.transitions?.every((transition,index)=>transition.duration===next.transitions?.[index]?.duration))return;
        if(!changed){state.checkpoint('トランジションの長さを変更');changed=true;}
        state.transient(next,before);preview=useEditor.getState().project;
      }catch(error){state.notify((error as Error).message);cancel();}
    };
    const finish=(event:PointerEvent)=>{
      if(event.pointerId!==pointerId)return;
      move(event);
      if(ended)return;
      if(changed&&useEditor.getState().project===preview&&preview.transitions?.every((transition,index)=>transition.duration===before.transitions?.[index]?.duration))restore();
      end();
    };
    const pointerCancel=(event:PointerEvent)=>{if(event.pointerId===pointerId)cancel();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}};
    const visibility=()=>{if(document.hidden)cancel();};
    if(!state.beginGesture(owner,cancel))return;
    state.stop();selectEffect();cancelDrag.current=cancel;setDragging(true);document.documentElement.dataset.transitionResize='true';
    capture.setPointerCapture(pointerId);capture.addEventListener('lostpointercapture',cancel);
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',pointerCancel);window.addEventListener('keydown',key,true);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',visibility);
  };
  const resizeKey = (event: React.KeyboardEvent, side:'start'|'end') => {
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||event.ctrlKey||event.metaKey||event.altKey)return;
    event.preventDefault();event.stopPropagation();const state=useEditor.getState();if(state.gestureActive||resizeInfo.reason)return;
    const direction=(event.key==='ArrowRight'?1:-1)*(side==='start'?-1:1);
    const duration=event.key==='Home'?1/project.fps:event.key==='End'?resizeInfo.maximum:Math.max(1/project.fps,t.duration+direction*(event.shiftKey?10:1)/project.fps);
    selectEffect();state.resizeTransition(t.id,duration);
  };
  const label = [t.video && VIDEO_TRANSITIONS[t.video], t.audio && AUDIO_TRANSITIONS[t.audio]].filter(Boolean).join(' + ');
  const width=Math.max(30,t.duration*zoom);
  return <><div className={`timeline-transition-wrap${dragging?' resizing':''}`} data-transition-id={t.id} style={{left:Math.max(0,(t.start+t.duration/2)*zoom-width/2),width}}><button ref={button} className="timeline-transition" data-transition-id={t.id} aria-label={`トランジション ${t.video ? VIDEO_TRANSITIONS[t.video] : AUDIO_TRANSITIONS[t.audio!]}`} title={`${label} · ${t.duration.toFixed(2)}秒 · 両端をドラッグで長さを調整`} onPointerDown={e => e.stopPropagation()} onClick={adjust} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); open(e.clientX, e.clientY); }} onKeyDown={e => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); open(r.left + Math.min(20, r.width / 2), r.bottom); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); if (!e.repeat && !useEditor.getState().gestureActive) remove(); }
  }}>⋈</button>{(['start','end'] as const).map(side=><button key={side} className={`transition-resize-handle transition-resize-${side}`} role="slider" aria-label={`${label}の${side==='start'?'開始':'終了'}側の長さを調整`} aria-valuemin={1/project.fps} aria-valuemax={resizeInfo.maximum} aria-valuenow={t.duration} aria-valuetext={`${t.duration.toFixed(3)}秒`} disabled={!!resizeInfo.reason} title={resizeInfo.reason||'ドラッグで長さを調整。左右矢印で1フレーム、Shiftで10フレーム'} onPointerDown={e=>drag(e,side)} onClick={e=>{e.preventDefault();e.stopPropagation();}} onKeyDown={e=>resizeKey(e,side)}/>)}{dragging?<output className="transition-resize-readout">{t.duration.toFixed(3)}秒</output>:null}</div>{anchor && menuOpen ? createPortal(<div ref={menu} className="clip-context-menu transition-context-menu" role="menu" aria-label="トランジションの編集" style={{ left: anchor.x, top: anchor.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
    e.stopPropagation();
    const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
  }}><div className="clip-menu-heading">{label}<small>素材と動画の長さは変わりません</small></div><button role="menuitem" tabIndex={-1} onClick={() => { close(); adjust(); }}>効果を調整</button><button role="menuitem" tabIndex={-1} disabled={locked} title={locked ? 'トラックのロックを解除してください。' : undefined} onClick={remove}>トランジションを削除</button></div>, document.body) : null}</>;
}
