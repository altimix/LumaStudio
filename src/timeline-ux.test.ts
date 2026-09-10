import { expect, it } from 'vitest';
import { emptyProject, makeClip, roundFrame } from './model';
import { snapMove } from './move-snapping';
import { effectiveKeys, sameEffectiveVolume, sameVolumeCurve, editEffectivePoint, editEffectiveSegment, setEffectiveVolume, removeVolumePoint } from './volume-editing';
import { volumeAt, validateVolumeKeys } from '../shared/volume-automation.mjs';
import { useEditor } from './store';

it('keeps the base gain through envelope edits within its existing headroom',()=>{
  const clip={...audio(),volume:.5,volumeKeyframes:[{time:0,value:1},{time:2,value:1},{time:6,value:1}]};
  for(const patch of [setEffectiveVolume(clip,2,.6,30),editEffectivePoint(clip,1,3,.6,30),editEffectiveSegment(clip,1,.1)]){
    expect(patch.volume).toBe(.5);validateVolumeKeys({...clip,...patch});
  }
});
it('clears the selected volume timestamp when undoing or redoing a point move',()=>{
  const p=emptyProject(),clip={...audio(),trackId:p.tracks[2].id,volumeKeyframes:[{time:0,value:1},{time:2,value:1},{time:6,value:1}]};p.clips=[clip];
  const s=useEditor.getState();s.load(p);s.updateClip(clip.id,editEffectivePoint(clip,1,3,.1,30));
  useEditor.setState({activeVolumePoint:{clipId:clip.id,time:3}});s.undo();expect(useEditor.getState().activeVolumePoint).toBeNull();
  useEditor.setState({activeVolumePoint:{clipId:clip.id,time:2}});s.redo();expect(useEditor.getState().activeVolumePoint).toBeNull();
});

