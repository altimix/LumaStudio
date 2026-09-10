const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
const { createHash } = require('node:crypto');
const { createAudioProcessor, readLoudness, processAudio } = require('../electron/audio-normalize.cjs');
const { ffmpeg, run } = require('../electron/media.cjs');
const { decodeAudioChunk, createAudioReader } = require('../electron/audio.cjs');
const { buildExport } = require('../electron/export.cjs');
const { buildTimelineAudio } = require('../electron/youtube.cjs');
async function temporary(work) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-normalize-')); try { await work(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); } }
const rms = (data, from, to) => { let sum=0;for(let i=from*48000*2;i<to*48000*2;i++)sum+=data[i]**2;return Math.sqrt(sum/((to-from)*48000*2)); };
test('speech normalization lowers dynamics, targets loudness and keeps stereo source timing and originals', async () => temporary(async dir => {
  const file=path.join(dir,'会話 & 強弱.wav');
  await run(ffmpeg,['-y','-v','error','-f','lavfi','-i',String.raw`aevalsrc=if(lt(t\,4)\,0.025\,0.45)*sin(2*PI*420*t)|if(lt(t\,4)\,0.025\,0.45)*sin(2*PI*630*t):s=48000:d=10`,'-c:a','pcm_s24le',file]);
  const hash=async()=>createHash('sha256').update(await fs.readFile(file)).digest('hex'),before=await hash();
  const service=createAudioProcessor(path.join(dir,'cache'));
  try {
    const progress=[];
    const [processed,same]=await Promise.all([service.get(file,'speech',undefined,{duration:10,onProgress:value=>progress.push(value)}),service.get(file,'speech')]); assert.equal(processed.file,same.file);
    assert.ok(Math.abs(processed.outputLufs+16)<1,JSON.stringify(processed));assert.ok(processed.peak<=-1.2);
    const measured=readLoudness(await processAudio(['-i',processed.file,'-af','loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json','-f','null','-']));
    assert.ok(Math.abs(measured.input_i+16)<.3,JSON.stringify(measured));assert.ok(measured.input_tp<=-1.3);
    assert.ok(Math.abs(measured.input_i-processed.outputLufs)<.15);assert.ok(Math.abs(measured.input_tp-processed.peak)<.15);
    assert.ok(progress.some(p=>p.phase==='speech'&&p.progress>0&&p.progress<=.96));
    assert.ok(!progress.some(p=>p.phase==='analysis'||p.phase==='processing'));assert.equal(progress.at(-1).phase,'complete');assert.equal(progress.at(-1).progress,1);
    assert.ok(progress.every((p,i)=>Number.isFinite(p.progress)&&p.progress>=0&&p.progress<=1&&(!i||p.progress>=progress[i-1].progress)));
    const source=await decodeAudioChunk(file,0),actual=await decodeAudioChunk(processed.file,0);
    const difference=data=>20*Math.log10(rms(data,5,7)/rms(data,1,3));assert.ok(difference(actual)<difference(source)-6);
    assert.equal(actual.length,source.length);assert.equal(await hash(),before);
    const stat=await fs.stat(processed.file),cached=[];await service.get(file,'speech',undefined,{onProgress:p=>cached.push(p)});assert.equal((await fs.stat(processed.file)).mtimeMs,stat.mtimeMs);
    assert.deepEqual(cached.map(p=>p.phase),['preparing','cached']);assert.equal(cached.at(-1).progress,1);
    const full=await run(ffmpeg,['-v','error','-i',processed.file,'-ar','48000','-ac','2','-f','f32le','pipe:1']);const tail=await decodeAudioChunk(processed.file,1);
    for(let i=0;i<48000*2;i+=123)assert.ok(Math.abs(tail[i]-full.readFloatLE((8*48000*2+i)*4))<1e-6);
    const normalProgress=[],normal=await service.get(file,'normalize',undefined,{onProgress:p=>normalProgress.push(p)});assert.notEqual(normal.file,processed.file);
    assert.ok(normalProgress.some(p=>p.phase==='analysis'));assert.ok(normalProgress.some(p=>p.phase==='processing'));assert.ok(!normalProgress.some(p=>p.phase==='speech'));
    await fs.truncate(normal.file,0);await service.get(file,'normalize');assert.ok((await fs.stat(normal.file)).size>32);
    await fs.utimes(file,new Date(),new Date(Date.now()+2000));assert.notEqual((await service.get(file,'speech')).file,processed.file);
  } finally { service.close(); }
}));
test('peaky stereo audio remains within measured loudness and true-peak limits after resampling',async()=>temporary(async dir=>{
  const file=path.join(dir,'transients.wav');
  await run(ffmpeg,['-y','-v','error','-f','lavfi','-i',String.raw`aevalsrc=0.015*sin(2*PI*440*t)+if(lt(mod(t\,1)\,0.0001)\,0.85\,0)|0.015*sin(2*PI*880*t)+if(lt(mod(t\,1)\,0.0001)\,0.75\,0):s=44100:d=12`,'-c:a','pcm_s24le',file]);
  const service=createAudioProcessor(path.join(dir,'cache'));
  try{for(const mode of ['speech','normalize']){
    const output=await service.get(file,mode),measured=readLoudness(await processAudio(['-i',output.file,'-af','loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json','-f','null','-']));
    assert.ok(measured.input_tp<=-1.3,JSON.stringify({mode,output,measured}));
    assert.ok(Math.abs(measured.input_i-output.outputLufs)<.2,JSON.stringify({mode,output,measured}));
    assert.ok(Math.abs(measured.input_tp-output.peak)<.2,JSON.stringify({mode,output,measured}));
  }}finally{service.close();}
}));
test('speech refines only when isolated peaks prevent reaching target loudness',async()=>temporary(async dir=>{
  const file=path.join(dir,'extreme-levels.wav'),events=[];
  await run(ffmpeg,['-y','-v','error','-f','lavfi','-i',String.raw`aevalsrc=if(lt(mod(t\,10)\,4)\,0.025\,0.45)*sin(2*PI*420*t)|if(lt(mod(t\,10)\,4)\,0.025\,0.45)*sin(2*PI*630*t):s=48000:d=60`,'-c:a','pcm_s24le',file]);
  const service=createAudioProcessor(path.join(dir,'cache'));
  try{
    const output=await service.get(file,'speech',undefined,{duration:60,onProgress:p=>events.push(p)});
    const measured=readLoudness(await processAudio(['-i',output.file,'-af','loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json','-f','null','-']));
    assert.ok(events.some(p=>p.phase==='refining'));assert.ok(events.every((p,i)=>!i||p.progress>=events[i-1].progress));
    assert.ok(Math.abs(measured.input_i+16)<.3,JSON.stringify(measured));assert.ok(measured.input_tp<=-1.3);
  }finally{service.close();}
}));
test('shared progress survives one cancellation and immediate retry avoids the aborted job',async()=>temporary(async dir=>{
  const file=path.join(dir,'shared.wav');await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=420:sample_rate=48000:duration=30','-ac','2',file]);
  const cache=path.join(dir,'cache'),service=createAudioProcessor(cache),cancel=new AbortController(),firstProgress=[],secondProgress=[];
  let abortAt=Infinity;
  try{
    const first=service.get(file,'speech',cancel.signal,{duration:30,onProgress:p=>{
      firstProgress.push(p);if(p.phase==='speech'&&p.progress>0){abortAt=firstProgress.length;cancel.abort();}
    }});
    const rejection=assert.rejects(first,/中止/);
    const second=service.get(file,'speech',undefined,{duration:30,onProgress:p=>secondProgress.push(p)});
    await rejection;const result=await second;
    assert.equal(firstProgress.length,abortAt);assert.equal(secondProgress.at(-1).phase,'complete');assert.ok((await fs.stat(result.file)).size>32);
    const retryCancel=new AbortController();let retry;
    const aborted=service.get(file,'normalize',retryCancel.signal,{onProgress:p=>{
      if(p.phase==='analysis'&&!retry){retryCancel.abort();retry=service.get(file,'normalize',undefined,{duration:30});}
    }});
    await assert.rejects(aborted,/中止/);assert.ok(retry);await retry;
    assert.ok(!(await fs.readdir(cache)).some(name=>/partial|corrected/.test(name)));
  }finally{service.close();}
}));
test('silence, invalid settings and cancellation do not create a completed output', async () => temporary(async dir => {
  const file=path.join(dir,'silent.wav'),cache=path.join(dir,'cache');await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2',file]);
  const service=createAudioProcessor(cache);try {
    await assert.rejects(service.get(file,'speech'),/無音/);await assert.rejects(service.get(file,'unknown'),/設定/);
    const abort=new AbortController();abort.abort();await assert.rejects(service.get(file,'speech',abort.signal));
    assert.ok(!(await fs.readdir(cache)).some(f=>f.endsWith('.flac')));
  } finally {service.close();}
}));
test('enhanced and original PCM requests cannot share the same pending decode', async()=>{
  const calls=[];const reader=createAudioReader(async(file,index,signal,treatment)=>{calls.push(treatment);return new Float32Array(8);});reader.register('media://voice',{path:'voice.wav',duration:20,hasAudio:true});
  await Promise.all([reader.read('media://voice',0),reader.read('media://voice',0,'speech')]);assert.deepEqual(calls,[undefined,'speech']);await assert.rejects(reader.read('media://voice',0,'bad'),/設定/);reader.close();
});
test('export and transcription require the prepared audio and preserve source in, speed and fades',()=>{
  const file=path.resolve('source.mp4'),enhanced=path.resolve('prepared.flac');
  const c={id:'c',name:'動画',kind:'video',assetId:'a',trackId:'t',start:1,in:2,duration:3,speed:1.5,scale:1,x:0,y:0,rotation:0,opacity:1,volume:.7,exposure:0,contrast:1,saturation:1,fadeIn:.2,fadeOut:.3,audioTreatment:'speech'};
  const p={id:'p',name:'テスト',version:1,width:320,height:180,fps:30,tracks:[{id:'t',kind:'video'}],markers:[],clips:[c],assets:[{id:'a',name:'source',path:file,kind:'video',duration:12,width:320,height:180,fps:30,size:100,codec:'h264',waveform:[],hasAudio:true}]};
  assert.throws(()=>buildExport(p,{width:320,height:180,fps:30,quality:'draft'},{a:file},'out.mp4'),/音声を準備/);
  const output=buildExport(p,{width:320,height:180,fps:30,quality:'draft'},{a:file},'out.mp4',{c:enhanced}).args;assert.ok(output.includes(file)&&output.includes(enhanced));assert.match(output.join(' '),/atempo=1.5/);assert.match(output.join(' '),/volume=0.7/);
  assert.throws(()=>buildTimelineAudio(p,'out.wav'),/音声を準備/);const transcript=buildTimelineAudio(p,'out.wav',{c:enhanced});assert.ok(transcript.includes(enhanced));assert.ok(!transcript.includes(file));
  c.audioTreatment='unknown';assert.throws(()=>buildTimelineAudio(p,'out.wav'),/設定/);
});
