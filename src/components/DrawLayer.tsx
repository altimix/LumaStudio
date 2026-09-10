import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from '../store';
import { graphicFromPoints, arrowPoints } from '../../shared/graphics.mjs';
import { loadSoundForTimeline } from '../sounds';
export default function DrawLayer(){
  const panel=useEditor(s=>s.panel),tool=useEditor(s=>s.drawTool),p=useEditor(s=>s.project),settings=useEditor(s=>s.drawSettings),cleanup=useRef<(()=>void)|null>(null);
  const [points,setPoints]=useState<{from:{x:number;y:number};to:{x:number;y:number}}|null>(null);
  useEffect(()=>()=>cleanup.current?.(),[]);
  useEffect(()=>useEditor.subscribe((state,previous)=>{if(state.project!==previous.project||state.drawTool!==previous.drawTool||state.panel!==previous.panel)cleanup.current?.();}),[]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){cleanup.current?.();useEditor.setState({drawTool:null});}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  const draw=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(e.button!==0||!tool||cleanup.current||useEditor.getState().gestureActive)return;e.preventDefault();e.stopPropagation();const s=useEditor.getState(),snapshot=s.project;
    if(!snapshot.tracks.some(t=>t.kind==='video'&&!t.locked&&!t.hidden)){s.notify('図形を置く映像トラックを表示し、ロックを解除してください。');return;}
    const owner={};if(!s.beginGesture(owner,()=>cancel()))return;s.stop();const target=e.currentTarget,rect=target.getBoundingClientRect(),pointer=e.pointerId;
    const point=(event:PointerEvent|ReactPointerEvent)=>({x:Math.max(0,Math.min(p.width,(event.clientX-rect.left)/rect.width*p.width)),y:Math.max(0,Math.min(p.height,(event.clientY-rect.top)/rect.height*p.height))});
    const from=point(e);let to=from,closed=false;setPoints({from,to});target.setPointerCapture(pointer);
    const detach=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);target.removeEventListener('lostpointercapture',cancel);if(target.hasPointerCapture(pointer))target.releasePointerCapture(pointer);};
    const finish=()=>{if(closed)return;closed=true;window.removeEventListener('blur',cancel);detach();if(cleanup.current===cancel){cleanup.current=null;setPoints(null);useEditor.getState().endGesture(owner);}};
    const cancel=()=>finish();
    const move=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;to=point(event);setPoints({from,to});};
    const up=async(event:PointerEvent)=>{
      if(event.pointerId!==pointer)return;to=point(event);detach();
      if(Math.hypot((to.x-from.x)/p.width*rect.width,(to.y-from.y)/p.height*rect.height)<4){finish();return;}
      try{const sound=settings.sound==='none'?undefined:await loadSoundForTimeline(settings.sound,p.fps);if(!closed&&useEditor.getState().gestureOwner===owner&&useEditor.getState().project===snapshot){s.endGesture(owner);s.addDrawing({...graphicFromPoints(tool,from,to,p.width,p.height),start:s.playhead,color:settings.color,duration:settings.duration},sound,settings.volume);}}catch(error){if(!closed)s.notify((error as Error).message);}finally{finish();}
    };
    cleanup.current=cancel;window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);target.addEventListener('lostpointercapture',cancel);
  };
  if(!tool||panel!=='draw')return null;
  const arrow=points&&tool==='arrow'?arrowPoints(graphicFromPoints(tool,points.from,points.to,p.width,p.height).graphic!):null;
  const path=arrow&&points?arrow.map(([x,y])=>[x+(points.from.x+points.to.x)/2,y+(points.from.y+points.to.y)/2].join(' ')):null;
  return <div className="draw-layer" role="img" aria-label="図形を描くプレビュー" onPointerDown={draw}><span className="draw-instruction">ドラッグして{tool==='arrow'?'矢印':tool==='rectangle'?'四角':'丸'}を描く · Escで中止</span>{points?<svg viewBox={'0 0 '+p.width+' '+p.height} preserveAspectRatio="none"><g fill="none" stroke={settings.color} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">{tool==='arrow'?<path d={path?`M${path[0]}L${path[2]}M${path[1]}L${path[2]}L${path[3]}`:undefined}/>:tool==='rectangle'?<rect x={Math.min(points.from.x,points.to.x)} y={Math.min(points.from.y,points.to.y)} width={Math.abs(points.to.x-points.from.x)} height={Math.abs(points.to.y-points.from.y)}/>:<ellipse cx={(points.from.x+points.to.x)/2} cy={(points.from.y+points.to.y)/2} rx={Math.abs(points.to.x-points.from.x)/2} ry={Math.abs(points.to.y-points.from.y)/2}/>}</g></svg>:null}</div>;
}
