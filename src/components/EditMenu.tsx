import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { clipsLocked, linkedIds } from '../../shared/clip-links.mjs';
import { shortcutLabel } from '../shortcut-label';
export default function EditMenu({ onOpen }: { onOpen: () => void }) {
  const [open, setOpen] = useState(false), menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const state = useEditor();
  const locked = clipsLocked(state.project, linkedIds(state.project, state.selected)), empty = !state.selected.length;
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => { if (open) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [open]);
  const items = [
    { label:'元に戻す', key:'Ctrl+Z', disabled:!state.history.length, action:state.undo },
    { label:'やり直す', key:'Ctrl+Shift+Z', disabled:!state.future.length, action:state.redo },
    { label:'コピー', key:'Ctrl+C', disabled:empty, action:state.copy },
    { label:'再生ヘッドに貼り付け', key:'Ctrl+V', disabled:!state.clipboard.length || state.clipboard.some(clip => !state.project.tracks.some(track => track.id === clip.trackId && !track.locked)), action:state.paste },
    { label:'複製', key:'Ctrl+D', disabled:empty || locked, action:state.duplicate },
    { label:'削除', key:'Delete', disabled:empty || locked, action:() => state.remove() },
    { label:'すべてのクリップを選択', key:'Ctrl+A', disabled:!state.project.clips.length, action:() => state.select(state.project.clips.map(clip => clip.id)) },
  ];
  return <div className="file-menu-wrap" onKeyDown={event => { if (!open) return; event.stopPropagation(); if (event.key === 'Escape' && open) { event.preventDefault(); close(); } if (event.key === 'Tab') setOpen(false); }}><button ref={trigger} aria-haspopup="menu" aria-expanded={open} onClick={() => { onOpen(); setOpen(!open); }}>編集</button>{open ? <>
    <button className="menu-dismiss" aria-label="編集メニューを閉じる" onClick={close}/>
    <div ref={menu} className="popup-menu file-menu" role="menu" aria-label="編集" onKeyDown={event => {
      if (['ArrowUp','ArrowDown','Home','End'].includes(event.key)) { event.preventDefault(); const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    }}>{items.map(item => <button role="menuitem" key={item.label} disabled={item.disabled || state.gestureActive} onClick={() => { close(); item.action(); }}><span>{item.label}</span><kbd>{shortcutLabel(item.key)}</kbd></button>)}</div>
  </> : null}</div>;
}
