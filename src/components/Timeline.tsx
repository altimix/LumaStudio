import { separateOverlappingClips } from '../track-placement';
import TrackDeleteButton from './TrackDeleteButton';
import TimelineScrollbars from './TimelineScrollbars';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MousePointer2, Scissors, Magnet, Undo2, Redo2, Copy, Trash2, BookmarkPlus, Minus, Plus, Maximize2, Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Film, Music2, ChevronDown, Type, MoveHorizontal, LocateFixed, Gauge, Link2 } from 'lucide-react';
import { transitionPlan } from '../../shared/transitions.mjs';
import type { TransitionOptions } from '../types';
import TimelineTransition from './TimelineTransition';
import ClipContextMenu, { type ClipMenuAnchor } from './ClipContextMenu';
import GapContextMenu, { type GapMenuAnchor } from './GapContextMenu';
import { findTimelineGap } from '../gap-editing';
import ClipVolumeLine from './ClipVolumeLine';
import ClipWaveform from './ClipWaveform';
import { snapMove } from '../move-snapping';
import { linkedIds, clipsLocked, cloneLinkedClips } from '../../shared/clip-links.mjs';
import AudioJobProgress from './AudioJobProgress';
import { useEditor } from '../store';
import type { Asset, Clip, Project, Track } from '../types';
import { endTime, snapTime, timecode, trimClip, rateStretchClip, roundFrame, uid } from '../model';
import { usePlayheadViewport } from '../use-playhead-viewport';
import { useTimelineSelection } from '../use-timeline-selection';
import '../timeline-selection.css';
import AudioMeter from './AudioMeter';
import { IconButton } from './UI';
import { rulerStep, timelineLength, timelineZoomBounds } from '../../shared/time.mjs';
import { clipWaveformRange, EMPTY_WAVEFORM_RANGE } from '../waveform-viewport';

