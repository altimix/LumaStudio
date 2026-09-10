import { afterEach, expect, it, vi } from 'vitest';
import { emptyProject, makeClip, trimClip, rateStretchClip } from './model';
import { separateAudio, relinkAudio } from './linked-editing';
import { useEditor } from './store';
import type { Asset, Project } from './types';
import { linkedIds, audioTargets, validateClipLinks } from '../shared/clip-links.mjs';
import { audioSlices } from './audio-plan';
import { applyTransition, transitionPlan, audioEnvelopes } from '../shared/transitions.mjs';
import { timelineKey } from '../shared/youtube.mjs';
import { runAudioEnhancement, useAudioJob, cancelAudioJob } from './audio-enhancement-job';

const asset: Asset = {id:'source',name:'会話.mp4',path:'C:/会話.mp4',url:'media://source',thumbnail:'',kind:'video',hasAudio:true,duration:30,width:320,height:180,fps:30,waveform:[.2,.6],codec:'h264',size:100};
function fixture(): Project {const p=emptyProject();p.assets=[asset];p.clips=[{...makeClip(p.tracks[1].id,2,asset),id:'v',in:1,duration:8,fadeIn:.5,fadeOut:1}];return p;}
const state=()=>useEditor.getState();
function loadPair(){const p=separateAudio(fixture(),['v']);state().load(p);state().select(['v']);return p;}
afterEach(()=>{vi.unstubAllGlobals();useAudioJob.setState({busy:false,message:''});});

