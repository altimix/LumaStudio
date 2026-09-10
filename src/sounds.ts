import type { Asset } from './types';
import { soundWave, SOUNDS, soundDurationForFps } from '../shared/sounds.mjs';
import type { SoundId } from '../shared/sounds.mjs';
const cached=new Map<string,Promise<Asset>>();
export function loadSoundForTimeline(id:SoundId,fps:number):Promise<Asset>{
  return loadSound(id,soundDurationForFps(id,fps));
}
export function loadSound(id:SoundId,minimumDuration=0):Promise<Asset>{
  const key=id+':'+minimumDuration;let promise=cached.get(key);if(!promise){promise=(async()=>{
    if(window.luma)return window.luma.soundAsset(id,minimumDuration);
    const sound=SOUNDS.find(s=>s.id===id)!,bytes=soundWave(id,minimumDuration),url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));
    return {id:'luma-original-'+key,name:sound.name+'.wav',path:'',url,thumbnail:'',kind:'audio' as const,duration:(bytes.length-44)/4/48000,width:0,height:0,fps:0,hasAudio:true,waveform:[],size:bytes.length,codec:'pcm_s16le'};
  })().catch(error=>{cached.delete(key);throw error;});cached.set(key,promise);}return promise;
}
