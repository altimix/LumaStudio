import type { Clip, Graphic } from '../src/types';
export const SHAPES: readonly Graphic['shape'][];
export const SHAPE_NAMES: Record<Graphic['shape'],string>;
export function validateGraphic(c: Partial<Clip>): void;
export function graphicFromPoints(shape:Graphic['shape'],from:{x:number;y:number},to:{x:number;y:number},width:number,height:number,lineWidth?:number):Pick<Clip,'x'|'y'|'rotation'|'graphic'>;
export function paintGraphic(ctx:CanvasRenderingContext2D,graphic:Graphic,color:string,width:number,height:number,factor:number):void;

export function graphicBounds(g:Graphic):{width:number;height:number};

export function arrowPoints(g:Graphic,factor?:number):[number,number][];
