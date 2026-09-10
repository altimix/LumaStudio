export type SoundId = 'ping' | 'chime' | 'jingle';
export const SOUNDS:readonly {id:SoundId;name:string;duration:number;revision:number}[];
export function soundWave(id:string,minimumDuration?:number):Uint8Array;
export function soundDurationForFps(id:SoundId,fps:number):number;
