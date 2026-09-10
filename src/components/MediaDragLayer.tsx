import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import type { Asset, Clip } from '../types';
import { fadeAt } from '../render';
import { opacityAt } from '../../shared/opacity.mjs';
import { mediaBounds, mediaCorner, mediaSourceKey, moveMedia, resizeMedia, visualOrder, type Corner, type MediaSize, type SourceSize } from '../media-transform';
import { NO_SNAP, sameSnapGuides, snapMonitorPosition } from '../monitor-snap';
import MonitorSnapGuides from './MonitorSnapGuides';
import './media-transform.css';

const corners: (Corner & { name: string; cursor: string })[] = [
  { x: -1, y: -1, name: '左上', cursor: 'nwse-resize' }, { x: 1, y: -1, name: '右上', cursor: 'nesw-resize' },
  { x: 1, y: 1, name: '右下', cursor: 'nwse-resize' }, { x: -1, y: 1, name: '左下', cursor: 'nesw-resize' },
];
export default function MediaDragLayer({ sizes, actions }: { sizes: Record<string, MediaSize>; actions: HTMLElement | null }) {
  const project = useEditor(s => s.project), time = useEditor(s => s.playhead), playing = useEditor(s => s.playing), selected = useEditor(s => s.selected);
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
  const current = active.find(item => selected.includes(item.clip.id));
  return <><div className="media-drag-layer" ref={root}>{!playing && active.map(({ clip, asset, locked }) => {
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
  })}<MonitorSnapGuides guides={guides}/></div>
    {!playing && current && !current.locked && actions ? createPortal(<button className="media-transform-reset" disabled={current.clip.x === 0 && current.clip.y === 0 && current.clip.scale === 1} onClick={() => { cleanup.current?.(); useEditor.getState().updateClip(current.clip.id, { x: 0, y: 0, scale: 1 }); }}>位置・大きさを戻す</button>, actions) : null}</>;
}
