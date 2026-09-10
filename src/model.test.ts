import { describe, it, expect, beforeEach } from 'vitest';
import { applySequenceSettings, emptyProject, makeClip, normalizeClip, splitClip, trimClip, timecode, snapTime } from './model';
import { useEditor } from './store';
import type { Asset } from './types';
import { MAX_TIMELINE_PIXELS, rulerStep, timelineLength } from '../shared/time.mjs';
const asset: Asset = { id:'video',name:'Video',path:'test.mp4',url:'',thumbnail:'',kind:'video',duration:20,width:1920,height:1080,fps:30,hasAudio:true,waveform:[],size:1,codec:'h264' };
function fixture() { const p=emptyProject();p.assets=[asset];p.clips=[{ ...makeClip(p.tracks[1].id,2,asset),in:4,duration:6,speed:2 }];return p; }

describe('history retains the clip being adjusted', () => {
  it('keeps surviving selected clips through undo/redo and discards nonexistent selections', () => {
    const p=fixture(), id=p.clips[0].id;useEditor.getState().load(p);useEditor.getState().select([id]);
    useEditor.getState().updateClip(id,{volume:0.5});useEditor.getState().undo();expect(useEditor.getState().selected).toEqual([id]);expect(useEditor.getState().project.clips[0].volume).toBe(1);
    useEditor.getState().redo();expect(useEditor.getState().selected).toEqual([id]);expect(useEditor.getState().project.clips[0].volume).toBe(0.5);
    useEditor.getState().addTitle('minimal');const title=useEditor.getState().selected[0];useEditor.getState().select([id,title]);useEditor.getState().undo();expect(useEditor.getState().selected).toEqual([id]);
  });
});

describe('full-length source media', () => {
  it.each([75.43, 13 * 3600, 9 * 86400])('adds all usable frames of a %s second source', duration => {
    const p = emptyProject(), long = { ...asset, duration }; p.assets = [long];
    useEditor.getState().load(p); useEditor.getState().addAsset(long.id);
    const s = useEditor.getState(), c = s.project.clips[0];
    expect(c.duration).toBeCloseTo(Math.floor(duration * p.fps) / p.fps, 6);
    expect(c.in).toBe(0); expect(c.duration).toBeGreaterThan(60);
    expect(timelineLength(c.duration) * s.zoom).toBeLessThanOrEqual(MAX_TIMELINE_PIXELS + 1);
    expect(rulerStep(s.zoom) * s.zoom).toBeGreaterThanOrEqual(80);
    s.updateClip(c.id, { speed: 2 }); expect(useEditor.getState().project.clips[0].duration * 2).toBeCloseTo(c.duration, 1);
    s.undo(); expect(useEditor.getState().project.clips[0].duration).toBe(c.duration);
  });
});

