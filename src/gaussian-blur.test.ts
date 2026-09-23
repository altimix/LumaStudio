import { describe, expect, it } from 'vitest';
import { emptyProject, makeClip, splitClip } from './model';
import { useEditor } from './store';
import { separateAudio } from './linked-editing';
import type { Asset } from './types';
import { DEFAULT_GAUSSIAN_BLUR } from '../shared/gaussian-blur.mjs';

const asset:Asset={id:'blur-asset',name:'clip.mp4',path:'C:\\clip.mp4',url:'luma://clip',thumbnail:'',kind:'video',duration:10,width:1920,height:1080,fps:30,hasAudio:false,waveform:[],size:100,codec:'h264'};
function fixture(){const project=emptyProject();project.assets=[asset];project.clips=[{...makeClip(project.tracks[1].id,0,asset),id:'blur-clip',duration:8}];return project;}

describe('gaussian blur clip editing',()=>{
  it('commits, undoes, redoes and keeps the effect on both split halves',()=>{
    const p=fixture(),state=useEditor.getState();state.load(p);state.updateClip('blur-clip',{gaussianBlur:{...DEFAULT_GAUSSIAN_BLUR}});
    const edited=useEditor.getState().project;expect(edited.clips[0].gaussianBlur).toEqual(DEFAULT_GAUSSIAN_BLUR);expect(edited.assets[0]).toBe(asset);
    const [left,right]=splitClip(edited.clips[0],4,30)!;expect(left.gaussianBlur).toEqual(DEFAULT_GAUSSIAN_BLUR);expect(right.gaussianBlur).toEqual(DEFAULT_GAUSSIAN_BLUR);
    state.undo();expect(useEditor.getState().project).toBe(p);state.redo();expect(useEditor.getState().project).toBe(edited);
  });
  it('rejects invalid settings, project loads and edits on locked tracks',()=>{
    const p=fixture(),state=useEditor.getState();state.load(p);state.updateClip('blur-clip',{gaussianBlur:{...DEFAULT_GAUSSIAN_BLUR,x:.01}});
    expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
    const invalid=fixture();invalid.clips[0]={...invalid.clips[0],gaussianBlur:{...DEFAULT_GAUSSIAN_BLUR,sigma:Infinity}};
    expect(()=>state.load(invalid)).toThrow(/ガウスぼかし/);expect(useEditor.getState().project).toBe(p);
    p.tracks[1].locked=true;state.load(p);state.updateClip('blur-clip',{gaussianBlur:{...DEFAULT_GAUSSIAN_BLUR}});
    expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
  });
  it('keeps blur only on video when audio is separated',()=>{
    const p=fixture();p.assets=[{...asset,hasAudio:true}];p.clips[0]={...p.clips[0],gaussianBlur:{...DEFAULT_GAUSSIAN_BLUR}};
    const result=separateAudio(p,['blur-clip']);
    expect(result.clips.find(clip=>clip.kind==='video')?.gaussianBlur).toEqual(DEFAULT_GAUSSIAN_BLUR);
    expect(result.clips.find(clip=>clip.kind==='audio')?.gaussianBlur).toBeUndefined();
  });
});
