import type { Clip, Graphic } from '../types';
import { useEditor } from '../store';
export default function GraphicEffects({clip}:{clip:Clip}){
  const graphic=clip.graphic!,patch=(value:Partial<Graphic>)=>useEditor.getState().updateClip(clip.id,{graphic:{...graphic,...value}});
  return <div className="graphic-effects"><p>プレビューで移動、右下のハンドルでサイズを調整できます。</p>
    {(['width','height','lineWidth'] as const).map(key=><label key={key}>{key==='width'?'図形の幅（px）':key==='height'?'図形の高さ（px）':'線の太さ（px）'}<input type="number" min={key==='lineWidth'?1:4} max={key==='lineWidth'?80:16000} key={clip.id+':'+key+':'+graphic[key]} defaultValue={Number(graphic[key].toFixed(1))} onBlur={e=>{const value=Number(e.currentTarget.value);if(e.currentTarget.value&&Number.isFinite(value)&&Math.abs(value-graphic[key])>.051)patch({[key]:value});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>)}
    <label>図形の線の色<input type="color" value={clip.color} onChange={e=>useEditor.getState().updateClip(clip.id,{color:e.target.value})}/></label>
    {graphic.shape!=='arrow'?<><label className="text-effect-toggle"><input type="checkbox" checked={graphic.fill} onChange={e=>patch({fill:e.target.checked})}/>図形を塗りつぶす</label>{graphic.fill?<label>塗りつぶしの色<input type="color" value={graphic.fillColor} onChange={e=>patch({fillColor:e.target.value})}/></label>:null}</>:null}
    <button className="secondary-button" onClick={()=>useEditor.getState().updateClip(clip.id,{x:0,y:0})}>画面の中央に配置</button>
  </div>;
}
