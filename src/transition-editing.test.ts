import { expect, it } from 'vitest';
import { emptyProject, makeClip } from './model';
import { separateAudio } from './linked-editing';
import { useEditor } from './store';
import { draggedTransitionDuration, resizeTransition, transitionResizeInfo } from './transition-editing';
import { applyTransition, transitionPlan } from '../shared/transitions.mjs';
import type { Asset } from './types';

const asset:Asset={id:'source',name:'source',path:'source.mp4',url:'',thumbnail:'',kind:'video',duration:20,width:320,height:180,fps:30,hasAudio:true,waveform:[],size:1,codec:'h264'};
function fixture() {
  const p=emptyProject();p.assets=[asset];
  p.clips=[0,4,8].map((start,i)=>({...makeClip(p.tracks[1].id,start,asset),id:'c'+i,in:1,duration:4}));
  return applyTransition(p,'c0','c1',{duration:1,video:'pagePeel',audio:'constantGain'},'effect');
}
it('resizes only effect metadata, retains identity and curves, and clamps on frame boundaries',()=>{
  const p=fixture(),next=resizeTransition(p,'effect',.777);
  expect(next.clips).toBe(p.clips);expect(next.assets).toBe(p.assets);expect(next.tracks).toBe(p.tracks);
  expect(next.transitions).toEqual([{...p.transitions![0],duration:23/30}]);
  expect(transitionPlan(next)[0]).toMatchObject({start:4-11/30,end:4+12/30});
  expect(resizeTransition(p,'effect',500).transitions![0].duration).toBe(2);
  expect(resizeTransition(p,'effect',.001).transitions![0].duration).toBe(1/30);
  expect(resizeTransition(p,'effect',1)).toBe(p);
  expect(transitionPlan(JSON.parse(JSON.stringify(next)))[0].duration).toBe(23/30);
});
it('resizes separated linked audio with the video and leaves other cuts untouched',()=>{
  let p=applyTransition(fixture(),'c1','c2',{duration:.5,video:'dissolve',autoAudio:true},'other');
  p=separateAudio(p,['c0','c1','c2'],true);
  const group=transitionResizeInfo(p,'effect');expect(group.ids).toHaveLength(2);
  const next=resizeTransition(p,group.ids.find(id=>id!=='effect')!,1.5);
  expect(next.clips).toBe(p.clips);
  for(const t of next.transitions!)expect(t.duration).toBe(group.ids.includes(t.id)?1.5:.5);
  expect(transitionPlan(next)).toHaveLength(4);
});
it('keeps unlinked audio independent and does not add an effect to a linked partner',()=>{
  const detached=separateAudio(fixture(),['c0','c1'],false);
  expect(transitionResizeInfo(detached,'effect').ids).toEqual(['effect']);
  expect(resizeTransition(detached,'effect',1.5).transitions!.find(t=>t.audio)!.duration).toBe(1);
  const linked=separateAudio(fixture(),['c0','c1'],true);
  linked.transitions=linked.transitions!.filter(t=>t.video);
  expect(resizeTransition(linked,'effect',1.5).transitions).toHaveLength(1);
});
it('protects locks on linked audio and retains legacy overlap placement',()=>{
  const p=separateAudio(fixture(),['c0','c1'],true);
  p.tracks=p.tracks.map(track=>p.clips.some(c=>c.kind==='audio'&&c.trackId===track.id)?{...track,locked:true}:track);
  expect(()=>resizeTransition(p,'effect',1.5)).toThrow(/ロック/);
  const legacy=fixture();legacy.clips=legacy.clips.map(c=>c.id==='c1'?{...c,start:3}:c);
  legacy.transitions=legacy.transitions!.map(({mode:_mode,duration:_duration,...t})=>t);
  const before=structuredClone(legacy);
  expect(()=>resizeTransition(legacy,'effect',.5)).toThrow(/重なり/);expect(legacy).toEqual(before);
});
it('rejects invalid values and missing targets without editing',()=>{
  const p=fixture(),before=structuredClone(p);
  for(const value of [NaN,Infinity,-1,0])expect(()=>resizeTransition(p,'effect',value)).toThrow(/長さ/);
  expect(()=>resizeTransition(p,'missing',1)).toThrow(/見つかりません/);
  expect(p).toEqual(before);
});
it('converts either edge movement to a centered duration at different zooms and FPS',()=>{
  for(const zoom of [24,96,600])for(const fps of [1,24,30,60]) {
    expect(draggedTransitionDuration(1,'end',zoom/4,zoom,fps,2)).toBe(Math.round(1.5*fps)/fps);
    expect(draggedTransitionDuration(1,'start',-zoom/4,zoom,fps,2)).toBe(Math.round(1.5*fps)/fps);
    expect(draggedTransitionDuration(1,'start',zoom,zoom,fps,2)).toBe(1/fps);
    expect(draggedTransitionDuration(1,'end',10*zoom,zoom,fps,2)).toBe(2);
  }
});
it('numeric changes are one undoable edit, no-op edits preserve clean state, and gestures are protected',()=>{
  const p=fixture(),s=useEditor.getState();s.load(p);s.select(['c1']);useEditor.setState({activeTransitionId:'effect'});
  expect(s.resizeTransition('effect',1)).toBe(true);expect(useEditor.getState().history).toHaveLength(0);expect(useEditor.getState().dirty).toBe(false);
  expect(s.resizeTransition('effect',1.5)).toBe(true);expect(useEditor.getState().history).toHaveLength(1);
  s.undo();expect(useEditor.getState().project).toBe(p);s.redo();expect(useEditor.getState().project.transitions![0].duration).toBe(1.5);
  const owner={},before=useEditor.getState().project;s.beginGesture(owner,()=>s.endGesture(owner));
  expect(s.resizeTransition('effect',2)).toBe(false);s.removeTransition('effect');expect(useEditor.getState().project).toBe(before);s.endGesture(owner);
  s.select(['c2']);expect(useEditor.getState().activeTransitionId).toBe(null);
});
it('selects the actual linked audio effect after applying an audio preset to video clips',()=>{
  const p=separateAudio(fixture(),['c0','c1'],true),s=useEditor.getState();s.load(p);
  s.addTransition({duration:1.5,audio:'constantPower'},'c0','c1');
  const state=useEditor.getState(),active=state.project.transitions!.find(t=>t.id===state.activeTransitionId);
  expect(active).toMatchObject({audio:'constantPower',duration:1.5});expect(active?.video).toBeUndefined();
  expect(active?.fromId).not.toBe('c0');
});
it('removes only the selected category of a combined effect with Undo/Redo and stable placement',()=>{
  const p=fixture(),s=useEditor.getState();
  for(const kind of ['video','audio'] as const){
    s.load(p);useEditor.setState({activeTransitionId:'effect'});
    s.removeTransition('effect',kind);
    const {[kind]:_removed,...remaining}=p.transitions![0];
    expect(useEditor.getState().project.transitions).toEqual([remaining]);expect(useEditor.getState().project.clips).toEqual(p.clips);
    expect(useEditor.getState().activeTransitionId).toBe(null);expect(useEditor.getState().history).toHaveLength(1);
    s.undo();expect(useEditor.getState().project.transitions).toEqual(p.transitions);s.redo();expect(useEditor.getState().project.transitions).toEqual([remaining]);
    s.removeTransition('effect',kind==='video'?'audio':'video');expect(useEditor.getState().project.transitions).toEqual([]);
  }
  s.load(p);s.removeTransition('effect');expect(useEditor.getState().project.transitions).toEqual([]);
});