it('new AV placement creates one linked pair and Undo/Redo restores the complete edit',()=>{
  const p=fixture();p.clips=[];state().load(p);state().addAsset(asset.id,4,p.tracks[1].id);
  const next=state().project;expect(next.clips).toHaveLength(2);expect(next.clips.map(c=>c.kind)).toEqual(['video','audio']);
  expect(new Set(next.clips.map(c=>c.trackId)).size).toBe(2);expect(next.clips.every(c=>c.start===4&&c.duration===30)).toBe(true);validateClipLinks(next);
  expect(state().history).toHaveLength(1);state().undo();expect(state().project).toBe(p);state().redo();expect(state().project).toBe(next);
});
it('legacy loading stays unchanged; separation keeps source, fades, audio treatment and track mute',()=>{
  const p=fixture();p.clips[0].audioTreatment='speech';p.tracks[1].muted=true;state().load(p);expect(state().project).toBe(p);
  state().separateAudio(['v']);const n=state().project,a=audioTargets(n,['v'])[0];
  expect(a).toMatchObject({in:1,duration:8,start:2,fadeIn:.5,fadeOut:1,audioTreatment:'speech'});expect(n.tracks.find(t=>t.id===a.trackId)?.muted).toBe(true);expect(n.clips[0].audioTreatment).toBeUndefined();validateClipLinks(n);
});
it('forward and reverse preview contain exactly one source and stay silent after deleting unlinked audio',()=>{
  loadPair();for(const rate of [1,2,-1,-4]){const slices=audioSlices(state().project,rate<0?4:2,rate<0?2:4,rate);expect(slices).toHaveLength(1);expect(slices[0].clip.kind).toBe('audio');}
  const key=timelineKey(state().project);state().patchAudio({audioMuted:true});expect(audioSlices(state().project,2,4,1)).toEqual([]);expect(timelineKey(state().project)).not.toBe(key);state().undo();
  state().unlink();const a=state().project.clips.find(c=>c.kind==='audio')!;state().select([a.id]);state().remove();expect(state().project.clips[0].audioDetached).toBe(true);expect(audioSlices(state().project,2,4,1)).toEqual([]);
});
it('visual-only edits keep separated transcripts usable while audio or sequence-end changes invalidate them',()=>{
  const p=loadPair(),key=timelineKey(p);
  state().updateClip('v',{fadeIn:1.2,fadeOut:1.5});expect(timelineKey(state().project)).toBe(key);
  state().updateClip(p.clips.find(c=>c.kind==='audio')!.id,{fadeIn:1.2});expect(timelineKey(state().project)).not.toBe(key);
  state().load(p);state().unlink(['v']);expect(timelineKey(state().project)).toBe(key);
  state().updateClip('v',{start:1});expect(timelineKey(state().project)).toBe(key);
  state().updateClip('v',{start:12});expect(timelineKey(state().project)).not.toBe(key);
});
it('move, trim and rate edits follow the partner across multiple gesture samples and cancel atomically',()=>{
  const p=loadPair();state().updateClip('v',{start:5});expect(state().project.clips.every(c=>c.start===5)).toBe(true);state().undo();
  for(const amount of [.5,1,1.5]){const v=trimClip(p.clips[0],'left',amount,p);state().transient({...p,clips:p.clips.map(c=>c.id==='v'?v:c)},p);validateClipLinks(state().project);expect(state().project.clips.every(c=>c.start===2+amount&&c.in===1+amount)).toBe(true);}
  state().load(p);const v=rateStretchClip(p.clips[0],'right',-4,p);state().commit({...p,clips:p.clips.map(c=>c.id==='v'?v:c)});expect(state().project.clips.every(c=>c.duration===4&&c.speed===2)).toBe(true);state().undo();expect(state().project).toBe(p);
});
it('split creates independent pairs, and copy, paste and duplicate never link to originals',()=>{
  loadPair();state().split(5);let p=state().project;expect(p.clips).toHaveLength(4);expect(new Set(p.clips.map(c=>c.linkId)).size).toBe(2);validateClipLinks(p);
  state().select(['v']);state().updateClip('v',{start:0});expect(state().project.clips.filter(c=>c.in===4).every(c=>c.start===5)).toBe(true);
  state().copy();expect(state().clipboard).toHaveLength(2);state().seek(15);state().paste();p=state().project;validateClipLinks(p);expect(new Set(p.clips.map(c=>c.linkId)).size).toBe(3);
  state().duplicate();p=state().project;validateClipLinks(p);expect(new Set(p.clips.map(c=>c.linkId)).size).toBe(4);
});
it('unlink allows independent timing; relink requires an exact pair and keeps independent sound settings',()=>{
  loadPair();state().unlink();const audio=state().project.clips.find(c=>c.kind==='audio')!;state().updateClip(audio.id,{start:6,volume:.3});expect(state().project.clips[0].start).toBe(2);
  expect(()=>relinkAudio(state().project,['v',audio.id])).toThrow(/同じ素材/);state().updateClip(audio.id,{start:2});state().relink(['v',audio.id]);validateClipLinks(state().project);expect(state().project.clips[1].volume).toBe(.3);
});
it('partner locks reject timing/delete/paste/duplicate without adding history, while independent color edits work',()=>{
  const p=loadPair();p.tracks.find(t=>t.id===p.clips[1].trackId)!.locked=true;state().load(p);state().select(['v']);
  for(const action of [()=>state().updateClip('v',{start:4}),()=>state().remove(),()=>state().duplicate(),()=>state().unlink(),()=>state().setRate(2),()=>state().split(5)]){action();expect(state().project).toBe(p);expect(state().history).toHaveLength(0);}
  state().copy();state().paste();expect(state().project).toBe(p);state().updateClip('v',{exposure:.5});expect(state().project.clips[0].exposure).toBe(.5);
});
it('Z skips an entire locked pair while splitting unrelated unlocked clips',()=>{
  const p=loadPair();p.tracks.find(t=>t.id===p.clips[1].trackId)!.locked=true;p.clips.push({...makeClip(p.tracks[0].id,0),id:'title',duration:10});state().load(p);state().split(5,p.clips.map(c=>c.id));expect(state().project.clips).toHaveLength(4);expect(linkedIds(state().project,['v'])).toHaveLength(2);validateClipLinks(state().project);
});
it('separation capacity failures leave original project and history untouched',()=>{
  const p=fixture();p.tracks=Array.from({length:24},(_,i)=>({...p.tracks[1],id:i===0?p.clips[0].trackId:`t${i}`}));state().load(p);state().separateAudio(['v']);expect(state().project).toBe(p);expect(state().history).toHaveLength(0);
});
it.each(['previous','next'] as const)('ripple %s preserves links and Undo/Redo restores the editing playhead',direction=>{
  const p=loadPair();state().seek(5);state().rippleTrim(direction);const edited=state().project,post=state().playhead;validateClipLinks(edited);
  expect(post).toBe(direction==='previous'?2:5);state().seek(0);state().undo();expect(state().playhead).toBe(5);expect(state().project).toBe(p);expect(state().seekRevision).toBeGreaterThan(0);
  state().redo();expect(state().project).toBe(edited); // Undo records the actual location from which the user navigated back.
});
it('Q then Ctrl+Z and Ctrl+Shift+Z restore both playhead positions repeatedly including a trim to zero',()=>{
  const p=fixture();p.clips[0].start=0;state().load(p);state().seek(4);state().rippleTrim('previous');expect(state().playhead).toBe(0);
  for(let i=0;i<3;i++){state().undo();expect(state().playhead).toBe(4);state().redo();expect(state().playhead).toBe(0);}expect(state().historyPlayheads).toHaveLength(state().history.length);
});
it('separating either endpoint preserves existing video and audio crossfades even after unlink',()=>{
  let p=fixture();p.clips.push({...p.clips[0],id:'v2',start:10});p=applyTransition(p,'v','v2',{duration:1,video:'dissolve',autoAudio:true},'t');
  p=separateAudio(p,['v']);expect(transitionPlan(p)).toHaveLength(2);const a=audioTargets(p,['v'])[0];expect(audioEnvelopes(p).get(a.id)).toHaveLength(1);
  p=separateAudio(p,['v2']);validateClipLinks(p);state().load(p);state().unlink(['v']);expect(audioEnvelopes(state().project).get(a.id)).toHaveLength(1);
});
it('new transitions synchronize both lanes, preserve chosen audio curves and respect audio partner locks',()=>{
  let p=fixture();p.clips.push({...p.clips[0],id:'v2',start:10});p=separateAudio(p,['v','v2']);
  let next=applyTransition(p,'v','v2',{duration:1,video:'pageTurn',autoAudio:true},'t');validateClipLinks(next);expect(transitionPlan(next)).toHaveLength(2);
  next=applyTransition(next,'v','v2',{duration:1,audio:'constantGain'},'u');next=applyTransition(next,'v','v2',{duration:1,video:'dissolve'},'w');expect(next.transitions!.find(t=>t.audio)?.audio).toBe('constantGain');
  p.tracks.find(t=>t.id===p.clips[2].trackId)!.locked=true;expect(()=>applyTransition(p,'v','v2',{duration:1,video:'dissolve',autoAudio:true},'bad')).toThrow(/ロック/);
  expect(applyTransition(p,'v','v2',{duration:1,video:'dissolve'},'video-only').clips).toBe(p.clips);
});
it('multi-selection normalization analyzes unique audio targets and applies in one Undo',async()=>{
  const p=loadPair();state().duplicate();const before=state().project;const prepare=vi.fn().mockResolvedValue({outputLufs:-16,peak:-1});vi.stubGlobal('window',{luma:{prepareAudio:prepare,cancelAudioPrepare:vi.fn()}});
  const count=state().history.length;await runAudioEnhancement(before.clips.map(c=>c.id),'normalize');expect(prepare).toHaveBeenCalledTimes(1);expect(state().history).toHaveLength(count+1);expect(state().project.clips.filter(c=>c.audioTreatment)).toHaveLength(2);state().undo();expect(state().project).toBe(before);expect(p.clips[0].audioTreatment).toBeUndefined();
});
it.each(['edit','lock','load','cancel','failure'] as const)('async normalization never applies a partial or stale result after %s',async action=>{
  loadPair();let resolve!:(v:unknown)=>void,reject!:(e:Error)=>void;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});const cancel=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('window',{luma:{prepareAudio:()=>pending,cancelAudioPrepare:cancel}});
  const work=runAudioEnhancement(['v'],'speech');expect(useAudioJob.getState().busy).toBe(true);
  if(action==='edit')state().updateClip('v',{name:'changed'});if(action==='lock')state().updateTrack(state().project.clips[1].trackId,{locked:true});if(action==='load')state().load(fixture());if(action==='cancel')cancelAudioJob();
  if(action==='failure')reject(Error('解析失敗'));else resolve({outputLufs:-16,peak:-1});await work;expect(state().project.clips.some(c=>c.audioTreatment)).toBe(false);expect(useAudioJob.getState().busy).toBe(false);if(action!=='failure')expect(cancel).toHaveBeenCalledOnce();
});

