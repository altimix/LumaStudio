import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { transitionPlan, VIDEO_TRANSITIONS, AUDIO_TRANSITIONS } from '../../shared/transitions.mjs';
import { clipsLocked } from '../../shared/clip-links.mjs';
import { useEditor } from '../store';
import type { Project } from '../types';
import '../clip-context-menu.css';

export default function TimelineTransition({ transition: t, zoom }: { transition: ReturnType<typeof transitionPlan>[number]; zoom: number }) {
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; project: Project } | null>(null);
  const project = useEditor(s => s.project), menuOpen = useEditor(s => s.clipMenuOpen);
  const locked = clipsLocked(project, [t.fromId, t.toId]);
  const close = useCallback(() => { setAnchor(null); useEditor.setState({ clipMenuOpen: false }); }, []);
  const adjust = () => { useEditor.getState().select([t.toId]); useEditor.getState().setPanel('effects'); useEditor.getState().seek(t.start); };
  const remove = () => { close(); useEditor.getState().removeTransition(t.id); };
  const open = (x: number, y: number) => {
    const state = useEditor.getState(); if (state.gestureActive) return;
    state.stop(); setAnchor({ x, y, project: state.project }); useEditor.setState({ clipMenuOpen: true, trackMenuOpen: false });
  };
  useLayoutEffect(() => {
    if (!anchor || !menuOpen) return;
    const element = menu.current!;
    const place = () => { element.style.left = `${Math.max(8, Math.min(anchor.x, innerWidth - element.offsetWidth - 8))}px`; element.style.top = `${Math.max(8, Math.min(anchor.y, innerHeight - element.offsetHeight - 8))}px`; };
    place(); element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) close(); };
    window.addEventListener('pointerdown', outside, true); window.addEventListener('blur', close); window.addEventListener('resize', place);
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', close); window.removeEventListener('resize', place); button.current?.focus({ preventScroll: true }); };
  }, [anchor, menuOpen, close]);
  useLayoutEffect(() => { if (anchor && (anchor.project !== project || !menuOpen)) close(); }, [anchor, project, menuOpen, close]);
  useLayoutEffect(() => () => { if (menu.current) useEditor.setState({ clipMenuOpen: false }); }, []);
  const label = [t.video && VIDEO_TRANSITIONS[t.video], t.audio && AUDIO_TRANSITIONS[t.audio]].filter(Boolean).join(' + ');
  return <><button ref={button} className="timeline-transition" data-transition-id={t.id} style={{ left: t.start * zoom, width: Math.max(16, t.duration * zoom) }} aria-label={`トランジション ${t.video ? VIDEO_TRANSITIONS[t.video] : AUDIO_TRANSITIONS[t.audio!]}`} title={`${label} · ${t.duration.toFixed(2)}秒 · 右クリックで効果だけを削除`} onPointerDown={e => e.stopPropagation()} onClick={adjust} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); open(e.clientX, e.clientY); }} onKeyDown={e => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); open(r.left + Math.min(20, r.width / 2), r.bottom); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); if (!e.repeat && !useEditor.getState().gestureActive) remove(); }
  }}>⋈</button>{anchor && menuOpen ? createPortal(<div ref={menu} className="clip-context-menu transition-context-menu" role="menu" aria-label="トランジションの編集" style={{ left: anchor.x, top: anchor.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
    e.stopPropagation();
    const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
  }}><div className="clip-menu-heading">{label}<small>素材と動画の長さは変わりません</small></div><button role="menuitem" tabIndex={-1} onClick={() => { close(); adjust(); }}>効果を調整</button><button role="menuitem" tabIndex={-1} disabled={locked} title={locked ? 'トラックのロックを解除してください。' : undefined} onClick={remove}>トランジションを削除</button></div>, document.body) : null}</>;
}
