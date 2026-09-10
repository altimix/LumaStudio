import { afterEach, expect, it, vi } from 'vitest';
import { emptyProject, makeClip } from './model';
import type { Asset, AudioPrepareProgress, Project } from './types';
import { useEditor } from './store';
import { useAudioJob, runAudioEnhancement, cancelAudioJob } from './audio-enhancement-job';
import { audioWorkItems, progressEstimate, durationLabel } from './audio-job-progress';

function fixture() {
  const project = emptyProject();
  const base: Asset = {id:'a',name:'会話.wav',kind:'audio',path:'a.wav',url:'media://a',thumbnail:'',hasAudio:true,duration:30,width:0,height:0,fps:0,waveform:[],codec:'pcm',size:100};
  project.assets = [base,{...base,id:'b',duration:90,path:'b.wav'}];
  project.clips = [makeClip(project.tracks[2].id,0,base), {...makeClip(project.tracks[2].id,30,base),in:5,duration:10}, makeClip(project.tracks[2].id,40,project.assets[1])];
  useEditor.getState().load(project); return project;
}
afterEach(() => { vi.unstubAllGlobals(); useAudioJob.setState({busy:false,message:'',progress:null}); });

it('groups split and duplicated clips by source and weights actual source durations',()=>{
  const p=fixture(),work=audioWorkItems(p,p.clips);expect(work).toHaveLength(2);expect(work.map(w=>w.duration)).toEqual([30,90]);
});
it('estimates only after measurable progress and formats long durations',()=>{
  expect(progressEstimate(0,1000,9000).remainingSeconds).toBeNull();
  expect(progressEstimate(.5,1000,11000)).toEqual({elapsedSeconds:10,remainingSeconds:10});
  expect(progressEstimate(.999,1000,11000).remainingSeconds).toBeNull();
  expect(progressEstimate(.3,null,11000).elapsedSeconds).toBe(0);
  expect(durationLabel(3665)).toBe('1時間1分');expect(durationLabel(65)).toBe('1分05秒');
});
it('aggregates real progress, ignores stale/malformed events and reaches 100 only after atomic apply',async()=>{
  const p=fixture();let listener!:(p:AudioPrepareProgress)=>void;
  const off=vi.fn(),requests:{id:string;resolve:(value:unknown)=>void}[]=[];
  const prepare=vi.fn((_p:Project,_c:string,_m:string,id:string)=>new Promise(resolve=>requests.push({id,resolve})));
  vi.stubGlobal('window',{luma:{prepareAudio:prepare,cancelAudioPrepare:vi.fn(),onAudioPrepareProgress:(cb:typeof listener)=>{listener=cb;return off;}}});
  const work=runAudioEnhancement(p.clips.map(c=>c.id),'speech');expect(requests).toHaveLength(1);
  const emit=(id:string,progress:number,phase:AudioPrepareProgress['phase']='analysis')=>listener({requestId:id,phase,progress,processedSeconds:15,durationSeconds:30});
  emit(requests[0].id,.5);expect(useAudioJob.getState().progress).toBe(.125);
  emit(requests[0].id,.2);expect(useAudioJob.getState().progress).toBe(.125);
  emit('old-job',1);emit(requests[0].id,NaN);emit(requests[0].id,.9,'bad' as AudioPrepareProgress['phase']);expect(useAudioJob.getState().progress).toBe(.125);
  requests[0].resolve({outputLufs:-16,peak:-1.5});await Promise.resolve();expect(requests).toHaveLength(2);
  emit(requests[0].id,1);expect(useAudioJob.getState().progress).toBe(.25);
  emit(requests[1].id,1,'complete');expect(useAudioJob.getState().progress).toBe(.99);expect(useEditor.getState().project).toBe(p);
  requests[1].resolve({outputLufs:-16,peak:-1.5});await work;
  expect(prepare).toHaveBeenCalledTimes(2);expect(useAudioJob.getState()).toMatchObject({busy:false,progress:1});expect(off).toHaveBeenCalledOnce();
  expect(useEditor.getState().project.clips.every(c=>c.audioTreatment==='speech')).toBe(true);useEditor.getState().undo();expect(useEditor.getState().project).toBe(p);
  emit(requests[1].id,.1);expect(useAudioJob.getState().progress).toBe(1);
});
it('cancel detaches progress and never applies a partially prepared source',async()=>{
  const p=fixture();let listener!:(p:AudioPrepareProgress)=>void,resolve!:(value:unknown)=>void,id='';
  const off=vi.fn(),cancel=vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('window',{luma:{prepareAudio:(_p:Project,_c:string,_m:string,requestId:string)=>{id=requestId;return new Promise(done=>{resolve=done;});},cancelAudioPrepare:cancel,onAudioPrepareProgress:(cb:typeof listener)=>{listener=cb;return off;}}});
  const work=runAudioEnhancement(p.clips.map(c=>c.id),'normalize');cancelAudioJob();
  listener({requestId:id,phase:'complete',progress:1,processedSeconds:30,durationSeconds:30});expect(useAudioJob.getState().progress).toBe(0);
  resolve({outputLufs:-16,peak:-1.5});await work;expect(useEditor.getState().project).toBe(p);expect(useAudioJob.getState().busy).toBe(false);expect(useAudioJob.getState().progress).not.toBe(1);expect(cancel).toHaveBeenCalledOnce();expect(off).toHaveBeenCalledOnce();
});