function ClipItem({ clip, asset, track, selected, related, zoom, waveformLeft, waveformRight, onDrag, onMenu, editingLocked, tool }: { clip: Clip; asset?: Asset; track: Track; editingLocked:boolean; tool: 'select'|'razor'|'rate'; selected: boolean; related:boolean; waveformLeft:number; waveformRight:number; onMenu:(clip:Clip,element:HTMLElement,x:number,y:number)=>void; zoom: number; onDrag: (e: React.PointerEvent, c: Clip, mode: 'move' | 'left' | 'right') => void }) {
  return <div className={`timeline-clip ${clip.kind} ${editingLocked ? 'editing-locked' : ''} ${selected ? 'selected' : ''} ${related ? 'linked-selected' : ''} ${clip.audioMuted ? 'audio-muted' : ''} ${asset?.offline ? 'offline' : ''} ${track.locked ? 'locked' : ''}`} data-clip-id={clip.id} tabIndex={0} role="button" aria-label={`${clip.name}、開始 ${clip.start.toFixed(2)} 秒、長さ ${clip.duration.toFixed(2)} 秒`} aria-pressed={selected} style={{ left: clip.start * zoom, width: Math.max(5, clip.duration * zoom) }} onPointerDown={e => onDrag(e, clip, 'move')} onContextMenu={e => {e.preventDefault();e.stopPropagation();onMenu(clip,e.currentTarget,e.clientX,e.clientY);}} onKeyDown={e => { if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();onMenu(clip,e.currentTarget,r.left+Math.min(40,r.width/2),r.top+20);return;} if (e.key === 'Enter') { e.preventDefault(); useEditor.getState().select([clip.id]); useEditor.getState().seek(clip.start); } }}>
    {clip.kind === 'video' || clip.kind === 'image' ? <div className="clip-filmstrip" style={{ backgroundImage: asset?.thumbnail ? `url("${asset.thumbnail}")` : undefined }}/> : null}
    <div className="clip-name">{clip.kind === 'title' ? <Type size={12}/> : clip.kind === 'audio' ? <Music2 size={12}/> : <Film size={12}/>}<span>{clip.name}</span>{clip.linkId ? <Link2 className="clip-link-icon" size={11} aria-label="映像と音声をリンク中"/> : null}{clip.audioMuted ? <VolumeX size={11} aria-label="ミュート中"/> : null}{clip.speed !== 1 ? <small>{Number(clip.speed.toFixed(3))}×</small> : null}</div>
    {!clip.audioDetached&&asset?.hasAudio?<ClipWaveform clip={clip} asset={asset} zoom={zoom} left={waveformLeft} right={waveformRight}/>:null}
    {clip.fadeIn ? <div className="clip-fade in" style={{ width: clip.fadeIn * zoom }}/> : null}{clip.fadeOut ? <div className="clip-fade out" style={{ width: clip.fadeOut * zoom }}/> : null}
    {asset?.hasAudio&&!clip.audioDetached&&['audio','video'].includes(clip.kind)?<ClipVolumeLine clip={clip} zoom={zoom} selected={selected} locked={track.locked}/>:null}
    {!editingLocked ? <><div className="trim-handle left" title={tool === 'rate' ? '開始側をドラッグして再生速度を調整' : '開始点をドラッグして長さを調整'} onPointerDown={e => onDrag(e, clip, 'left')}/><div className="trim-handle right" title={tool === 'rate' ? '終了側をドラッグして再生速度を調整' : '終了点をドラッグして長さを調整'} onPointerDown={e => onDrag(e, clip, 'right')}/></> : null}
  </div>;
}
const MemoClip = memo(ClipItem);
export default function Timeline({ onImport }: { onImport?: () => void }) {
  const [rowHeight,setRowHeight]=useState(80);
  const p = useEditor(s => s.project); const selected = useEditor(s => s.selected); const playhead = useEditor(s => s.playhead); const zoom = useEditor(s => s.zoom);
  const snapping = useEditor(s => s.snapping); const tool = useEditor(s => s.tool); const canUndo = useEditor(s => s.history.length > 0); const canRedo = useEditor(s => s.future.length > 0);
  const scroller = useRef<HTMLDivElement>(null); const labels = useRef<HTMLDivElement>(null); const trackMenu = useEditor(s => s.trackMenuOpen); const setTrackMenu = (trackMenuOpen: boolean) => useEditor.setState({ trackMenuOpen }); const [dropTrack, setDropTrack] = useState<string | null>(null); const [snapLine, setSnapLine] = useState<number | null>(null);
  const [clipMenu,setClipMenu]=useState<ClipMenuAnchor|null>(null);
  const [gapMenu,setGapMenu]=useState<GapMenuAnchor|null>(null);
  const menuOpen=useEditor(s=>s.clipMenuOpen);
  const closeClipMenu=useCallback(()=>{setClipMenu(null);useEditor.setState({clipMenuOpen:false});},[]);
  const closeGapMenu=useCallback(()=>{setGapMenu(null);useEditor.setState({clipMenuOpen:false});},[]);
  useLayoutEffect(()=>()=>{useEditor.setState({clipMenuOpen:false});},[]);
  const openClipMenu=useCallback((clip:Clip,element:HTMLElement,x:number,y:number)=>{
    const state=useEditor.getState();if(state.gestureActive)return;const ids=state.selected.includes(clip.id)?state.selected:[clip.id];state.select(ids);state.stop();useEditor.setState({clipMenuOpen:true,trackMenuOpen:false});setGapMenu(null);setClipMenu({ids,x,y,element,project:state.project});
  },[]);
  const related=useMemo(()=>new Set(linkedIds(p,selected)),[p,selected]);
  const editingLockedIds=useMemo(()=>{const locked=new Set(p.tracks.filter(t=>t.locked).map(t=>t.id));return new Set(linkedIds(p,p.clips.filter(c=>locked.has(c.trackId)).map(c=>c.id)));},[p]);
  const selectedIds=useMemo(()=>new Set(selected),[selected]);
  const assetsById=useMemo(()=>new Map(p.assets.map(asset=>[asset.id,asset])),[p.assets]);
  const clipsByTrack=useMemo(()=>{const groups=new Map<string,Clip[]>();for(const clip of p.clips){let group=groups.get(clip.trackId);if(!group){group=[];groups.set(clip.trackId,group);}group.push(clip);}return groups;},[p.clips]);
  const transitions=useMemo(()=>transitionPlan(p),[p]);
  const total = endTime(p); const extent = Math.max(total, playhead); const length = timelineLength(extent); const width = Math.max(700, length * zoom); const tickStep = rulerStep(zoom); const zoomBounds = timelineZoomBounds(extent);
  const [rulerViewport, setRulerViewport] = useState({ left: 0, width: 2000 });
  const updateRuler = useCallback(() => {
    const view = scroller.current; if (!view) return;
    setRulerViewport(previous => previous.left === view.scrollLeft && previous.width === view.clientWidth ? previous : { left: view.scrollLeft, width: view.clientWidth });
  }, []);
  useLayoutEffect(() => { updateRuler(); const observer = new ResizeObserver(updateRuler); if (scroller.current) observer.observe(scroller.current); return () => observer.disconnect(); }, [updateRuler]);
  const firstTick = Math.max(0, Math.floor(rulerViewport.left / zoom / tickStep) - 1);
  const lastTick = Math.min(Math.floor(length / tickStep), Math.ceil((rulerViewport.left + rulerViewport.width) / zoom / tickStep) + 1);
  const { followPlayhead, setFollowPlayhead, revealPlayhead, scrub, onViewportScroll } = usePlayheadViewport(scroller);
  const { selectionBox, startSelection } = useTimelineSelection(scroller);
  const localTime = useCallback((clientX: number) => { const rect = scroller.current!.getBoundingClientRect(); return Math.max(0, (clientX - rect.left + scroller.current!.scrollLeft) / useEditor.getState().zoom); }, []);
  const openGapMenu=useCallback((trackId:string,time:number,element:HTMLElement,x:number,y:number)=>{
    const state=useEditor.getState();if(state.gestureActive)return;
    state.stop();element.focus({preventScroll:true});setClipMenu(null);
    useEditor.setState({clipMenuOpen:true,trackMenuOpen:false});setGapMenu({trackId,time,element,x,y,project:state.project});
  },[]);
  const highlightedGap=gapMenu&&menuOpen&&gapMenu.project===p?findTimelineGap(p,gapMenu.trackId,gapMenu.time):null;
  const cancelDrag=useRef<(()=>void)|null>(null);useLayoutEffect(()=>()=>cancelDrag.current?.(),[]);
  const startDrag = useCallback((e: React.PointerEvent, clip: Clip, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation(); if (e.button !== 0) return; e.preventDefault();(e.currentTarget.closest('.timeline-clip') as HTMLElement)?.focus({preventScroll:true});cancelDrag.current?.(); const s = useEditor.getState();if(s.gestureActive)return;
    if (s.tool === 'razor') { s.split(localTime(e.clientX), [clip.id]); return; }
    if (s.tool === 'rate') { if (!['video', 'audio'].includes(clip.kind)) { s.notify('レート調整には動画または音声クリップを選択してください。'); return; } if (mode === 'move') mode = 'right'; }
    let ids = s.selected.includes(clip.id) ? s.selected : [clip.id];
    if (e.shiftKey) { ids = s.selected.includes(clip.id) ? s.selected.filter(id => id !== clip.id) : [...s.selected, clip.id]; s.select(ids); return; }
    s.select(ids); s.stop();
    if (clipsLocked(s.project,linkedIds(s.project,mode==='move'?ids:[clip.id]))) {s.notify('リンク相手を含むトラックのロックを解除してください。');return;}
    const explicitCount=ids.length;ids=linkedIds(s.project,ids);
    const copying=e.altKey&&mode==='move'&&s.tool==='select';
    if(copying&&s.project.clips.length+ids.length>2000){s.notify('クリップは最大2000個です。');return;}
    const originals=s.project.clips.filter(c=>ids.includes(c.id));
    const copies=copying?cloneLinkedClips(originals,uid,0):[];
    const copyIds=new Map(originals.map((c,i)=>[c.id,copies[i]?.id]));
    const owner={};if(!s.beginGesture(owner,()=>cancel()))return;
    const before: Project = s.project; const originX = e.clientX, originY=e.clientY; const scrollStart = scroller.current!.scrollLeft;
    document.documentElement.dataset.timelineGesture=s.tool === 'rate' ? 'rate' : mode === 'move' ? (copying ? 'copy' : 'move') : 'trim';
    let started = false, ended=false;const capture=scroller.current!,pointerId=e.pointerId;capture.setPointerCapture(pointerId);
    const move = (event: PointerEvent) => {
      if(useEditor.getState().gestureOwner!==owner){end();return;}
      if (!started && Math.hypot(event.clientX-originX,mode==='move'?event.clientY-originY:0) < 3) return;
      if (!started) { s.checkpoint(s.tool === 'rate' ? 'レートを調整' : mode === 'move' ? (copying?'クリップを複製して移動':'クリップを移動') : 'クリップをトリム'); started = true; }
      const horizontalPixels = event.clientX - originX + scroller.current!.scrollLeft - scrollStart;
      let delta = horizontalPixels / s.zoom;
      const excluded = mode === 'move' ? ids : linkedIds(before,[clip.id]);
      let newTrack = clip.trackId;
      if (mode === 'move') {
        const hits = document.elementsFromPoint(event.clientX, event.clientY); const lane = hits.find(el => el.hasAttribute('data-track-id'));
        const target = before.tracks.find(t => t.id === lane?.getAttribute('data-track-id'));
        if (explicitCount === 1 && target && !target.locked && (target.kind === 'video' || clip.kind === 'audio')) newTrack = target.id;
        const minStart = Math.min(...before.clips.filter(c => ids.includes(c.id)).map(c => c.start)); delta = Math.max(-minStart, delta);
      }
      // Across tracks, small horizontal hand movement should not change timing.
      const preserveStart=s.snapping&&mode==='move'&&newTrack!==clip.trackId&&Math.abs(horizontalPixels)<=16;
      if(preserveStart){delta=0;setSnapLine(clip.start);}
      else if (s.snapping) {
        if(mode==='move') {
          const match=copying?null:snapMove(before,ids,delta,8/s.zoom,s.playhead);
          // Copies snap against the originals as well as the other clips.
          const copiedMatch=copying?snapMove({...before,clips:[...before.clips,...copies]},copies.map(c=>c.id),delta,8/s.zoom,s.playhead):match!;
          delta=copiedMatch.delta;setSnapLine(copiedMatch.point);
        } else {
          const originalPoint=clip.start+(mode==='right'?clip.duration:0), proposed=originalPoint+delta;
          const snapped=snapTime(proposed,before,excluded,8/s.zoom,s.playhead);
          setSnapLine(Math.abs(snapped-proposed)>0.0001?snapped:null);delta=snapped-originalPoint;
        }
      }
      delta = roundFrame(delta, before.fps);
      const clips = before.clips.map(c => {
        if (!copying && mode === 'move' && ids.includes(c.id) && !before.tracks.find(t => t.id === c.trackId)?.locked) return { ...c, start: preserveStart?c.start:Math.max(0, roundFrame(c.start + delta, before.fps)), trackId: c.id === clip.id ? newTrack : c.trackId };
        return c.id === clip.id && mode !== 'move' ? (s.tool === 'rate' ? rateStretchClip(c, mode, delta, before) : trimClip(c, mode, delta, before)) : c;
      });
      if(copying){clips.push(...copies.map(c=>({...c,start:preserveStart?c.start:Math.max(0,roundFrame(c.start+delta,before.fps)),trackId:c.id===copyIds.get(clip.id)?newTrack:c.trackId})));useEditor.getState().select(copies.map(c=>c.id));}
      s.transient({ ...before, clips },before);
      const rect = scroller.current!.getBoundingClientRect(); if (event.clientX > rect.right - 35) scroller.current!.scrollLeft += 10; if (event.clientX < rect.left + 25) scroller.current!.scrollLeft -= 10;
    };
    const end = () => { if(ended)return;ended=true;delete document.documentElement.dataset.timelineGesture;cancelDrag.current=null;capture.removeEventListener('lostpointercapture',cancel);document.removeEventListener('visibilitychange',visibility);if(capture.hasPointerCapture(pointerId))capture.releasePointerCapture(pointerId);useEditor.getState().endGesture(owner); setSnapLine(null); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); window.removeEventListener('blur', cancel); };
    const cancel = () => { if(ended)return;if (started&&useEditor.getState().gestureOwner===owner) { useEditor.setState({ project: before, selected:s.selected, activeVolumePoint:s.activeVolumePoint, zoom: s.zoom, history: s.history, future: s.future, historyPlayheads:s.historyPlayheads, futurePlayheads:s.futurePlayheads, historyLabels: s.historyLabels, futureLabels: s.futureLabels, currentAction: s.currentAction, dirty: s.dirty }); } end(); };
    const finish = () => {
      if(ended)return;
      const current=useEditor.getState();
      if(started&&mode==='move'&&current.gestureOwner===owner){
        const originalById=new Map(before.clips.map(c=>[c.id,c]));
        const changed=current.project.clips.filter(c=>{
          const original=originalById.get(c.id);
          return copying ? copies.some(copy=>copy.id===c.id) : ids.includes(c.id)&&original&&(c.start!==original.start||c.trackId!==original.trackId);
        }).map(c=>c.id);
        try { const next=separateOverlappingClips(current.project,changed);
          if(next!==current.project){s.transient(next,before);s.notify('重ならないように、新しいトラックへ配置しました。');}
        } catch(error){cancel();s.notify((error as Error).message);return;}
      }
      end();
    };
    const visibility=()=>{if(document.hidden)cancel();};
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    cancelDrag.current=cancel;capture.addEventListener('lostpointercapture',cancel);document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key); window.addEventListener('blur', cancel);
  }, [localTime]);
  return <section className="timeline-panel panel"><div className="timeline-heading"><div className="sequence-tab"><Film size={14}/><span>シーケンス 01</span><span className="sequence-dot"/></div><span className="timeline-format">{p.width} × {p.height} <span> / </span> {p.fps} fps <span> / </span> {timecode(total, p.fps)}</span>{tool === 'rate' ? <span className="rate-tool-hint">クリップの端をドラッグして速度調整 · Escで中止</span> : tool === 'razor' ? <span className="rate-tool-hint">C：ハサミでクリックした位置を分割 · Vで選択へ</span> : <span className="timeline-tip">Vで選択 · 空白をドラッグで範囲選択 · Shiftで追加</span>}</div>
    <div className="timeline-toolbar"><div className="tool-group"><IconButton label="選択ツール (V)" active={tool === 'select'} onClick={() => useEditor.setState({ tool: 'select' })}><MousePointer2 size={17}/></IconButton><IconButton label="レーザーツール (C)" active={tool === 'razor'} onClick={() => useEditor.setState({ tool: 'razor' })}><Scissors size={17}/></IconButton><IconButton label="レート調整ツール（長さで再生速度を変更）" active={tool === 'rate'} onClick={() => useEditor.setState({ tool: 'rate' })}><Gauge size={17}/></IconButton><span className="toolbar-divider"/><IconButton label="スナップ (N)" active={snapping} onClick={() => useEditor.setState({ snapping: !snapping })}><Magnet size={17}/></IconButton><IconButton label="マーカーを追加 (M)" onClick={() => useEditor.getState().addMarker()}><BookmarkPlus size={17}/></IconButton></div><span className="toolbar-divider"/><div className="tool-group"><IconButton label="元に戻す (Ctrl+Z)" disabled={!canUndo} onClick={() => useEditor.getState().undo()}><Undo2 size={16}/></IconButton><IconButton label="やり直す (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => useEditor.getState().redo()}><Redo2 size={16}/></IconButton><IconButton label="選択クリップを分割 (Ctrl+B)" disabled={!selected.length} onClick={() => useEditor.getState().split()}><Scissors size={16}/></IconButton><IconButton label="複製 (Ctrl+D)" disabled={!selected.length} onClick={() => useEditor.getState().duplicate()}><Copy size={15}/></IconButton><IconButton label="削除 (Delete)" disabled={!selected.length} onClick={() => useEditor.getState().remove()}><Trash2 size={15}/></IconButton></div><div className="timeline-toolbar-right"><IconButton label="再生ヘッドの自動追従" active={followPlayhead} onClick={() => setFollowPlayhead(!followPlayhead)}><MoveHorizontal size={16}/></IconButton><IconButton label="再生ヘッドを表示" onClick={() => revealPlayhead(true)}><LocateFixed size={16}/></IconButton><span className="toolbar-divider"/><div className="track-menu-wrap"><button className="text-button" onClick={() => setTrackMenu(!trackMenu)}><Plus size={13}/>トラック<ChevronDown size={12}/></button>{trackMenu ? <><button className="menu-dismiss" aria-label="トラックメニューを閉じる" onClick={() => setTrackMenu(false)}/><div className="popup-menu"><button onClick={() => { useEditor.getState().addTrack('video'); setTrackMenu(false); }}><Film size={14}/>映像トラックを追加</button><button onClick={() => { useEditor.getState().addTrack('audio'); setTrackMenu(false); }}><Music2 size={14}/>音声トラックを追加</button></div></> : null}</div><span className="toolbar-divider"/><IconButton label="ズームアウト (S / -)" onClick={() => useEditor.getState().setZoom(zoom / 1.25)}><Minus size={14}/></IconButton><input className="zoom-slider" aria-label="タイムラインのズーム" type="range" min={zoomBounds.min} max={zoomBounds.max} step="any" value={zoom} onChange={e => useEditor.getState().setZoom(Number(e.target.value))}/><IconButton label="ズームイン (A / +)" onClick={() => useEditor.getState().setZoom(zoom * 1.25)}><Plus size={14}/></IconButton><IconButton label="タイムライン全体を表示" onClick={() => useEditor.getState().setZoom((scroller.current!.clientWidth - 60) / Math.max(10, total))}><Maximize2 size={14}/></IconButton></div></div>
    <AudioJobProgress location="timeline"/>
    {clipMenu && menuOpen ? <ClipContextMenu anchor={clipMenu} onClose={closeClipMenu}/> : null}
    {gapMenu && menuOpen ? <GapContextMenu anchor={gapMenu} onClose={closeGapMenu}/> : null}
    <div className="timeline-body">{!p.clips.length ? <div className="timeline-empty-guide"><strong>ここに素材を並べて、動画を作りましょう</strong><p>{p.assets.length ? '左の素材を選んで「選択素材をタイムラインに追加」を押すか、この場所へドラッグします。' : '動画・写真・音声を読み込むと、編集を始められます。'}</p>{!p.assets.length && onImport ? <button className="secondary-button" onClick={onImport}><Plus size={14}/>素材を読み込んで始める</button> : null}<small>左から右へ再生されます · 元の素材はそのまま残ります</small></div> : null}<div className="timeline-tracks" style={{'--track-height':`${rowHeight}px`} as React.CSSProperties} onWheel={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); useEditor.getState().setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9)); } }}>
      <div className="track-labels" ref={labels}><div className="ruler-label"><span className="timecode">{timecode(playhead, p.fps)}</span></div>{p.tracks.map((track, i) => <div className={`track-label ${track.kind} ${track.locked ? 'locked' : ''}`} key={track.id}><div className="track-label-top"><span className={`track-badge ${track.kind}`}>{track.kind === 'video' ? 'V' : 'A'}{track.kind === 'video' ? p.tracks.filter(t => t.kind === 'video').length - p.tracks.slice(0,i).filter(t => t.kind === 'video').length : p.tracks.slice(0,i + 1).filter(t => t.kind === 'audio').length}</span><input aria-label={`トラック名 ${track.name}`} value={track.name} onChange={e => useEditor.getState().updateTrack(track.id, { name: e.target.value })}/><TrackDeleteButton track={track} project={p}/></div><div className="track-actions"><IconButton label={`${track.name} ${track.locked ? 'ロック解除' : 'ロック'}`} active={track.locked} onClick={() => useEditor.getState().updateTrack(track.id, { locked: !track.locked })}>{track.locked ? <Lock size={12}/> : <Unlock size={12}/>}</IconButton>{track.kind === 'video' ? <IconButton label={`${track.name} ${track.hidden ? '表示' : '非表示'}`} active={track.hidden} onClick={() => useEditor.getState().updateTrack(track.id, { hidden: !track.hidden })}>{track.hidden ? <EyeOff size={13}/> : <Eye size={13}/>}</IconButton> : null}<IconButton label={`${track.name} ミュート`} active={track.muted} onClick={() => useEditor.getState().updateTrack(track.id, { muted: !track.muted })}>{track.muted ? <VolumeX size={12}/> : <Volume2 size={12}/>}</IconButton><IconButton label={`${track.name} ソロ`} active={track.solo} onClick={() => useEditor.getState().updateTrack(track.id, { solo: !track.solo })}><span className="solo-label">S</span></IconButton></div></div>)}</div>
      <div id="timeline-scroll" className={`timeline-scroll ${tool}`} ref={scroller} onScroll={e => { if (labels.current) labels.current.scrollTop = e.currentTarget.scrollTop; onViewportScroll(); updateRuler(); }}><div className="timeline-content" tabIndex={-1} style={{ width }} onPointerDown={e => { if (e.target === e.currentTarget) startSelection(e); }}><div className="timeline-ruler" onPointerDown={scrub}>{Array.from({ length: Math.max(0, lastTick - firstTick + 1) }, (_, index) => { const i = firstTick + index; return <div className="ruler-tick" key={i} style={{ left: i * tickStep * zoom }}><span>{timecode(i * tickStep, p.fps).split(':').slice(extent >= 3600 ? 0 : 1).join(':')}</span></div>; })}{p.markers.map(m => <button className="timeline-marker" key={m.id} style={{ left: m.time * zoom }} aria-label={`マーカー ${m.label}`} title={`${m.label} · 右クリックで削除`} onPointerDown={e => e.stopPropagation()} onClick={() => useEditor.getState().seek(m.time)} onContextMenu={e => { e.preventDefault(); useEditor.getState().removeMarker(m.id); }}><span/>{m.label}</button>)}</div>
        {p.tracks.map(track => <div key={track.id} data-track-id={track.id} className={`track-lane ${track.kind} ${track.locked ? 'locked' : ''} ${dropTrack === track.id ? 'drop-target' : ''}`} tabIndex={0} role="group" aria-label={`${track.name}のタイムライン`} onContextMenu={e=>{if((e.target as HTMLElement).closest('.timeline-clip,.timeline-transition'))return;e.preventDefault();e.stopPropagation();openGapMenu(track.id,localTime(e.clientX),e.currentTarget,e.clientX,e.clientY);}} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();e.stopPropagation();const view=scroller.current!.getBoundingClientRect(),lane=e.currentTarget.getBoundingClientRect();openGapMenu(track.id,useEditor.getState().playhead,e.currentTarget,Math.max(view.left+8,Math.min(view.right-8,lane.left+useEditor.getState().playhead*zoom)),lane.top+20);}}} onPointerDown={e => { if (e.button === 0 && e.target === e.currentTarget) { if (useEditor.getState().tool === 'select') startSelection(e); else { e.currentTarget.focus({preventScroll:true}); useEditor.getState().select([]); scrub(e); } } }} onDragOver={e => { if ((e.dataTransfer.types.includes('application/x-luma-asset') || e.dataTransfer.types.includes('application/x-luma-transition')) && !track.locked) { e.preventDefault(); setDropTrack(track.id); } }} onDragLeave={() => setDropTrack(null)} onDrop={e => { e.preventDefault(); setDropTrack(null); const effect=e.dataTransfer.getData('application/x-luma-transition');if(effect){try{const options=JSON.parse(effect) as TransitionOptions,time=localTime(e.clientX),lane=p.clips.filter(c=>c.trackId===track.id).sort((a,b)=>a.start-b.start);const joins=lane.slice(1).map((to,i)=>({from:lane[i],to,distance:Math.abs(time-to.start)*zoom})).sort((a,b)=>a.distance-b.distance);if(!joins[0]||joins[0].distance>60)throw Error('隣り合うクリップのつなぎ目へドロップしてください。');useEditor.getState().addTransition(options,joins[0].from.id,joins[0].to.id);}catch(error){useEditor.getState().notify((error as Error).message);}return;} const id = e.dataTransfer.getData('application/x-luma-asset'); if (id) { const time = localTime(e.clientX); useEditor.getState().addAsset(id, snapping ? snapTime(time, p, [], 10 / zoom, playhead) : time, track.id); } }}>
          {transitions.filter(t=>t.from.trackId===track.id).map(t=><TimelineTransition key={t.id} transition={t} zoom={zoom}/>)}
          {highlightedGap?<div className="timeline-gap-highlight" aria-hidden="true" style={{left:highlightedGap.from*zoom,width:(highlightedGap.to-highlightedGap.from)*zoom}}/>:null}
          <div className="playhead-scrub-hit" style={{ left: playhead * zoom }} title="再生ヘッドを移動" onPointerDown={scrub}/>
          {clipsByTrack.get(track.id)?.map(clip => {
            const asset=assetsById.get(clip.assetId||'');
            const range=asset?.hasAudio&&!clip.audioDetached?clipWaveformRange(clip,zoom,rulerViewport):EMPTY_WAVEFORM_RANGE;
            return <MemoClip key={clip.id} clip={clip} asset={asset} track={track} selected={selectedIds.has(clip.id)} related={related.has(clip.id)} onMenu={openClipMenu} editingLocked={editingLockedIds.has(clip.id)} tool={tool} zoom={zoom} waveformLeft={range.left} waveformRight={range.right} onDrag={startDrag}/>;
          })}
        </div>)}
        {selectionBox ? <div className="timeline-selection-rect" role="img" aria-label="素材の選択範囲" style={selectionBox}/> : null}
        <div className="playhead" style={{ left: playhead * zoom }}><div className="playhead-handle" title="再生ヘッドを移動" onPointerDown={scrub}/><div className="playhead-line"/></div>{snapLine !== null ? <div className="snap-line" style={{ left: snapLine * zoom }}/> : null}
      </div></div>
      <TimelineScrollbars view={scroller} rowHeight={rowHeight} setRowHeight={setRowHeight}/>
    </div><AudioMeter/></div>
  </section>;
}