it('a later normalization failure does not keep an earlier successful member applied',async()=>{
  loadPair();state().duplicate();const duplicated=state().project,other={...asset,id:'other',path:'C:/other.mp4'};
  const p={...duplicated,assets:[...duplicated.assets,other],clips:duplicated.clips.map(c=>state().selected.includes(c.id)||linkedIds(duplicated,state().selected).includes(c.id)?{...c,assetId:other.id}:c)};
  state().load(p);const count=state().history.length;
  vi.stubGlobal('window',{luma:{prepareAudio:vi.fn().mockResolvedValueOnce({outputLufs:-16,peak:-1}).mockRejectedValueOnce(Error('second source failed')),cancelAudioPrepare:vi.fn()}});
  await runAudioEnhancement(p.clips.map(c=>c.id),'speech');expect(state().project).toBe(p);expect(state().history).toHaveLength(count);
});
it('mixed legacy and linked selection unlinks all requested sources atomically',()=>{
  const p=loadPair();p.clips.push({...makeClip(p.tracks[1].id,12,asset),id:'legacy',duration:5});state().load(p);state().unlink(['v','legacy']);expect(state().project.clips).toHaveLength(4);expect(state().project.clips.every(c=>!c.linkId)).toBe(true);expect(audioTargets(state().project,state().project.clips.map(c=>c.id))).toHaveLength(2);state().undo();expect(state().project).toBe(p);
});
it('audio transition property changes at an existing overlap respect both endpoint locks',()=>{
  let p=fixture();p.clips.push({...p.clips[0],id:'v2',start:10});p=separateAudio(p,['v','v2']);p=applyTransition(p,'v','v2',{duration:1,video:'dissolve',autoAudio:true},'t');p.tracks.find(t=>t.id===p.clips[2].trackId)!.locked=true;
  expect(()=>applyTransition(p,'v','v2',{duration:1,audio:'constantGain'},'new')).toThrow(/ロック/);
});

