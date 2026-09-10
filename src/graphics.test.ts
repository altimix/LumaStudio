import { SOUNDS, soundWave, soundDurationForFps } from '../shared/sounds.mjs';
import { describe,expect,it } from 'vitest';
import { emptyProject, makeTrack, applySequenceSettings } from './model';
import { useEditor } from './store';
import { graphicFromPoints } from '../shared/graphics.mjs';
import type { Asset } from './types';
const sound:Asset={id:'cue',name:'pop.wav',path:'pop.wav',url:'',thumbnail:'',kind:'audio',duration:.24,width:0,height:0,fps:0,hasAudio:true,waveform:[],size:48000,codec:'pcm_s16le'};
describe('editable drawing and synchronized attention cues',()=>{
  it.each(['arrow','rectangle','ellipse'] as const)('adds %s and its sound in one undoable transaction',shape=>{
    const p=emptyProject();useEditor.getState().load(p);useEditor.getState().seek(2);
    const input={...graphicFromPoints(shape,{x:100,y:100},{x:800,y:600},1920,1080),color:'#ffcc33',duration:3};
    expect(useEditor.getState().addDrawing(input,sound,.5)).toBe(true);const next=useEditor.getState().project;
    expect(next.clips).toHaveLength(2);expect(next.clips.map(c=>c.start)).toEqual([2,2]);expect(next.clips[0].graphic?.shape).toBe(shape);expect(next.clips[1].volume).toBe(.5);expect(useEditor.getState().history).toHaveLength(1);
    useEditor.getState().undo();expect(useEditor.getState().project).toBe(p);useEditor.getState().redo();expect(useEditor.getState().project).toBe(next);
    useEditor.getState().updateClip(next.clips[0].id,{graphic:{...next.clips[0].graphic!,width:300},color:'#00ff00'});expect(useEditor.getState().project.clips[0].graphic?.width).toBe(300);useEditor.getState().undo();expect(useEditor.getState().project).toBe(next);
  });
  it('preserves arrow direction in portrait coordinates without clipping a rotated wide source canvas',()=>{
    const g=graphicFromPoints('arrow',{x:540,y:1800},{x:540,y:100},1080,1920);
    expect(g.rotation).toBe(0);expect(g.graphic?.flipY).toBe(true);expect(g.graphic?.height).toBe(1700);expect(g.graphic?.width).toBe(4);
  });
  it('skips hidden and locked video tracks when placing a visible drawing',()=>{
    const p=emptyProject(),hidden=makeTrack('video','非表示'),locked=makeTrack('video','ロック'),visible=makeTrack('video','図形');
    hidden.hidden=true;locked.locked=true;p.tracks=[hidden,locked,visible];useEditor.getState().load(p);
    expect(useEditor.getState().addDrawing({...graphicFromPoints('arrow',{x:0,y:0},{x:100,y:100},1920,1080),color:'#ffffff',duration:3},sound)).toBe(true);
    expect(useEditor.getState().project.clips[0].trackId).toBe(visible.id);
    expect(useEditor.getState().project.tracks[0]).toBe(hidden);expect(useEditor.getState().project.tracks[1]).toBe(locked);
    useEditor.getState().undo();expect(useEditor.getState().project).toBe(p);
  });
  it.each(['locked','hidden'] as const)('%s video tracks prevent partial sound or asset additions',flag=>{
    const p=emptyProject();p.tracks.forEach(t=>t[flag]=true);useEditor.getState().load(p);
    const added=useEditor.getState().addDrawing({...graphicFromPoints('ellipse',{x:0,y:0},{x:100,y:100},1920,1080),color:'#ffffff',duration:3},sound);
    expect(added).toBe(false);expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
  });
});

it.each([1,2,3,4,5,6,7,24,25,30,60,120])('keeps the entire audible cue after timeline normalization at %s FPS',fps=>{
  for(const cue of SOUNDS){
    const p=emptyProject();p.fps=fps;useEditor.getState().load(p);
    const aligned=soundDurationForFps(cue.id,fps),bytes=soundWave(cue.id,aligned);
    const asset={...sound,id:cue.id,name:cue.name,duration:(bytes.length-44)/4/48000};
    const input={...graphicFromPoints('rectangle',{x:100,y:100},{x:400,y:300},1920,1080),color:'#ff0000',duration:3};
    expect(useEditor.getState().addDrawing(input,asset)).toBe(true);
    const audio=useEditor.getState().project.clips.find(c=>c.kind==='audio')!;
    expect(audio.duration).toBe(aligned);expect(audio.duration).toBeGreaterThanOrEqual(cue.duration);
    expect(audio.duration-cue.duration).toBeLessThan(1);
    for(const destinationFps of [1,2,7,24,25,30,50,60,120]){
      const next=applySequenceSettings(useEditor.getState().project,{name:p.name,width:p.width,height:p.height,fps:destinationFps});
      expect(next.clips.find(c=>c.kind==='audio')!.duration).toBe(aligned);
      expect(next.assets.find(a=>a.id===asset.id)!.duration).toBe(aligned);
    }
  }
});
