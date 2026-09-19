import { useEditor } from '../store';
import type { Clip } from '../types';
import { initialTextBox, boxedTextLayout } from '../render';
import './text-box.css';
import { EffectField } from './ClipPropertyFields';

export default function TextBoxControls({clip}:{clip:Clip}) {
  const width=useEditor(s=>s.project.width),height=useEditor(s=>s.project.height);
  const box=initialTextBox(clip,width,height),layout=boxedTextLayout({...clip,textBox:box});
  const patch=(value:Partial<typeof box>)=>useEditor.getState().updateClip(clip.id,{textBox:{...box,...value}});
  return <div className="text-box-controls"><strong>テキスト枠</strong><p>プレビューのハンドルでも幅と高さを変更できます。文字は枠の幅に合わせて折り返します。</p>
    {(['width','height'] as const).map(key=><EffectField key={key} clip={clip} label={key==='width'?'テキスト枠の幅':'テキスト枠の高さ'} value={box[key]} min={32} max={16000} suffix="px" slider={false} channel={`textBox.${key}`} patch={(current,value)=>({textBox:{...initialTextBox(current,width,height),[key]:value}})}/>)}
    {clip.textBox&&layout.overflow?<p className="text-box-overflow" role="status">文字が枠に収まりません。枠を広げるか、文字サイズを小さくしてください。</p>:null}
    <button className="secondary-button" onClick={()=>patch({height:Math.min(16000,Math.max(32,Math.ceil(layout.requiredHeight)))})}>枠の高さを文字に合わせる</button>
    {clip.textBox?<button className="text-button" onClick={()=>useEditor.getState().updateClip(clip.id,{textBox:undefined})}>テキスト枠を解除</button>:null}
  </div>;
}
