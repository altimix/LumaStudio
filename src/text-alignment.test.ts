import { describe, expect, it } from 'vitest';
import { TEXT_ALIGNMENTS, textLineLayout } from '../shared/text-alignment.mjs';
import { validateTextStyle } from '../shared/text-style.mjs';
import { needsTitleFrames, setVisualKey, validateVisualKeys, visualClipAt, visualSnapshot } from '../shared/visual-keyframes.mjs';
import { emptyProject, makeClip, splitClip, trimClip } from './model';
import { useEditor } from './store';
import type { Clip } from './types';
const measure = (text: string) => Array.from(new Intl.Segmenter('ja', {granularity:'grapheme'}).segment(text)).length * 20;
const title = () => ({...makeClip('v', 0), duration:4, text:'長い行の文字\n短文', fontSize:40});

describe('text alignment', () => {
  it('anchors left, center and right without splitting or reshaping the text', () => {
    for(const [align, x] of [['left',0],['center',100],['right',200]] as const){
      expect(textLineLayout('日本語 Aa',200,align,measure)).toEqual({align,runs:[{text:'日本語 Aa',x,maxWidth:200}]});
    }
    expect(textLineLayout('旧文書',200,undefined,measure)).toEqual(textLineLayout('旧文書',200,'center',measure));
  });
  it('spreads Japanese graphemes across the width with identical gaps', () => {
    const result=textLineLayout('か\u3099👩‍👩‍👧‍👦文',200,'justify',measure);
    expect(result.align).toBe('left');expect(result.runs.map(run=>run.text)).toEqual(['か\u3099','👩‍👩‍👧‍👦','文']);
    expect(result.runs.map(run=>run.x)).toEqual([0,90,180]);
    expect(result.runs.at(-1)!.x+measure(result.runs.at(-1)!.text)).toBe(200);
  });
  it('uses glyph widths when spacing Latin and Japanese text',()=>{
    const widths:Record<string,number>={A:11,'字':20,B:9};
    const {runs}=textLineLayout('A字B',100,'justify',text=>widths[text]);
    expect(runs.map(run=>run.x)).toEqual([0,41,91]);
  });
  it('keeps empty lines, single graphemes and overflowing boxes safe',()=>{
    expect(textLineLayout('',200,'justify',measure).runs).toEqual([]);
    expect(textLineLayout('👩‍👩‍👧‍👦',200,'justify',measure).runs).toEqual([{text:'👩‍👩‍👧‍👦',x:100,maxWidth:200}]);
    expect(textLineLayout('長い行',40,'justify',measure,false)).toEqual({align:'center',runs:[{text:'長い行',x:20,maxWidth:undefined}]});
    expect(textLineLayout('長い行',40,'left',measure).runs[0].maxWidth).toBe(40);
  });
  it('rejects unsupported saved and keyed values at the shared/export boundary',()=>{
    for(const textAlign of [null,'distributed','start',0,{},[]]){
      const clip={...title(),textAlign} as Clip;
      expect(()=>validateTextStyle(clip)).toThrow(/文字揃え/);
      expect(()=>validateVisualKeys({...title(),visualKeyframes:[{time:0,values:{...visualSnapshot(title()),textAlign} as never}]})).toThrow(/文字揃え/);
    }
    for(const textAlign of TEXT_ALIGNMENTS)expect(()=>validateTextStyle({...title(),textAlign})).not.toThrow();
  });
  it('steps alignment at keyframes and preserves it through splits and trims',()=>{
    const c=setVisualKey(setVisualKey(title(),0),2,{textAlign:'right'});
    expect(visualClipAt(c,1.99).textAlign).toBe('center');expect(visualClipAt(c,2).textAlign).toBe('right');expect(needsTitleFrames(c)).toBe(true);
    const [left,right]=splitClip(c,1,30)!;
    expect(visualClipAt(left,.5).textAlign).toBe('center');expect(visualClipAt(right,.99).textAlign).toBe('center');expect(visualClipAt(right,1).textAlign).toBe('right');
    const trimmed=trimClip(c,'left',1,{...emptyProject(),clips:[c]});expect(visualClipAt(trimmed,1).textAlign).toBe('right');
  });
  it('round-trips each alignment with Undo/Redo, legacy defaults and locked tracks',()=>{
    for(const textAlign of TEXT_ALIGNMENTS){
      const p=emptyProject(),c={...title(),trackId:p.tracks[0].id};p.clips=[c];const s=useEditor.getState();s.load(p);
      expect(visualSnapshot(c).textAlign).toBe('center');s.updateClip(c.id,{textAlign});const edited=JSON.parse(JSON.stringify(useEditor.getState().project));
      expect(edited.clips[0].textAlign).toBe(textAlign);s.undo();expect(useEditor.getState().project.clips[0].textAlign).toBeUndefined();s.redo();expect(useEditor.getState().project.clips[0].textAlign).toBe(textAlign);
      s.load(edited);s.updateTrack(c.trackId,{locked:true});const locked=useEditor.getState().project;s.updateClip(c.id,{textAlign:'left'});expect(useEditor.getState().project).toBe(locked);
    }
  });
  it('edits only the current key when alignment changes',()=>{
    const p=emptyProject(),c=setVisualKey(setVisualKey({...title(),trackId:p.tracks[0].id},0),3,{textAlign:'right'});p.clips=[c];const s=useEditor.getState();s.load(p);s.seek(1);s.updateClip(c.id,{textAlign:'justify'});
    const updated=useEditor.getState().project.clips[0];expect(visualClipAt(updated,0).textAlign).toBe('center');expect(visualClipAt(updated,1).textAlign).toBe('justify');expect(visualClipAt(updated,3).textAlign).toBe('right');s.undo();expect(useEditor.getState().project.clips[0]).toEqual(c);
  });
});
