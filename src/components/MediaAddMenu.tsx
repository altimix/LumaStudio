import { shortcutLabel } from '../shortcut-label';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Film, Plus, Upload } from 'lucide-react';

export default function MediaAddMenu({ onImport, onBlack, disabled, blackDisabled }: {
  onImport: () => void; onBlack: () => void; disabled: boolean; blackDisabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', outside); window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); };
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div className="media-add-wrap" ref={wrap} onKeyDown={event => {
    if (!open) return;
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Tab') setOpen(false);
    else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }}>
    <button ref={trigger} className="media-add-trigger" aria-label="素材を追加" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'media-add-menu' : undefined} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={event => { if (!open && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); setOpen(true); } }}><Plus size={14}/>追加<ChevronDown size={12}/></button>
    {open ? <div ref={menu} id="media-add-menu" className="popup-menu media-add-menu" role="menu" aria-label="素材の追加方法">
      <button role="menuitem" tabIndex={-1} onClick={() => { close(); onImport(); }}><Upload size={15}/><span>素材を読み込む</span><kbd>{shortcutLabel('Ctrl I')}</kbd></button>
      <button role="menuitem" tabIndex={-1} disabled={blackDisabled} onClick={() => { close(); onBlack(); }}><Film size={15}/><span>ブラックビデオを追加</span></button>
    </div> : null}
  </div>;
}
