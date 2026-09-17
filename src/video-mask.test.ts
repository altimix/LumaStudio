import { describe, expect, it } from 'vitest';
import { emptyProject, makeClip, splitClip } from './model';
import { useEditor } from './store';
import type { Asset, VideoMask } from './types';
import { evictInactiveMaskedFrames, MAX_VIDEO_MASK_RASTER_EDGE, type MaskedFrame, videoMaskRasterSize } from './video-mask';

const asset:Asset={id:'mask-asset',name:'mask.mp4',path:'C:\\mask.mp4',url:'luma://mask',thumbnail:'',kind:'video',duration:10,width:1920,height:1080,fps:30,hasAudio:false,waveform:[],size:100,codec:'h264'};
function fixture(){const p=emptyProject();p.assets=[asset];p.clips=[{...makeClip(p.tracks[1].id,0,asset),id:'mask-clip',duration:8}];return p;}
const mask:VideoMask={type:'ellipse',x:.5,y:.45,width:.6,height:.7,feather:.1,inverted:false};

describe('crop and basic shape mask editing',()=>{
  it('commits, undoes and redoes a valid non-destructive edit',()=>{
    const p=fixture(),s=useEditor.getState();s.load(p);s.updateClip('mask-clip',{crop:{top:.1,right:.2,bottom:.1,left:0},videoMask:mask});
    const edited=useEditor.getState().project;expect(edited.clips[0]).toMatchObject({crop:{top:.1,right:.2,bottom:.1,left:0},videoMask:mask});expect(useEditor.getState().history).toHaveLength(1);
    s.undo();expect(useEditor.getState().project).toBe(p);s.redo();expect(useEditor.getState().project).toBe(edited);
  });
  it('rejects invalid and locked edits without partial history',()=>{
    const p=fixture(),s=useEditor.getState();s.load(p);s.updateClip('mask-clip',{crop:{top:0,right:.6,bottom:0,left:.5}});expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
    p.tracks[1].locked=true;s.load(p);s.updateClip('mask-clip',{videoMask:mask});expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
  });
  it('preserves crop and mask when splitting a clip',()=>{
    const p=fixture(),clip={...p.clips[0],crop:{top:.1,right:0,bottom:0,left:.1},videoMask:mask};const parts=splitClip(clip,4,30)!;
    expect(parts[0].crop).toEqual(clip.crop);expect(parts[1].crop).toEqual(clip.crop);expect(parts[0].videoMask).toEqual(mask);expect(parts[1].videoMask).toEqual(mask);
  });
  it('keeps monitor edit mode only while the same clip stays selected',()=>{
    const p=fixture(),s=useEditor.getState();s.load(p);s.setMediaEditMode('crop');s.select(['mask-clip']);expect(useEditor.getState().mediaEditMode).toBe('crop');s.select([]);expect(useEditor.getState().mediaEditMode).toBe('transform');s.setMediaEditMode('mask');s.load(p);expect(useEditor.getState().mediaEditMode).toBe('transform');
  });
  it('leaves mask edit mode when Undo removes the selected mask',()=>{
    const p=fixture(),s=useEditor.getState();s.load(p);s.updateClip('mask-clip',{videoMask:mask});s.setMediaEditMode('mask');
    s.undo();expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().selected).toEqual(['mask-clip']);expect(useEditor.getState().mediaEditMode).toBe('transform');
    s.redo();expect(useEditor.getState().project.clips[0].videoMask).toEqual(mask);expect(useEditor.getState().mediaEditMode).toBe('transform');
  });
  it('bounds high-resolution preview mattes while preserving aspect ratio',()=>{
    expect(videoMaskRasterSize(320,180)).toEqual({width:320,height:180});
    expect(videoMaskRasterSize(640,360)).toEqual({width:MAX_VIDEO_MASK_RASTER_EDGE,height:288});
    expect(videoMaskRasterSize(7680,4320)).toEqual({width:MAX_VIDEO_MASK_RASTER_EDGE,height:288});
    expect(videoMaskRasterSize(4320,7680)).toEqual({width:288,height:MAX_VIDEO_MASK_RASTER_EDGE});
  });
  it('releases composite and matte canvases as soon as a masked clip is inactive',()=>{
    const frame=(width:number,height:number)=>({canvas:{width,height},mask:{width:512,height:288},context:{},key:'mask'} as unknown as MaskedFrame);
    const active=frame(1920,1080),inactive=frame(3840,2160),frames=new Map([['active',active],['inactive',inactive]]);
    evictInactiveMaskedFrames(frames,new Set(['active']));
    expect(frames.get('active')).toBe(active);expect(frames.has('inactive')).toBe(false);
    expect(inactive.canvas.width).toBe(0);expect(inactive.canvas.height).toBe(0);expect(inactive.mask.width).toBe(0);expect(inactive.mask.height).toBe(0);
  });
});
