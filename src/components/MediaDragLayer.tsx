import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import type { Asset, BezierMaskPoint, BezierVideoMask, Clip, Crop } from '../types';
import { fadeAt } from '../render';
import { opacityAt } from '../../shared/opacity.mjs';
import { mediaBounds, mediaCorner, mediaNormalizedPoint, mediaPoint, mediaSourceKey, moveMedia, resizeMedia, visualOrder, type Corner, type MediaSize, type SourceSize } from '../media-transform';
import { NO_SNAP, sameSnapGuides, snapMonitorPosition } from '../monitor-snap';
import MonitorSnapGuides from './MonitorSnapGuides';
import './media-transform.css';
import { EMPTY_CROP, MAX_BEZIER_MASK_POINTS, moveBezierAnchor, moveBezierHandle, resizeMaskAxis } from '../../shared/video-mask.mjs';

const corners: (Corner & { name: string; cursor: string })[] = [
  { x: -1, y: -1, name: '左上', cursor: 'nwse-resize' }, { x: 1, y: -1, name: '右上', cursor: 'nesw-resize' },
  { x: 1, y: 1, name: '右下', cursor: 'nwse-resize' }, { x: -1, y: 1, name: '左下', cursor: 'nesw-resize' },
];
export default function MediaDragLayer({ sizes, actions }: { sizes: Record<string, MediaSize>; actions: HTMLElement | null }) {
  const project = useEditor(s => s.project), time = useEditor(s => s.playhead), playing = useEditor(s => s.playing), selected = useEditor(s => s.selected), editMode = useEditor(s => s.mediaEditMode);
  const root = useRef<HTMLDivElement>(null), cleanup = useRef<(() => void) | null>(null);
  const dragSize = useRef<(MediaSize & { clipId: string }) | null>(null);
  const [guides, setGuides] = useState(NO_SNAP);
  const order = useMemo(() => visualOrder(project), [project]);
  const assets = useMemo(() => new Map(project.assets.map(asset => [asset.id, asset])), [project.assets]);
  const tracks = useMemo(() => new Map(project.tracks.map(track => [track.id, track])), [project.tracks]);
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    const before = dragSize.current;
    if (!before) return;
    const after = sizes[before.clipId];
    if (!after || after.source !== before.source || after.width !== before.width || after.height !== before.height) cleanup.current?.();
  }, [sizes]);
  const sourceSize = (clip: Clip, asset: Asset): SourceSize => sizes[clip.id]?.source === mediaSourceKey(project, asset) ? sizes[clip.id] : asset;
  const active = playing ? [] : project.clips.flatMap(clip => {
    const track = tracks.get(clip.trackId), asset = assets.get(clip.assetId || '');
    return (clip.kind === 'video' || clip.kind === 'image') && track && !track.hidden && asset && !asset.offline && time >= clip.start && time < clip.start + clip.duration && fadeAt(clip, time) * opacityAt(clip.opacityKeyframes, time - clip.start, clip.opacity) > .001 ? [{ clip, asset, locked: track.locked }] : [];
  });
  const start = (event: ReactPointerEvent<HTMLButtonElement>, renderedClip: Clip, source: SourceSize, corner?: Corner) => {
    if (event.button !== 0 || cleanup.current || useEditor.getState().gestureActive) return;
    event.preventDefault(); event.stopPropagation();
    // Blur commits pending inspector values before taking the drag snapshot.
    // Keep subsequent Delete/playback shortcuts in the monitor's context.
    event.currentTarget.focus({ preventScroll: true });
    const initial = useEditor.getState(), project = initial.project;
    const clip = project.clips.find(item => item.id === renderedClip.id);
    const measured = sizes[renderedClip.id];
    if (!clip || !measured || initial.playing || initial.gestureActive) return;
    initial.select([clip.id]);
    if (initial.project.tracks.find(t => t.id === clip.trackId)?.locked) return;
    initial.stop();
    const owner = {}, target = event.currentTarget, pointer = event.pointerId, viewport = root.current!;
    const rect = viewport.getBoundingClientRect(), origin = { x: event.clientX, y: event.clientY }, action = corner ? '素材の表示サイズを変更' : '素材の表示位置を変更';
    if (!rect.width || !rect.height || !initial.beginGesture(owner, () => cancel())) return;
    let before = useEditor.getState(), expected = before.project, changed = false, closed = false, writing = false;
    let last = { x: clip.x, y: clip.y, scale: clip.scale };
    let snapped = NO_SNAP, lastPointer: PointerEvent | null = null;
    let previousDelta = { x: 0, y: 0 };
    const bounds = mediaBounds(clip, source, project);
    const detach = () => {
      closed = true; cleanup.current = null; dragSize.current = null; unsubscribe(); observer.disconnect();
      setGuides(NO_SNAP); lastPointer = null;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); document.removeEventListener('visibilitychange', visibility);
      target.removeEventListener('lostpointercapture', cancelPointer);
      if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
    };
    const finish = () => { if (closed) return; detach(); useEditor.getState().endGesture(owner); };
    const cancel = () => {
      if (closed) return;
      const current = useEditor.getState(); detach();
      if (changed && current.gestureOwner === owner && current.project.id === before.project.id) {
        const item = current.project.clips.find(c => c.id === clip.id), pure = current.project === expected;
        if (item && item.x === last.x && item.y === last.y && item.scale === last.scale) {
          const onlyDrag = pure && current.history.at(-1) === before.project && current.currentAction === action;
          useEditor.setState({ project: pure ? before.project : { ...current.project, clips: current.project.clips.map(c => c.id === clip.id ? { ...c, x: clip.x, y: clip.y, scale: clip.scale } : c) }, ...(onlyDrag ? {
            history: before.history, future: before.future, historyPlayheads: before.historyPlayheads, futurePlayheads: before.futurePlayheads,
            historyLabels: before.historyLabels, futureLabels: before.futureLabels, currentAction: before.currentAction, dirty: before.dirty,
          } : {}) });
        }
      }
      useEditor.getState().endGesture(owner);
    };
    const move = (e: PointerEvent, bypass = e.altKey) => {
      if (e.pointerId !== pointer || closed) return;
      lastPointer = e;
      const current = useEditor.getState();
      if (current.gestureOwner !== owner) { finish(); return; }
      if (!changed && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 3) return;
      const delta = { x: (e.clientX - origin.x) / rect.width * project.width, y: (e.clientY - origin.y) / rect.height * project.height };
      const result = snapMonitorPosition(clip, bounds, project, delta, rect, snapped, previousDelta);
      previousDelta = delta;
      const patch = corner ? resizeMedia(clip, source, project, corner, delta) : bypass ? moveMedia(clip, project, delta) : { x: result.x, y: result.y };
      if (!corner) { snapped = result.guides; const visible = bypass ? NO_SNAP : result.guides; setGuides(previous => sameSnapGuides(previous, visible) ? previous : visible); }
      if (patch.x === last.x && patch.y === last.y && (!('scale' in patch) || patch.scale === last.scale)) return;
      writing = true;
      try {
        if (!changed) { before = current; current.checkpoint(action); changed = true; }
        current.transient({ ...current.project, clips: current.project.clips.map(c => c.id === clip.id ? { ...c, ...patch } : c) });
        expected = useEditor.getState().project; last = { ...last, ...patch };
      } finally { writing = false; }
    };
    const up = (e: PointerEvent) => { if (e.pointerId === pointer) finish(); };
    const cancelPointer = (e: PointerEvent) => { if (e.pointerId === pointer) cancel(); };
    const key = (e: KeyboardEvent) => {
      if (e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      if (e.key === 'Alt' && !corner && lastPointer) { e.preventDefault(); move(lastPointer, e.altKey); }
    };
    const visibility = () => { if (document.hidden) cancel(); };
    const unsubscribe = useEditor.subscribe((current, previous) => {
      if (writing || closed) return;
      if (current.gestureOwner !== owner) { finish(); return; }
      // A separate committed edit owns its project and history. Finish this
      // drag without rewriting that edit; load() cancels before replacing a project.
      if (current.project !== expected) { finish(); return; }
      if (current.playing || current.playhead !== previous.playhead || current.seekRevision !== previous.seekRevision || current.drawTool !== previous.drawTool || !current.selected.includes(clip.id)) cancel();
    });
    const observer = new ResizeObserver(() => { const now = viewport.getBoundingClientRect(); if (Math.abs(now.width - rect.width) > .5 || Math.abs(now.height - rect.height) > .5 || Math.abs(now.left - rect.left) > .5 || Math.abs(now.top - rect.top) > .5) cancel(); });
    cleanup.current = cancel; dragSize.current = { ...measured, clipId: clip.id }; observer.observe(viewport);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); document.addEventListener('visibilitychange', visibility);
    target.addEventListener('lostpointercapture', cancelPointer); target.setPointerCapture(pointer);
  };
  type EffectOperation = { kind:'crop'; edge:keyof Crop } | { kind:'mask'; corner?:Corner };
  const startEffect = (event:ReactPointerEvent<HTMLButtonElement>,renderedClip:Clip,source:SourceSize,operation:EffectOperation) => {
    if(event.button!==0||cleanup.current||useEditor.getState().gestureActive)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});
    const initial=useEditor.getState(),clip=initial.project.clips.find(c=>c.id===renderedClip.id),viewport=root.current;
    if(!clip||!viewport||initial.playing||initial.project.tracks.find(t=>t.id===clip.trackId)?.locked)return;
    if(operation.kind==='mask'&&(!clip.videoMask||clip.videoMask.type==='bezier'))return;
    const owner={},target=event.currentTarget,pointer=event.pointerId,rect=viewport.getBoundingClientRect();
    if(!rect.width||!rect.height||!initial.beginGesture(owner,()=>cancel()))return;
    let before=useEditor.getState(),expected=before.project,changed=false,closed=false,writing=false,unsubscribe=()=>{};
    const origin={x:event.clientX,y:event.clientY},startPoint=mediaNormalizedPoint(clip,source,project,{x:(event.clientX-rect.left)/rect.width*project.width,y:(event.clientY-rect.top)/rect.height*project.height});
    const originalCrop={...(clip.crop||EMPTY_CROP)},originalMask=clip.videoMask&&clip.videoMask.type!=='bezier'?{...clip.videoMask}:undefined;
    const action=operation.kind==='crop'?'クロップ範囲を変更':'マスクを変更';
    const detach=()=>{closed=true;cleanup.current=null;unsubscribe();window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancelPointer);window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);target.removeEventListener('lostpointercapture',cancelPointer);if(target.hasPointerCapture(pointer))target.releasePointerCapture(pointer);};
    const finish=()=>{if(closed)return;detach();useEditor.getState().endGesture(owner);};
    const cancel=()=>{if(closed)return;const current=useEditor.getState();detach();if(changed&&current.gestureOwner===owner&&current.project===expected)useEditor.setState({project:before.project,history:before.history,future:before.future,historyPlayheads:before.historyPlayheads,futurePlayheads:before.futurePlayheads,historyLabels:before.historyLabels,futureLabels:before.futureLabels,currentAction:before.currentAction,dirty:before.dirty});useEditor.getState().endGesture(owner);};
    const move=(e:PointerEvent)=>{
      if(e.pointerId!==pointer||closed)return;const current=useEditor.getState();if(current.gestureOwner!==owner){finish();return;}if(!changed&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)<3)return;
      const point=mediaNormalizedPoint(clip,source,project,{x:(e.clientX-rect.left)/rect.width*project.width,y:(e.clientY-rect.top)/rect.height*project.height}),dx=point.x-startPoint.x,dy=point.y-startPoint.y;
      let patch:Partial<Clip>;
      if(operation.kind==='crop'){
        const crop={...originalCrop};
        if(operation.edge==='left')crop.left=Math.max(0,Math.min(.99-crop.right,originalCrop.left+dx));
        if(operation.edge==='right')crop.right=Math.max(0,Math.min(.99-crop.left,originalCrop.right-dx));
        if(operation.edge==='top')crop.top=Math.max(0,Math.min(.99-crop.bottom,originalCrop.top+dy));
        if(operation.edge==='bottom')crop.bottom=Math.max(0,Math.min(.99-crop.top,originalCrop.bottom-dy));
        patch={crop};
      }else{
        const mask={...originalMask!};
        if(!operation.corner){mask.x=Math.max(0,Math.min(1,originalMask!.x+dx));mask.y=Math.max(0,Math.min(1,originalMask!.y+dy));}
        else{
          const opposite={x:originalMask!.x-operation.corner.x*originalMask!.width/2,y:originalMask!.y-operation.corner.y*originalMask!.height/2};
          const horizontal=resizeMaskAxis(opposite.x,point.x,operation.corner.x),vertical=resizeMaskAxis(opposite.y,point.y,operation.corner.y);
          mask.x=horizontal.center;mask.y=vertical.center;mask.width=horizontal.size;mask.height=vertical.size;
        }
        patch={videoMask:mask};
      }
      writing=true;try{if(!changed){before=current;current.checkpoint(action);changed=true;}const now=useEditor.getState();now.transient({...now.project,clips:now.project.clips.map(c=>c.id===clip.id?{...c,...patch}:c)});expected=useEditor.getState().project;}finally{writing=false;}
    };
    const up=(e:PointerEvent)=>{if(e.pointerId===pointer)finish();},cancelPointer=(e:PointerEvent)=>{if(e.pointerId===pointer)cancel();},key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();cancel();}};
    cleanup.current=cancel;window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancelPointer);window.addEventListener('keydown',key);window.addEventListener('blur',cancel);target.addEventListener('lostpointercapture',cancelPointer);target.setPointerCapture(pointer);
    unsubscribe=useEditor.subscribe((current)=>{if(writing||closed)return;if(current.gestureOwner!==owner){finish();return;}if(current.project!==expected||current.playing||current.mediaEditMode!==editMode||!current.selected.includes(clip.id))cancel();});
  };
  const startBezierDrag=(event:ReactPointerEvent<HTMLButtonElement>,renderedClip:Clip,source:SourceSize,index:number,part:'anchor'|'in'|'out')=>{
    if(event.button!==0||cleanup.current||useEditor.getState().gestureActive)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});
    const initial=useEditor.getState(),clip=initial.project.clips.find(c=>c.id===renderedClip.id),viewport=root.current;
    if(!clip||!viewport||clip.videoMask?.type!=='bezier'||!clip.videoMask.points[index]||initial.playing||initial.project.tracks.find(t=>t.id===clip.trackId)?.locked)return;
    const owner={},target=event.currentTarget,pointer=event.pointerId,rect=viewport.getBoundingClientRect(),originalMask:BezierVideoMask={...clip.videoMask,points:clip.videoMask.points.map(point=>({...point}))};
    if(!rect.width||!rect.height||!initial.beginGesture(owner,()=>cancel()))return;
    let before=useEditor.getState(),expected=before.project,changed=false,closed=false,writing=false,unsubscribe=()=>{};
    const origin={x:event.clientX,y:event.clientY},startPoint=mediaNormalizedPoint(clip,source,project,{x:(event.clientX-rect.left)/rect.width*project.width,y:(event.clientY-rect.top)/rect.height*project.height});
    const detach=()=>{closed=true;cleanup.current=null;unsubscribe();window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancelPointer);window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);window.removeEventListener('resize',cancel);document.removeEventListener('visibilitychange',visibility);target.removeEventListener('lostpointercapture',cancelPointer);if(target.hasPointerCapture(pointer))target.releasePointerCapture(pointer);};
    const finish=()=>{if(closed)return;detach();useEditor.getState().endGesture(owner);};
    const cancel=()=>{if(closed)return;const current=useEditor.getState();detach();if(changed&&current.gestureOwner===owner&&current.project===expected)useEditor.setState({project:before.project,history:before.history,future:before.future,historyPlayheads:before.historyPlayheads,futurePlayheads:before.futurePlayheads,historyLabels:before.historyLabels,futureLabels:before.futureLabels,currentAction:before.currentAction,dirty:before.dirty});useEditor.getState().endGesture(owner);};
    const move=(e:PointerEvent)=>{
      if(e.pointerId!==pointer||closed)return;const current=useEditor.getState();if(current.gestureOwner!==owner){finish();return;}if(!changed&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)<3)return;
      const point=mediaNormalizedPoint(clip,source,project,{x:(e.clientX-rect.left)/rect.width*project.width,y:(e.clientY-rect.top)/rect.height*project.height}),dx=point.x-startPoint.x,dy=point.y-startPoint.y;
      const points=originalMask.points.map(item=>({...item})),original=originalMask.points[index];
      points[index]=part==='anchor'?moveBezierAnchor(original,dx,dy):moveBezierHandle(original,part,dx,dy);
      if(JSON.stringify(points[index])===JSON.stringify(original))return;
      writing=true;try{if(!changed){before=current;current.checkpoint('ベジェマスクの点を変更');changed=true;}const now=useEditor.getState();now.transient({...now.project,clips:now.project.clips.map(c=>c.id===clip.id?{...c,videoMask:{...originalMask,points}}:c)});expected=useEditor.getState().project;}finally{writing=false;}
    };
    const up=(e:PointerEvent)=>{if(e.pointerId===pointer)finish();},cancelPointer=(e:PointerEvent)=>{if(e.pointerId===pointer)cancel();},key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}},visibility=()=>{if(document.hidden)cancel();};
    cleanup.current=cancel;window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancelPointer);window.addEventListener('keydown',key);window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);document.addEventListener('visibilitychange',visibility);target.addEventListener('lostpointercapture',cancelPointer);target.setPointerCapture(pointer);
    unsubscribe=useEditor.subscribe(current=>{if(writing||closed)return;if(current.gestureOwner!==owner){finish();return;}if(current.project!==expected||current.playing||current.mediaEditMode!=='mask'||!current.selected.includes(clip.id))cancel();});
  };
  const addBezierPoint=(event:ReactPointerEvent<HTMLButtonElement>,renderedClip:Clip,source:SourceSize)=>{
    if(event.button!==0||cleanup.current||useEditor.getState().gestureActive)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});
    const state=useEditor.getState(),clip=state.project.clips.find(c=>c.id===renderedClip.id),viewport=root.current;
    if(!clip||!viewport||clip.videoMask?.type!=='bezier'||clip.videoMask.closed||clip.videoMask.points.length>=MAX_BEZIER_MASK_POINTS||state.project.tracks.find(t=>t.id===clip.trackId)?.locked)return;
    const rect=viewport.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const raw=mediaNormalizedPoint(clip,source,state.project,{x:(event.clientX-rect.left)/rect.width*state.project.width,y:(event.clientY-rect.top)/rect.height*state.project.height});
    const x=Math.max(0,Math.min(1,raw.x)),y=Math.max(0,Math.min(1,raw.y)),point:BezierMaskPoint={x,y,inX:x,inY:y,outX:x,outY:y,kind:'line'};
    state.updateClip(clip.id,{videoMask:{...clip.videoMask,points:[...clip.videoMask.points,point]}});
  };
  const current = active.find(item => selected.includes(item.clip.id));
  const effectOverlay=()=>{
    if(!current||current.locked)return null;const {clip,asset}=current;if(sizes[clip.id]?.source!==mediaSourceKey(project,asset))return null;
    const source=sourceSize(clip,asset),bounds=mediaBounds(clip,source,project),z=900000+(order.get(clip.id)||1);
    const style=(center:{x:number;y:number},width:number,height:number,ellipse=false)=>({left:center.x/project.width*100+'%',top:center.y/project.height*100+'%',width:width/project.width*100+'%',height:height/project.height*100+'%',transform:`translate(-50%,-50%) rotate(${clip.rotation}deg)`,borderRadius:ellipse?'50%':'0',zIndex:z});
    if(editMode==='crop'){
      const crop=clip.crop||EMPTY_CROP,center=mediaPoint(clip,source,project,{x:(crop.left+1-crop.right)/2,y:(crop.top+1-crop.bottom)/2});
      const edgePoints:{edge:keyof Crop;point:{x:number;y:number};cursor:string}[]=[{edge:'top',point:mediaPoint(clip,source,project,{x:(crop.left+1-crop.right)/2,y:crop.top}),cursor:'ns-resize'},{edge:'right',point:mediaPoint(clip,source,project,{x:1-crop.right,y:(crop.top+1-crop.bottom)/2}),cursor:'ew-resize'},{edge:'bottom',point:mediaPoint(clip,source,project,{x:(crop.left+1-crop.right)/2,y:1-crop.bottom}),cursor:'ns-resize'},{edge:'left',point:mediaPoint(clip,source,project,{x:crop.left,y:(crop.top+1-crop.bottom)/2}),cursor:'ew-resize'}];
      const edgeNames:Record<keyof Crop,string>={top:'上',right:'右',bottom:'下',left:'左'};
      return <><div className="media-effect-box crop" style={style(center,bounds.width*(1-crop.left-crop.right),bounds.height*(1-crop.top-crop.bottom))}/>{edgePoints.map(({edge,point,cursor})=><button key={edge} className="media-effect-handle edge" data-crop-edge={edge} aria-label={`${edgeNames[edge]}のクロップ量を変更`} style={{left:point.x/project.width*100+'%',top:point.y/project.height*100+'%',cursor,zIndex:z+1}} onPointerDown={e=>startEffect(e,clip,source,{kind:'crop',edge})}/>)}</>;
    }
    if(editMode==='mask'&&clip.videoMask?.type!=='bezier'&&clip.videoMask){const mask=clip.videoMask,center=mediaPoint(clip,source,project,{x:mask.x,y:mask.y});return <><button className="media-effect-box mask" aria-label="マスクを移動" style={style(center,bounds.width*mask.width,bounds.height*mask.height,mask.type==='ellipse')} onPointerDown={e=>startEffect(e,clip,source,{kind:'mask'})}/>{corners.map(corner=>{const point=mediaPoint(clip,source,project,{x:mask.x+corner.x*mask.width/2,y:mask.y+corner.y*mask.height/2});return <button key={corner.name} className="media-effect-handle" aria-label={`マスクの${corner.name}を変更`} style={{left:point.x/project.width*100+'%',top:point.y/project.height*100+'%',cursor:corner.cursor,zIndex:z+1}} onPointerDown={e=>startEffect(e,clip,source,{kind:'mask',corner})}/>;})}</>}
    if(editMode==='mask'&&clip.videoMask?.type==='bezier'){
      const mask=clip.videoMask,screenPoints=mask.points.map(point=>({anchor:mediaPoint(clip,source,project,point),incoming:mediaPoint(clip,source,project,{x:point.inX,y:point.inY}),outgoing:mediaPoint(clip,source,project,{x:point.outX,y:point.outY}),kind:point.kind}));
      let path='';if(screenPoints.length){path=`M ${screenPoints[0].anchor.x} ${screenPoints[0].anchor.y}`;for(let index=1;index<screenPoints.length;index++){const previous=screenPoints[index-1],point=screenPoints[index];path+=(previous.kind==='curve'||point.kind==='curve')?` C ${previous.kind==='curve'?previous.outgoing.x:previous.anchor.x} ${previous.kind==='curve'?previous.outgoing.y:previous.anchor.y} ${point.kind==='curve'?point.incoming.x:point.anchor.x} ${point.kind==='curve'?point.incoming.y:point.anchor.y} ${point.anchor.x} ${point.anchor.y}`:` L ${point.anchor.x} ${point.anchor.y}`;}if(mask.closed){const previous=screenPoints.at(-1)!,point=screenPoints[0];path+=(previous.kind==='curve'||point.kind==='curve')?` C ${previous.kind==='curve'?previous.outgoing.x:previous.anchor.x} ${previous.kind==='curve'?previous.outgoing.y:previous.anchor.y} ${point.kind==='curve'?point.incoming.x:point.anchor.x} ${point.kind==='curve'?point.incoming.y:point.anchor.y} ${point.anchor.x} ${point.anchor.y}`:` L ${point.anchor.x} ${point.anchor.y}`;path+=' Z';}}
      return <>
        {!mask.closed&&mask.points.length<MAX_BEZIER_MASK_POINTS?<button className="bezier-add-target" aria-label="ベジェマスクの点を追加" title="クリックして点を追加" style={{left:bounds.x/project.width*100+'%',top:bounds.y/project.height*100+'%',width:bounds.width/project.width*100+'%',height:bounds.height/project.height*100+'%',transform:`translate(-50%,-50%) rotate(${clip.rotation}deg)`,zIndex:z}} onPointerDown={e=>addBezierPoint(e,clip,source)}/>:null}
        <svg className="bezier-mask-path" viewBox={`0 0 ${project.width} ${project.height}`} preserveAspectRatio="none" style={{zIndex:z+1}} aria-hidden="true"><path d={path}/>{screenPoints.flatMap((point,index)=>point.kind==='curve'?[<line key={`in-line-${index}`} x1={point.anchor.x} y1={point.anchor.y} x2={point.incoming.x} y2={point.incoming.y}/>,<line key={`out-line-${index}`} x1={point.anchor.x} y1={point.anchor.y} x2={point.outgoing.x} y2={point.outgoing.y}/>] : [])}</svg>
        {screenPoints.map((point,index)=><Fragment key={index}><button className="bezier-mask-anchor" aria-label={`ベジェマスクの点 ${index+1}を移動`} style={{left:point.anchor.x/project.width*100+'%',top:point.anchor.y/project.height*100+'%',zIndex:z+3}} onPointerDown={e=>startBezierDrag(e,clip,source,index,'anchor')}/>{point.kind==='curve'?<><button className="bezier-mask-handle" aria-label={`点 ${index+1}の入力ハンドルを移動`} style={{left:point.incoming.x/project.width*100+'%',top:point.incoming.y/project.height*100+'%',zIndex:z+2}} onPointerDown={e=>startBezierDrag(e,clip,source,index,'in')}/><button className="bezier-mask-handle" aria-label={`点 ${index+1}の出力ハンドルを移動`} style={{left:point.outgoing.x/project.width*100+'%',top:point.outgoing.y/project.height*100+'%',zIndex:z+2}} onPointerDown={e=>startBezierDrag(e,clip,source,index,'out')}/></>:null}</Fragment>)}
      </>;
    }
    return null;
  };
  return <><div className="media-drag-layer" ref={root}>{editMode==='transform'&&!playing && active.map(({ clip, asset, locked }) => {
    if (sizes[clip.id]?.source !== mediaSourceKey(project, asset)) return null;
    const size = sourceSize(clip, asset), bounds = mediaBounds(clip, size, project), chosen = selected.includes(clip.id), z = order.get(clip.id) || 1;
    return <Fragment key={clip.id}>
      <button className={'media-drag-target' + (chosen ? ' selected' : '')} data-media-clip-id={clip.id} aria-label={'素材「' + clip.name + '」を移動'} aria-pressed={chosen} aria-disabled={locked} tabIndex={chosen ? 0 : -1}
        title={locked ? 'トラックがロックされています' : 'ドラッグして移動 · 端・中央線に触れると吸着 · Altで吸着解除 · 四隅でサイズ変更'}
        style={{ left: bounds.x / project.width * 100 + '%', top: bounds.y / project.height * 100 + '%', width: bounds.width / project.width * 100 + '%', height: bounds.height / project.height * 100 + '%', transform: `translate(-50%,-50%) rotate(${clip.rotation}deg)`, zIndex: z }}
        onPointerDown={e => start(e, clip, size)} onClick={() => useEditor.getState().select([clip.id])}/>
      {chosen && !locked && corners.map(corner => { const point = mediaCorner(clip, size, project, corner); return <button key={corner.name} className="media-resize-handle" data-media-clip-id={clip.id} data-media-corner={corner.name}
        aria-label={'素材「' + clip.name + '」の' + corner.name + 'でサイズを変更'} title="縦横比を保って拡大縮小"
        style={{ left: `clamp(6px,${point.x / project.width * 100}%,calc(100% - 6px))`, top: `clamp(6px,${point.y / project.height * 100}%,calc(100% - 6px))`, cursor: corner.cursor, zIndex: 900000 + z }} onPointerDown={e => start(e, clip, size, corner)}/>; })}
    </Fragment>;
  })}{!playing&&editMode!=='transform'?effectOverlay():null}<MonitorSnapGuides guides={guides}/></div>
    {!playing && editMode==='transform' && current && !current.locked && actions ? createPortal(<button className="media-transform-reset" disabled={current.clip.x === 0 && current.clip.y === 0 && current.clip.scale === 1} onClick={() => { cleanup.current?.(); useEditor.getState().updateClip(current.clip.id, { x: 0, y: 0, scale: 1 }); }}>位置・大きさを戻す</button>, actions) : null}</>;
}
