type Result = (values: Float32Array | null) => void;
type Treatment='speech'|'normalize'|undefined;
type Job = { treatment:Treatment;key: string; url: string; start: number; end: number; bins: number; listeners: Set<Result>; requestId?:string; cancelled?:boolean };
const cache = new Map<string, Float32Array>(), jobs = new Map<string, Job>(), queue: Job[] = [];
let active = 0;
function pump() {
  while (active < 2 && queue.length) {
    const job = queue.shift()!;
    if (!job.listeners.size) { if(jobs.get(job.key)===job)jobs.delete(job.key); continue; }
    active++;
    Promise.resolve().then(() => {
      if(job.cancelled)throw new Error('Waveform cancelled');
      job.requestId=crypto.randomUUID();
      return window.luma!.readWaveform(job.url, job.start, job.end, job.bins, {absolute:true,treatment:job.treatment},job.requestId);
    }).then(values => {
      if(job.cancelled)return;
      cache.set(job.key, values); while (cache.size > 128) cache.delete(cache.keys().next().value!);
      for (const listener of job.listeners) listener(values);
    }, () => { for (const listener of job.listeners) listener(null); }).finally(() => { active--; if(jobs.get(job.key)===job)jobs.delete(job.key); pump(); });
  }
}
export function requestWaveform(url: string, start: number, end: number, bins: number, listener: Result, treatment?:Treatment) {
  const key = JSON.stringify([url, start, end, bins, treatment]), cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); listener(cached); return () => {}; }
  let job = jobs.get(key);
  if (!job) { job = { treatment,key, url, start, end, bins, listeners: new Set() }; jobs.set(key, job); queue.push(job); }
  job.listeners.add(listener); pump();
  return () => {
    job.listeners.delete(listener);
    if(!job.listeners.size){
      job.cancelled=true;if(jobs.get(key)===job)jobs.delete(key);
      const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);
      if(job.requestId)void window.luma!.cancelWaveform(job.requestId).catch(()=>{});
    }
  };
}
