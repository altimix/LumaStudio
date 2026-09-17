import { useEffect, useRef, useState } from 'react';
import { formatNumberInput, isHorizontalNumberScrub, scrubNumberValue } from '../number-scrub';
import './number-scrub.css';

type Props = {
  id?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  className?: string;
  title?: string;
  'aria-label'?: string;
  onCommit(value: number): void;
  onScrubStart(): boolean;
  onScrubChange(value: number): void;
  onScrubEnd(): void;
  onScrubCancel(): void;
};

const displayNumberInput = (value: number) => formatNumberInput(value, 2);

export default function ScrubbableNumberInput(props: Props) {
  const { value, min, max, step, disabled = false } = props;
  const [draft, setDraft] = useState(displayNumberInput(value));
  const focused = useRef(false), edited = useRef(false), cancelActive = useRef<(() => void) | null>(null), suppressClick = useRef(false);
  const callbacks = useRef(props); callbacks.current = props;

  useEffect(() => { if (!focused.current && !cancelActive.current) setDraft(displayNumberInput(value)); }, [value]);
  useEffect(() => () => cancelActive.current?.(), []);

  const pointerDown = (event: React.PointerEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (event.button !== 0 || disabled || cancelActive.current || document.activeElement === input) return;
    const pointerId = event.pointerId, originX = event.clientX, originY = event.clientY, start = value;
    let started = false, closed = false, last = start;
    const detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
      input.removeEventListener('lostpointercapture', lost);
      delete input.dataset.numberScrubbing;
      if (document.documentElement.dataset.numberScrub === input.id || document.documentElement.dataset.numberScrub === 'active') delete document.documentElement.dataset.numberScrub;
      try { if (input.hasPointerCapture(pointerId)) input.releasePointerCapture(pointerId); } catch { /* The native control may already have released it. */ }
      if (cancelActive.current === cancel) cancelActive.current = null;
    };
    const close = (result: 'finish' | 'cancel' | 'abandon') => {
      if (closed) return; closed = true; detach();
      if (started && result === 'cancel') { setDraft(displayNumberInput(start)); callbacks.current.onScrubCancel(); }
      if (started && result === 'finish') callbacks.current.onScrubEnd();
    };
    function move(e: PointerEvent) {
      if (closed || e.pointerId !== pointerId) return;
      const deltaX = e.clientX - originX, deltaY = e.clientY - originY;
      if (!started) {
        if (!isHorizontalNumberScrub(deltaX, deltaY)) return;
        if (!callbacks.current.onScrubStart()) { close('abandon'); return; }
        started = true; edited.current = false; input.dataset.numberScrubbing = 'true'; document.documentElement.dataset.numberScrub = input.id || 'active';
        document.getSelection()?.removeAllRanges();
        try { input.setPointerCapture(pointerId); } catch { /* Window listeners still complete the gesture. */ }
      }
      e.preventDefault();
      const next = scrubNumberValue(start, deltaX, step, min, max);
      if (next === last) return; last = next; setDraft(displayNumberInput(next)); callbacks.current.onScrubChange(next);
    }
    function up(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      if (started) { e.preventDefault(); suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); close('finish'); }
      else close('abandon');
    }
    function cancelPointer(e: PointerEvent) { if (e.pointerId === pointerId) cancel(); }
    function lost(e: Event) { if ((e as PointerEvent).pointerId === pointerId) cancel(); }
    function key(e: KeyboardEvent) { if (e.key === 'Escape' && started) { e.preventDefault(); e.stopPropagation(); cancel(); } }
    function visibility() { if (document.hidden) cancel(); }
    function cancel() { close(started ? 'cancel' : 'abandon'); }
    cancelActive.current = cancel;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    input.addEventListener('lostpointercapture', lost);
  };

  return <input id={props.id} className={`scrubbable-number${props.className ? ` ${props.className}` : ''}`} aria-label={props['aria-label']} title={props.title || '左右にドラッグして値を変更'} type="number" min={min} max={max} step={step} disabled={disabled} value={draft}
    onPointerDown={pointerDown}
    onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
    onFocus={() => { focused.current = true; edited.current = false; }}
    onChange={event => { setDraft(event.target.value); edited.current = true; }}
    onBlur={() => { focused.current = false; if (cancelActive.current) return; const wasEdited = edited.current; edited.current = false; const next = Number(draft); if (wasEdited && draft !== '' && Number.isFinite(next) && next !== value) props.onCommit(next); else setDraft(displayNumberInput(value)); }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape' && !cancelActive.current) { edited.current = false; setDraft(displayNumberInput(value)); event.currentTarget.blur(); } }}/>;
}
