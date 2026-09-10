import { describe, expect, it } from 'vitest';
import { audioSlices } from './audio-plan';
import { crossfadeGain } from '../shared/transitions.mjs';
import { emptyProject, makeClip } from './model';
import type { Asset } from './types';

function fixture() {
  const p = emptyProject();
  const asset: Asset = { id: 'sound', name: '音声', url: 'media://local/asset/sound?v=1', path: 'audio.wav', thumbnail: '', kind: 'audio', duration: 40, width: 0, height: 0, fps: 0, hasAudio: true, waveform: [], size: 100, codec: 'pcm' };
  p.assets = [asset]; p.clips = [{ ...makeClip(p.tracks[2].id, 3, asset), in: 7, speed: 2, duration: 5, volume: 1, fadeIn: 0, fadeOut: 0 }]; return p;
}
describe('timeline audio intervals', () => {
  it('maps clip in/speed across a PCM window in both directions without gaps', () => {
    const p = fixture();
    const forward = audioSlices(p, 3, 4, 1);
    expect(forward.map(s => [s.chunk, s.offset, s.sourceDuration, s.when, s.duration, s.playbackRate])).toEqual([[0, 7, 1, 0, 0.5, 2], [1, 0, 1, 0.5, 0.5, 2]]);
    const reverse = audioSlices(p, 4, 3, -1);
    expect(reverse.map(s => [s.chunk, s.offset, s.sourceDuration, s.when, s.duration, s.playbackRate])).toEqual([[1, 7, 1, 0, 0.5, 2], [0, 0, 1, 0.5, 0.5, 2]]);
    expect(reverse.map(s => [s.timelineStart, s.timelineEnd, s.reverse])).toEqual([[4, 3.5, true], [3.5, 3, true]]);
  });
  it('includes audio from video, mixes overlaps, respects cuts and gaps', () => {
    const p = fixture(); p.clips[0].duration = 1;
    p.clips.push({ ...p.clips[0], id: 'next', start: 5, in: 20, kind: 'video', trackId: p.tracks[1].id });
    expect(audioSlices(p, 4, 5, 1)).toHaveLength(0);
    const reverse = audioSlices(p, 6, 2, -2);
    expect(reverse.map(s => [s.clip.id, s.when, s.duration])).toEqual([['next', 0, 0.5], [p.clips[0].id, 1, 0.25], [p.clips[0].id, 1.25, 0.25]]);
    p.clips[1].start = 3;
    expect(new Set(audioSlices(p, 3, 4, 1).map(s => s.clip.id)).size).toBe(2);
  });
  it('honors mute, solo, missing audio, offline assets and zero volume but not video visibility', () => {
    for (const change of ['mute', 'solo', 'offline', 'silent', 'volume']) {
      const p = fixture();
      if (change === 'mute') p.tracks[2].muted = true;
      if (change === 'solo') p.tracks[1].solo = true;
      if (change === 'offline') p.assets[0].offline = true;
      if (change === 'silent') p.assets[0].hasAudio = false;
      if (change === 'volume') p.clips[0].volume = 0;
      expect(audioSlices(p, 4, 3, -1)).toHaveLength(0);
    }
    const p = fixture(); p.tracks[2].hidden = true; p.tracks[2].solo = true;
    expect(audioSlices(p, 3, 4, 1)).toHaveLength(2);
  });
  it('uses half-open end points and clamps at actual source duration', () => {
    const p = fixture(); p.assets[0].duration = 8;
    expect(audioSlices(p, 4, 3, -1).map(s => [s.chunk, s.offset, s.when, s.duration])).toEqual([[0, 0, 0.5, 0.5]]);
    expect(audioSlices(p, 3.5, 4, 1)).toHaveLength(0);
    expect(audioSlices(p, 3, 3, 1)).toHaveLength(0);
    expect(audioSlices(p, 3, 4, 0)).toHaveLength(0);
  });
  it('supports all shuttle magnitudes including clip speed multiplication', () => {
    for (const rate of [1, 2, 4, 8, 16, -1, -2, -4, -8, -16]) {
      const slices = audioSlices(fixture(), rate > 0 ? 3 : 4, rate > 0 ? 4 : 3, rate);
      expect(slices.reduce((sum, s) => sum + s.duration, 0)).toBeCloseTo(1 / Math.abs(rate));
      expect(slices.every(s => s.playbackRate === 2 * Math.abs(rate))).toBe(true);
    }
  });
});


it('updates transition gains for edited snapshots and restores them on Undo',()=>{
  const p=fixture(),base={...p.clips[0],in:0,duration:2,speed:1};p.clips=[{...base,id:'a',start:0},{...base,id:'b',start:1}];p.transitions=[{id:'crossfade',fromId:'a',toId:'b',audio:'constantGain'}];
  const gain=(project:typeof p,rate:number)=>crossfadeGain(audioSlices(project,rate>0?1.4:1.6,rate>0?1.6:1.4,rate).find(slice=>slice.clip.id==='a')!.envelopes,1.5);
  expect(gain(p,1)).toBeCloseTo(.5);const edited:typeof p={...p,transitions:[{...p.transitions[0],audio:'constantPower'}]};expect(gain(edited,-1)).toBeCloseTo(Math.SQRT1_2);expect(gain(p,-1)).toBeCloseTo(.5);
});
