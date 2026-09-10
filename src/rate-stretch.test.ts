import { describe, expect, it } from 'vitest';
import { emptyProject, makeClip, rateStretchClip } from './model';
import type { Asset } from './types';
const asset:Asset={id:'a',name:'AV',path:'test.mp4',url:'',thumbnail:'',kind:'video',duration:30,width:320,height:180,fps:30,hasAudio:true,waveform:[],size:1,codec:'h264'};
describe('rate stretching preserves the complete trimmed source range',()=>{
  it.each(['video','audio'] as const)('stretches %s from either edge without changing source in/out',kind=>{
    const p=emptyProject(), c={...makeClip(p.tracks[1].id,4,{...asset,kind}),in:3,duration:6,speed:1.25,fadeIn:1,fadeOut:2};p.assets=[{...asset,kind}];
    for(const edge of ['left','right'] as const){const changed=rateStretchClip(c,edge,edge==='right'?3:-3,p);expect(changed.duration).toBe(9);expect(changed.in).toBe(3);expect(changed.in+changed.duration*changed.speed).toBe(10.5);expect(changed.fadeIn).toBe(1.5);expect(changed.fadeOut).toBe(3);expect(edge==='right'?changed.start:changed.start+changed.duration).toBe(edge==='right'?4:10);}
  });
  it('clamps to frame boundaries, 0.25–4× and the beginning of the sequence',()=>{
    const p=emptyProject(),c={...makeClip(p.tracks[1].id,2,asset),duration:5};p.assets=[asset];
    for(const edge of ['left','right'] as const)for(const delta of [-100,100,0.137]){const next=rateStretchClip(c,edge,delta,p);expect(next.start).toBeGreaterThanOrEqual(0);expect(next.duration*p.fps).toBeCloseTo(Math.round(next.duration*p.fps));expect(next.speed).toBeGreaterThanOrEqual(.25);expect(next.speed).toBeLessThanOrEqual(4);expect(next.duration*next.speed).toBeCloseTo(5);}
  });
  it('rejects locked, still and invalid gestures without an edit',()=>{
    const p=emptyProject(),c=makeClip(p.tracks[1].id,0,asset);p.tracks[1].locked=true;expect(rateStretchClip(c,'right',4,p)).toBe(c);p.tracks[1].locked=false;expect(rateStretchClip(c,'right',NaN,p)).toBe(c);for(const kind of ['title','image'] as const){const still={...c,kind};expect(rateStretchClip(still,'right',3,p)).toBe(still);}
  });
});

it('rounds floating point boundary rates into the persistable range',()=>{const p=emptyProject();const c={...makeClip(p.tracks[0].id,0,asset),duration:.4,speed:3};for(const delta of [-.1,100]){const n=rateStretchClip(c,'right',delta,p);expect(n.speed).toBeGreaterThanOrEqual(.25);expect(n.speed).toBeLessThanOrEqual(4);expect(n.duration*n.speed).toBeCloseTo(c.duration*c.speed,12);}});

it('keeps fully occupied fades within strict serialization bounds',()=>{const p=emptyProject();for(const fade of ['fadeIn','fadeOut'] as const){const c={...makeClip(p.tracks[0].id,0,asset),duration:5/30,[fade]:5/30},n=rateStretchClip(c,'right',6/30,p);expect(n.duration).toBe(11/30);expect(n[fade]).toBeLessThanOrEqual(n.duration);expect(n.fadeIn+n.fadeOut).toBeLessThanOrEqual(n.duration);expect(n[fade]).toBeCloseTo(n.duration,12);}});
