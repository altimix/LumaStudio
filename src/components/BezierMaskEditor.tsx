import { Fragment, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import type { BezierVideoMask, Clip, Project } from '../types';
import { mediaNormalizedPoint, mediaPoint, type Position, type SourceSize } from '../media-transform';
import { constrainBezierVector, editBezierHandle, newBezierPoint, translateBezierPoints } from '../bezier-editing';
import { MAX_BEZIER_MASK_POINTS } from '../../shared/video-mask.mjs';

type Props = { clip: Clip; mask: BezierVideoMask; source: SourceSize; project: Project; viewport: RefObject<HTMLDivElement | null>; actions: HTMLElement | null; z: number };
type Operation = { part: 'anchor' | 'in' | 'out'; index: number } | { part: 'add' };

export default function BezierMaskEditor({ clip, mask, source, project, viewport, actions, z }: Props) {
  const [tool, setTool] = useState<'pen' | 'direct'>(mask.closed ? 'direct' : 'pen');
  const [temporaryDirect, setTemporaryDirect] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [closeCandidate, setCloseCandidate] = useState(false);
  const cancelGesture = useRef<(() => void) | null>(null);
  const gestureActive = useEditor(s => s.gestureActive);
  const direct = tool === 'direct' || temporaryDirect || mask.closed;
  useLayoutEffect(() => { setTool(mask.closed ? 'direct' : 'pen'); }, [mask.closed]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.type === 'keydown' && (event.isComposing || (event.target as HTMLElement | null)?.closest('input,textarea,select,[contenteditable=true]'))) return;
      setTemporaryDirect(event.ctrlKey || event.metaKey);
    };
    const blur = () => setTemporaryDirect(false);
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur);
    return () => { cancelGesture.current?.(); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); };
  }, []);
  useEffect(() => useEditor.subscribe((current, previous) => {
    // Indices are UI-only; do not keep stale point selections after deletion, Undo or another edit.
    if (!current.gestureActive && current.project !== previous.project) setSelected([]);
  }), []);
  useEffect(() => { cancelGesture.current?.(); }, [source.width, source.height]);

  const nearStart = (position: { clientX: number; clientY: number }) => {
    if (!mask.points.length || !viewport.current) return false;
    const rect = viewport.current.getBoundingClientRect(), first = mediaPoint(clip, source, project, mask.points[0]);
    return Math.hypot(position.clientX - rect.left - first.x / project.width * rect.width, position.clientY - rect.top - first.y / project.height * rect.height) <= 10;
  };
  const begin = (event: ReactPointerEvent<HTMLButtonElement>, operation: Operation) => {
    if (event.button !== 0 || useEditor.getState().gestureActive) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
    const initial = useEditor.getState(), originalClip = initial.project.clips.find(item => item.id === clip.id), element = viewport.current;
    if (!originalClip || originalClip.videoMask?.type !== 'bezier' || !element || initial.playing || initial.project.tracks.find(track => track.id === clip.trackId)?.locked) return;
    const originalMask = originalClip.videoMask, rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const normalized = (position: { clientX: number; clientY: number }) => mediaNormalizedPoint(originalClip, source, initial.project, {
      x: (position.clientX - rect.left) / rect.width * initial.project.width,
      y: (position.clientY - rect.top) / rect.height * initial.project.height,
    });
    const origin = { clientX: event.clientX, clientY: event.clientY }, startPoint = normalized(origin);
    const isDirect = tool === 'direct' || event.ctrlKey || event.metaKey || originalMask.closed;
    if (operation.part === 'add' && isDirect) {
      setSelected([]);
      // Ending drawing keeps an open path open and does not create a history entry.
      if (event.ctrlKey || event.metaKey) setTool('direct');
      return;
    }
    if (operation.part === 'add' && !isDirect && !event.shiftKey && originalMask.points.length >= 3 && nearStart(event)) {
      initial.updateClip(clip.id, { videoMask: { ...originalMask, closed: true } }); setCloseCandidate(false); return;
    }
    if (operation.part === 'add' && (originalMask.closed || originalMask.points.length >= MAX_BEZIER_MASK_POINTS || startPoint.x < 0 || startPoint.x > 1 || startPoint.y < 0 || startPoint.y > 1)) return;
    if (operation.part !== 'add' && !originalMask.points[operation.index]) return;
    if (operation.part === 'anchor' && !isDirect && !event.shiftKey && operation.index === 0 && originalMask.points.length >= 3) {
      initial.updateClip(clip.id, { videoMask: { ...originalMask, closed: true } }); setCloseCandidate(false); return;
    }
    const previousSelection = selected;
    const index = operation.part === 'add' ? originalMask.points.length : operation.index;
    const indices = operation.part === 'anchor' ? selected.includes(index) ? selected : event.shiftKey ? [...selected, index] : [index] : [index];
    setSelected(indices);
    const owner = {}, target = event.currentTarget, pointer = event.pointerId;
    let closed = false, writing = false, changed = false, moved = false, unsubscribe = () => {};
    const before = initial;
    let expected = initial.project;
    let last = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey };
    const constrain = (vector: Position, shift: boolean) => shift ? constrainBezierVector(originalClip, source, initial.project, vector) : vector;
    let baseMask = originalMask;
    let heldOpposite = originalMask.points[index];
    const rememberAlt = (alt: boolean) => {
      if (alt && !last.altKey) {
        const currentMask = useEditor.getState().project.clips.find(item => item.id === clip.id)?.videoMask;
        if (currentMask?.type === 'bezier') heldOpposite = currentMask.points[index];
      }
    };
    const detach = () => {
      closed = true; cancelGesture.current = null; setCloseCandidate(false); unsubscribe(); observer.disconnect();
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true);
      window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); document.removeEventListener('visibilitychange', visibility);
      target.removeEventListener('lostpointercapture', pointerCancel);
      if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
    };
    const restore = () => useEditor.setState({ project: before.project, history: before.history, future: before.future, historyPlayheads: before.historyPlayheads, futurePlayheads: before.futurePlayheads, historyLabels: before.historyLabels, futureLabels: before.futureLabels, currentAction: before.currentAction, dirty: before.dirty });
    const endpointsOverlap = (latest: BezierVideoMask) => {
      const first = mediaPoint(originalClip, source, initial.project, latest.points[0]);
      const end = mediaPoint(originalClip, source, initial.project, latest.points.at(-1)!);
      return Math.hypot((end.x - first.x) / initial.project.width * rect.width, (end.y - first.y) / initial.project.height * rect.height) <= 10;
    };
    const finish = () => {
      if (closed) return;
      const state = useEditor.getState();
      if (moved && operation.part === 'anchor' && operation.index === originalMask.points.length - 1 && indices.length === 1 && originalMask.points.length >= 4 && !originalMask.closed && state.project === expected && state.gestureOwner === owner && nearStart(last)) {
        const latest = state.project.clips.find(item => item.id === clip.id)?.videoMask;
        if (latest?.type === 'bezier' && endpointsOverlap(latest)) {
          const points = latest.points.slice(0, -1), first = points[0], end = latest.points.at(-1)!;
          const incoming = end.kind === 'curve' ? { inX: end.inX + first.x - end.x, inY: end.inY + first.y - end.y } : { inX: first.x, inY: first.y };
          points[0] = { ...editBezierHandle(first, 'in', { x: incoming.inX - first.x, y: incoming.inY - first.y }, true), kind: first.kind === 'curve' || end.kind === 'curve' ? 'curve' : 'line' };
          write({ ...latest, points, closed: true }); setSelected([]);
        }
      }
      const current = useEditor.getState(); detach();
      // Returning to the initial shape is a no-op, including a modifier-key-only detour.
      if (changed && current.gestureOwner === owner && current.project === expected && JSON.stringify(current.project.clips.find(item => item.id === clip.id)?.videoMask) === JSON.stringify(originalMask)) restore();
      useEditor.getState().endGesture(owner);
    };
    const cancel = () => {
      if (closed) return;
      const current = useEditor.getState(); detach();
      if (changed && current.gestureOwner === owner && current.project === expected) restore();
      setSelected(previousSelection); useEditor.getState().endGesture(owner);
    };
    const write = (nextMask: BezierVideoMask) => {
      if (closed) return;
      const current = useEditor.getState();
      if (JSON.stringify(current.project.clips.find(item => item.id === clip.id)?.videoMask) === JSON.stringify(nextMask)) return;
      writing = true;
      try {
        if (!changed) { current.checkpoint(operation.part === 'add' ? 'ベジェマスクの点を追加' : 'ベジェマスクの点を変更'); changed = true; }
        const now = useEditor.getState();
        now.transient({ ...now.project, clips: now.project.clips.map(item => item.id === clip.id ? { ...item, videoMask: nextMask } : item) });
        expected = useEditor.getState().project;
      } finally { writing = false; }
    };
    const update = () => {
      const position = normalized(last);
      let points = baseMask.points;
      if (operation.part === 'anchor') {
        points = translateBezierPoints(points, indices, constrain({ x: position.x - startPoint.x, y: position.y - startPoint.y }, last.shiftKey));
      } else {
        const original = points[index], part = operation.part === 'add' ? 'out' : operation.part;
        const handle = operation.part === 'add' ? original : { x: part === 'in' ? original.inX : original.outX, y: part === 'in' ? original.inY : original.outY };
        const vector = constrain({ x: handle.x + position.x - startPoint.x - original.x, y: handle.y + position.y - startPoint.y - original.y }, last.shiftKey);
        points = points.map((point, pointIndex) => pointIndex === index ? editBezierHandle(last.altKey && heldOpposite ? { ...point, inX: heldOpposite.inX, inY: heldOpposite.inY, outX: heldOpposite.outX, outY: heldOpposite.outY } : point, part, vector, last.altKey) : point);
      }
      write({ ...baseMask, points });
    };
    const move = (e: PointerEvent) => {
      if (closed || e.pointerId !== pointer) return;
      rememberAlt(e.altKey);
      last = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey };
      if (!moved && Math.hypot(e.clientX - origin.clientX, e.clientY - origin.clientY) < 3) return;
      moved = true;
      update();
      const latest = useEditor.getState().project.clips.find(item => item.id === clip.id)?.videoMask;
      setCloseCandidate(latest?.type === 'bezier' && endpointsOverlap(latest) && operation.part === 'anchor' && index === originalMask.points.length - 1 && indices.length === 1 && !originalMask.closed && originalMask.points.length >= 4 && nearStart(e));
    };
    const up = (e: PointerEvent) => { if (e.pointerId === pointer) { move(e); finish(); } };
    const pointerCancel = (e: PointerEvent) => { if (e.pointerId === pointer) cancel(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      if (['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) {
        rememberAlt(e.altKey);
        last = { ...last, shiftKey: e.shiftKey, altKey: e.altKey };
        if (moved) update();
      }
    };
    const visibility = () => { if (document.hidden) { setTemporaryDirect(false); cancel(); } };
    const observer = new ResizeObserver(() => {
      const now = element.getBoundingClientRect();
      if (Math.abs(now.width - rect.width) > .5 || Math.abs(now.height - rect.height) > .5 || Math.abs(now.left - rect.left) > .5 || Math.abs(now.top - rect.top) > .5) cancel();
    });
    if (!initial.beginGesture(owner, cancel)) return;
    cancelGesture.current = cancel;
    unsubscribe = useEditor.subscribe((current, previous) => {
      if (writing || closed) return;
      if (current.gestureOwner !== owner || current.project !== expected) { finish(); return; }
      if (current.playing || current.seekRevision !== previous.seekRevision || current.playhead !== previous.playhead || current.mediaEditMode !== 'mask' || !current.selected.includes(clip.id)) cancel();
    });
    observer.observe(element);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true);
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); document.addEventListener('visibilitychange', visibility);
    target.addEventListener('lostpointercapture', pointerCancel); target.setPointerCapture(pointer);
    if (operation.part === 'add') {
      const previous = originalMask.points.at(-1);
      // Clamp along the constrained ray so clipping at the source edge cannot bend a 45° line.
      const point = previous && event.shiftKey ? translateBezierPoints([newBezierPoint(previous)], [0], constrain({ x: startPoint.x - previous.x, y: startPoint.y - previous.y }, true))[0] : newBezierPoint(startPoint);
      baseMask = { ...originalMask, points: [...originalMask.points, newBezierPoint(point)] };
      heldOpposite = baseMask.points[index];
      write(baseMask);
    }
  };

  const screen = mask.points.map(point => ({ anchor: mediaPoint(clip, source, project, point), incoming: mediaPoint(clip, source, project, { x: point.inX, y: point.inY }), outgoing: mediaPoint(clip, source, project, { x: point.outX, y: point.outY }), kind: point.kind }));
  let path = '';
  if (screen.length) {
    path = `M ${screen[0].anchor.x} ${screen[0].anchor.y}`;
    const edge = (from: typeof screen[number], to: typeof screen[number]) => {
      const out = from.kind === 'curve' ? from.outgoing : from.anchor, incoming = to.kind === 'curve' ? to.incoming : to.anchor;
      return ` C ${out.x} ${out.y} ${incoming.x} ${incoming.y} ${to.anchor.x} ${to.anchor.y}`;
    };
    for (let index = 1; index < screen.length; index++) path += edge(screen[index - 1], screen[index]);
    if (mask.closed) path += edge(screen.at(-1)!, screen[0]) + ' Z';
  }
  const positionStyle = (point: Position, layer: number) => ({ left: point.x / project.width * 100 + '%', top: point.y / project.height * 100 + '%', zIndex: z + layer });
  return <>
    <button className={`bezier-add-target ${direct ? 'direct' : ''}`} aria-label={direct ? 'ベジェマスクの選択を解除' : 'ベジェマスクの点を追加'} title={direct ? '空白をクリックして点の選択を解除' : 'クリックで点を追加・ドラッグで曲線・Ctrl / ⌘でポイント編集'} style={{ inset: 0, zIndex: z }} onPointerMove={event => { if (!gestureActive) setCloseCandidate(!direct && !event.shiftKey && mask.points.length >= 3 && nearStart(event)); }} onPointerLeave={() => { if (!gestureActive) setCloseCandidate(false); }} onPointerDown={event => begin(event, { part: 'add' })}/>
    <svg className="bezier-mask-path" viewBox={`0 0 ${project.width} ${project.height}`} preserveAspectRatio="none" style={{ zIndex: z + 1 }} aria-hidden="true"><path d={path}/>{screen.flatMap((point, index) => point.kind === 'curve' ? [<line key={`in-${index}`} x1={point.anchor.x} y1={point.anchor.y} x2={point.incoming.x} y2={point.incoming.y}/>, <line key={`out-${index}`} x1={point.anchor.x} y1={point.anchor.y} x2={point.outgoing.x} y2={point.outgoing.y}/>] : [])}</svg>
    {screen.map((point, index) => <Fragment key={index}>
      <button className={`bezier-mask-anchor ${index === 0 && closeCandidate && !mask.closed ? 'close-candidate' : ''}`} title={index === 0 && !direct && mask.points.length >= 3 ? 'クリックしてパスを閉じる' : 'ドラッグで移動・Shiftクリックで追加選択'} onPointerEnter={() => { if (!gestureActive && index === 0 && !direct && mask.points.length >= 3) setCloseCandidate(true); }} onPointerLeave={() => { if (!gestureActive) setCloseCandidate(false); }} aria-label={`ベジェマスクの点 ${index + 1}を移動`} aria-pressed={selected.includes(index)} style={positionStyle(point.anchor, 3)} onPointerDown={event => begin(event, { part: 'anchor', index })}/>
      {point.kind === 'curve' ? <>
        <button className="bezier-mask-handle" aria-label={`点 ${index + 1}の入力ハンドルを移動`} style={positionStyle(point.incoming, 2)} onPointerDown={event => begin(event, { part: 'in', index })}/>
        <button className="bezier-mask-handle" aria-label={`点 ${index + 1}の出力ハンドルを移動`} style={positionStyle(point.outgoing, 2)} onPointerDown={event => begin(event, { part: 'out', index })}/>
      </> : null}
    </Fragment>)}
    {actions ? createPortal(<div className="bezier-tools" role="group" aria-label="ベジェ編集ツール">
      <button aria-pressed={!direct} disabled={mask.closed || gestureActive} onClick={() => setTool('pen')}>ペン</button>
      <button aria-pressed={direct} disabled={gestureActive} onClick={() => setTool('direct')}>ダイレクト選択</button>
      <span role="status">{closeCandidate && !mask.closed ? 'パスを閉じる' : temporaryDirect && tool === 'pen' ? '一時切替' : `${selected.length}点選択`}</span>
    </div>, actions) : null}
  </>;
}
