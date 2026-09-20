import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useEditor } from './store';
import { containMonitor, fitMonitor, wheelMonitorScale, zoomMonitor, type MonitorSize, type MonitorView } from './preview-viewport';

type Position = { x: number; y: number };
type Navigation = { before: MonitorView; base: MonitorView; center: Position; distance: number; pointers: Map<number, Position> };
function geometry(points: Map<number, Position>) {
  const [a, b] = [...points.values()];
  return b ? { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(b.x - a.x, b.y - a.y) } : { center: a, distance: 0 };
}

export function usePreviewViewport(stage: RefObject<HTMLDivElement | null>, source: MonitorSize, projectId: string) {
  const [viewport, setViewport] = useState<MonitorSize>({ width: 1, height: 1 });
  const [view, setView] = useState<MonitorView>({ scale: 1, x: 0, y: 0, fit: true });
  const [hand, setHand] = useState(false), [navigating, setNavigating] = useState(false);
  const current = useRef({ view, viewport, source }); current.current = { view, viewport, source };
  const navigation = useRef<Navigation | null>(null);
  const apply = (next: MonitorView) => {
    const state = current.current, bounded = containMonitor(next, state.source, state.viewport);
    current.current.view = bounded; setView(bounded);
  };
  const finish = (cancel = false) => {
    const session = navigation.current; if (!session) return;
    navigation.current = null; setNavigating(false);
    for (const id of session.pointers.keys()) if (stage.current?.hasPointerCapture(id)) stage.current.releasePointerCapture(id);
    if (cancel) apply(session.before);
  };
  useLayoutEffect(() => {
    const element = stage.current; if (!element) return;
    finish(true); setHand(false);
    const measure = () => {
      finish(true);
      const bounds = element.getBoundingClientRect(), size = { width: bounds.width, height: bounds.height };
      current.current.viewport = size; current.current.source = source; setViewport(size);
      apply(current.current.view.fit ? fitMonitor(source, size) : current.current.view);
    };
    current.current.view = { ...current.current.view, fit: true }; measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => { observer.disconnect(); finish(true); };
  }, [stage, source.width, source.height, projectId]);
  useEffect(() => {
    const element = stage.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (useEditor.getState().gestureActive || navigation.current || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
      const state = current.current, bounds = element.getBoundingClientRect();
      const anchor = { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
      apply(zoomMonitor(state.view, wheelMonitorScale(state.view.scale, event.deltaY, event.deltaMode, event.ctrlKey, bounds.height), anchor));
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && navigation.current) { event.preventDefault(); event.stopPropagation(); finish(true); } };
    const cancel = () => finish(true), visibility = () => { if (document.hidden) cancel(); };
    element.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', visibility);
    return () => { element.removeEventListener('wheel', wheel); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', visibility); finish(true); };
  }, [stage]);
  const pointerPosition = (event: ReactPointerEvent) => {
    const bounds = stage.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-monitor-control]')) return;
    if (!(event.pointerType === 'touch' || event.button === 1 || (hand && event.button === 0))) return;
    event.preventDefault(); event.stopPropagation();
    if (useEditor.getState().gestureActive) return;
    const position = pointerPosition(event), session = navigation.current;
    if (session) {
      if (session.pointers.size >= 2) return;
      session.pointers.set(event.pointerId, position); Object.assign(session, geometry(session.pointers), { base: current.current.view });
    } else navigation.current = { before: current.current.view, base: current.current.view, center: position, distance: 0, pointers: new Map([[event.pointerId, position]]) };
    event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); setNavigating(true);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = navigation.current; if (!session?.pointers.has(event.pointerId)) return;
    event.preventDefault(); event.stopPropagation(); session.pointers.set(event.pointerId, pointerPosition(event));
    const now = geometry(session.pointers);
    if (now.center.x === session.center.x && now.center.y === session.center.y && now.distance === session.distance) { apply(session.base); return; }
    const next = session.distance > 0 ? zoomMonitor(session.base, session.base.scale * now.distance / session.distance, session.center) : { ...session.base, fit: false };
    apply({ ...next, x: next.x + now.center.x - session.center.x, y: next.y + now.center.y - session.center.y });
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = navigation.current; if (!session?.pointers.has(event.pointerId)) return;
    pointerMove(event); session.pointers.delete(event.pointerId);
    if (!session.pointers.size) { navigation.current = null; setNavigating(false); }
    else Object.assign(session, geometry(session.pointers), { base: current.current.view });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const reset = () => { if (useEditor.getState().gestureActive) return; finish(); apply(fitMonitor(current.current.source, current.current.viewport)); setHand(false); };
  const chooseScale = (value: string) => {
    if (value === 'fit') { reset(); return; }
    if (useEditor.getState().gestureActive || !Number.isFinite(Number(value))) return;
    finish(); apply(zoomMonitor(current.current.view, Number(value), { x: 0, y: 0 }));
  };
  const pan = (axis: 'x' | 'y', value: number) => {
    if (useEditor.getState().gestureActive || !Number.isFinite(value)) return;
    finish(); apply({ ...current.current.view, [axis]: -value, fit: false });
  };
  const limitX = Math.max(0, (source.width * view.scale + viewport.width) / 2 - 32);
  const limitY = Math.max(0, (source.height * view.scale + viewport.height) / 2 - 32);
  return { view, viewport, hand, navigating, setHand, chooseScale, pan, limitX, limitY, pointerDown, pointerMove, pointerUp,
    pointerCancel: (event: ReactPointerEvent) => { if (navigation.current?.pointers.has(event.pointerId)) finish(true); },
    lostCapture: (event: ReactPointerEvent) => { if (navigation.current?.pointers.has(event.pointerId)) finish(true); } };
}
