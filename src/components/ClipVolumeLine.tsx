import { useLayoutEffect, useRef, useState } from 'react';
import { volumeAt } from '../../shared/volume-automation.mjs';
import { addVolumePoint, effectiveKeys, editEffectivePointResult, editEffectiveSegment, removeVolumePoint, sameEffectiveVolume, volumeLabel } from '../volume-editing';
import { useEditor } from '../store';
import type { Clip } from '../types';
import '../volume-automation.css';

export default function ClipVolumeLine({clip, zoom, selected, locked}: {clip: Clip; zoom: number; selected: boolean; locked: boolean}) {
  const point=useEditor(s=>s.activeVolumePoint);
  const [readout,setReadout] = useState('');
  const [height,setHeight]=useState(48);
  const svg = useRef<SVGSVGElement>(null), cancelDrag = useRef<(()=>void)|null>(null);
  useLayoutEffect(()=>{const node=svg.current;if(!node)return;const observer=new ResizeObserver(()=>setHeight(Math.max(20,node.clientHeight)));observer.observe(node);return()=>{cancelDrag.current?.();observer.disconnect();};},[]);
  const keys = effectiveKeys(clip), width = Math.max(5,clip.duration*zoom);
  const active=point?.clipId===clip.id?keys.findIndex(k=>k.time===point.time):-1;
  const setActive=(index:number|null)=>useEditor.setState({activeVolumePoint:index===null?null:{clipId:clip.id,time:keys[index]?.time??0}});
  const x = (time: number) => Math.max(0,Math.min(width,time/clip.duration*width));
  const y = (value: number) => 8+(1-value/4)*(height-16);
  const points = [{time:0,value:volumeAt(keys,0)},...keys,{time:clip.duration,value:volumeAt(keys,clip.duration)}];
  const focused = active === null ? undefined : keys[active];
  const currentReadout = focused ? `${focused.time.toFixed(2)}秒 · ${volumeLabel(1,focused.value)}` : readout;
  const add = (clientX: number) => {
    const state=useEditor.getState();if(locked||state.gestureActive)return;
    try {
      const bounds=svg.current!.getBoundingClientRect(),time=(clientX-bounds.left)*clip.duration/bounds.width;
      const next=addVolumePoint(clip,time,state.project.fps);
      state.stop();state.select([clip.id]);
      if(next!==clip.volumeKeyframes)state.updateClip(clip.id,{volumeKeyframes:next});
      const index=next.reduce((best,key,i)=>Math.abs(key.time-time)<Math.abs(next[best].time-time)?i:best,0);
      const displayIndex=effectiveKeys({...clip,volumeKeyframes:next}).findIndex(key=>key.time===next[index].time);
      useEditor.setState({activeVolumePoint:{clipId:clip.id,time:next[index].time}});setReadout('点を上下で音量、左右で時刻を調整');
      requestAnimationFrame(()=>svg.current?.querySelector<SVGElement>(`[data-volume-index="${displayIndex}"]`)?.focus());
    } catch(e) { state.notify((e as Error).message); }
  };
  const drag = (event: React.PointerEvent<SVGElement>, index: number|null) => {
    // Shift-click belongs to the clip's multi-selection handler, even when the
    // pointer lands on a volume line or node in a compact audio row.
    if(event.altKey||event.shiftKey||useEditor.getState().tool!=='select')return;
    event.stopPropagation();if(event.button!==0)return;event.preventDefault();
    // Resolve overlapping hit areas by distance, not SVG paint order.
    let target=event.currentTarget;
    if(index!==null && svg.current){
      const bounds=svg.current.getBoundingClientRect();
      let nearest=Infinity;
      keys.forEach((key,i)=>{
        const distance=Math.hypot(event.clientX-bounds.left-x(key.time)*bounds.width/width,event.clientY-bounds.top-y(key.value)*bounds.height/height);
        if(distance<nearest){nearest=distance;index=i;}
      });
      target=svg.current.querySelector<SVGElement>(`[data-volume-index="${index}"]`)!;
    }
    target.focus();
    const state=useEditor.getState();if(locked||state.gestureActive)return;
    state.select([clip.id]);state.stop();setActive(index);
    const before=state.project, original=before.clips.find(c=>c.id===clip.id)!;
    const key=index===null?null:effectiveKeys(original)[index];if(index!==null&&!key)return;
    const owner={},capture=target,pointerId=event.pointerId,originX=event.clientX,originY=event.clientY;
    const scroll=svg.current?.closest<HTMLElement>('.timeline-scroll'),scrollStart=scroll?.scrollLeft||0;
    const rect=svg.current!.getBoundingClientRect(),secondsPerPixel=original.duration/rect.width,segmentTime=(originX-rect.left)*secondsPerPixel;let changed=false,ended=false;
    const end=()=>{
      if(ended)return;
      const current=useEditor.getState();
      if(changed&&current.gestureOwner===owner&&sameEffectiveVolume(original,current.project.clips.find(c=>c.id===clip.id)!))restore();
      ended=true;cancelDrag.current=null;
      capture.removeEventListener('lostpointercapture',cancel);if(capture.hasPointerCapture(pointerId))capture.releasePointerCapture(pointerId);
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',escape);window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',visibility);
      useEditor.getState().endGesture(owner);setReadout('');
    };
    const restore=()=>useEditor.setState({project:before,activeVolumePoint:state.activeVolumePoint,history:state.history,future:state.future,historyPlayheads:state.historyPlayheads,futurePlayheads:state.futurePlayheads,historyLabels:state.historyLabels,futureLabels:state.futureLabels,currentAction:state.currentAction,dirty:state.dirty});
    const cancel=()=>{
      if(ended)return;
      if(changed&&useEditor.getState().gestureOwner===owner)restore();
      setReadout('');end();
    };
    const move=(e: PointerEvent)=>{
      if(useEditor.getState().gestureOwner!==owner){end();return;}
      if(!changed&&Math.hypot(e.clientX-originX,e.clientY-originY)<3)return;
      const delta=-(e.clientY-originY)*4/(rect.height*(height-16)/height);
      let next:Partial<Clip>,movedPoint:{time:number;value:number}|undefined;
      try{
        if(index===null)next=editEffectiveSegment(original,segmentTime,delta);
        else {const result=editEffectivePointResult(original,index,key!.time+(e.clientX-originX+(scroll?.scrollLeft||0)-scrollStart)*secondsPerPixel,key!.value+delta,before.fps);next=result.patch;movedPoint=result.point;}
      }catch(error){state.notify((error as Error).message);cancel();return;}

      if(!changed&&sameEffectiveVolume(original,{...original,...next}))return;
      if(!changed){state.checkpoint(index===null?'音量ラインを調整':'音量ポイントを移動');changed=true;}
      state.transient({...before,clips:before.clips.map(c=>c.id===clip.id?{...c,...next}:c)},before);
      const updated={...original,...next};
      const point=index===null?{time:segmentTime,value:updated.volume*volumeAt(updated.volumeKeyframes||[],segmentTime)}:movedPoint!;
      if(index!==null)useEditor.setState({activeVolumePoint:{clipId:clip.id,time:point.time}});
      setReadout(`${point.time.toFixed(2)}秒 · ${volumeLabel(1,point.value)}`);
      if(scroll){const bounds=scroll.getBoundingClientRect();if(e.clientX>bounds.right-25)scroll.scrollLeft+=10;if(e.clientX<bounds.left+25)scroll.scrollLeft-=10;}
    };
    const escape=(e: KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}};
    const visibility=()=>{if(document.hidden)cancel();};
    if(!state.beginGesture(owner,cancel))return;cancelDrag.current=cancel;capture.setPointerCapture(pointerId);
    capture.addEventListener('lostpointercapture',cancel);window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',escape);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',visibility);
  };
  return <svg ref={svg} className="clip-volume-line" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="音量ライン">
    <path className="volume-line-visible" d={points.map((point,i)=>`${i?'L':'M'}${x(point.time)},${y(point.value)}`).join(' ')}/>
    <path className="volume-line-hit" d={points.map((point,i)=>`${i?'L':'M'}${x(point.time)},${y(point.value)}`).join(' ')} onPointerDown={e=>{if(e.shiftKey||e.altKey)return;if(e.ctrlKey||e.metaKey){e.stopPropagation();e.preventDefault();add(e.clientX);}else drag(e,null);}} onDoubleClick={e=>{if(e.shiftKey||e.altKey)return;e.stopPropagation();e.preventDefault();add(e.clientX);}}><title>線を上下にドラッグで区間の音量を調整。ダブルクリック、またはCtrl+クリックで点を追加</title></path>
    {selected?keys.map((key,index)=><g key={index}><circle data-volume-index={index} className={'volume-node '+(active===index?'active':'')} cx={x(key.time)} cy={y(key.value)} r={7} role="slider" tabIndex={locked?-1:0} aria-label={`音量ポイント ${index+1}`} aria-disabled={locked} aria-valuemin={0} aria-valuemax={400} aria-valuenow={Math.round(key.value*100)} aria-valuetext={`${key.time.toFixed(2)}秒、${volumeLabel(1,key.value)}`} onFocus={()=>setActive(index)} onBlur={()=>setReadout('')} onPointerDown={e=>drag(e,index)} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();}} onKeyDown={e=>{
      if(e.ctrlKey||e.metaKey)return;
      if(useEditor.getState().gestureActive)return;
      if(!['Delete','Backspace','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'].includes(e.key))return;
      e.preventDefault();e.stopPropagation();const state=useEditor.getState();if(locked||state.gestureActive)return;
      if(e.key==='Escape'){setActive(null);(svg.current?.closest('.timeline-clip') as HTMLElement)?.focus();return;}
      let next:Partial<Clip>,movedTime:number|undefined;
      try{
        if(e.key==='Delete'||e.key==='Backspace')next=removeVolumePoint(clip,index);
        else {const result=editEffectivePointResult(clip,index,key.time+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)*(e.shiftKey?10:1)/state.project.fps,key.value+(e.key==='ArrowUp'?1:e.key==='ArrowDown'?-1:0)*(e.shiftKey?.1:.01),state.project.fps);if(Math.abs(result.point.time-key.time)<1e-9&&Math.abs(result.point.value-key.value)<1e-9)return;next=result.patch;movedTime=result.point.time;}
      }catch(error){state.notify((error as Error).message);return;}
      if(!Object.keys(next).length)return;
      state.updateClip(clip.id,next);
      if(movedTime!==undefined)useEditor.setState({activeVolumePoint:{clipId:clip.id,time:movedTime}});
      if(e.key==='Delete'||e.key==='Backspace'){setActive(null);(svg.current?.closest('.timeline-clip') as HTMLElement)?.focus();}
    }}><title>{key.time.toFixed(2)}秒 · {volumeLabel(1,key.value)}（←→で1フレーム、Shift＋←→で10フレーム。↑↓で1%、Shift＋↑↓で10%。Deleteで点を削除）</title></circle><circle className="volume-node-visual" cx={x(key.time)} cy={y(key.value)} r={7} aria-hidden="true" /></g>):null}
    {selected&&currentReadout?<text className="volume-readout" x={8} y={11}>{currentReadout}</text>:null}
  </svg>;
}
