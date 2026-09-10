import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { clamp, roundFrame } from './model';
import { useEditor } from './store';

/** One viewport policy for transport, explicit seeks, navigation and pointer scrubbing. */
export function usePlayheadViewport(scroller: RefObject<HTMLDivElement | null>) {
  const playhead = useEditor(s => s.playhead);
  const seekRevision = useEditor(s => s.seekRevision);
  const playing = useEditor(s => s.playing);
  const shuttleRate = useEditor(s => s.shuttleRate);
  const zoom = useEditor(s => s.zoom);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const following = useRef(true);
  const scrubbing = useRef(false);
  const cleanupScrub = useRef<(() => void) | null>(null);
  const previousTime = useRef(playhead);
  const direction = useRef(1);

  const revealPlayhead = useCallback((center = false) => {
    const viewport = scroller.current;
    if (!viewport || !viewport.clientWidth) return;
    const s = useEditor.getState(), x = s.playhead * s.zoom, width = viewport.clientWidth;
    if (!Number.isFinite(x)) return;
    const margin = Math.min(48, width * 0.12);
    if (!center && x >= viewport.scrollLeft + margin && x <= viewport.scrollLeft + width - margin) return;
    const anchor = center ? 0.5 : direction.current < 0 ? 0.75 : 0.25;
    const left = clamp(x - width * anchor, 0, Math.max(0, viewport.scrollWidth - width));
    if (Math.abs(left - viewport.scrollLeft) > 0.5) viewport.scrollLeft = left;
  }, [scroller]);

  useLayoutEffect(() => {
    following.current = followPlayhead;
    if (playhead !== previousTime.current) direction.current = Math.sign(playhead - previousTime.current);
    if (playing) direction.current = Math.sign(shuttleRate);
    previousTime.current = playhead;
    // seekRevision also reveals a repeated Home/End or jump to the same timestamp.
    if (followPlayhead && !scrubbing.current && !useEditor.getState().gestureActive) revealPlayhead();
  }, [playhead, seekRevision, zoom, playing, shuttleRate, followPlayhead, revealPlayhead]);

  useEffect(() => {
    const viewport = scroller.current;
    if (!viewport) return;
    let previousWidth = viewport.clientWidth;
    const resize = () => {
      const width = viewport.clientWidth;
      if (width === previousWidth) return;
      previousWidth = width;
      if (following.current && !scrubbing.current && !useEditor.getState().gestureActive) revealPlayhead();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, [scroller, revealPlayhead]);
  useEffect(() => () => cleanupScrub.current?.(), []);

  const onViewportScroll = useCallback(() => {
    // Paused browsing changes only the viewport. It must not seek or snap back.
    if (following.current && useEditor.getState().playing && !useEditor.getState().gestureActive && !scrubbing.current) revealPlayhead();
  }, [revealPlayhead]);

  const scrub = useCallback((e: ReactPointerEvent) => {
    const viewport = scroller.current;
    if (e.button !== 0 || !viewport || scrubbing.current) return;
    const owner={};if(!useEditor.getState().beginGesture(owner,()=>finish()))return;
    e.preventDefault();
    scrubbing.current = true;
    useEditor.getState().stop();

    const pointerId = e.pointerId, originX = e.clientX;
    let clientX = originX, moved = false, frame = 0, previousFrame = performance.now();

    const moveHead = (force = false) => {
      const s = useEditor.getState();if(s.gestureOwner!==owner)return;const rect = viewport.getBoundingClientRect();
      const x = clamp(clientX - rect.left - viewport.clientLeft, 0, viewport.clientWidth - 1);
      // Rounding near an edge must not put the line a few pixels outside the viewport.
      const firstFrame = Math.ceil(viewport.scrollLeft / s.zoom * s.project.fps) / s.project.fps;
      const lastFrame = Math.floor((viewport.scrollLeft + viewport.clientWidth - 1) / s.zoom * s.project.fps) / s.project.fps;
      const time = clamp(roundFrame((viewport.scrollLeft + x) / s.zoom, s.project.fps), firstFrame, Math.max(firstFrame, lastFrame));
      if (force || Math.abs(time - s.playhead) > 1e-7) s.seek(time);
    };
    const tick = (now: number) => {
      if(useEditor.getState().gestureOwner!==owner){finish();return;}
      const elapsed = Math.min(50, now - previousFrame); previousFrame = now;
      if (moved && following.current) {
        const x = clientX - viewport.getBoundingClientRect().left - viewport.clientLeft;
        const edge = Math.min(48, viewport.clientWidth * 0.12);
        const strength = x < edge ? (x - edge) / edge : x > viewport.clientWidth - edge ? (x - viewport.clientWidth + edge) / edge : 0;
        viewport.scrollLeft = clamp(viewport.scrollLeft + clamp(strength, -1, 1) * 1200 * elapsed / 1000, 0, Math.max(0, viewport.scrollWidth - viewport.clientWidth));
      }
      moveHead();
      frame = requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      clientX = event.clientX; moved ||= Math.abs(clientX - originX) >= 3;
      moveHead();
    };
    const finish = () => {
      if (!scrubbing.current) return;
      scrubbing.current = false; cleanupScrub.current = null;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', finish);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('keydown', key);
      viewport.removeEventListener('lostpointercapture', end);
      if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
      const owned=useEditor.getState().gestureOwner===owner;useEditor.getState().endGesture(owner);
      if (following.current&&owned) revealPlayhead();
    };
    const end = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); finish(); } };
    const hidden = () => { if (document.hidden) finish(); };
    cleanupScrub.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', finish);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('keydown', key);
    viewport.addEventListener('lostpointercapture', end);
    viewport.setPointerCapture(pointerId);
    moveHead(true);
    frame = requestAnimationFrame(tick);
  }, [scroller, revealPlayhead]);

  return { followPlayhead, setFollowPlayhead, revealPlayhead, scrub, onViewportScroll };
}
