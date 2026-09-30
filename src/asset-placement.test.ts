import { expect, it } from 'vitest';
import { emptyProject, makeClip, makeTrack } from './model';
import { useEditor } from './store';
import { validateClipLinks } from '../shared/clip-links.mjs';
import type { Asset } from './types';
import { MAX_MEDIA_SECONDS } from '../shared/time.mjs';
const asset:Asset={id:'video',name:'映像',kind:'video',path:'video.mp4',url:'',thumbnail:'',duration:3,width:320,height:180,fps:30,hasAudio:false,waveform:[],size:1,codec:'h264'};
it.each(['video','image','audio'] as const)('always creates an outer %s lane at the exact playhead, even when all existing lanes are empty and locked',kind=>{
  const p=emptyProject(),s=useEditor.getState();p.assets=[{...asset,kind,hasAudio:kind==='audio'}];p.tracks.forEach(t=>{t.locked=true;});
  s.load(p);s.seek(7.017,true);s.addAsset(asset.id);const next=useEditor.getState().project,clip=next.clips[0];
  expect(next.tracks).toHaveLength(5);expect(clip.start).toBe(7.017);expect(useEditor.getState().playhead).toBe(7.017);
  expect(clip.trackId).toBe(kind==='audio'?next.tracks.at(-1)!.id:next.tracks[0].id);
  expect(next.tracks.filter(t=>p.tracks.some(old=>old.id===t.id))).toEqual(p.tracks);
  s.undo();expect(useEditor.getState().project).toBe(p);s.redo();expect(useEditor.getState().project).toBe(next);
});
it('puts media below every existing text lane, including mixed title/video lanes, with unchanged existing clips',()=>{
  const p=emptyProject(),s=useEditor.getState();p.assets=[asset];p.tracks[0]={...p.tracks[0],name:'上字幕',autoName:false};p.tracks[1]={...p.tracks[1],name:'混在字幕',autoName:false};
  p.clips=[makeClip(p.tracks[0].id,0),makeClip(p.tracks[1].id,30),makeClip(p.tracks[1].id,0,asset)];
  s.load(p);s.seek(20);s.addAsset(asset.id);const next=useEditor.getState().project;
  expect(next.tracks.slice(0,2)).toEqual(p.tracks.slice(0,2));expect(next.clips.at(-1)!.trackId).toBe(next.tracks[2].id);expect(next.clips.at(-1)!.start).toBe(20);
  expect(next.clips.slice(0,3)).toEqual(p.clips);expect(next.tracks.slice(3)).toEqual(p.tracks.slice(2));
});
it('keeps an existing graphic overlay from reserving a text lane',()=>{
  const p=emptyProject(),s=useEditor.getState();p.assets=[asset];p.clips=[{...makeClip(p.tracks[0].id,0),text:'',graphic:{shape:'rectangle',width:10,height:10,lineWidth:1,fill:false,fillColor:'#000000'}}];
  s.load(p);s.addAsset(asset.id);expect(useEditor.getState().project.clips.at(-1)!.trackId).toBe(useEditor.getState().project.tracks[0].id);
});
it('adds a mixed batch at one captured time with separate linked AV lanes, stable order and one Undo step',()=>{
  const p=emptyProject(),s=useEditor.getState();p.assets=[{...asset,hasAudio:true},{...asset,id:'image',kind:'image'},{...asset,id:'audio',kind:'audio',hasAudio:true}];
  p.tracks[2]={...p.tracks[2],name:'の音声',autoName:false};s.load(p);s.seek(9);expect(s.addAssets(['video','image','audio'],4.017)).toBe(true);
  const next=useEditor.getState().project;expect(next.clips).toHaveLength(4);expect(next.clips.every(c=>c.start===4.017)).toBe(true);validateClipLinks(next);
  expect(next.clips[0].trackId).toBe(next.tracks[0].id);expect(next.clips[2].trackId).toBe(next.tracks[1].id);expect(next.clips[1].trackId).toBe(next.tracks.at(-2)!.id);expect(next.clips[3].trackId).toBe(next.tracks.at(-1)!.id);
  expect(next.tracks.slice(2,-2)).toEqual(p.tracks);expect(useEditor.getState().history).toHaveLength(1);
  s.undo();expect(useEditor.getState().project).toBe(p);s.redo();expect(useEditor.getState().project).toBe(next);
});
it('rejects the whole mixed batch at track capacity, leaving clip/history/selection/playhead unchanged',()=>{
  const p=emptyProject(),s=useEditor.getState();p.assets=[asset,{...asset,id:'audio',kind:'audio',hasAudio:true}];while(p.tracks.length<23)p.tracks.push(makeTrack('video','既存'));
  s.load(p);s.seek(5);const before=useEditor.getState();expect(s.addAssets(['video','audio'])).toBe(false);const after=useEditor.getState();
  expect(after.project).toBe(before.project);expect(after.history).toEqual(before.history);expect(after.selected).toEqual(before.selected);expect(after.playhead).toBe(5);
});
it('rejects offline and unknown assets before creating any tracks',()=>{
  const p=emptyProject(),s=useEditor.getState();p.assets=[{...asset,offline:true}];s.load(p);s.addAsset(asset.id);expect(useEditor.getState().project).toBe(p);expect(s.addAssets(['missing'])).toBe(false);expect(useEditor.getState().history).toHaveLength(0);
});

it('puts a newly added drawing sound in a dedicated bottom audio lane and rejects its whole edit at capacity',()=>{
  const p=emptyProject(),s=useEditor.getState(),sound={...asset,id:'sound',kind:'audio' as const,hasAudio:true};
  const input={graphic:{shape:'rectangle' as const,width:10,height:10,lineWidth:1,fill:false,fillColor:'#000000'},x:0,y:0,rotation:0,color:'#ffffff',duration:2};
  s.load(p);s.seek(4);expect(s.addDrawing(input,sound)).toBe(true);const next=useEditor.getState().project;
  expect(next.clips[1]).toMatchObject({kind:'audio',trackId:next.tracks.at(-1)!.id,start:4});expect(next.tracks.slice(0,-1)).toEqual(p.tracks);
  s.undo();expect(useEditor.getState().project).toBe(p);s.redo();expect(useEditor.getState().project).toBe(next);
  const full=emptyProject();while(full.tracks.length<24)full.tracks.push(makeTrack('audio','空き'));
  s.load(full);expect(s.addDrawing(input,sound)).toBe(false);expect(useEditor.getState().project).toBe(full);expect(useEditor.getState().history).toHaveLength(0);
});

it('rejects a batch whose media ends beyond the sequence limit without creating tracks',()=>{
  const p=emptyProject(),s=useEditor.getState();p.assets=[asset];s.load(p);s.seek(MAX_MEDIA_SECONDS-1,true);
  expect(s.addAssets([asset.id])).toBe(false);expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
});
