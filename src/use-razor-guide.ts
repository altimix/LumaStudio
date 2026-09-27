import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useEditor } from './store';
import { canSplitAt, timelinePointerTime } from './timeline-pointer';
import { clipsLocked, linkedIds } from '../shared/clip-links.mjs';

type Guide = { clipId: string; time: number; snapped: boolean; cuttable: boolean };
export function useRazorGuide(scroller: RefObject<HTMLDivElement | null>) {
  const project = useEditor(state => state.project), zoom = useEditor(state => state.zoom);
  const tool = useEditor(state => state.tool), snapping = useEditor(state => state.snapping);
  const gesture = useEditor(state => state.gestureActive), menu = useEditor(state => state.clipMenuOpen);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const clear = useCallback(() => { pointer.current = null; setGuide(null); }, []);
  const refresh = useCallback(() => {
    const view = scroller.current, position = pointer.current, state = useEditor.getState();
    if (!view || !position || state.tool !== 'razor' || state.gestureActive || state.clipMenuOpen) { setGuide(null); return; }
    const element = document.elementFromPoint(position.x, position.y)?.closest<HTMLElement>('.timeline-clip');
    const clip = element && view.contains(element) ? state.project.clips.find(item => item.id === element.dataset.clipId) : undefined;
    if (!clip || clipsLocked(state.project, linkedIds(state.project, [clip.id]))) { setGuide(null); return; }
    const raw = (position.x - view.getBoundingClientRect().left - view.clientLeft + view.scrollLeft) / state.zoom;
    const match = timelinePointerTime(state.project, raw, state.zoom, state.snapping, clip);
    const next = { clipId: clip.id, ...match, cuttable: canSplitAt(clip, match.time, state.project.fps) };
    setGuide(previous => previous && Object.keys(next).every(key => previous[key as keyof Guide] === next[key as keyof Guide]) ? previous : next);
  }, [scroller]);
  useLayoutEffect(() => {
    const view = scroller.current; if (!view) return;
    const move = (event: PointerEvent) => { pointer.current = { x: event.clientX, y: event.clientY }; refresh(); };
    const hidden = () => { if (document.hidden) clear(); };
    view.addEventListener('pointermove', move); view.addEventListener('pointerleave', clear); view.addEventListener('scroll', refresh);
    window.addEventListener('blur', clear); window.addEventListener('resize', clear); document.addEventListener('visibilitychange', hidden);
    return () => {
      view.removeEventListener('pointermove', move); view.removeEventListener('pointerleave', clear); view.removeEventListener('scroll', refresh);
      window.removeEventListener('blur', clear); window.removeEventListener('resize', clear); document.removeEventListener('visibilitychange', hidden);
    };
  }, [scroller, refresh, clear]);
  useLayoutEffect(refresh, [refresh, project, zoom, tool, snapping, gesture, menu]);
  return guide;
}