describe('media removal preserves a valid editable project', () => {
  beforeEach(() => useEditor.getState().load(fixture()));
  it('requires confirmation for used media and removes it together with references in one history step', () => {
    const s = useEditor.getState(), before = s.project; s.copy();
    useEditor.setState({ sourceId: asset.id }); s.removeAsset(asset.id);
    expect(useEditor.getState().project).toBe(before); expect(useEditor.getState().history).toHaveLength(0);
    s.removeAsset(asset.id, true);
    expect(useEditor.getState().project.assets).toHaveLength(0); expect(useEditor.getState().project.clips).toHaveLength(0);
    expect(useEditor.getState().clipboard).toHaveLength(0); expect(useEditor.getState().sourceId).toBeNull();
    expect(useEditor.getState().history).toHaveLength(1); s.undo(); expect(useEditor.getState().project).toBe(before);
    s.redo(); expect(useEditor.getState().project.assets).toHaveLength(0);
  });
  it('protects a locked reference even when removal was confirmed', () => {
    const p = fixture(); p.tracks[1].locked = true; useEditor.getState().load(p);
    useEditor.getState().removeAsset(asset.id, true); expect(useEditor.getState().project).toBe(p);
    expect(useEditor.getState().history).toHaveLength(0); expect(useEditor.getState().toast).toContain('ロック');
  });
  it('removes an unused thumbnail reference without affecting unrelated clips or disk metadata', () => {
    const p = fixture(), image = { ...asset, id: 'thumbnail', kind: 'image' as const, hasAudio: false };
    p.assets.push(image); p.youtube = { sourceKey: '', cues: [], titles: [], description: '', chapters: [], keywords: [], thumbnailPrompt: '', thumbnailAssetId: image.id };
    useEditor.getState().load(p); useEditor.getState().removeAsset(image.id);
    expect(useEditor.getState().project.clips).toEqual(p.clips); expect(useEditor.getState().project.assets).toEqual([asset]);
    expect(useEditor.getState().project.youtube?.thumbnailAssetId).toBeUndefined();
    useEditor.getState().undo(); expect(useEditor.getState().project).toBe(p);
  });
});
describe('frame-accurate editing',()=>{
  it('keeps the source in point when splitting a speed-adjusted clip',()=>{ const p=fixture();const pair=splitClip(p.clips[0],4,30)!;expect(pair.map(c=>c.duration)).toEqual([2,4]);expect(pair[1].in).toBe(8);expect(pair[1].start).toBe(4);expect(pair[0].id).not.toBe(pair[1].id); });
  it('rejects zero-length splits and aligns timecodes at a frame boundary',()=>{const p=fixture();expect(splitClip(p.clips[0],2,30)).toBeNull();expect(splitClip(p.clips[0],8,30)).toBeNull();expect(timecode(59.999,30)).toBe('00:01:00:00');});
  it('left trimming preserves the original end and cannot read negative source time',()=>{const p=fixture();const c=trimClip(p.clips[0],'left',-5,p);expect(c.start).toBe(0);expect(c.in).toBe(0);expect(c.start+c.duration).toBe(8);});
  it('right trimming cannot exceed the source at 2x speed',()=>{const p=fixture();const c=trimClip(p.clips[0],'right',100,p);expect(c.duration).toBe(8);expect(c.in+c.duration*c.speed).toBe(asset.duration);});
  it('clamps overlapping fades after trimming',()=>{const p=fixture();const c=normalizeClip({...p.clips[0],duration:1,fadeIn:3,fadeOut:3},p);expect(c.fadeIn+c.fadeOut).toBe(1);});
  it('snaps to other clips while excluding the moved selection',()=>{const p=fixture();expect(snapTime(8.08,p,[],0.1,0)).toBe(8);expect(snapTime(8.08,p,[p.clips[0].id],0.1,0)).toBeCloseTo(8.066667,5);});
});
describe('non-destructive timeline history',()=>{
 beforeEach(()=>useEditor.getState().load(fixture()));
 it('undoes and redoes a selected split without changing assets',()=>{const s=useEditor.getState();s.split(4);expect(useEditor.getState().project.clips).toHaveLength(2);s.undo();expect(useEditor.getState().project.clips).toHaveLength(1);s.redo();expect(useEditor.getState().project.clips[1].in).toBe(8);expect(useEditor.getState().project.assets[0]).toEqual(asset);});
 it('does not split any track or create history when nothing is selected',()=>{
  const s=useEditor.getState();const before=s.project;s.select([]);s.split(4);s.split(4,[]);
  expect(useEditor.getState().project).toBe(before);expect(useEditor.getState().history).toHaveLength(0);expect(useEditor.getState().dirty).toBe(false);
 });
 it('adjusts duration when speed changes and can undo it',()=>{const s=useEditor.getState();s.updateClip(s.project.clips[0].id,{speed:1});expect(useEditor.getState().project.clips[0].duration).toBe(12);s.undo();expect(useEditor.getState().project.clips[0].duration).toBe(6);});
 it('protects locked tracks from deletion, trimming and splitting',()=>{let s=useEditor.getState();s.updateTrack(s.project.tracks[1].id,{locked:true});s=useEditor.getState();s.select([s.project.clips[0].id]);s.remove();s.split(4);s.updateClip(s.project.clips[0].id,{duration:1});expect(useEditor.getState().project.clips[0].duration).toBe(6);});
 it('ripple deletion closes the union of overlaps exactly once',()=>{const p=fixture();const base=p.clips[0];p.clips=[{...base,start:0,duration:3},{...base,id:'second',start:2,duration:3},{...base,id:'third',start:8,duration:2}];useEditor.getState().load(p);useEditor.getState().select([base.id,'second']);useEditor.getState().remove(true);expect(useEditor.getState().project.clips[0].start).toBe(3);});
 it('paste preserves the relative placement of a multi-clip selection',()=>{const p=fixture();p.clips.push({...p.clips[0],id:'second',start:10});useEditor.getState().load(p);const s=useEditor.getState();s.select(p.clips.map(c=>c.id));s.copy();s.seek(20);s.paste();expect(useEditor.getState().project.clips.slice(2).map(c=>c.start)).toEqual([20,28]);});
});

