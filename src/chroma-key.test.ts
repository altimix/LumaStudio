import { describe, expect, it } from 'vitest';
import { DEFAULT_CHROMA_KEY } from '../shared/chroma-key.mjs';
import { emptyProject, makeClip, splitClip } from './model';
import { useEditor } from './store';
import type { Asset, ChromaKey } from './types';

const asset:Asset={id:'chroma-asset',name:'green.mp4',path:'C:\\green.mp4',url:'luma://green',thumbnail:'',kind:'video',duration:10,width:640,height:360,fps:30,hasAudio:false,waveform:[],size:100,codec:'h264'};
const key:ChromaKey={...DEFAULT_CHROMA_KEY,color:'#12ab34'};
function fixture(){const project=emptyProject();project.assets=[asset];project.clips=[{...makeClip(project.tracks[1].id,0,asset),id:'chroma-clip',duration:8}];return project;}

describe('chroma key editing',()=>{
  it('commits, persists, splits, undoes and redoes chroma settings',()=>{
    const project=fixture(),state=useEditor.getState();state.load(project);state.updateClip('chroma-clip',{chromaKey:key});
    const edited=useEditor.getState().project;expect(edited.clips[0].chromaKey).toEqual(key);expect(useEditor.getState().history).toEqual([project]);
    const parts=splitClip(edited.clips[0],4,30)!;expect(parts[0].chromaKey).toEqual(key);expect(parts[1].chromaKey).toEqual(key);
    state.undo();expect(useEditor.getState().project).toBe(project);state.redo();expect(useEditor.getState().project).toBe(edited);
  });
  it('rejects invalid and locked changes without partial history',()=>{
    const project=fixture(),state=useEditor.getState();state.load(project);state.updateClip('chroma-clip',{chromaKey:{...key,tolerance:1}});expect(useEditor.getState().project).toBe(project);expect(useEditor.getState().history).toHaveLength(0);
    project.tracks[1].locked=true;state.load(project);state.updateClip('chroma-clip',{chromaKey:key});expect(useEditor.getState().project).toBe(project);expect(useEditor.getState().history).toHaveLength(0);
  });
  it('leaves eyedropper mode when Undo removes the chroma effect',()=>{
    const project=fixture(),state=useEditor.getState();state.load(project);state.updateClip('chroma-clip',{chromaKey:key});state.setMediaEditMode('chroma');state.undo();
    expect(useEditor.getState().project).toBe(project);expect(useEditor.getState().mediaEditMode).toBe('transform');
  });
});
