import type { Clip, Graphic } from '../types';
import { useEditor } from '../store';
import { EffectField } from './ClipPropertyFields';
import ColorField from './ColorField';
export default function GraphicEffects({clip}:{clip:Clip}){
  const graphic=clip.graphic!,patch=(value:Partial<Graphic>)=>useEditor.getState().updateClip(clip.id,{graphic:{...graphic,...value}});
  return <div className="graphic-effects"><p>プレビューで移動、右下のハンドルでサイズを調整できます。</p>
    {(['width','height','lineWidth'] as const).map(key=><EffectField key={key} clip={clip} label={key==='width'?'図形の幅':key==='height'?'図形の高さ':'線の太さ'} value={graphic[key]} min={key==='lineWidth'?1:4} max={key==='lineWidth'?80:16000} suffix="px" slider={key==='lineWidth'} channel={`graphic.${key}`} patch={(current,value)=>({graphic:{...current.graphic!,[key]:value}})}/>)}
    <ColorField id="graphic-color" label="図形の線の色" value={clip.color} onChange={color=>useEditor.getState().updateClip(clip.id,{color})}/>
    {graphic.shape!=='arrow'?<><label className="text-effect-toggle"><input type="checkbox" checked={graphic.fill} onChange={e=>patch({fill:e.target.checked})}/>図形を塗りつぶす</label>{graphic.fill?<ColorField id="graphic-fill-color" label="塗りつぶしの色" value={graphic.fillColor} onChange={fillColor=>patch({fillColor})}/>:null}</>:null}
    <button className="secondary-button" onClick={()=>useEditor.getState().updateClip(clip.id,{x:0,y:0})}>画面の中央に配置</button>
  </div>;
}
