import { it,expect } from 'vitest';
import { emptyProject,makeClip,applySequenceSettings } from './model';
import type { Asset } from './types';
import { useEditor } from './store';
import { applyTransition,transitionPlan,crossfadeGain,audioEnvelopes,mediaWindow,visualSourceTime } from '../shared/transitions.mjs';
import { audioSlices } from './audio-plan';
import { timelineKey } from '../shared/youtube.mjs';
const asset:Asset={id:'source',name:'source',path:'source.mp4',url:'',thumbnail:'',kind:'video',duration:20,width:320,height:180,fps:30,hasAudio:true,waveform:[],size:1,codec:'h264'};
function fixture(){const p=emptyProject();p.assets=[asset];p.clips=[0,4,8].map((start,i)=>({...makeClip(p.tracks[1].id,start,asset),id:'c'+i,in:2,duration:4,speed:2}));p.clips.push({...p.clips[0],id:'other',trackId:p.tracks[0].id});return p;}
it('centers a frame-bounded effect without changing any clip or sequence duration',()=>{
  const p=fixture(),n=applyTransition(p,'c0','c1',{duration:.777,video:'dissolve',autoAudio:true},'t');
  expect(n.clips).toBe(p.clips);expect(transitionPlan(n)[0]).toMatchObject({mode:'fixed',audio:'constantPower',start:4-11/30,duration:23/30});
  expect(transitionPlan(applyTransition(p,'c0','c1',{duration:50,video:'pagePeel'},'t'))[0].duration).toBe(2);
});
it('chains preserve earlier overlaps and audio changes preserve the video effect',()=>{
  let p=applyTransition(fixture(),'c0','c1',{duration:1,video:'pageTurn'},'a');p=applyTransition(p,'c1','c2',{duration:1,video:'dissolve'},'b');expect(transitionPlan(p).map(t=>[t.start,t.end])).toEqual([[3.5,4.5],[7.5,8.5]]);
  p=applyTransition(p,'c0','c1',{duration:1,audio:'constantGain'},'a2');expect(p.transitions?.find(t=>t.id==='a2')?.video).toBe('pageTurn');
});
it('protects locks, gaps, unsupported clips and malformed persisted connections',()=>{
  let p=fixture();p.tracks[1].locked=true;expect(()=>applyTransition(p,'c0','c1',{duration:1,video:'dissolve'},'t')).toThrow(/ロック/);
  p=fixture();p.clips[1].start=5;expect(()=>applyTransition(p,'c0','c1',{duration:1,video:'dissolve'},'t')).toThrow(/隙間/);
  p=fixture();p.assets[0]={...asset,hasAudio:false};expect(()=>applyTransition(p,'c0','c1',{duration:1,audio:'constantGain'},'t')).toThrow();
  for(const value of [null,{},[{id:'bad',fromId:'c0',toId:'missing',video:'dissolve'}]])expect(()=>transitionPlan({...fixture(),transitions:value as never})).toThrow();
});
it('video-only changes preserve a chosen audio curve and explicit audio choices still replace it',()=>{
  let p=applyTransition(fixture(),'c0','c1',{duration:1,video:'dissolve',autoAudio:true},'t');
  p=applyTransition(p,'c0','c1',{duration:1,audio:'constantGain'},'t');
  for(const video of ['pageTurn','pagePeel','dissolve'] as const)for(const autoAudio of [true,false]){
    p=applyTransition(p,'c0','c1',{duration:1,video,autoAudio},'t');
    expect(transitionPlan(p)[0]).toMatchObject({video,audio:'constantGain',start:3.5,end:4.5});
    expect(crossfadeGain(audioEnvelopes(p).get('c0'),4)).toBe(.5);
  }
  p=applyTransition(p,'c0','c1',{duration:1,audio:'constantPower'},'t');
  expect(transitionPlan(p)[0].audio).toBe('constantPower');
});
it('applies and removes in one Undo step; edits prune disconnected effects and Undo restores them',()=>{
  const p=fixture(),s=useEditor.getState();s.load(p);s.select(['c1']);s.addTransition({duration:1,video:'dissolve'});expect(useEditor.getState().history.length).toBe(1);s.undo();expect(useEditor.getState().project).toBe(p);s.redo();expect(useEditor.getState().project.transitions).toHaveLength(1);
  s.updateClip('c1',{start:10});expect(useEditor.getState().project.transitions).toHaveLength(0);s.undo();const n=useEditor.getState().project;s.removeTransition(n.transitions![0].id);expect(useEditor.getState().project.clips).toBe(n.clips);s.undo();expect(useEditor.getState().project).toBe(n);
});
it('rejects originally nonadjacent overlapping endpoints without reordering clips or creating history',()=>{
  const p=fixture();p.clips=p.clips.slice(0,3).map((c,i)=>({...c,start:[0,6,8][i],duration:i===1?2:10,in:0,speed:1}));
  const before=structuredClone(p);
  for(const effect of [{video:'dissolve' as const},{audio:'constantGain' as const}])expect(()=>applyTransition(p,'c0','c2',{duration:5,...effect},'t')).toThrow(/隣り合う/);
  expect(p).toEqual(before);
  const s=useEditor.getState();s.load(p);s.select(['c0','c2']);s.addTransition({duration:5,video:'dissolve'});
  expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
});
it('a single selection is always incoming; a first clip requires an explicit pair and rejected edits preserve state',()=>{
  const p=fixture(),s=useEditor.getState();
  for(const effect of [{video:'dissolve' as const},{audio:'constantGain' as const}]){
    s.load(p);s.select(['c0']);s.seek(1);s.addTransition({duration:1,...effect});
    const rejected=useEditor.getState();
    expect(rejected.project).toBe(p);expect(rejected.history).toHaveLength(0);expect(rejected.dirty).toBe(false);
    expect(rejected.selected).toEqual(['c0']);expect(rejected.playhead).toBe(1);expect(rejected.toast).toMatch(/前のクリップがありません/);
    s.select(['c1']);s.addTransition({duration:1,...effect});
    expect(useEditor.getState().project.transitions?.[0]).toMatchObject({fromId:'c0',toId:'c1'});
    s.load(p);s.select(['c0','c1']);s.addTransition({duration:1,...effect});
    expect(useEditor.getState().project.transitions?.[0]).toMatchObject({fromId:'c0',toId:'c1'});
    s.load(p);s.select(['c0']);s.addTransition({duration:1,...effect},'c0','c1');
    expect(useEditor.getState().project.transitions?.[0]).toMatchObject({fromId:'c0',toId:'c1'});
  }
});
it('linear and equal-power curves have correct endpoints, midpoint and reverse envelopes',()=>{
  for(const curve of ['constantGain','constantPower'] as const){const p=applyTransition(fixture(),'c0','c1',{duration:1,audio:curve},'t'),env=audioEnvelopes(p);expect(crossfadeGain(env.get('c0'),3.5)).toBe(1);expect(crossfadeGain(env.get('c1'),3.5)).toBe(0);expect(crossfadeGain(env.get('c0'),4.5)).toBe(0);expect(crossfadeGain(env.get('c1'),4.5)).toBe(1);expect(crossfadeGain(env.get('c0'),4)).toBeCloseTo(curve==='constantGain'?.5:Math.SQRT1_2);
    const reverse=audioSlices(p,4.5,3.5,-2).filter(s=>s.clip.id!=='other');expect(reverse.every(s=>s.reverse&&s.envelopes?.some(e=>e.start===3.5&&e.end===4.5))).toBe(true);expect(reverse.find(s=>s.clip.id==='c1')?.timelineStart).toBe(4.5);
    expect(timelineKey(p)).not.toBe(timelineKey({...p,transitions:p.transitions!.map(t=>({...t,audio:curve==='constantGain'?'constantPower':'constantGain'}))}));
  }
});
it('uses unused handles and freezes only missing video frames without looping audio',()=>{
  const p=fixture();p.assets=[{...asset,duration:8}];p.clips=p.clips.slice(0,2).map(c=>({...c,in:0,speed:2}));
  const next=applyTransition(p,'c0','c1',{duration:1,video:'dissolve',autoAudio:true},'t'),plans=transitionPlan(next);
  expect(mediaWindow(next.clips[0],p.assets[0],plans,'video')).toMatchObject({start:0,end:4.5,sourceIn:0,sourceDuration:8,padAfter:.5});
  expect(mediaWindow(next.clips[1],p.assets[0],plans,'video')).toMatchObject({start:3.5,end:8,sourceIn:0,sourceDuration:8,padBefore:.5});
  expect(visualSourceTime(next.clips[0],p.assets[0],4.25)).toBeCloseTo(8-1/30);
  expect(visualSourceTime(next.clips[1],p.assets[0],3.75)).toBe(0);
  const env=audioEnvelopes(next);expect(env.get('c0')).toMatchObject([{start:3.5,end:4,direction:'out'}]);expect(env.get('c1')).toMatchObject([{start:4,end:4.5,direction:'in'}]);
  const slices=audioSlices(next,3.5,4.5,1);expect(slices.find(s=>s.clip.id==='c0')!.timelineEnd).toBe(4);expect(slices.find(s=>s.clip.id==='c1')!.timelineStart).toBe(4);
});
it('rejects malformed fixed duration metadata and preserves legacy overlap timing',()=>{
  const p=fixture(),fixed=applyTransition(p,'c0','c1',{duration:1,video:'dissolve'},'t');
  for(const patch of [{duration:NaN},{duration:0},{duration:.011},{mode:'unknown'},{duration:40}])expect(()=>transitionPlan({...fixed,transitions:fixed.transitions!.map(t=>({...t,...patch}))} as never)).toThrow();
  const legacy={...p,clips:p.clips.map(c=>c.id==='c1'?{...c,start:3}:c),transitions:[{id:'old',fromId:'c0',toId:'c1',video:'pageTurn' as const}]};
  expect(transitionPlan(legacy)[0]).toMatchObject({start:3,end:4,duration:1});const changed=applyTransition(legacy,'c0','c1',{duration:.5,video:'pagePeel'},'new');expect(changed.clips).toBe(legacy.clips);expect(transitionPlan(changed)[0].duration).toBe(1);
  expect(timelineKey({...fixed,transitions:fixed.transitions!.map(t=>({...t,audio:'constantGain'}))})).not.toBe(timelineKey({...fixed,transitions:fixed.transitions!.map(t=>({...t,audio:'constantGain',duration:.5}))}));
});
it('preserves fixed effects and common cuts when sequence FPS changes',()=>{
  for(const fps of [1,7,24,25,30,60,120]){
    const p=applyTransition(fixture(),'c0','c1',{duration:23/30,video:'dissolve',autoAudio:true},'t');
    const next=applySequenceSettings(p,{name:p.name,width:p.width,height:p.height,fps});
    expect(transitionPlan(next)).toHaveLength(1);expect(transitionPlan(next)[0].duration*fps).toBeCloseTo(Math.round(transitionPlan(next)[0].duration*fps));
  }
  const p=fixture();p.clips=p.clips.slice(0,3).map((c,i)=>({...c,start:(1+i*2)/30,duration:2/30,in:0,speed:1}));
  let sequence=applyTransition(p,'c0','c1',{duration:1/30,video:'dissolve'},'a');sequence=applyTransition(sequence,'c1','c2',{duration:1/30,video:'pagePeel'},'b');
  const next=applySequenceSettings(sequence,{name:p.name,width:p.width,height:p.height,fps:24});expect(transitionPlan(next)).toHaveLength(2);
  expect(next.clips[0].start+next.clips[0].duration).toBeCloseTo(next.clips[1].start);expect(next.clips[1].start+next.clips[1].duration).toBeCloseTo(next.clips[2].start);
  const s=useEditor.getState();s.load(sequence);s.commit(next);s.undo();expect(useEditor.getState().project).toBe(sequence);s.redo();expect(useEditor.getState().project.transitions).toHaveLength(2);
});
it('continuous source splits stay untouched while discontinuous cuts have 3 ms edge ramps',()=>{
 const p=fixture();p.clips=p.clips.slice(0,2);p.clips[1]={...p.clips[1],in:10};
 expect(audioEnvelopes(p).size).toBe(0);
 p.clips[1]={...p.clips[1],in:11};
 const envelopes=audioEnvelopes(p);
 expect(crossfadeGain(envelopes.get('c0'),4-.003)).toBe(1);
 expect(crossfadeGain(envelopes.get('c0'),4)).toBe(0);
 expect(crossfadeGain(envelopes.get('c1'),4)).toBe(0);
 expect(crossfadeGain(envelopes.get('c1'),4+.003)).toBe(1);
 expect(crossfadeGain(envelopes.get('c1'),4+.0015)).toBeCloseTo(.5);
 p.clips[1]={...p.clips[1],start:5};expect(audioEnvelopes(p).size).toBe(0);
});
