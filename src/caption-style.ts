import type { Clip, Project } from './types';
import { wrapCaption } from '../shared/captions.mjs';
import { visualClipAt, visualKeys } from '../shared/visual-keyframes.mjs';

export function captionBottomY(p: Pick<Project,'width'|'height'>, text:string, fontSize:number) {
  const boxHeight=fontSize*(text.split('\n').length*1.22+.26),bottom=p.height*(p.height>p.width?.92:.96);
  return Math.max(-200,Math.min(200,(bottom-boxHeight/2)/p.height*100-50));
}
export function reflowEditedCaptions(before:Project,next:Project):Project {
  const old=new Map(before.clips.map(c=>[c.id,c]));let changed=false;
  const clips=next.clips.map(c=>{
    const previous=old.get(c.id);if(!c.captionAutoPosition||!previous||previous===c)return c;
    const result=positionAutomaticCaption(next,c,previous);if(result!==c)changed=true;return result;
  });return changed?{...next,clips}:next;
}
export function positionAutomaticCaption(p:Pick<Project,'width'|'height'>,clip:Clip,previous?:Clip):Clip {
  if(!clip.captionAutoPosition)return clip;
  // Inspect the values actually used by rendering, including newly inserted keys.
  for(const time of [0,...visualKeys(clip).map(key=>key.time)]){
    const value=visualClipAt(clip,time),old=previous&&visualClipAt(previous,time);
    const moved=old&&(['x','scale','rotation','textBox'] as const).some(key=>JSON.stringify(value[key])!==JSON.stringify(old[key]));
    const manualY=old&&Math.abs(value.y-old.y)>1e-7&&Math.abs(value.y-captionBottomY(p,clip.text,value.fontSize))>1e-7;
    if(value.textStyle!=='subtitle'||moved||manualY)return {...clip,captionAutoPosition:false};
  }
  const y=captionBottomY(p,clip.text,clip.fontSize);
  const visualKeyframes=clip.visualKeyframes?.map(key=>{
    const nextY=captionBottomY(p,clip.text,Number(key.values.fontSize??clip.fontSize));
    return key.values.y===nextY?key:{...key,values:{...key.values,y:nextY}};
  });
  if(y===clip.y&&(!visualKeyframes||visualKeyframes.every((key,index)=>key===clip.visualKeyframes![index])))return clip;
  return {...clip,y,...(visualKeyframes?{visualKeyframes}:{})};
}
export function captionStyle(p: Pick<Project,'width'|'height'>, text: string): Pick<Clip,'text'|'fontSize'|'fontWeight'|'textShadow'|'textStroke'|'strokeColor'|'strokeWidth'|'color'|'y'|'captionBackgroundOpacity'|'captionAutoPosition'> {
  const portrait=p.height>p.width,wrapped=text.includes('\n')?text:wrapCaption(text,portrait?15:24);
  const base=(portrait?64:72)*p.width/(portrait?1080:1920);
  const units=(line:string)=>[...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(line)].reduce((n,g)=>n+(/^[\x00-\x7f]+$/.test(g.segment)?.6:1),0);
  const longest=Math.max(1,...wrapped.split('\n').map(units));
  const fontSize=Math.max(16,Math.min(240,Math.round(Math.min(base,p.width*.84/longest))));
  // Place the entire subtitle background above the lower margin, including
  // both lines and padding. Use the same line height/padding as titleCanvas.
  const y=captionBottomY(p,wrapped,fontSize);
  return {text:wrapped,fontSize,fontWeight:700,color:'#ffffff',textShadow:false,textStroke:true,strokeColor:'#0064ff',strokeWidth:4,captionBackgroundOpacity:.25,captionAutoPosition:true,y};
}
