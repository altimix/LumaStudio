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
it.each(['video','image','audio'] as const)('places and edits %s on either track group, with locked destinations protected',kind=>{
  for(const targetKind of ['video','audio']){
    const p=emptyProject(),asset={...source,kind,hasAudio:kind==='audio'},s=useEditor.getState();p.assets=[asset];s.load(p);
    const target=p.tracks.find(t=>t.kind===targetKind)!;s.addAsset(asset.id,0,target.id);
    let next=useEditor.getState().project;expect(next.clips).toHaveLength(1);expect(next.clips[0]).toMatchObject({kind,trackId:target.id});
    const other=p.tracks.find(t=>t.kind!==targetKind)!;s.updateTrack(other.id,{locked:true});const locked=useEditor.getState().project;
    s.updateClip(next.clips[0].id,{trackId:other.id});expect(useEditor.getState().project).toBe(locked);
    s.updateTrack(other.id,{locked:false});s.updateClip(next.clips[0].id,{trackId:other.id});next=useEditor.getState().project;
    expect(next.clips[0].trackId).toBe(other.id);s.select([next.clips[0].id]);s.copy();s.seek(3);s.paste();expect(useEditor.getState().project.clips).toHaveLength(2);
    s.undo();expect(useEditor.getState().project).toBe(next);
  }
});
it('keeps upper-row audio audible and makes mute/solo independent of row group',()=>{
  const p=emptyProject(),asset={...source,kind:'audio' as const,hasAudio:true};p.assets=[asset];p.clips=[makeClip(p.tracks[0].id,0,asset)];
  expect(audioSlices(p,0,1,1).length).toBeGreaterThan(0);
  p.tracks[0].muted=true;expect(audioSlices(p,0,1,1)).toHaveLength(0);p.tracks[0].muted=false;
  p.tracks[3].solo=true;expect(audioSlices(p,0,1,1)).toHaveLength(0);p.tracks[0].solo=true;expect(audioSlices(p,0,1,1).length).toBeGreaterThan(0);
});
