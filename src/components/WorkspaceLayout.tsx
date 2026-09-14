import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { clampSize, fitLayout, LAYOUT_LIMITS, type LayoutPreferences } from '../layout-preferences';

function LayoutSeparator({ label, controls, axis, direction = 1, value, min, max, onChange, onDragStart, onDragCancel }: {
  label: string; controls: string; axis: 'x' | 'y'; direction?: number;
  value: number; min: number; max: number; onChange: (value: number) => void;
  onDragStart: () => void; onDragCancel: () => void;
}) {
  const drag = useRef<{ id: number; start: number; value: number } | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const finish = (cancel = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (cancel) onDragCancel();
    setDragging(false);
    if (element.current?.hasPointerCapture(current.id)) element.current.releasePointerCapture(current.id);
  };
  useEffect(() => {
    const blur = () => finish();
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  });
  return <div ref={element} className={`layout-separator ${axis === 'y' ? 'workspace-resizer' : 'side-resizer'} ${dragging ? 'dragging' : ''}`}
    role="separator" tabIndex={0} aria-label={label} aria-controls={controls}
    aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} ピクセル`}
    title={`${label}（ドラッグ / 矢印キー）`}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      onDragStart();
      drag.current = { id: event.pointerId, start: axis === 'x' ? event.clientX : event.clientY, value };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      onChange(clampSize(current.value + direction * ((axis === 'x' ? event.clientX : event.clientY) - current.start), min, max));
    }}
    onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish()}
    onKeyDown={event => {
      // A focused separator owns its keys; arrows must not seek or edit clips.
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); finish(true); return; }
      const arrows = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      const arrow = arrows.indexOf(event.key);
      if (arrow >= 0 || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        if (!drag.current) onChange(event.key === 'Home' ? min : event.key === 'End' ? max : clampSize(value + (arrow ? 1 : -1) * direction * (event.shiftKey ? 40 : 10), min, max));
      }
    }}><span/></div>;
}

export default function WorkspaceLayout({ preferences, onChange, library, inspector, preview, timeline }: {
  preferences: LayoutPreferences; onChange: Dispatch<SetStateAction<LayoutPreferences>>;
  library: ReactNode; inspector: ReactNode; preview: ReactNode; timeline: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const previous = useRef(preferences);
  useLayoutEffect(() => {
    for (const side of ['library', 'inspector'] as const) {
      const key = side === 'library' ? 'libraryCollapsed' : 'inspectorCollapsed';
      if (previous.current[key] === preferences[key]) continue;
      const content = container.current?.querySelector<HTMLElement>(`#workspace-${side}`);
      const rail = content?.parentElement;
      if (rail?.contains(document.activeElement) || document.activeElement === document.body) {
        rail?.querySelector<HTMLElement>(preferences[key] ? '.collapsed-panel' : '.panel-collapse')?.focus();
      }
    }
    previous.current = preferences;
  }, [preferences]);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight - 133 });
  useLayoutEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(() => setViewport({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const sizes = fitLayout(preferences, viewport.width, viewport.height);
  const beforeDrag = useRef(preferences);
  const dragCallbacks = {
    onDragStart: () => { beforeDrag.current = preferences; },
    onDragCancel: () => onChange(beforeDrag.current),
  };
  const resizeSide = (side: 'libraryWidth' | 'inspectorWidth', value: number) => onChange(current => ({
    ...current,
    libraryWidth: current.libraryCollapsed ? current.libraryWidth : sizes.libraryWidth,
    inspectorWidth: current.inspectorCollapsed ? current.inspectorWidth : sizes.inspectorWidth,
    [side]: value,
  }));
  return <div className="editor-layout" ref={container}>
    <main className="workspace" style={{ gridTemplateColumns: `${sizes.libraryWidth}px 8px minmax(400px, 1fr) 8px ${sizes.inspectorWidth}px` }}>
      <div className="workspace-side">
        <div id="workspace-library" className="workspace-side-content" hidden={preferences.libraryCollapsed}>{library}</div>
        {preferences.libraryCollapsed ? <button className="collapsed-panel" aria-label="素材パネルを表示" aria-controls="workspace-library" aria-expanded={false} onClick={() => onChange(current => ({ ...current, libraryCollapsed: false }))}><PanelLeftOpen size={18}/><span>素材</span></button> : null}
      </div>
      {preferences.libraryCollapsed ? <div/> : <LayoutSeparator {...dragCallbacks} label="素材パネルの幅を変更" controls="workspace-library" axis="x" value={sizes.libraryWidth} min={LAYOUT_LIMITS.library.min} max={sizes.libraryMax} onChange={value => resizeSide('libraryWidth', value)}/>}
      {preview}
      {preferences.inspectorCollapsed ? <div/> : <LayoutSeparator {...dragCallbacks} label="プロパティパネルの幅を変更" controls="workspace-inspector" axis="x" direction={-1} value={sizes.inspectorWidth} min={LAYOUT_LIMITS.inspector.min} max={sizes.inspectorMax} onChange={value => resizeSide('inspectorWidth', value)}/>}
      <div className="workspace-side">
        <div id="workspace-inspector" className="workspace-side-content" hidden={preferences.inspectorCollapsed}>{inspector}</div>
        {preferences.inspectorCollapsed ? <button className="collapsed-panel" aria-label="プロパティパネルを表示" aria-controls="workspace-inspector" aria-expanded={false} onClick={() => onChange(current => ({ ...current, inspectorCollapsed: false }))}><PanelRightOpen size={18}/><span>プロパティ</span></button> : null}
      </div>
    </main>
    <LayoutSeparator {...dragCallbacks} label="タイムラインの高さを変更" controls="workspace-timeline" axis="y" direction={-1} value={sizes.timelineHeight} min={LAYOUT_LIMITS.timeline.min} max={sizes.timelineMax} onChange={value => onChange(current => ({ ...current, timelineHeight: value }))}/>
    <div id="workspace-timeline" className="timeline-container" style={{ height: sizes.timelineHeight }}>{timeline}</div>
  </div>;
}
