import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { clamp, roundFrame } from './model';
import { useEditor } from './store';
import { clipsInSelection, selectionRect, selectionScrollSpeed } from './timeline-selection';
import type { SelectionCandidate, SelectionRect } from './timeline-selection';

export function useTimelineSelection(scroller: RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState<SelectionRect | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => cleanup.current?.(), []);

  const startSelection = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const view = scroller.current, state = useEditor.getState();
    const content = view?.querySelector<HTMLElement>('.timeline-content');
    if (!view || !content || e.button !== 0 || state.tool !== 'select' || state.gestureActive) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.focus({ preventScroll: true });
    const owner = {}, pointerId = e.pointerId, previous = state.selected, additive = e.shiftKey;
    const originClient = { x: e.clientX, y: e.clientY };
    let client = originClient, moved = false, ended = false, frame = 0, lastFrame = performance.now();
    const contentBounds = content.getBoundingClientRect();
    const origin = { x: e.clientX - contentBounds.left, y: e.clientY - contentBounds.top };
    const lockedTracks = new Set(state.project.tracks.filter(track => track.locked).map(track => track.id));
    const candidates: SelectionCandidate[] = [...content.querySelectorAll<HTMLElement>('.timeline-clip[data-clip-id]')].map(node => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.clipId!, locked: lockedTracks.has(node.closest<HTMLElement>('[data-track-id]')!.dataset.trackId!),
        left: rect.left - contentBounds.left, top: rect.top - contentBounds.top, width: rect.width, height: rect.height };
    });

    const update = () => {
      if (!moved || ended) return;
      const bounds = content.getBoundingClientRect(), viewport = view.getBoundingClientRect();
      const rulerHeight = view.querySelector('.timeline-ruler')!.getBoundingClientRect().height;
      const current = {
        x: clamp(clamp(client.x, viewport.left, viewport.left + view.clientWidth) - bounds.left, 0, bounds.width),
        y: clamp(clamp(client.y, viewport.top + rulerHeight, viewport.top + view.clientHeight) - bounds.top, 0, bounds.height)
      };
      const next = selectionRect(origin, current);
      setBox(old => old && old.left === next.left && old.top === next.top && old.width === next.width && old.height === next.height ? old : next);
      const ids = clipsInSelection(next, candidates, additive ? previous : []), selected = useEditor.getState().selected;
      if (ids.length !== selected.length || ids.some((id, i) => id !== selected[i])) state.select(ids);
    };
    const finish = (cancelled: boolean) => {
      if (ended) return;
      ended = true; cleanup.current = null; cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelPointer); window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', hidden);
      view.removeEventListener('lostpointercapture', cancelPointer); view.removeEventListener('scroll', update);
      if (view.hasPointerCapture(pointerId)) view.releasePointerCapture(pointerId);
      const current = useEditor.getState(), owns = current.gestureOwner === owner;
      current.endGesture(owner); setBox(null);
      if (!owns || current.project !== state.project) return;
      if (cancelled) state.select(previous);
      else if (!moved && !additive) { state.select([]); state.seek(roundFrame(Math.max(0, origin.x / state.zoom), state.project.fps)); }
    };
    const cancel = () => finish(true);
    const cancelPointer = (event: PointerEvent) => { if (event.pointerId === pointerId) cancel(); };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      client = { x: event.clientX, y: event.clientY };
      moved ||= Math.hypot(client.x - originClient.x, client.y - originClient.y) >= 4;
      update();
    };
    const up = (event: PointerEvent) => { if (event.pointerId === pointerId) { move(event); finish(false); } };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    const hidden = () => { if (document.hidden) cancel(); };
    const initialSize = { width: view.clientWidth, height: view.clientHeight };
    const observer = new ResizeObserver(() => { if (view.clientWidth !== initialSize.width || view.clientHeight !== initialSize.height) cancel(); });
    const tick = (now: number) => {
      const current = useEditor.getState();
      if (current.gestureOwner !== owner || current.project !== state.project || current.zoom !== state.zoom || current.tool !== 'select') { cancel(); return; }
      const elapsed = Math.min(50, now - lastFrame) / 1000; lastFrame = now;
      if (moved) {
        const bounds = view.getBoundingClientRect(), rulerHeight = view.querySelector('.timeline-ruler')!.getBoundingClientRect().height;
        view.scrollLeft += selectionScrollSpeed(client.x, bounds.left, bounds.left + view.clientWidth) * elapsed;
        view.scrollTop += selectionScrollSpeed(client.y, bounds.top + rulerHeight, bounds.top + view.clientHeight) * elapsed;
        update();
      }
      if (!ended) frame = requestAnimationFrame(tick);
    };
    if (!state.beginGesture(owner, cancel)) return;
    state.stop(); cleanup.current = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelPointer); window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key); document.addEventListener('visibilitychange', hidden);
    view.addEventListener('lostpointercapture', cancelPointer); view.addEventListener('scroll', update);
    observer.observe(view); view.setPointerCapture(pointerId);
    frame = requestAnimationFrame(tick);
  }, [scroller]);
  return { selectionBox: box, startSelection };
}
