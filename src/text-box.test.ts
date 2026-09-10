import { describe,it,expect } from 'vitest';
import { emptyProject,makeClip } from './model';
import { useEditor } from './store';
import { wrapTextBox,textBoxLayout,resizeTextBox,validateTextBox } from '../shared/text-box.mjs';
const measure=(text:string)=>[...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text)].length*10;
describe('editable text frames',()=>{
  it('wraps words and Japanese without splitting emoji or explicit blank lines',()=>{
    expect(wrapTextBox('hello world',70,measure)).toEqual(['hello','world']);
    expect(wrapTextBox('日本語の字幕\n\n家族👨‍👩‍👦と一緒',30,measure).join('')).toBe('日本語の字幕家族👨‍👩‍👦と一緒');
    expect(wrapTextBox('前半\n\n後半',100,measure)).toEqual(['前半','','後半']);
  });
  it('reports vertical overflow without changing the text or font size',()=>{
    const p=emptyProject(),c={...makeClip(p.tracks[0].id,0),text:'長いテキストの折り返し',fontSize:40,textBox:{width:60,height:40}};
    const layout=textBoxLayout(c,measure);expect(layout.lines.length).toBeGreaterThan(1);expect(layout.overflow).toBe(true);expect(c.fontSize).toBe(40);expect(c.text).toBe('長いテキストの折り返し');
    expect(textBoxLayout({...c,textBox:{...c.textBox,height:Math.ceil(layout.requiredHeight)}},measure).overflow).toBe(false);
  });
  it.each([0,37,-90])('resizes against the opposite anchor at %s degrees and 150 percent scale',rotation=>{
    const p=emptyProject(),c={...makeClip(p.tracks[0].id,0),rotation,scale:1.5,x:8,y:-5},box={width:400,height:200},angle=rotation*Math.PI/180;
    const point=(clip:typeof c,frame:typeof box,h:{x:number;y:number})=>{const x=-h.x*frame.width/2,y=-h.y*frame.height/2;return [p.width*(.5+clip.x/100)+(x*Math.cos(angle)-y*Math.sin(angle))*clip.scale,p.height*(.5+clip.y/100)+(x*Math.sin(angle)+y*Math.cos(angle))*clip.scale];};
    for(const h of [{x:1,y:1},{x:-1,y:-1},{x:1,y:0},{x:0,y:1}]){
      const patch=resizeTextBox(c,box,p,h,45,30),before=point(c,box,h),after=point({...c,...patch},patch.textBox!,h);
      expect(after[0]).toBeCloseTo(before[0],5);expect(after[1]).toBeCloseTo(before[1],5);
      if(!h.x)expect(patch.textBox!.width).toBe(box.width);if(!h.y)expect(patch.textBox!.height).toBe(box.height);
    }
  });
  it('preserves frame metadata across undo, redo and load while retaining legacy text',()=>{
    const p=emptyProject(),c=makeClip(p.tracks[0].id,0);p.clips=[c];useEditor.getState().load(p);
    useEditor.getState().updateClip(c.id,{text:'直接入力した字幕',textBox:{width:600,height:220}});const edited=useEditor.getState().project;
    expect(edited.clips[0].textBox).toEqual({width:600,height:220});useEditor.getState().undo();expect(useEditor.getState().project).toBe(p);expect(c.textBox).toBeUndefined();
    useEditor.getState().redo();expect(useEditor.getState().project).toBe(edited);useEditor.getState().load(JSON.parse(JSON.stringify(edited)));expect(useEditor.getState().project.clips[0].textBox).toEqual({width:600,height:220});
  });
  it('rejects invalid frame types and unbounded dimensions',()=>{
    const p=emptyProject(),c=makeClip(p.tracks[0].id,0);
    for(const box of [null,[],{width:31,height:40},{width:Infinity,height:40},{width:40,height:16001},{width:'60',height:50}])expect(()=>validateTextBox({...c,textBox:box} as never)).toThrow(/テキスト枠/);
    expect(()=>validateTextBox({...c,kind:'audio',textBox:{width:100,height:80}})).toThrow(/テキスト枠/);
    expect(()=>validateTextBox({...c,textBox:{width:100,height:80}})).not.toThrow();
  });
});
