import { describe, expect, it } from 'vitest';
import { emptyProject, makeClip } from './model';
import { useEditor } from './store';
describe('Japanese text editing', () => {
  it.each([[1920,1080],[1080,1920]])('minimal text starts at the center of %sx%s and keeps effects through undo', (width,height) => {
    const p=emptyProject(); p.width=width;p.height=height; useEditor.getState().load(p);useEditor.getState().addTitle('minimal');
    const c=useEditor.getState().project.clips[0]; expect([c.x,c.y]).toEqual([0,0]); expect(c.fontFamily).toBe('Noto Sans JP');expect(c.fontWeight).toBe(500);
    useEditor.getState().updateClip(c.id,{fontFamily:'Zen Maru Gothic',fontWeight:700,textShadow:false,textStroke:true,strokeColor:'#00ff00',strokeWidth:5});
    const edited=useEditor.getState().project; useEditor.getState().undo(); expect(useEditor.getState().project.clips[0]).toEqual(c);
    useEditor.getState().redo();expect(useEditor.getState().project).toEqual(edited);
    useEditor.getState().updateTrack(c.trackId,{locked:true});const locked=useEditor.getState().project;
    useEditor.getState().updateClip(c.id,{x:20,textStroke:false});expect(useEditor.getState().project).toBe(locked);
  });
});

it.each(['hero','minimal','subtitle'] as const)('%s defaults to an outline without a shadow',style=>{const s=useEditor.getState();s.load(emptyProject());s.addTitle(style);expect(s.project).toBeDefined();expect(useEditor.getState().project.clips[0]).toMatchObject({textShadow:false,textStroke:true,strokeColor:'#0064ff',strokeWidth:4});});
it('legacy and explicitly saved effects are unchanged on load',()=>{const p=emptyProject();p.clips=[{...makeClip(p.tracks[0].id,0),textShadow:true,textStroke:false}];useEditor.getState().load(p);expect(useEditor.getState().project).toBe(p);expect(p.clips[0].textShadow).toBe(true);});
