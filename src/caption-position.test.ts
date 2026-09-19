import {it,expect} from 'vitest';
import {emptyProject,makeClip,applySequenceSettings} from './model';
import {captionStyle} from './caption-style';
import {useEditor} from './store';
import {patchVisualClip,setVisualKey,visualClipAt} from '../shared/visual-keyframes.mjs';
it('keeps the lower caption margin after text and size edits and restores it with Undo',()=>{
  const p=emptyProject(),c={...makeClip(p.tracks[0].id,0),...captionStyle(p,'字幕'),textStyle:'subtitle' as const};p.clips=[c];useEditor.getState().load(p);
  const bottom=()=>{const clip=useEditor.getState().project.clips[0];return p.height*(.5+clip.y/100)+clip.fontSize*(clip.text.split('\n').length*1.22+.26)/2;};
  useEditor.getState().updateClip(c.id,{text:'字幕を二行に\n変更しました'});expect(bottom()).toBeCloseTo(p.height*.96);
  useEditor.getState().updateClip(c.id,{fontSize:120});expect(bottom()).toBeCloseTo(p.height*.96);useEditor.getState().undo();expect(bottom()).toBeCloseTo(p.height*.96);
  useEditor.getState().undo();expect(useEditor.getState().project).toBe(p);
});
it('preserves manually positioned and legacy captions through later text edits',()=>{
  const p=emptyProject(),c={...makeClip(p.tracks[0].id,0),...captionStyle(p,'字幕'),textStyle:'subtitle' as const};p.clips=[c];useEditor.getState().load(p);
  useEditor.getState().updateClip(c.id,{y:10});useEditor.getState().updateClip(c.id,{text:'改行\n追加',fontSize:100});expect(useEditor.getState().project.clips[0]).toMatchObject({y:10,captionAutoPosition:false});
  const old={...p,clips:[{...c,captionAutoPosition:undefined,y:20}]};useEditor.getState().load(old);useEditor.getState().updateClip(c.id,{text:'古い字幕\nそのまま'});expect(useEditor.getState().project.clips[0].y).toBe(20);
});
it('anchors unlocked automatic captions to the new sequence size without moving locked tracks',()=>{
  const p=emptyProject(),c={...makeClip(p.tracks[0].id,0),...captionStyle(p,'字幕'),textStyle:'subtitle' as const};p.clips=[c];
  const settings={name:p.name,width:1080,height:1920,fps:p.fps},next=applySequenceSettings(p,settings),clip=next.clips[0];expect(1920*(.5+clip.y/100)+clip.fontSize*1.48/2).toBeCloseTo(1920*.92);
  p.tracks[0].locked=true;expect(applySequenceSettings(p,settings).clips[0]).toBe(c);
});
it('reflows coalesced inspector typing and size drags but ends automatic layout for position drags',()=>{
  const p=emptyProject(),c={...makeClip(p.tracks[0].id,0),...captionStyle(p,'字幕'),textStyle:'subtitle' as const};p.clips=[c];const s=useEditor.getState();s.load(p);s.checkpoint();s.transient({...p,clips:[{...c,text:'文字を\n入力',fontSize:120}]});
  const edited=useEditor.getState().project.clips[0];expect(p.height*(.5+edited.y/100)+120*2.7/2).toBeCloseTo(p.height*.96);s.undo();expect(useEditor.getState().project).toBe(p);
  s.transient({...p,clips:[{...c,y:10}]});expect(useEditor.getState().project.clips[0].captionAutoPosition).toBe(false);
});
it('keeps keyed captions above the lower margin after size, text and sequence edits',()=>{
  const p=emptyProject(),base={...makeClip(p.tracks[0].id,0),...captionStyle(p,'字幕'),textStyle:'subtitle' as const,duration:4};
  const c=setVisualKey(setVisualKey(base,0),4);p.clips=[c];const s=useEditor.getState();s.load(p);s.seek(2);
  const check=(project:typeof p)=>{for(const at of [0,1,2,3,4]){const v=visualClipAt(project.clips[0],at);expect(v.captionAutoPosition).toBe(true);expect(project.height*(.5+v.y/100)+v.fontSize*(v.text.split('\n').length*1.22+.26)/2).toBeCloseTo(project.height*(project.height>project.width?.92:.96));}};
  s.updateClip(c.id,{fontSize:120});check(useEditor.getState().project);expect(visualClipAt(useEditor.getState().project.clips[0],2).fontSize).toBe(120);
  s.updateClip(c.id,{text:'二行の\n字幕'});check(useEditor.getState().project);s.undo();check(useEditor.getState().project);s.redo();check(useEditor.getState().project);
  check(applySequenceSettings(useEditor.getState().project,{name:p.name,width:1080,height:1920,fps:p.fps}));
});
it('reflows keyed size drags and disables automatic placement for keyed manual transforms or styles',()=>{
  const p=emptyProject(),base={...makeClip(p.tracks[0].id,0),...captionStyle(p,'字幕'),textStyle:'subtitle' as const,duration:4},c=setVisualKey(setVisualKey(base,0),4);p.clips=[c];const s=useEditor.getState();
  s.load(p);s.checkpoint();s.transient({...p,clips:[patchVisualClip(c,{fontSize:100},2)]},p);
  const value=visualClipAt(useEditor.getState().project.clips[0],2);expect(value.captionAutoPosition).toBe(true);expect(p.height*(.5+value.y/100)+100*1.48/2).toBeCloseTo(p.height*.96);s.undo();expect(useEditor.getState().project).toBe(p);
  for(const patch of [{y:10},{scale:2},{textStyle:'minimal' as const}]){s.load(p);s.seek(2);s.updateClip(c.id,patch);expect(useEditor.getState().project.clips[0].captionAutoPosition).toBe(false);expect(visualClipAt(useEditor.getState().project.clips[0],2)).toMatchObject(patch);}
  s.load(p);s.transient({...p,clips:[patchVisualClip(c,{y:10},2)]},p);expect(useEditor.getState().project.clips[0].captionAutoPosition).toBe(false);
});
