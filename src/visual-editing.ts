import { useEditor } from './store';
import { clamp, roundFrame } from './model';
import { setVisualKey, visualKeys, validateVisualKeys } from '../shared/visual-keyframes.mjs';
import type { Clip } from './types';

export function localVisualTime(clip: Clip, playhead: number, fps: number) { return clamp(roundFrame(playhead - clip.start, fps), 0, clip.duration); }
export function addVisualPoint(id: string, time?: number) {
  const state = useEditor.getState(), clip = state.project.clips.find(item => item.id === id);
  if (!clip || state.gestureActive || state.project.tracks.find(track => track.id === clip.trackId)?.locked) return;
  try {
    const at = time === undefined ? localVisualTime(clip, state.playhead, state.project.fps) : clamp(roundFrame(time, state.project.fps), 0, clip.duration);
    const next = setVisualKey(clip, at);
    if (JSON.stringify(next) === JSON.stringify(clip)) return;
    state.updateClip(id, { visualKeyframes: next.visualKeyframes, opacityKeyframes: undefined });
    state.stop(); state.select([id]); state.seek(clip.start + at);
  } catch (error) { state.notify((error as Error).message); }
}
export function removeVisualPoint(id: string, time: number) {
  const state = useEditor.getState(), clip = state.project.clips.find(item => item.id === id);
  if (!clip || state.gestureActive) return;
  state.updateClip(id, { visualKeyframes: visualKeys(clip).filter(key => Math.abs(key.time - time) > 1e-7), opacityKeyframes: undefined });
}
export function moveVisualPoint(clip: Clip, from: number, to: number): Clip {
  const keys = visualKeys(clip), point = keys.find(key => Math.abs(key.time - from) < 1e-7);
  if (!point || keys.some(key => key !== point && Math.abs(key.time - to) < 1e-7)) return clip;
  const result = { ...clip, opacityKeyframes: undefined, visualKeyframes: keys.map(key => key === point ? { ...key, time: to } : key).sort((a, b) => a.time - b.time) };
  validateVisualKeys(result); return result;
}
