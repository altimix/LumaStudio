import type { Project,Clip,Transition,TransitionOptions } from '../src/types';
export const VIDEO_TRANSITIONS:Record<NonNullable<Transition['video']>,string>;
export const AUDIO_TRANSITIONS:Record<NonNullable<Transition['audio']>,string>;
export interface PlannedTransition extends Transition {from:Clip;to:Clip;start:number;end:number;duration:number}
export interface AudioEnvelope {start:number;end:number;curve:NonNullable<Transition['audio']>;direction:'in'|'out'}
export function transitionPlan(p:Project,strict?:boolean):PlannedTransition[];
export function validateTransitions(p:Project):void;
export function pruneTransitions(p:Project):Project;
export function applyTransition(p:Project,fromId:string,toId:string,options:TransitionOptions,id:string):Project;
export function audioEnvelopes(p:Project):Map<string,AudioEnvelope[]>;
export function crossfadeGain(envelopes:AudioEnvelope[]|undefined,time:number):number;
export interface MediaWindow {start:number;end:number;duration:number;sourceIn:number;sourceDuration:number;padBefore:number;padAfter:number}
export function mediaWindow(clip:Clip,asset:import('../src/types').Asset|undefined,plans:PlannedTransition[],kind:'video'|'audio'):MediaWindow;
export function visualSourceTime(clip:Clip,asset:import('../src/types').Asset,time:number):number;
export function maxTransitionDuration(from:Clip,to:Clip,fps:number):number;