it('snaps the trailing edge even when the unsnapped leading edge is not on a frame',()=>{
  const p=emptyProject();p.clips=[{...makeClip(p.tracks[0].id,2),id:'move',duration:3},{...makeClip(p.tracks[0].id,10),id:'next',duration:2}];
  expect(snapMove(p,['move'],4.97,.1,0)).toEqual({delta:5,point:10});
  expect(snapMove(p,['move'],3.017,.1,0)).toEqual({delta:3.017,point:null});
  expect(snapMove(p,['move'],5,.1,0)).toEqual({delta:5,point:10});
});
it('snaps every group edge, excludes the moving clips, and never moves before zero',()=>{
  const p=emptyProject();p.clips=[{...makeClip(p.tracks[0].id,2),id:'a',duration:2},{...makeClip(p.tracks[0].id,6),id:'b',duration:2},{...makeClip(p.tracks[0].id,12),id:'c',duration:2}];
  expect(snapMove(p,['a','b'],3.97,.1,0)).toEqual({delta:4,point:12});
  expect(snapMove(p,['a','b'],-8,.1,0).delta).toBe(-2);
});
const audio=()=>({...makeClip('audio',0),kind:'audio' as const,volume:.1,duration:6});
it('clears point selection after duration, speed and transient source retiming but retains gain edits',()=>{
  const p=emptyProject(),clip={...audio(),trackId:p.tracks[2].id,volumeKeyframes:[{time:0,value:1},{time:2,value:1},{time:6,value:1}]};p.clips=[clip];
  const s=useEditor.getState(),reset=()=>{s.load(p);useEditor.setState({activeVolumePoint:{clipId:clip.id,time:2}});};
  reset();s.updateClip(clip.id,{duration:1});expect(useEditor.getState().activeVolumePoint).toBeNull();
  reset();s.setRate(2,[clip.id]);expect(useEditor.getState().activeVolumePoint).toBeNull();
  reset();s.transient({...p,clips:[{...clip,in:1,duration:5}]},p);expect(useEditor.getState().activeVolumePoint).toBeNull();
  reset();s.updateClip(clip.id,setEffectiveVolume(clip,2,.15,30));expect(useEditor.getState().activeVolumePoint).toEqual({clipId:clip.id,time:2});
});
it('preserves constant gain when the last point is deleted instead of restoring 100 percent',()=>{
  for(const gain of [0,.1,.5,1,2]){
    const clip={...audio(),volume:1,volumeKeyframes:[{time:1,value:gain}]};
    expect(removeVolumePoint(clip,1)).toEqual({volume:gain,volumeKeyframes:[]});
  }
});
it('syncs the unkeyed line to base percent, including zero volume',()=>{
  const clip=audio();expect(effectiveKeys(clip).map(k=>k.value)).toEqual([.1,.1]);
  expect(editEffectiveSegment(clip,2,.15)).toEqual({volume:.25});
  expect(setEffectiveVolume({...clip,volume:0},2,.5,30)).toEqual({volume:.5});
});
it('editing a selected synthetic endpoint creates automation and preserves the opposite end',()=>{
  const clip=audio();for(const time of [0,clip.duration]){
    const next={...clip,...setEffectiveVolume(clip,time,.5,30,true)};validateVolumeKeys(next);
    expect(effectiveKeys(next).find(k=>k.time===time)?.value).toBe(.5);
    expect(effectiveKeys(next).find(k=>k.time!==time)?.value).toBeCloseTo(.1);
  }
  expect(setEffectiveVolume(clip,0,.5,30)).toEqual({volume:.5});
});
it('edits an absolute-gain point without changing the other points, including 400% and muted base',()=>{
  for(const base of [0,.1,1,2]){
    const clip={...audio(),volume:base,volumeKeyframes:[{time:0,value:.2},{time:2,value:1},{time:6,value:2}]};
    const next={...clip,...setEffectiveVolume(clip,2,4,30)};
    validateVolumeKeys(next);
    expect(next.volume*volumeAt(next.volumeKeyframes,0)).toBeCloseTo(base*.2);
    expect(next.volume*volumeAt(next.volumeKeyframes,2)).toBe(4);
    expect(next.volume*volumeAt(next.volumeKeyframes,6)).toBeCloseTo(base*2);
  }
});
it('moves a point by frames and gain percent without crossing neighbors',()=>{
  const clip={...audio(),volumeKeyframes:[{time:0,value:1},{time:2,value:1},{time:3,value:1},{time:6,value:1}]};
  const moved={...clip,...editEffectivePoint(clip,1,2+10/30,.11,30)};
  expect(effectiveKeys(moved)[1].time).toBe(70/30);expect(effectiveKeys(moved)[1].value).toBeCloseTo(.11,12);
  const limited={...clip,...editEffectivePoint(clip,1,5,.2,30)};validateVolumeKeys(limited);
  expect(effectiveKeys(limited)[1].time).toBeLessThan(3);
});

it('clears latent volume points when commands replace clip selection',()=>{
  const p=emptyProject(),clip={...audio(),trackId:p.tracks[2].id,volumeKeyframes:[{time:0,value:1},{time:2,value:.5},{time:6,value:1}]};p.clips=[clip];
  for(const command of ['duplicate','paste','addTitle'] as const){
    const s=useEditor.getState();s.load(p);s.select([clip.id]);s.copy();
    useEditor.setState({activeVolumePoint:{clipId:clip.id,time:2}});
    s[command]();expect(useEditor.getState().selected).not.toContain(clip.id);
    expect(useEditor.getState().activeVolumePoint).toBeNull();
    s.select([clip.id]);expect(useEditor.getState().activeVolumePoint).toBeNull();
    expect(useEditor.getState().project.clips.find(c=>c.id===clip.id)?.volumeKeyframes).toEqual(clip.volumeKeyframes);
  }
});

