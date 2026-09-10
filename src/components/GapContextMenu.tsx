import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../types';
import { findTimelineGap, gapRippleBlockReason } from '../gap-editing';
import { timecode } from '../model';
import { useEditor } from '../store';
import '../clip-context-menu.css';

export type GapMenuAnchor = { trackId: string; time: number; x: number; y: number; element: HTMLElement; project: Project };

export default function GapContextMenu({ anchor, onClose }: { anchor: GapMenuAnchor; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null), project = useEditor(s => s.project);
  const gap = findTimelineGap(project, anchor.trackId, anchor.time);
  const reason = gap ? gapRippleBlockReason(project, gap) : 'この位置には、後ろに素材がある空白がありません。';
  useLayoutEffect(() => {
    const element = menu.current!;
    const place = () => {
      element.style.left = `${Math.max(8, Math.min(anchor.x, innerWidth - element.offsetWidth - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(anchor.y, innerHeight - element.offsetHeight - 8))}px`;
    };
    place(); (element.querySelector<HTMLButtonElement>('button:not(:disabled)') || element).focus();
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) onClose(); };
    window.addEventListener('pointerdown', outside, true); window.addEventListener('blur', onClose); window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', onClose); window.removeEventListener('resize', place);
      if (anchor.element.isConnected) anchor.element.focus({ preventScroll: true });
    };
  }, [anchor, onClose]);
  useLayoutEffect(() => { if (project !== anchor.project) onClose(); }, [project, anchor, onClose]);
  return createPortal(<div ref={menu} className="clip-context-menu gap-context-menu" role="menu" aria-label="空白の編集" tabIndex={-1} style={{ left: anchor.x, top: anchor.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }
  }}>
    <div className="clip-menu-heading">空白を詰める{gap ? <small>{timecode(gap.from, project.fps)} → {timecode(gap.to, project.fps)}（{(gap.to - gap.from).toFixed(2)}秒）</small> : null}
      <small>{reason || '全トラックの後ろの素材を前に詰めます。この区間に重なるBGM・字幕なども、同じ時間分をカットします。'}</small>
    </div>
    <button role="menuitem" disabled={!!reason} title={reason || undefined} onClick={() => {
      const state = useEditor.getState(); onClose();
      if (state.project === anchor.project && !state.gestureActive) state.removeGap(anchor.trackId, anchor.time);
    }}>空白をリップル削除</button>
  </div>, document.body);
}
