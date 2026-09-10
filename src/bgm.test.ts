import { it,expect } from 'vitest';
import { emptyProject,makeClip,endTime } from './model';
import { insertBgm } from './bgm';
import { useEditor } from './store';
import type { Asset } from './types';
const music:Asset={id:'music',name:'日本語の曲.mp3',path:'music.mp3',url:'media://local/music',thumbnail:'',kind:'audio',duration:7.04,width:0,height:0,fps:0,hasAudio:true,waveform:[],size:1,codec:'mp3'};
function sequence(){const p=emptyProject();p.clips=[{...makeClip(p.tracks[0].id,0),duration:20}];return p;}
it('fits repeated music to the visual end without moving existing clips, at frame boundaries',()=>{
  const p=sequence(),next=insertBgm(p,music,2,true,.2),added=next.project.clips.slice(1);
  expect(added).toHaveLength(3);expect(endTime(next.project)).toBe(20);expect(next.project.clips[0]).toBe(p.clips[0]);expect(added[0]).toMatchObject({start:2,volume:.2,fadeIn:.5,fadeOut:0});
  expect(added[1]).toMatchObject({fadeIn:0,fadeOut:0});expect(added[2].fadeOut).toBeGreaterThan(0);
  for(const [i,c]of added.entries()){expect(c.duration*30).toBeCloseTo(Math.round(c.duration*30));expect(c.duration).toBeLessThanOrEqual(music.duration);if(i)expect(c.start).toBeCloseTo(added[i-1].start+added[i-1].duration);}
});
it('trims long music or inserts the full song, and treats an audio-only/empty sequence as one song',()=>{
  const p=sequence(),long={...music,duration:4000};expect(insertBgm(p,long,2,true,.3).project.clips[1].duration).toBe(18);
  expect(insertBgm(p,long,2,false,.3).project.clips[1].duration).toBe(4000);
  const empty=emptyProject();expect(insertBgm(empty,music,0,true,.2).repeats).toBe(1);
  empty.assets=[music];empty.clips=[{...makeClip(empty.tracks[2].id,0,music),duration:200}];expect(insertBgm(empty,music,4,true,.2).repeats).toBe(1);
  expect(insertBgm(p,music,21,true,.2).repeats).toBe(1);
});
it('avoids overlaps, locked and muted tracks while preserving track flags',()=>{
  for(const flag of ['locked','muted','hidden'] as const){const p=sequence();p.tracks[2][flag]=true;const next=insertBgm(p,music,0,true,.2).project;expect(next.tracks).toHaveLength(5);expect(next.tracks[2]).toBe(p.tracks[2]);expect(next.clips[1].trackId).not.toBe(p.tracks[2].id);}
  const p=sequence();p.assets=[music];p.clips.push(makeClip(p.tracks[2].id,0,music));const next=insertBgm(p,music,1,true,.2).project;expect(next.clips[1]).toBe(p.clips[1]);expect(next.clips[2].trackId).not.toBe(p.tracks[2].id);
});
it('reuses a music track when the insertion only touches an existing endpoint',()=>{
  const p=sequence();p.assets=[music];p.clips.push({...makeClip(p.tracks[2].id,0,music),duration:4});const next=insertBgm(p,music,4,true,.2).project;expect(next.tracks).toBe(p.tracks);expect(next.assets).toBe(p.assets);expect(next.clips[2].trackId).toBe(p.tracks[2].id);
});
it('adds the asset, track and repeated clips as one Undo/Redo action',()=>{
  const p=sequence();p.tracks[2].locked=true;const s=useEditor.getState();s.load(p);s.seek(2);expect(s.addBgm(music,true,.2)).toBe(true);const after=useEditor.getState().project;expect(after.tracks).toHaveLength(5);expect(after.assets).toContain(music);expect(useEditor.getState().history).toHaveLength(1);s.undo();expect(useEditor.getState().project).toBe(p);s.redo();expect(useEditor.getState().project).toBe(after);expect(useEditor.getState().playhead).toBe(2);
});
it('restores an offline BGM asset for existing and new clips in the same Undo/Redo action',()=>{
  const p=sequence(),offline={...music,offline:true,url:''};p.assets=[offline];p.clips.push({...makeClip(p.tracks[2].id,0,music),duration:4});
  const s=useEditor.getState();s.load(p);s.seek(4);expect(s.addBgm(music,true,.2)).toBe(true);
  const after=useEditor.getState().project;expect(after.assets).toEqual([music]);expect(after.clips[1]).toBe(p.clips[1]);expect(after.clips.slice(1).every(c=>c.assetId===music.id)).toBe(true);
  expect(p.assets[0]).toBe(offline);expect(useEditor.getState().history).toHaveLength(1);s.undo();expect(useEditor.getState().project).toBe(p);s.redo();expect(useEditor.getState().project).toBe(after);
});
it('rejects offline, invalid, subframe music and excessive repetitions atomically',()=>{
  const p=sequence();for(const a of [{...music,offline:true},{...music,kind:'video' as const},{...music,duration:.001},{...music,duration:NaN}])expect(()=>insertBgm(p,a,0,true,.2)).toThrow();
  expect(()=>insertBgm(p,music,NaN,true,.2)).toThrow();expect(()=>insertBgm(p,music,0,true,2)).toThrow();
  const s=useEditor.getState();s.load(p);expect(s.addBgm({...music,duration:1/120},true,.2)).toBe(false);expect(useEditor.getState().project).toBe(p);
  const large=sequence();large.clips[0].duration=10000;expect(()=>insertBgm(large,{...music,duration:1},0,true,.2)).toThrow(/2000/);
  const full=sequence();full.tracks=Array.from({length:24},(_,i)=>({...p.tracks[0],id:'t'+i}));expect(()=>insertBgm(full,music,0,true,.2)).toThrow(/空きトラック/);
});
