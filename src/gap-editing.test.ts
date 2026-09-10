import { describe, expect, it } from 'vitest';
import { emptyProject, endTime, makeClip } from './model';
import { findTimelineGap, deleteTimelineGap } from './gap-editing';
import { useEditor } from './store';
import { separateAudio } from './linked-editing';
import { validateClipLinks } from '../shared/clip-links.mjs';
import { applyTransition, validateTransitions } from '../shared/transitions.mjs';
import { volumeAt } from '../shared/volume-automation.mjs';
import { opacityAt } from '../shared/opacity.mjs';
import type { Asset } from './types';

const asset: Asset = { id:'source',name:'素材.mp4',path:'C:/素材.mp4',url:'media://source',thumbnail:'',kind:'video',hasAudio:true,duration:60,width:320,height:180,fps:30,waveform:[],codec:'h264',size:100 };
const state = () => useEditor.getState();
function fixture() {
  const p = emptyProject(); p.assets = [asset];
  p.clips = [
    {...makeClip(p.tracks[1].id,0,asset),id:'before',duration:2},
    {...makeClip(p.tracks[1].id,4,asset),id:'after',in:4,duration:2},
    {...makeClip(p.tracks[1].id,6,asset),id:'last',in:6,duration:2},
    {...makeClip(p.tracks[2].id,0,asset),id:'bgm',kind:'audio',in:3,duration:8,speed:2,volumeKeyframes:[{time:0,value:.2},{time:2,value:.6},{time:4,value:1.2},{time:8,value:.4}]},
    {...makeClip(p.tracks[0].id,1),id:'caption',duration:5,opacityKeyframes:[{time:0,value:0},{time:5,value:1}]},
  ];
  p.markers = [1,3,5,9].map(time=>({id:String(time),time,label:String(time)}));
  return p;
}
describe('gap detection', () => {
  it('finds leading and interior gaps using the union of overlapping clips on the clicked track', () => {
    const p=fixture(),track=p.tracks[1].id;
    expect(findTimelineGap(p,track,3)).toEqual({from:2,to:4});
    p.clips[0].start=1;p.clips[0].duration=1;
    expect(findTimelineGap(p,track,0)).toEqual({from:0,to:1});
    p.clips.push({...p.clips[0],id:'overlap',start:1.5,duration:1});
    expect(findTimelineGap(p,track,2.25)).toBeNull();expect(findTimelineGap(p,track,3)).toEqual({from:2.5,to:4});
  });
  it('rejects occupied, trailing, empty, nonexistent and invalid positions', () => {
    const p=fixture(),track=p.tracks[1].id;
    for(const time of [0,1.99,4,8,99,-1,NaN,Infinity])expect(findTimelineGap(p,track,time)).toBeNull();
    expect(findTimelineGap(p,p.tracks[3].id,3)).toBeNull();expect(findTimelineGap(p,'missing',3)).toBeNull();
    expect(deleteTimelineGap(p,track,8)).toBeNull();
  });
  it.each([24,30,60])('accepts exactly one empty frame at %i fps and treats ends as exclusive', fps => {
    const p=fixture();p.fps=fps;p.clips[1].start=2+1/fps;
    expect(findTimelineGap(p,p.tracks[1].id,2)).toEqual({from:2,to:2+1/fps});
    expect(findTimelineGap(p,p.tracks[1].id,2+1/fps)).toBeNull();
  });
});
describe('all-track gap ripple edit', () => {
  it('moves every later track and retains source time, volume and opacity at the splice', () => {
    const p=fixture(),snapshot=structuredClone(p);state().load(p);state().removeGap(p.tracks[1].id,3);
    const n=state().project;expect(endTime(n)).toBe(6);expect(n.clips.find(c=>c.id==='after')?.start).toBe(2);
    const music=n.clips.filter(c=>c.name===asset.name&&c.kind==='audio');
    expect(music.map(c=>[c.start,c.duration,c.in,c.speed])).toEqual([[0,2,3,2],[2,4,11,2]]);
    for(const c of music)for(const local of [0,c.duration/2,c.duration])expect(volumeAt(c.volumeKeyframes,local)).toBeCloseTo(volumeAt(p.clips[3].volumeKeyframes,(c.in-3)/2+local));
    const captions=n.clips.filter(c=>c.kind==='title');expect(captions.map(c=>[c.start,c.duration])).toEqual([[1,1],[2,2]]);
    expect(opacityAt(captions[1].opacityKeyframes,0)).toBeCloseTo(.6);
    expect(n.markers.map(m=>m.time)).toEqual([1,2,3,7]);expect(n.assets).toBe(p.assets);expect(p).toEqual(snapshot);
  });
  it('cuts clips ending or starting within the removed interval and drops fully enclosed clips', () => {
    const p=fixture(),base=p.clips[4];
    p.clips=p.clips.filter(c=>c.id!=='caption');p.clips.push({...base,id:'left',start:1,duration:2},{...base,id:'right',start:3,duration:2},{...base,id:'inside',start:2,duration:2});
    state().load(p);state().removeGap(p.tracks[1].id,3);const clips=state().project.clips;
    expect(clips.find(c=>c.id==='left')).toMatchObject({start:1,duration:1});expect(clips.find(c=>c.id==='right')).toMatchObject({start:2,duration:1});expect(clips.some(c=>c.id==='inside')).toBe(false);
  });
  it('maintains separated AV pairs and untouched later transitions', () => {
    let p=separateAudio(fixture(),['before','after','last']);p=applyTransition(p,'after','last',{duration:.5,video:'dissolve',audio:'constantPower'},'join');
    state().load(p);state().removeGap(p.tracks[1].id,3);const n=state().project;
    validateClipLinks(n);validateTransitions(n);expect(n.transitions).toEqual(p.transitions);
    expect(n.clips.filter(c=>c.linkId===p.clips.find(c=>c.id==='after')!.linkId).map(c=>[c.start,c.in,c.duration])).toEqual([[2,4,2],[2,4,2]]);
  });
  it('creates independent linked fragments and reattaches the original outgoing transition', () => {
    let p=fixture();p.clips=p.clips.filter(c=>c.id!=='caption');
    p.clips.push({...makeClip(p.tracks[0].id,0,asset),id:'spanning',duration:6},{...makeClip(p.tracks[0].id,6,asset),id:'neighbor',in:6,duration:2});
    p=separateAudio(p,['spanning','neighbor']);p=applyTransition(p,'spanning','neighbor',{duration:.5,video:'dissolve',audio:'constantGain'},'edge');
    state().load(p);state().removeGap(p.tracks[1].id,3);const n=state().project;
    validateClipLinks(n);validateTransitions(n);expect(n.transitions).toHaveLength(2);
    const fragments=n.clips.filter(c=>c.trackId===p.tracks[0].id&&c.name===asset.name);expect(new Set(fragments.map(c=>c.linkId)).size).toBe(3);
    expect(n.transitions?.find(t=>t.video)?.fromId).toBe(fragments.find(c=>c.start===2)?.id);
  });
  it.each([1,2])('protects an affected locked track %i without partial history', trackIndex => {
    const p=fixture();p.tracks[trackIndex].locked=true;state().load(p);const selected=state().selected;
    state().removeGap(p.tracks[1].id,3);expect(state().project).toBe(p);expect(state().history).toHaveLength(0);expect(state().selected).toBe(selected);expect(state().dirty).toBe(false);expect(state().toast).toContain('ロック');
  });
  it('allows an unrelated locked track entirely before the gap', () => {
    const p=fixture();p.clips[4].start=0;p.clips[4].duration=2;p.tracks[0].locked=true;
    state().load(p);state().removeGap(p.tracks[1].id,3);expect(endTime(state().project)).toBe(6);expect(state().project.clips.find(c=>c.id==='caption')).toBe(p.clips[4]);
  });
  it.each([[1,1],[3,2],[7,5]])('maps playhead %i to %i, restoring it exactly through one Undo/Redo', (before,after) => {
    const p=fixture();state().load(p);state().seek(before);state().shuttle(1);const revision=state().seekRevision;
    state().removeGap(p.tracks[1].id,3);const edited=state().project;
    expect(state().playhead).toBe(after);expect(state().seekRevision).toBe(revision+1);expect(state().playing).toBe(false);expect(state().selected).toEqual([]);expect(state().history).toHaveLength(1);
    state().undo();expect(state().project).toBe(p);expect(state().playhead).toBe(before);state().redo();expect(state().project).toBe(edited);expect(state().playhead).toBe(after);
  });
  it('closes a leading gap across all tracks', () => {
    const p=fixture();p.clips=p.clips.map(c=>({...c,start:c.start+2}));state().load(p);state().removeGap(p.tracks[1].id,1);
    expect(state().project.clips.map(c=>c.start)).toEqual(fixture().clips.map(c=>c.start));
  });
  it('rejects capacity overflow or an active gesture without changing the project', () => {
    const p=fixture();p.clips.push(...Array.from({length:1995},(_,i)=>({...p.clips[4],id:'extra-'+i})));
    state().load(p);state().removeGap(p.tracks[1].id,3);expect(state().project).toBe(p);expect(state().history).toHaveLength(0);expect(state().toast).toContain('最大2000');
    const small=fixture(),owner={};state().load(small);state().beginGesture(owner,()=>{});state().removeGap(small.tracks[1].id,3);expect(state().project).toBe(small);state().endGesture(owner);
  });
});
