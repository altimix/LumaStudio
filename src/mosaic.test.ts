import {describe,expect,it} from 'vitest';
import {emptyProject,makeClip,splitClip} from './model';
import {useEditor} from './store';
import {separateAudio} from './linked-editing';
import type {Asset} from './types';
import {DEFAULT_MOSAIC} from '../shared/mosaic.mjs';

const asset:Asset={id:'mosaic-asset',name:'clip.mp4',path:'C:\\clip.mp4',url:'luma://clip',thumbnail:'',kind:'video',duration:10,width:1920,height:1080,fps:30,hasAudio:false,waveform:[],size:100,codec:'h264'};
function fixture(){const project=emptyProject();project.assets=[asset];project.clips=[{...makeClip(project.tracks[1].id,0,asset),id:'mosaic-clip',duration:8}];return project;}

describe('mosaic clip editing',()=>{
  it('commits, undoes, redoes, splits and preserves the original asset',()=>{
    const p=fixture(),state=useEditor.getState();state.load(p);state.updateClip('mosaic-clip',{mosaic:{...DEFAULT_MOSAIC}});
    const edited=useEditor.getState().project;expect(edited.clips[0].mosaic).toEqual(DEFAULT_MOSAIC);expect(edited.assets[0]).toBe(asset);
    const [left,right]=splitClip(edited.clips[0],4,30)!;expect(left.mosaic).toEqual(DEFAULT_MOSAIC);expect(right.mosaic).toEqual(DEFAULT_MOSAIC);
    state.undo();expect(useEditor.getState().project).toBe(p);state.redo();expect(useEditor.getState().project).toBe(edited);
  });
  it('rejects invalid values and locked-track changes without adding history',()=>{
    const p=fixture(),state=useEditor.getState();state.load(p);state.updateClip('mosaic-clip',{mosaic:{...DEFAULT_MOSAIC,x:.01}});
    expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
    p.tracks[1].locked=true;state.load(p);state.updateClip('mosaic-clip',{mosaic:{...DEFAULT_MOSAIC}});
    expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
  });
  it('rejects invalid mosaic data before replacing a loaded project',()=>{
    const state=useEditor.getState(),valid=fixture(),invalid=fixture();
    state.load(valid);invalid.clips[0]={...invalid.clips[0],mosaic:{...DEFAULT_MOSAIC,x:.01}};
    expect(()=>state.load(invalid)).toThrow(/モザイクの範囲/);
    expect(useEditor.getState().project).toBe(valid);
  });
  it('keeps mosaic on the video when its audio is separated',()=>{
    const p=fixture();p.assets=[{...asset,hasAudio:true}];p.clips[0]={...p.clips[0],mosaic:{...DEFAULT_MOSAIC}};
    const result=separateAudio(p,['mosaic-clip']);
    expect(result.clips.find(clip=>clip.kind==='video')?.mosaic).toEqual(DEFAULT_MOSAIC);
    expect(result.clips.find(clip=>clip.kind==='audio')?.mosaic).toBeUndefined();
  });
});
