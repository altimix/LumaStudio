import { useRef } from 'react';
import { useEditor } from '../store';
import PropertyNumberField from './PropertyNumberField';
import ScrubbableNumberInput from './ScrubbableNumberInput';

/** Settings for the next insertion are preferences, not project edits. */
export default function SettingNumberField({id,label,value,min,max,step=1,suffix,slider=false,onChange}:{id:string;label:string;value:number;min:number;max:number;step?:number;suffix:string;slider?:boolean;onChange:(value:number)=>void}) {
  const start=useRef<number|null>(null),last=useRef(value);last.current=value;
  const apply=(next:number)=>{if(Number.isFinite(next)){last.current=Math.max(min,Math.min(max,next));onChange(last.current);}};
  const begin=()=>{start.current=value;return true;},cancel=()=>{if(start.current!==null)apply(start.current);start.current=null;},finish=()=>{start.current=null;return last.current;};
  return <PropertyNumberField inputId={id} label={label} suffix={suffix} onFocus={()=>useEditor.getState().stop()}
    input={<ScrubbableNumberInput id={id} value={value} min={min} max={max} step={step} onCommit={apply} onScrubStart={begin} onScrubChange={apply} onScrubEnd={finish} onScrubCancel={cancel}/>}
    slider={slider?<input type="range" aria-label={`${label}スライダー`} min={min} max={max} step={step} value={value} onChange={event=>apply(Number(event.target.value))}/>:null}/>;
}
