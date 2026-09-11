import { expect, it } from 'vitest';
import { emptyProject, makeClip } from './model';
import { applyTransition, transitionPlan } from '../shared/transitions.mjs';
import { ordinaryCutPrefetch } from './video-prefetch';
import type { Asset } from './types';

const asset: Asset = { id:'v', name:'v', path:'v.mp4', url:'', thumbnail:'', kind:'video', duration:20, width:320, height:180, fps:30, hasAudio:true, waveform:[], size:1, codec:'h264' };
function fixture(video = true) {
  const p = emptyProject(); p.assets = [asset];
  p.clips = [0, 4, 8].map((start, i) => ({ ...makeClip(p.tracks[1].id, start, asset), id: String(i), in:2, duration:4 }));
  return applyTransition(p, '0', '1', { duration:1, ...(video ? {video:'dissolve' as const} : {audio:'constantGain' as const}) }, 't');
}

it('leaves fixed transition entry seeks exclusively to the transition primer in both directions', () => {
  const p = fixture(), plans = transitionPlan(p), track = p.tracks[1].id;
  // Normal cut timestamps (4 and 4-1/fps) differ from the effect handles (3.5 and 4.5).
  expect(ordinaryCutPrefetch(p.clips, plans, track, 3, 1)).toBeUndefined();
  expect(ordinaryCutPrefetch(p.clips, plans, track, 5, -1)).toBeUndefined();
  expect(ordinaryCutPrefetch(p.clips, plans, track, 3.75, 1)).toBeUndefined();
  expect(ordinaryCutPrefetch(p.clips, plans, track, 4.25, -1)).toBeUndefined();
});

it('still primes ordinary cuts and audio-only transitions, including the other end of an effect clip', () => {
  const p = fixture(), plans = transitionPlan(p), track = p.tracks[1].id;
  expect(ordinaryCutPrefetch(p.clips, plans, track, 7, 1)?.id).toBe('2');
  expect(ordinaryCutPrefetch(p.clips, plans, track, 9, -1)?.id).toBe('1');
  const audio = fixture(false);
  expect(ordinaryCutPrefetch(audio.clips, transitionPlan(audio), audio.tracks[1].id, 3, 1)?.id).toBe('1');
  expect(ordinaryCutPrefetch(audio.clips, transitionPlan(audio), audio.tracks[1].id, 5, -1)?.id).toBe('0');
});
