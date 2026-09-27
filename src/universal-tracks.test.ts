import { expect, it } from 'vitest';
import { emptyProject, makeClip } from './model';
import { numberTracks } from './track-names';
import { useEditor } from './store';
import { audioSlices } from './audio-plan';
import type { Asset } from './types';

const source: Asset = { id:'source',name:'映像',kind:'video',path:'video.mp4',url:'',thumbnail:'',duration:2,width:320,height:180,fps:30,hasAudio:false,waveform:[],codec:'h264',size:1 };
it('numbers outward from the center and renumbers automatic names without overwriting custom names',()=>{
  const p=emptyProject(),s=useEditor.getState();s.load(p);
  expect(p.tracks.map(t=>t.name)).toEqual(['Video2','Video1','Audio1','Audio2']);
  s.updateTrack(p.tracks[0].id,{name:'インタビュー'});s.addTrack('video');s.addTrack('audio');
  expect(useEditor.getState().project.tracks.map(t=>t.name)).toEqual(['Video3','インタビュー','Video1','Audio1','Audio2','Audio3']);
  const before=useEditor.getState().project;s.removeTrack(p.tracks[1].id);
  expect(useEditor.getState().project.tracks.map(t=>t.name)).toEqual(['Video2','インタビュー','Audio1','Audio2','Audio3']);
  s.undo();expect(useEditor.getState().project).toBe(before);s.redo();
  s.load(JSON.parse(JSON.stringify(useEditor.getState().project)));
  expect(useEditor.getState().project.tracks[1]).toMatchObject({name:'インタビュー',autoName:false});
});
it('migrates the recognizable legacy default layout, preserving custom project names and ids',()=>{
  const p=emptyProject();p.tracks.forEach((t,i)=>{delete t.autoName;t.name=['テロップ・オーバーレイ','メイン映像','ミュージック','ナレーション'][i];});
  const next=numberTracks(p);expect(next.tracks.map(t=>t.name)).toEqual(['Video2','Video1','Audio1','Audio2']);
  expect(next.tracks.map(t=>t.id)).toEqual(p.tracks.map(t=>t.id));expect(p.tracks[0].name).toBe('テロップ・オーバーレイ');
  p.tracks[0].name='利用者のタイトル';expect(numberTracks(p)).toBe(p);
});
it.each(['video','image','audio'] as const)('restricts new %s placements on Audio and protects locked destinations',kind=>{
  const p=emptyProject(),asset={...source,kind,hasAudio:kind==='audio'},s=useEditor.getState();p.assets=[asset];s.load(p);
  const video=p.tracks[0],audio=p.tracks[2];s.addAsset(asset.id,0,audio.id);
  if(kind!=='audio'){expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);}
  else {expect(useEditor.getState().project.clips[0]).toMatchObject({kind,trackId:audio.id});s.undo();}
  s.addAsset(asset.id,0,video.id);const clip=useEditor.getState().project.clips[0];
  s.updateTrack(audio.id,{locked:true});const locked=useEditor.getState().project;
  s.updateClip(clip.id,{trackId:audio.id});expect(useEditor.getState().project).toBe(locked);
  s.updateTrack(audio.id,{locked:false});const before=useEditor.getState().project;
  s.updateClip(clip.id,{trackId:audio.id});
  if(kind!=='audio')expect(useEditor.getState().project).toBe(before);
  else expect(useEditor.getState().project.clips[0].trackId).toBe(audio.id);
});
it('preserves legacy Audio visuals through load, split, trim, save and undo, while blocking new copies',()=>{
  const p=emptyProject(),s=useEditor.getState();p.assets=[source];p.clips=[makeClip(p.tracks[2].id,0,source)];s.load(p);
  const id=p.clips[0].id;s.select([id]);s.duplicate();expect(useEditor.getState().project).toBe(p);
  s.copy();s.seek(3);s.paste();expect(useEditor.getState().project).toBe(p);
  s.split(1,[id]);expect(useEditor.getState().project.clips).toHaveLength(2);
  s.undo();expect(useEditor.getState().project).toBe(p);s.redo();
  const split=useEditor.getState().project;s.updateClip(id,{duration:.5});
  const saved=JSON.parse(JSON.stringify(useEditor.getState().project));s.load(saved);
  expect(useEditor.getState().project.clips).toEqual(saved.clips);
  expect(split.clips.every(c=>c.trackId===p.tracks[2].id)).toBe(true);
  s.updateClip(id,{trackId:p.tracks[0].id});s.select([id]);s.duplicate();
  expect(useEditor.getState().project.clips.filter(c=>c.kind==='video'&&c.trackId===p.tracks[0].id)).toHaveLength(2);
});
it('never falls back to Audio for video, title or drawing when Video is unavailable',()=>{
  const p=emptyProject(),s=useEditor.getState();p.assets=[source];p.tracks=p.tracks.filter(t=>t.kind==='audio');s.load(p);
  s.addAsset(source.id);s.addTitle();s.addDrawing({graphic:{shape:'rectangle',width:10,height:10,lineWidth:1,fill:false,fillColor:'#000000'},x:0,y:0,rotation:0,color:'#ffffff',duration:1});
  expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
});
it('keeps detached video audio eligible for Audio with link synchronization',()=>{
  const p=emptyProject(),s=useEditor.getState();p.assets=[{...source,hasAudio:true}];s.load(p);s.addAsset(source.id,0,p.tracks[0].id);
  const placed=useEditor.getState().project,video=placed.clips.find(c=>c.kind==='video')!,audio=placed.clips.find(c=>c.kind==='audio')!;
  expect(placed.tracks.find(t=>t.id===audio.trackId)?.kind).toBe('audio');expect(video.linkId).toBe(audio.linkId);
  s.updateClip(audio.id,{trackId:p.tracks[3].id});s.split(1,[video.id]);
  expect(useEditor.getState().project.clips).toHaveLength(4);
});
it('keeps upper-row audio audible and makes mute/solo independent of row group',()=>{
  const p=emptyProject(),asset={...source,kind:'audio' as const,hasAudio:true};p.assets=[asset];p.clips=[makeClip(p.tracks[0].id,0,asset)];
  expect(audioSlices(p,0,1,1).length).toBeGreaterThan(0);
  p.tracks[0].muted=true;expect(audioSlices(p,0,1,1)).toHaveLength(0);p.tracks[0].muted=false;
  p.tracks[3].solo=true;expect(audioSlices(p,0,1,1)).toHaveLength(0);p.tracks[0].solo=true;expect(audioSlices(p,0,1,1).length).toBeGreaterThan(0);
});
