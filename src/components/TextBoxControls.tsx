import { useEditor } from '../store';
import type { Clip } from '../types';
import { initialTextBox, boxedTextLayout } from '../render';
import './text-box.css';

export default function TextBoxControls({clip}:{clip:Clip}) {
  const width=useEditor(s=>s.project.width),height=useEditor(s=>s.project.height);
  const box=initialTextBox(clip,width,height),layout=boxedTextLayout({...clip,textBox:box});
  const patch=(value:Partial<typeof box>)=>useEditor.getState().updateClip(clip.id,{textBox:{...box,...value}});
  return <div className="text-box-controls"><strong>テキスト枠</strong><p>プレビューのハンドルでも幅と高さを変更できます。文字は枠の幅に合わせて折り返します。</p>
    {(['width','height'] as const).map(key=><label key={key} className="text-effect-size">{key==='width'?'テキスト枠の幅（px）':'テキスト枠の高さ（px）'}<input type="number" min={32} max={16000} step={1} key={`${clip.id}-${key}-${box[key]}`} defaultValue={Math.round(box[key])} onBlur={e=>{const value=Number(e.currentTarget.value);if(e.currentTarget.value!==''&&Number.isFinite(value))patch({[key]:Math.max(32,Math.min(16000,value))});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>)}
    {clip.textBox&&layout.overflow?<p className="text-box-overflow" role="status">文字が枠に収まりません。枠を広げるか、文字サイズを小さくしてください。</p>:null}
    <button className="secondary-button" onClick={()=>patch({height:Math.min(16000,Math.max(32,Math.ceil(layout.requiredHeight)))})}>枠の高さを文字に合わせる</button>
    {clip.textBox?<button className="text-button" onClick={()=>useEditor.getState().updateClip(clip.id,{textBox:undefined})}>テキスト枠を解除</button>:null}
  </div>;
}
