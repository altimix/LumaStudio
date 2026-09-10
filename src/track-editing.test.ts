import { expect, it } from 'vitest';
import { emptyProject, makeClip } from './model';
import { useEditor } from './store';

it('removes an empty track with Undo/Redo and preserves the playhead',()=>{
  const p=emptyProject(),s=useEditor.getState();s.load(p);s.seek(12);
  expect(s.removeTrack(p.tracks[2].id)).toBe(true);
  expect(useEditor.getState().project.tracks).toHaveLength(3);
  expect(useEditor.getState().playhead).toBe(12);
  s.undo();expect(useEditor.getState().project).toEqual(p);
  s.redo();expect(useEditor.getState().project.tracks).toHaveLength(3);
});
it('removes only target placements and transitions, unlinks surviving partners and preserves assets',()=>{
  const p=emptyProject(),s=useEditor.getState();
  const video={...makeClip(p.tracks[1].id,2),id:'v',kind:'video' as const,assetId:'source',linkId:'pair',audioDetached:true};
  const audio={...video,id:'a',kind:'audio' as const,trackId:p.tracks[2].id,audioDetached:undefined};
  p.clips=[video,audio];s.load(p);s.select(['a','v']);useEditor.setState({activeVolumePoint:{clipId:'a',time:0}});
  expect(s.removeTrack(audio.trackId)).toBe(true);
  const after=useEditor.getState();expect(after.project.clips).toEqual([{...video,linkId:undefined}]);
  expect(after.project.assets).toEqual(p.assets);expect(after.selected).toEqual(['v']);expect(after.activeVolumePoint).toBeNull();
  s.undo();expect(useEditor.getState().project).toEqual(p);s.redo();expect(useEditor.getState().project).toEqual(after.project);
});
it('protects locked targets and linked partners without history',()=>{
  const p=emptyProject(),s=useEditor.getState();p.tracks[1].locked=true;
  const v={...makeClip(p.tracks[1].id,0),id:'v',kind:'video' as const,assetId:'source',linkId:'pair',audioDetached:true};
  p.clips=[v,{...v,id:'a',kind:'audio',trackId:p.tracks[2].id,audioDetached:undefined}];s.load(p);
  expect(s.removeTrack(p.tracks[1].id)).toBe(false);expect(s.removeTrack(p.tracks[2].id)).toBe(false);
  expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
});
it('protects the final track, missing IDs and active gestures',()=>{
  const p=emptyProject(),s=useEditor.getState();s.load(p);const owner={};s.beginGesture(owner,()=>{});
  expect(s.removeTrack(p.tracks[0].id)).toBe(false);s.endGesture(owner);
  s.load({...p,tracks:[p.tracks[0]]});expect(s.removeTrack(p.tracks[0].id)).toBe(false);
  expect(s.removeTrack('missing')).toBe(false);expect(useEditor.getState().history).toHaveLength(0);
});

it('prunes transitions on the deleted track while keeping other transitions and assets',()=>{
  const p=emptyProject(),s=useEditor.getState();
  p.assets=[{id:'source',name:'source',path:'source.mp4',url:'',thumbnail:'',kind:'video',duration:20,width:320,height:180,fps:30,hasAudio:true,waveform:[],size:1,codec:'h264'}];
  p.clips=[0,1].flatMap(lane=>[0,1].map(i=>({...makeClip(p.tracks[lane].id,i*4,p.assets[0]),id:`${lane}-${i}`,duration:4})));
  p.transitions=[0,1].map(lane=>({id:`t${lane}`,fromId:`${lane}-0`,toId:`${lane}-1`,mode:'fixed' as const,duration:1,video:'dissolve' as const}));
  s.load(p);expect(s.removeTrack(p.tracks[0].id)).toBe(true);
  expect(useEditor.getState().project.transitions).toEqual([p.transitions[1]]);
  expect(useEditor.getState().project.clips).toEqual(p.clips.slice(2));
  s.undo();expect(useEditor.getState().project).toEqual(p);
});

it('protects locked transition counterparts across audio tracks before removing any placement',()=>{
  const p=emptyProject(),s=useEditor.getState();
  p.assets=[{id:'source',name:'source',path:'source.wav',url:'',thumbnail:'',kind:'audio',duration:20,width:0,height:0,fps:0,hasAudio:true,waveform:[],size:1,codec:'pcm'}];
  p.clips=[0,1].map(i=>({...makeClip(p.tracks[i+2].id,i*4,p.assets[0]),id:`a${i}`,duration:4}));
  p.transitions=[{id:'cross',fromId:'a0',toId:'a1',mode:'fixed',duration:1,audio:'constantPower'}];
  p.tracks[3].locked=true;s.load(p);expect(s.removeTrack(p.tracks[2].id)).toBe(false);
  expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
  p.tracks[3].locked=false;s.load(p);expect(s.removeTrack(p.tracks[2].id)).toBe(true);
  expect(useEditor.getState().project.transitions).toEqual([]);expect(useEditor.getState().project.clips).toEqual([p.clips[1]]);
  s.undo();expect(useEditor.getState().project).toEqual(p);
});