it('shows both missing boundary handles and deletes the intended stored point by displayed index',()=>{
  const clip={...audio(),volume:.5,volumeKeyframes:[{time:2,value:1},{time:4,value:.5}]};
  expect(effectiveKeys(clip)).toEqual([{time:0,value:.5},{time:2,value:.5},{time:4,value:.25},{time:6,value:.25}]);
  expect(removeVolumePoint(clip,0)).toEqual({});
  expect(removeVolumePoint(clip,1)).toEqual({volumeKeyframes:[{time:4,value:.5}]});
  const edited={...clip,...editEffectivePoint(clip,0,0,.4,30)};validateVolumeKeys(edited);
  expect(effectiveKeys(edited)[0].value).toBeCloseTo(.4);expect(effectiveKeys(edited).at(-1)?.value).toBe(.25);
  const removed={...edited,...removeVolumePoint(edited,0)};expect(effectiveKeys(removed)[0].time).toBe(0);
});

it('edits existing 64-point curves without storing virtual boundary handles',()=>{
  const clip={...audio(),volume:1,volumeKeyframes:Array.from({length:64},(_,i)=>({time:(i+1)/12,value:.5}))};
  expect(effectiveKeys(clip)).toHaveLength(66);
  for(const patch of [editEffectivePoint(clip,20,20/12,.6,30),editEffectiveSegment(clip,2,.1),setEffectiveVolume(clip,2,.6,30),setEffectiveVolume(clip,1/12,.6,30,true)]){
    expect(patch.volumeKeyframes).toHaveLength(64);validateVolumeKeys({...clip,...patch});
  }
  expect(()=>editEffectivePoint(clip,0,0,.6,30)).toThrow(/最大64/);
  expect(clip.volumeKeyframes[0].value).toBe(.5);
});

it('shows the actual frame-rounded landing edge for off-grid markers and clip bounds',()=>{
  for(const fps of [24,30,60])for(const start of [2,2.011])for(const duration of [3,3.013]){
    const p=emptyProject();p.fps=fps;p.clips=[{...makeClip(p.tracks[0].id,start),id:'moving',duration}];
    p.markers=[{id:'target',time:10.017,label:'target'}];
    const match=snapMove(p,['moving'],10.017-start-duration-.01,.1,0);
    expect(match.point).not.toBeNull();expect(match.delta).toBeCloseTo(roundFrame(match.delta,fps));
    expect(roundFrame(start+roundFrame(match.delta,fps),fps)+duration).toBeCloseTo(match.point!);
    expect(Math.abs(match.point!-roundFrame(10.017,fps))).toBeLessThanOrEqual(.5/fps+1e-6);
  }
});

it('recognizes clamped and synthetic volume edits without hiding real point movement',()=>{
  const clip={...audio(),volume:2};
  expect(sameEffectiveVolume(clip,{...clip,...editEffectiveSegment(clip,1,1)})).toBe(true);
  expect(sameEffectiveVolume(clip,{...clip,...editEffectivePoint(clip,0,-1,2,30)})).toBe(true);
  expect(sameEffectiveVolume(clip,{...clip,...editEffectivePoint(clip,0,.5,2,30)})).toBe(false);
  expect(sameEffectiveVolume(clip,{...clip,...editEffectiveSegment(clip,1,-.1)})).toBe(false);
});

it('updates the exact selected key at minimum neighbor separation',()=>{
  const clip={...audio(),volume:1,volumeKeyframes:[{time:1,value:.2},{time:1+1e-7,value:.8}]};
  const next={...clip,...setEffectiveVolume(clip,1+1e-7,.5,30,true)};
  expect(next.volumeKeyframes).toEqual([{time:1,value:.2},{time:1+1e-7,value:.5}]);
});

it('compares interpolated gain independently from redundant point count',()=>{
  const clip={...audio(),volume:1,volumeKeyframes:[{time:0,value:.5},{time:6,value:1.5}]};
  const same={...clip,...setEffectiveVolume(clip,3,1,30)};
  expect(same.volumeKeyframes).toHaveLength(3);
  expect(sameVolumeCurve(clip,same)).toBe(true);
  expect(sameEffectiveVolume(clip,same)).toBe(false);
  expect(sameVolumeCurve(clip,{...clip,...setEffectiveVolume(clip,3,.9,30)})).toBe(false);
});
