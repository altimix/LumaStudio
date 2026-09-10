import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function IconButton({ label, active, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return <button className={`icon-button ${active ? 'active' : ''} ${props.className || ''}`} title={label} aria-label={label} aria-pressed={active === undefined ? undefined : active} {...props}>{children}</button>;
}
export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.querySelector<HTMLElement>('button')?.focus(); return () => previous?.focus(); }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={dialog} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') { const focusable = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]; const first = focusable[0]; const last = focusable.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
  }}><div className="modal-heading"><h2>{title}</h2><IconButton label="閉じる" onClick={onClose}><X size={18}/></IconButton></div>{children}</section></div>;
}
export function Waveform({ values, color = 'currentColor', from = 0, to = 1 }: { values: number[]; color?: string; from?: number; to?: number }) {
  const first = Math.max(0, Math.floor(from * values.length)), last = Math.min(values.length, Math.max(first + 1, Math.ceil(to * values.length))), count = Math.min(600, last - first);
  const bins = Array.from({ length: count }, (_, i) => {
    let peak = 0; for (let j = first + Math.floor(i * (last - first) / count); j < first + Math.ceil((i + 1) * (last - first) / count); j++) peak = Math.max(peak, values[j]); return peak;
  });
  return <svg className="waveform" viewBox="0 0 600 56" preserveAspectRatio="none" aria-hidden="true">{bins.map((value, i) => <rect key={i} x={i * 600 / bins.length} y={28 - Math.max(1, value * 24)} width={Math.max(1, 600 / bins.length * 0.62)} height={Math.max(2, value * 48)} fill={color}/>)}</svg>;
}
