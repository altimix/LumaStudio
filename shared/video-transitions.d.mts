import type { Transition } from '../src/types';
export function blendTransition(kind:NonNullable<Transition['video']>,a:Uint8ClampedArray,b:Uint8ClampedArray,output:Uint8ClampedArray,width:number,height:number,progress:number):void;
export function xfadeExpression(kind:NonNullable<Transition['video']>):string;
export function transitionShader():string;