it('extending a linked trim does not invent a fade, and all speed controls scale independent fades',()=>{
  const raw=fixture();raw.clips[0].fadeIn=0;raw.clips[0].fadeOut=0;const p=separateAudio(raw,['v']);state().load(p);
  for(const edge of ['left','right'] as const){const v=trimClip(p.clips[0],edge,edge==='left'?-1:1,p);state().transient({...p,clips:p.clips.map(c=>c.id==='v'?v:c)},p);expect(state().project.clips.every(c=>c.fadeIn===0&&c.fadeOut===0)).toBe(true);}
  const linked=loadPair();state().updateClip(linked.clips[1].id,{fadeIn:1,fadeOut:2});state().updateClip('v',{speed:2});expect(state().project.clips.map(c=>[c.fadeIn,c.fadeOut])).toEqual([[.25,.5],[.5,1]]);state().setRate(1,['v']);expect(state().project.clips.map(c=>[c.fadeIn,c.fadeOut])).toEqual([[.5,1],[1,2]]);
});

it('a valid explicitly attached video can separate without copying video-only metadata to audio',()=>{const p=fixture();p.clips[0].audioDetached=false;state().load(p);state().separateAudio(['v']);expect(state().project.clips).toHaveLength(2);expect(Object.hasOwn(state().project.clips[1],'audioDetached')).toBe(false);validateClipLinks(state().project);});
