import type { Clip, Project } from './types';
import { wrapCaption } from '../shared/captions.mjs';

export function captionBottomY(p: Pick<Project,'width'|'height'>, text:string, fontSize:number) {
  const boxHeight=fontSize*(text.split('\n').length*1.22+.26),bottom=p.height*(p.height>p.width?.92:.96);
  return Math.max(-200,Math.min(200,(bottom-boxHeight/2)/p.height*100-50));
}
export function reflowEditedCaptions(before:Project,next:Project):Project {
  const old=new Map(before.clips.map(c=>[c.id,c]));let changed=false;
  const clips=next.clips.map(c=>{
    const previous=old.get(c.id);if(!c.captionAutoPosition||!previous||previous===c)return c;
    const moved=['x','y','scale','rotation'].some(key=>c[key as keyof Clip]!==previous[key as keyof Clip]);
    if(moved||c.textStyle!=='subtitle'){changed=true;return {...c,captionAutoPosition:false};}
    const y=captionBottomY(next,c.text,c.fontSize);if(y===c.y)return c;changed=true;return {...c,y};
  });return changed?{...next,clips}:next;
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
