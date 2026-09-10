const { test }=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {spawn}=require('node:child_process');const {EventEmitter}=require('node:events');
const {ENCODERS,encodingArgs,createEncoderDetector,exportEncoders}=require('../electron/encoders.cjs');
const {exportProject}=require('../electron/export.cjs');const {ffmpeg,run,probe,inspectMedia}=require('../electron/media.cjs');
test('GPU detection executes a real probe, deduplicates it and falls back to CPU when none initialize',async()=>{
  const calls=[];const detector=createEncoderDetector(async id=>{calls.push(id);throw Error('not installed');});
  const results=await Promise.all([detector.detect(),detector.detect(),detector.detect()]);assert.equal(calls.length,3);assert.equal(results[0].recommended,'cpu');
  assert.equal((await detector.resolve('auto')).id,'cpu');assert.equal(calls.length,3);
  await assert.rejects(detector.resolve('nvenc'),/CPU/);await assert.rejects(detector.resolve('external-codec'),/方式/);
  await detector.detect(true);assert.equal(calls.length,6);
  for(const id of ['nvenc','qsv','amf','cpu'])for(const quality of ['draft','standard','high'])assert.equal(encodingArgs(id,quality)[1],ENCODERS.find(e=>e.id===id).codec);
  assert.throws(()=>encodingArgs('auto'));assert.throws(()=>encodingArgs('cpu','unsafe'));
  assert.ok(encodingArgs('qsv').includes('-global_quality:v'));assert.ok(!encodingArgs('qsv').includes('-global_quality'));
});
function project(asset){const clip={id:'clip',assetId:asset.id,trackId:'v',kind:'video',name:asset.name,start:0,in:0,duration:1,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:.8,fadeIn:0,fadeOut:0,text:'',fontSize:94,color:'#ffffff',textStyle:'hero'};return{version:1,id:'gpu',name:'GPU確認',width:320,height:180,fps:30,assets:[asset],markers:[],tracks:[{id:'v',name:'映像',kind:'video',locked:false,hidden:false,muted:false,solo:false}],clips:[clip]};}
test('actual available encoders produce H264/AAC with matching duration, video and audio',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-gpu-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const input=path.join(dir,'音声付き映像.mp4');await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',input]);
  const p=project(await inspectMedia(input,path.join(dir,'cache'))),capabilities=await exportEncoders.detect();let cpuPixels,cpuAudio;
  for(const id of ['cpu',...capabilities.encoders.filter(e=>e.id!=='cpu'&&e.available).map(e=>e.id)]){
    const file=path.join(dir,id+'.mp4'),events=[];await exportProject(p,{width:320,height:180,fps:30,quality:'standard',encoder:id},file,{onProgress:e=>events.push(e)});
    const info=await probe(file);assert.equal(info.streams.find(s=>s.codec_type==='video').codec_name,'h264');assert.equal(info.streams.find(s=>s.codec_type==='audio').codec_name,'aac');assert.ok(Math.abs(Number(info.format.duration)-1)<.06);assert.equal(events.at(-1).encoder,id);
    const pixels=await run(ffmpeg,['-v','error','-ss','0.5','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
    const audio=await run(ffmpeg,['-v','error','-i',file,'-vn','-f','f32le','pipe:1']);
    if(id==='cpu'){cpuPixels=pixels;cpuAudio=audio;}else{
      let difference=0;for(let i=0;i<pixels.length;i++)difference+=Math.abs(pixels[i]-cpuPixels[i]);assert.ok(difference/pixels.length<6,`${id} video difference`);
      assert.equal(audio.length,cpuAudio.length);let cross=0,power=0,reference=0;
      for(let i=0;i<audio.length;i+=4){const a=audio.readFloatLE(i),b=cpuAudio.readFloatLE(i);cross+=a*b;power+=a*a;reference+=b*b;}
      assert.ok(cross/Math.sqrt(power*reference)>.995,`${id} audio correlation`);assert.ok(Math.abs(Math.sqrt(power/reference)-1)<.02,`${id} audio gain`);
    }
  }
});
test('automatic GPU failure restarts safely on CPU; explicit failure and cancellation preserve the old output',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-gpu-fallback-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const input=path.join(dir,'素材.mp4');await run(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=1','-c:v','libx264','-y',input]);const p=project(await inspectMedia(input,path.join(dir,'cache')));
  const output=path.join(dir,'既存の出力.mp4'),original=Buffer.from('keep this original output'),settings={width:320,height:180,fps:30,quality:'draft',encoder:'auto'};
  const encoders={resolve:async()=>ENCODERS.find(e=>e.id==='nvenc')};let cpuStarts=0,gpuError='[h264_nvenc @ 123] OpenEncodeSessionEx failed: GPU unavailable';
  const spawnProcess=(binary,args,options)=>{
    if(args.includes('libx264')){cpuStarts++;return spawn(binary,args,options);}
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    void fs.writeFile(args.at(-1),'incomplete GPU output').then(()=>{child.stderr.emit('data',Buffer.from(gpuError));child.emit('close',1);});return child;
  };
  const progress=[];await fs.writeFile(output,original);await exportProject(p,settings,output,{encoders,spawnProcess,onProgress:e=>progress.push(e)});assert.equal(cpuStarts,1);assert.equal(progress.at(-1).encoder,'cpu');assert.match(progress.at(-1).warning,/CPU/);assert.equal((await probe(output)).streams[0].codec_name,'h264');
  await fs.writeFile(output,original);await assert.rejects(exportProject(p,{...settings,encoder:'nvenc'},output,{encoders,spawnProcess}),/OpenEncodeSessionEx failed/);assert.deepEqual(await fs.readFile(output),original);
  const controller=new AbortController();cpuStarts=0;await assert.rejects(exportProject(p,settings,output,{encoders,spawnProcess,signal:controller.signal,onProgress:e=>{if(e.status==='rendering')controller.abort();}}),/キャンセル/);assert.equal(cpuStarts,0);assert.deepEqual(await fs.readFile(output),original);
  for(const message of ['[out#0/mp4 @ 1] Error writing trailer: No space left on device','[vost#0:0/h264_nvenc @ 1] Error submitting a packet to the muxer: No space left on device','[vost#0:0/h264_qsv @ 1] Error submitting a packet to the muxer: I/O error','[Parsed_scale_0 @ 1] Failed to configure output pad','Invalid data found when processing input']){gpuError=message;cpuStarts=0;await assert.rejects(exportProject(p,settings,output,{encoders,spawnProcess}),error=>error.message===message);assert.equal(cpuStarts,0);assert.deepEqual(await fs.readFile(output),original);}
  assert.ok(!(await fs.readdir(dir)).some(f=>f.startsWith('.luma-')));
});

test('canceling an export rejects promptly while the shared detector is still pending',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-gpu-cancel-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const input=path.join(dir,'clip.mp4');await run(ffmpeg,['-v','error','-f','lavfi','-i','color=blue:s=320x180:r=30:d=1','-c:v','libx264','-y',input]);const p=project(await inspectMedia(input,path.join(dir,'cache'))),controller=new AbortController();let finish;
  const encoders={resolve:()=>new Promise(resolve=>{finish=resolve;})};const output=path.join(dir,'keep.mp4');await fs.writeFile(output,'original');
  const pending=exportProject(p,{width:320,height:180,fps:30,encoder:'auto'},output,{encoders,signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));controller.abort();
  let timer;await assert.rejects(Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cancel timeout')),250);})]),/キャンセル/);clearTimeout(timer);assert.equal(await fs.readFile(output,'utf8'),'original');finish(ENCODERS[0]);
});

test('CPU fallback is limited to hardware encoder diagnostics',()=>{const {isEncoderFailure}=require('../electron/export.cjs');for(const message of ['[h264_nvenc @ 123] Cannot load nvcuda.dll','[h264_qsv @ 1] Error initializing an internal MFX session','[h264_amf @ 1] CreateComponent failed'])assert.equal(isEncoderFailure(Error(message)),true);for(const message of ['Permission denied','[out#0/mp4 @ 1] Error writing trailer: No space left on device','[vost#0:0/h264_nvenc @ 1] Error submitting a packet to the muxer: No space left on device','[vost#0:0/h264_qsv @ 1] Error submitting a packet to the muxer: I/O error','[Parsed_scale_0 @ 1] Failed to configure output pad','Invalid data found when processing input'])assert.equal(isEncoderFailure(Error(message)),false);});
