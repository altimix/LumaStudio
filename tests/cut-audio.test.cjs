const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ffmpeg,run}=require('../electron/media.cjs');
const {clipAudioFilter}=require('../electron/audio-render.cjs');
const {audioFixture}=require('./helpers/audio.cjs');

test('30 FPS continuous audio cuts preserve every PCM sample including fractional milliseconds',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-cut-audio-'));
 try{
  const file=path.join(dir,'元音声.wav'),reference=await audioFixture(file,1);
  const args=['-v','error'],filters=[],labels=[];
  for(let i=0;i<3;i++){
   const start=i/30,end=(i===2?1:(i+1)/30),duration=end-start;
   args.push('-ss',String(start),'-t',String(duration),'-i',file);
   filters.push(clipAudioFilter({start,duration,speed:1,volume:1,fadeIn:0,fadeOut:0},i));labels.push(`[a${i}]`);
  }
  filters.push(`${labels.join('')}amix=inputs=3:normalize=0:dropout_transition=0[out]`);
  const bytes=await run(ffmpeg,[...args,'-filter_complex',filters.join(';'),'-map','[out]','-ac','2','-ar','48000','-f','f32le','pipe:1']);
  assert.equal(bytes.length,reference.byteLength);
  let peak=0;for(let i=0;i<reference.length;i++)peak=Math.max(peak,Math.abs(bytes.readFloatLE(i*4)-reference[i]));
  assert.ok(peak<1e-6,`PCM peak error ${peak}`);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('export AAC pre-roll discards decoder startup noise at a packet-aligned cut',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-cut-aac-'));
 try{
  const file=path.join(dir,'音声.m4a'),wav=path.join(dir,'音声.wav');await audioFixture(wav,10);
  await run(ffmpeg,['-v','error','-i',wav,'-c:a','aac','-b:a','192k',file]);
  const ref=await run(ffmpeg,['-v','error','-i',file,'-af','aresample=48000:async=1:first_pts=0','-ac','2','-ar','48000','-f','f32le','pipe:1']);
  const filter=clipAudioFilter({start:0,duration:1,speed:1,volume:1,fadeIn:0,fadeOut:0},0,[],{start:0,duration:1},1);
  const result=await run(ffmpeg,['-v','error','-ss','7','-t','2','-i',file,'-filter_complex',filter,'-map','[a0]','-ac','2','-ar','48000','-f','f32le','pipe:1']);
  assert.equal(result.length,48000*2*4);
  let peak=0;for(let i=0;i<result.length;i+=4)peak=Math.max(peak,Math.abs(result.readFloatLE(i)-ref.readFloatLE(8*48000*2*4+i)));
  assert.ok(peak<1e-4,`AAC startup peak error ${peak}`);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
