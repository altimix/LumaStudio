import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from '../store';
import { clamp, roundFrame } from '../model';
import { visualClipAt, visualKeys, setVisualKey } from '../../shared/visual-keyframes.mjs';
import { channelPatch, channelText, channelValue, visualChannels } from '../visual-channels';
import { addVisualPoint, moveVisualPoint, removeVisualPoint } from '../visual-editing';
import type { Clip } from '../types';
import './visual-keyframes.css';

export default function ClipVisualKeys({ clip, locked }: { clip: Clip; locked: boolean }) {
  const project = useEditor(state => state.project), playhead = useEditor(state => state.playhead), selected = useEditor(state => state.visualChannel);
  const root = useRef<HTMLDivElement>(null), cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const keys = visualKeys(clip), channels = visualChannels(clip, project), channel = channels.find(item => item.path === selected) ?? channels[4];
  const y = (time: number) => {
    const value = channelValue(visualClipAt(clip, time), channel.path);
    return typeof value === 'number' && channel.min !== undefined && channel.max !== undefined ? 90 - clamp((value - channel.min) / (channel.max - channel.min), 0, 1) * 80 : 50;
  };
  const times = [0, ...keys.flatMap((key, index) => index ? [Math.max(keys[index - 1].time, key.time - 1e-6), key.time] : [key.time]), clip.duration];
  const path = times.map((time, index) => `${index ? 'L' : 'M'}${time / clip.duration * 100},${y(time)}`).join(' ');
  const drag = (event: ReactPointerEvent<HTMLButtonElement>, from: number) => {
    if (event.button !== 0 || locked || cleanup.current || useEditor.getState().gestureActive) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
    const initial = useEditor.getState(); initial.stop(); initial.select([clip.id]); initial.seek(clip.start + from);
    const before = useEditor.getState(), original = before.project.clips.find(item => item.id === clip.id)!;
    const rect = root.current!.getBoundingClientRect(), target = event.currentTarget, pointer = event.pointerId, origin = { x: event.clientX, y: event.clientY }, owner = {};
    const originalValue = channelValue(visualClipAt(original, from), channel.path);
    let changed = false, closed = false, writing = false, expected = before.project,latestTime=from;
    const detach = () => {
      closed = true; cleanup.current = null; unsubscribe();
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancelPointer); window.removeEventListener('keydown', key); window.removeEventListener('blur', cancel);window.removeEventListener('resize',cancel);document.removeEventListener('visibilitychange',visibility);
      target.removeEventListener('lostpointercapture', cancelPointer);
      if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
    };
    const restore=()=>{const state=useEditor.getState();useEditor.setState({ project: before.project, history: before.history, future: before.future, historyLabels: before.historyLabels, futureLabels: before.futureLabels, historyPlayheads: before.historyPlayheads, futurePlayheads: before.futurePlayheads, currentAction: before.currentAction, dirty: before.dirty, playhead: before.playhead, seekRevision: state.seekRevision + 1 });};
    const finish = () => { if (closed) return;const state=useEditor.getState(),current=state.project.clips.find(c=>c.id===clip.id);detach();if(changed&&state.gestureOwner===owner&&state.project===expected&&current&&JSON.stringify(visualKeys(current))===JSON.stringify(visualKeys(original)))restore();useEditor.getState().endGesture(owner);root.current?.querySelector<HTMLButtonElement>(`[data-key-time="${latestTime}"]`)?.focus({preventScroll:true}); };
    const cancel = () => {
      if (closed) return; const state = useEditor.getState(); detach();
      if (changed && state.gestureOwner === owner && state.project === expected) restore();
      useEditor.getState().endGesture(owner);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer || closed) return;
      const state = useEditor.getState(); if (state.gestureOwner !== owner || state.project !== expected) { finish(); return; }
      if (!changed && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 3) return;
      const at = clamp(roundFrame(from + (e.clientX - origin.x) / rect.width * original.duration, before.project.fps), 0, original.duration);
      try {
        let next = moveVisualPoint(original, from, at);
        if (next === original && at !== from) return;
        if (typeof originalValue === 'number' && channel.min !== undefined && channel.max !== undefined && channel.step) {
          const requested = originalValue - (e.clientY - origin.y) / (rect.height * .8) * (channel.max - channel.min);
          const value = clamp(Math.round(requested / channel.step) * channel.step, channel.min, channel.max);
          next = setVisualKey(next, at, channelPatch(visualClipAt(next, at), channel.path, value));
        }
        if (JSON.stringify(next) === JSON.stringify(state.project.clips.find(item => item.id === clip.id))) return;
        writing = true;
        if (!changed) { state.checkpoint('キーフレームを移動'); changed = true; }
        state.transient({ ...before.project, clips: before.project.clips.map(item => item.id === clip.id ? next : item) }, before.project);
        expected = useEditor.getState().project;latestTime=at;state.seek(clip.start + at);
      } catch (error) { state.notify((error as Error).message); }
      finally { writing = false; }
    };
    const up = (e: PointerEvent) => { if (e.pointerId === pointer) finish(); };
    const cancelPointer = (e: PointerEvent) => { if (e.pointerId === pointer) cancel(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    const visibility=()=>{if(document.hidden)cancel();};
    const unsubscribe = useEditor.subscribe((state,previous) => { if(writing||closed)return;if(state.project!==expected){finish();return;}if(state.playing||!state.selected.includes(clip.id)||state.playhead!==previous.playhead||state.seekRevision!==previous.seekRevision||state.visualChannel!==previous.visualChannel)cancel(); });
    if (!before.beginGesture(owner, cancel)) { unsubscribe(); return; }
    cleanup.current = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancelPointer); window.addEventListener('keydown', key); window.addEventListener('blur', cancel);window.addEventListener('resize',cancel);document.addEventListener('visibilitychange',visibility);
    target.addEventListener('lostpointercapture', cancelPointer); target.setPointerCapture(pointer);
  };
  if (!keys.length) return null;
  return <div ref={root} className={`clip-visual-keys ${locked ? 'locked' : ''}`} role="group" aria-label={`${clip.name}のキーフレーム`} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); if (!locked && !(event.target as HTMLElement).closest('.clip-visual-key')) { const rect = root.current!.getBoundingClientRect(); addVisualPoint(clip.id, (event.clientX - rect.left) / rect.width * clip.duration); } }}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={path}/></svg>
    <span className="clip-keyframe-label">{channel.label}</span>
    {keys.map((point, index) => <button type="button" key={index} className="clip-visual-key" data-key-time={point.time} disabled={locked}
      style={{ left: `${point.time / clip.duration * 100}%`, top: `${y(point.time)}%` }} aria-label={`キーフレーム ${point.time.toFixed(2)} 秒 ${channel.label}`} aria-pressed={Math.abs(playhead - clip.start - point.time) < 1e-7}
      title={`${point.time.toFixed(2)} 秒 · ${channel.label}: ${channelText(visualClipAt(clip, point.time), channel)} · ドラッグで時刻と値、Deleteで削除`}
      onPointerDown={event => drag(event, point.time)} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={event => {
        if (!['Enter', ' ', 'Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); const state = useEditor.getState();
        if (event.key === 'Delete' || event.key === 'Backspace') { removeVisualPoint(clip.id, point.time); return; }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const at = clamp(roundFrame(point.time + (event.key === 'ArrowRight' ? 1 : -1) / project.fps, project.fps), 0, clip.duration), next = moveVisualPoint(clip, point.time, at);
          if (next === clip) return; state.updateClip(clip.id, { visualKeyframes: next.visualKeyframes, opacityKeyframes: undefined }); state.seek(clip.start + at); return;
        }
        state.stop(); state.select([clip.id]); state.seek(clip.start + point.time);
        const current = visualClipAt(clip, point.time), value = channelValue(current, channel.path);
        if (typeof value === 'number' && channel.step && channel.min !== undefined && channel.max !== undefined && ['ArrowUp', 'ArrowDown'].includes(event.key)) state.updateClip(clip.id, channelPatch(current, channel.path, clamp(value + channel.step * (event.key === 'ArrowUp' ? 1 : -1), channel.min, channel.max)));
      }}/>) }
  </div>;
}
