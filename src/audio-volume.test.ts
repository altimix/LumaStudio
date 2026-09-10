import { expect, it } from 'vitest';
import { applyBgmVolume } from './audio-volume';
import { audioSlices } from './audio-plan';
import { emptyProject, makeClip, makeTrack } from './model';
import { separateAudio } from './linked-editing';
import { useEditor } from './store';
import type { Asset } from './types';

const asset: Asset = { id:'music',name:'BGM.wav',path:'C:/BGM.wav',url:'media://music',thumbnail:'',kind:'audio',hasAudio:true,duration:20,width:0,height:0,fps:0,waveform:[],codec:'pcm',size:100 };
function fixture() {
  const p=emptyProject();p.assets=[asset];
  p.clips=[{...makeClip(p.tracks[2].id,1,asset),id:'a',duration:4,volume:.3,fadeIn:.5,fadeOut:1}, {...makeClip(p.tracks[2].id,5,asset),id:'b',duration:4,volume:.6}, {...makeClip(p.tracks[0].id,0),id:'title',duration:9}];
  return p;
}
it.each([[-20,.1],[-15,.1778279410038923]])('sets %s dB as an absolute gain and preserves unrelated clip properties', (db,volume)=>{
  const p=fixture();p.clips[0].audioTreatment='speech';p.clips[0].audioMuted=true;
  const next=applyBgmVolume(p,['a','title'],db);expect(next.clips[0].volume).toBeCloseTo(volume,12);
  expect({...next.clips[0],volume:p.clips[0].volume}).toEqual(p.clips[0]);expect(next.clips[1]).toBe(p.clips[1]);expect(next.clips[2]).toBe(p.clips[2]);expect(p.clips[0].volume).toBe(.3);
  expect(applyBgmVolume(next,['a','title'],db)).toBe(next);
});
it('applies a batch in one Undo/Redo and repeated settings preserve history, selection and playhead',()=>{
  const p=fixture(),s=useEditor.getState();s.load(p);s.select(['a','b']);s.seek(3);s.setBgmVolumeDb(-15);
  const next=useEditor.getState().project;expect(next.clips.slice(0,2).every(c=>Math.abs(20*Math.log10(c.volume)+15)<1e-8)).toBe(true);expect(useEditor.getState().history).toHaveLength(1);
  s.setBgmVolumeDb(-15);expect(useEditor.getState().project).toBe(next);expect(useEditor.getState().history).toHaveLength(1);expect(useEditor.getState().selected).toEqual(['a','b']);expect(useEditor.getState().playhead).toBe(3);
  s.undo();expect(useEditor.getState().project).toBe(p);s.redo();expect(useEditor.getState().project).toBe(next);expect(useEditor.getState().playhead).toBe(3);
});
it('targets the linked audio once even when its video and audio are both selected',()=>{
  const p=emptyProject(),video={...asset,kind:'video' as const,width:320,height:180,fps:30};p.assets=[video];p.clips=[{...makeClip(p.tracks[1].id,0,video),id:'video',duration:4,volume:.7}];
  const linked=separateAudio(p,['video']),audio=linked.clips.find(c=>c.kind==='audio')!;linked.tracks.find(t=>t.id===linked.clips[0].trackId)!.locked=true;
  const next=applyBgmVolume(linked,['video',audio.id],-20);expect(next.clips[0]).toBe(linked.clips[0]);expect(next.clips.find(c=>c.id===audio.id)?.volume).toBe(.1);
  const slices=audioSlices(next,.6,1.2,1);expect(slices.length).toBeGreaterThan(0);expect(slices.every(s=>s.clip.id===audio.id && s.clip.volume===.1)).toBe(true);
});
it('a locked member prevents the entire batch without adding history or changing any clip',()=>{
  const p=fixture(),locked=makeTrack('audio','ロックされたBGM');locked.locked=true;p.tracks.push(locked);p.clips[1].trackId=locked.id;
  const s=useEditor.getState();s.load(p);s.setBgmVolumeDb(-20,['a','b']);expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);expect(useEditor.getState().toast).toMatch(/ロック/);
});
it('invalid settings and selections without audio leave the project unchanged',()=>{
  const p=fixture();for(const db of [NaN,Infinity,-Infinity,-30,0,15])expect(()=>applyBgmVolume(p,['a'],db)).toThrow(/−20/);
  for(const ids of [[],['missing'],['title']])expect(()=>applyBgmVolume(p,ids,-20)).toThrow(/音声/);
  const s=useEditor.getState();s.load(p);s.setBgmVolumeDb(NaN,['a']);expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
});
it('muted and offline BGM can keep their mute state while their saved gain is adjusted',()=>{
  const p=fixture();p.assets[0]={...asset,offline:true};p.tracks[2].muted=true;p.clips[0].audioMuted=true;
  const next=applyBgmVolume(p,['a'],-15);expect(next.assets).toBe(p.assets);expect(next.tracks).toBe(p.tracks);expect(next.clips[0].audioMuted).toBe(true);expect(next.clips[0].volume).toBeCloseTo(.1778279410038923,12);
});
