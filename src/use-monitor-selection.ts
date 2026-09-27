import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useEditor } from './store';

/** Reveal the selected object after its monitor gesture without stealing keyboard focus. */
export function useMonitorSelection(scroller: RefObject<HTMLDivElement | null>) {
  const request = useEditor(s => s.monitorSelection), gestureActive = useEditor(s => s.gestureActive);
  const handled = useRef<typeof request>(null);
  useLayoutEffect(() => {
    const view = scroller.current;
    if (!request || handled.current === request || gestureActive || !view?.clientHeight) return;
    const clip = useEditor.getState().project.clips.find(c => c.id === request.clipId);
    const lane = [...view.querySelectorAll<HTMLElement>('.track-lane')].find(row => row.dataset.trackId === clip?.trackId);
    if (!clip || !lane) return;
    handled.current = request;
    const bounds = view.getBoundingClientRect(), row = lane.getBoundingClientRect();
    // Keep the sticky ruler clear and the selected row visible even in tall track layouts.
    const rulerHeight = view.querySelector('.timeline-ruler')?.getBoundingClientRect().height || 0;
    const top = bounds.top + view.clientTop + rulerHeight, bottom = bounds.top + view.clientTop + view.clientHeight;
    if (row.top < top) view.scrollTop += row.top - top;
    else if (row.bottom > bottom) view.scrollTop += Math.min(row.bottom - bottom, row.top - top);
    const state = useEditor.getState(), x = Math.max(clip.start, Math.min(state.playhead, clip.start + clip.duration)) * state.zoom;
    if (x < view.scrollLeft + 12 || x > view.scrollLeft + view.clientWidth - 12) view.scrollLeft = Math.max(0, x - view.clientWidth / 3);
  }, [request, gestureActive, scroller]);
}
