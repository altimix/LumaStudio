import { graphicFromPoints } from '../shared/graphics.mjs';
import type { Graphic, Project } from './types';

export function styledDrawing(shape:Graphic['shape'],from:{x:number;y:number},to:{x:number;y:number},project:Pick<Project,'width'|'height'>,style:{color:string;fill:boolean;fillColor:string;opacity:number;duration:number}) {
  const drawing=graphicFromPoints(shape,from,to,project.width,project.height);
  return {...drawing,graphic:{...drawing.graphic!,fill:shape!=='arrow'&&style.fill,fillColor:style.fillColor},color:style.color,opacity:style.opacity,duration:style.duration};
}
