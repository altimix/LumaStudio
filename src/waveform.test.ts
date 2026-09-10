import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>vi.unstubAllGlobals());
it('shares a request, cancels only its last listener and starts queued work',async()=>{
  vi.resetModules();
  const pending=new Map<string,{resolve:(v:Float32Array)=>void;reject:(e:Error)=>void}>();
  const readWaveform=vi.fn((_url:string,_start:number,_end:number,_bins:number,_options:unknown,id:string)=>new Promise<Float32Array>((resolve,reject)=>pending.set(id,{resolve,reject})));
  const cancelWaveform=vi.fn(async(id:string)=>{pending.get(id)?.reject(new Error('cancelled'));pending.delete(id);});
  vi.stubGlobal('window',{luma:{readWaveform,cancelWaveform}});
  const {requestWaveform}=await import('./waveform');const a=vi.fn(),b=vi.fn(),c=vi.fn();
  const removeA=requestWaveform('a',0,1,10,a,'speech'),removeB=requestWaveform('a',0,1,10,b,'speech');
  requestWaveform('b',0,1,10,()=>{},'speech');requestWaveform('c',0,1,10,c,'speech');
  await vi.waitFor(()=>expect(readWaveform).toHaveBeenCalledTimes(2));
  removeA();expect(cancelWaveform).not.toHaveBeenCalled();removeB();
  await vi.waitFor(()=>expect(readWaveform).toHaveBeenCalledTimes(3));
  expect(cancelWaveform).toHaveBeenCalledTimes(1);expect(a).not.toHaveBeenCalled();expect(b).not.toHaveBeenCalled();
  for(const work of pending.values())work.resolve(new Float32Array([.5]));
  await vi.waitFor(()=>expect(c).toHaveBeenCalledOnce());
});
it('removes an abandoned request before IPC starts and permits immediate resubscription',async()=>{
  vi.resetModules();const readWaveform=vi.fn(async()=>new Float32Array([.25]));const cancelWaveform=vi.fn(async()=>{});
  vi.stubGlobal('window',{luma:{readWaveform,cancelWaveform}});
  const {requestWaveform}=await import('./waveform');const old=vi.fn(),next=vi.fn();
  requestWaveform('same',0,1,10,old)();requestWaveform('same',0,1,10,next);
  await vi.waitFor(()=>expect(next).toHaveBeenCalledOnce());expect(old).not.toHaveBeenCalled();expect(readWaveform).toHaveBeenCalledOnce();expect(cancelWaveform).not.toHaveBeenCalled();
});
