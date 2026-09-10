import { hasClipAudio } from '../shared/clip-links.mjs';
import type { Asset, Clip, Project } from './types';

import { audioEnvelopes, transitionPlan, mediaWindow, type AudioEnvelope, type MediaWindow } from '../shared/transitions.mjs';
// Editor project snapshots are immutable; Undo can safely reuse an earlier plan.
const envelopeCache=new WeakMap<Project,Map<string,AudioEnvelope[]>>();
const windowCache=new WeakMap<Project,Map<string,MediaWindow>>();
export const AUDIO_CHUNK_SECONDS = 8;
export const AUDIO_SAMPLE_RATE = 48000;
export interface AudioSlice {
  asset: Asset; clip: Clip; envelopes?: AudioEnvelope[]; chunk: number; reverse: boolean;
  offset: number; sourceDuration: number; when: number; duration: number;
  timelineStart: number; timelineEnd: number; playbackRate: number;
}

// Half-open source intervals; a reverse slice starts immediately BEFORE its in point.
export function audioSlices(project: Project, from: number, to: number, rate: number): AudioSlice[] {
  const slices: AudioSlice[] = []; const reverse = rate < 0; const magnitude = Math.abs(rate);
  if (!Number.isFinite(rate) || !magnitude || from === to) return slices;
  let envelopes=envelopeCache.get(project);if(!envelopes){envelopes=audioEnvelopes(project);envelopeCache.set(project,envelopes);}
  const assets = new Map(project.assets.map(a => [a.id, a]));
  let windows=windowCache.get(project);if(!windows){const plans=transitionPlan(project),ids=new Set(plans.filter(t=>t.mode==='fixed'&&t.audio).flatMap(t=>[t.fromId,t.toId]));windows=new Map(project.clips.filter(c=>ids.has(c.id)).map(c=>[c.id,mediaWindow(c,assets.get(c.assetId||''),plans,'audio')]));windowCache.set(project,windows);}
  const tracks = new Map(project.tracks.map(t => [t.id, t]));
  const solo = project.tracks.some(t => t.solo);
  for (const clip of project.clips) {
    const asset = assets.get(clip.assetId || ''); const track = tracks.get(clip.trackId);
    if (!asset || asset.offline || !hasClipAudio(clip,asset) || clip.audioMuted || !track || track.muted || (solo && !track.solo) || !clip.volume || !['audio', 'video'].includes(clip.kind)) continue;
    const window=windows.get(clip.id)||mediaWindow(clip,asset,[],'audio');
    const low = Math.max(Math.min(from, to), window.start);
    const high = Math.min(Math.max(from, to), window.end);
    if (high - low < 1e-9) continue;
    const sourceEnd = clip.in + (high - clip.start) * clip.speed;
    let source = clip.in + (low - clip.start) * clip.speed;
    while (source < sourceEnd - 1e-9) {
      const chunk = Math.floor((source + 1e-9) / AUDIO_CHUNK_SECONDS);
      const end = Math.min(sourceEnd, (chunk + 1) * AUDIO_CHUNK_SECONDS);
      const a = clip.start + (source - clip.in) / clip.speed; const b = clip.start + (end - clip.in) / clip.speed;
      slices.push({ asset, clip, envelopes:envelopes.get(clip.id), chunk, reverse, offset: reverse ? (chunk + 1) * AUDIO_CHUNK_SECONDS - end : source - chunk * AUDIO_CHUNK_SECONDS,
        sourceDuration: end - source, when: (reverse ? from - b : a - from) / magnitude, duration: (b - a) / magnitude,
        timelineStart: reverse ? b : a, timelineEnd: reverse ? a : b, playbackRate: magnitude * clip.speed });
      source = end;
    }
  }
  return slices.sort((a, b) => a.when - b.when);
}