describe('sequence settings preserve protected edits',()=>{
 it('rejects an FPS change when any clip is on a locked track',()=>{
  const p=fixture();p.clips[0].start=1/30;p.tracks[1].locked=true;
  const before=structuredClone(p);
  expect(()=>applySequenceSettings(p,{name:p.name,width:p.width,height:p.height,fps:24})).toThrow(/ロックを解除/);
  expect(p).toEqual(before);
 });
 it('keeps every clip unchanged when changing only the project name or frame size',()=>{
  const p=fixture();p.clips[0].start=1/30;p.tracks[1].locked=true;
  const next=applySequenceSettings(p,{name:' renamed ',width:1280,height:720,fps:p.fps});
  expect(next.clips).toBe(p.clips);expect(next.name).toBe('renamed');expect(next.width).toBe(1280);
 });
 it('aligns unlocked clips to new frame boundaries when the FPS changes',()=>{
  const p=fixture();p.clips[0].start=1/30;
  const next=applySequenceSettings(p,{name:p.name,width:p.width,height:p.height,fps:24});
  expect(next.clips[0].start).toBe(1/24);expect(p.clips[0].start).toBe(1/30);
 });
});

describe('project capacity protects saving',()=>{
 it('rejects every clip-creation command above 2000 without changing history or selection',()=>{
  const p=fixture();p.clips=Array.from({length:2000},(_,i)=>({...p.clips[0],id:`clip-${i}`}));
  const s=useEditor.getState();s.load(p);s.select(['clip-0']);s.copy();
  for(const action of [()=>s.paste(),()=>s.duplicate(),()=>s.addTitle(),()=>s.addAsset(asset.id),()=>s.split(4)]) {
   action();expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
   expect(useEditor.getState().dirty).toBe(false);expect(useEditor.getState().selected).toEqual(['clip-0']);
   expect(useEditor.getState().toast).toContain('最大2000');
  }
 });
 it('allows a paste up to the exact limit and can undo it',()=>{
  const p=fixture();p.clips=Array.from({length:1999},(_,i)=>({...p.clips[0],id:`clip-${i}`}));
  const s=useEditor.getState();s.load(p);s.select(['clip-0']);s.copy();s.paste();
  expect(useEditor.getState().project.clips).toHaveLength(2000);s.undo();expect(useEditor.getState().project.clips).toHaveLength(1999);
 });
 it('refuses an import above the asset limit without committing a partial batch',()=>{
  const p=fixture();p.assets=Array.from({length:2000},(_,i)=>({...asset,id:`asset-${i}`}));
  const s=useEditor.getState();s.load(p);s.importAssets([{...asset,id:'new'}]);
  expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
 });
});

describe('project switching',()=>{
 it('clears copied clips whose tracks and assets belong to the previous project',()=>{
  const s=useEditor.getState();s.load(fixture());s.copy();expect(useEditor.getState().clipboard).toHaveLength(1);
  const next=emptyProject();s.load(next);s.paste();expect(useEditor.getState().project).toBe(next);expect(useEditor.getState().history).toHaveLength(0);
 });
});

describe('long media removal restores usable zoom', () => {
  it('rebounds after clamping the head from a month-long asset to a short remaining title', () => {
    const p=fixture(); p.assets[0]={...asset,duration:30*86400};p.clips=[{...makeClip(p.tracks[1].id,0,p.assets[0]),id:'long'}, {...makeClip(p.tracks[0].id,0),id:'short',duration:5}];
    const s=useEditor.getState();s.load(p);s.seek(30*86400);s.setZoom(0.01);expect(useEditor.getState().zoom).toBeLessThan(1);
    s.removeAsset(asset.id,true);expect(useEditor.getState().playhead).toBe(5);expect(useEditor.getState().zoom).toBeGreaterThanOrEqual(8);
    s.undo();expect(useEditor.getState().project.clips).toHaveLength(2);s.redo();expect(useEditor.getState().zoom).toBeGreaterThanOrEqual(8);
  });
});

it('rebinds zoom when playback returns from a distant empty seek to the sequence', () => {
 const s=useEditor.getState();s.load(fixture());
 for(const action of [()=>s.togglePlay(),()=>s.shuttle(1),()=>s.shuttle(-1),()=>s.addAsset(asset.id,0)]){
  s.stop();s.seek(60*86400);s.setZoom(.01);expect(useEditor.getState().zoom).toBeLessThan(1);action();expect(useEditor.getState().zoom).toBeGreaterThanOrEqual(8);
 }
});
