const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {ffmpeg,run,inspectMedia,probe}=require('../electron/media.cjs');
const {exportProject,validateProject}=require('../electron/export.cjs');
const {buildTimelineAudio,runAudio}=require('../electron/youtube.cjs');
const {volumeAt}=require('../shared/volume-automation.mjs');
const {hydrateProject}=require('../electron/project.cjs');
const {applyTransition}=require('../shared/transitions.mjs');
let directory,asset;
before(async()=>{directory=await fs.mkdtemp(path.join(os.tmpdir(),'luma-volume-'));const source=path.join(directory,'元の会話と音楽.wav');await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=8','-ac','2','-c:a','pcm_s16le',source]);asset=await inspectMedia(source,path.join(directory,'cache'));});
after(async()=>{if(directory)await fs.rm(directory,{recursive:true,force:true});});
function project(){const clip={id:'a',assetId:asset.id,trackId:'a',kind:'audio',name:'音量カーブ',start:0,in:1,duration:4,speed:1,volume:.5,fadeIn:0,fadeOut:0,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,text:'',fontSize:94,color:'#ffffff',textStyle:'hero',volumeKeyframes:[{time:0,value:1},{time:.75,value:1},{time:1.25,value:.1},{time:2.5,value:.1},{time:3,value:1},{time:4,value:1}]};return{version:1,id:'p',name:'音量カーブ',width:320,height:180,fps:30,assets:[asset],clips:[clip],tracks:[{id:'a',kind:'audio',name:'音声',locked:false,hidden:false,muted:false,solo:false}],markers:[]};}
const pcm=async file=>run(ffmpeg,['-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);
function rms(data,time,length=.02){let sum=0,count=0;for(let i=Math.round((time-length/2)*48000);i<Math.round((time+length/2)*48000)&&i*4<data.length;i++){sum+=data.readFloatLE(i*4)**2;count++;}return Math.sqrt(sum/count);}
test('MP4 and transcription samples follow the same volume curve, base volume, and timing',async()=>{
  const p=project(),original=await fs.readFile(asset.path),levels={};
  for(const [label,value]of[['curve',p],['unity',{...p,clips:[{...p.clips[0],volumeKeyframes:undefined}]}]]){
    const wav=path.join(directory,label+'.wav'),mp4=path.join(directory,label+'.mp4');await runAudio(buildTimelineAudio(value,wav));await exportProject(value,{width:320,height:180,fps:30,quality:'high',encoder:'cpu'},mp4);levels[label]={wav:await pcm(wav),mp4:await pcm(mp4)};assert.ok(Math.abs(Number((await probe(mp4)).format.duration)-4)<.04);
  }
  for(const time of [.4,1,1.7,2.75,3.5]){
    const expected=volumeAt(p.clips[0].volumeKeyframes,time);for(const format of ['wav','mp4']){const ratio=rms(levels.curve[format],time)/rms(levels.unity[format],time);assert.ok(Math.abs(ratio-expected)<.025,`${format} at ${time}: ${ratio}, expected ${expected}`);}
  }
  assert.deepEqual(await fs.readFile(asset.path),original);
});
test('full-size curves on twelve audio tracks do not exceed the Windows command line limit',async()=>{
  const p=project();p.clips=Array.from({length:12},(_,index)=>({...p.clips[0],id:'a'+index,volume:.025,duration:1,volumeKeyframes:Array.from({length:64},(_,i)=>({time:i/63,value:i%2?.2:1}))}));
  const args=buildTimelineAudio(p,path.join(directory,'many-keys.wav'));assert.ok(args.join(' ').length>32767);await runAudio(args);
  await exportProject(p,{width:320,height:180,fps:30,quality:'draft',encoder:'cpu'},path.join(directory,'many-keys.mp4'));assert.ok(rms(await pcm(path.join(directory,'many-keys.wav')),.5)>.001);
});
test('audio curves coexist with fixed-duration crossfades, handles, fades and treatment sources',async()=>{
  const p=project();p.clips=[{...p.clips[0],duration:2,volume:.3,fadeIn:.2,volumeKeyframes:[{time:0,value:1},{time:2,value:.2}]},{...p.clips[0],id:'b',start:2,duration:2,volume:.3,fadeOut:.2,volumeKeyframes:[{time:0,value:.2},{time:2,value:1}],audioTreatment:'normalize'}];
  const transitioned=applyTransition(p,'a','b',{duration:.5,audio:'constantPower'},'join'),wav=path.join(directory,'crossfade.wav'),mp4=path.join(directory,'crossfade.mp4');
  await runAudio(buildTimelineAudio(transitioned,wav,{b:asset.path}));await exportProject(transitioned,{width:320,height:180,fps:30,quality:'high',encoder:'cpu'},mp4,{audioPaths:{b:asset.path}});
  const unity={...transitioned,clips:transitioned.clips.map(c=>({...c,volumeKeyframes:undefined}))},unityWav=path.join(directory,'crossfade-unity.wav'),unityMp4=path.join(directory,'crossfade-unity.mp4');
  await runAudio(buildTimelineAudio(unity,unityWav,{b:asset.path}));await exportProject(unity,{width:320,height:180,fps:30,quality:'high',encoder:'cpu'},unityMp4,{audioPaths:{b:asset.path}});
  const expected=await pcm(wav),actual=await pcm(mp4),wavReference=await pcm(unityWav),mp4Reference=await pcm(unityMp4);
  // Compare the envelope's gain against each format's own mono/stereo baseline.
  for(const time of [.1,.7,1.8,2,2.2,3.2,3.9]){const wavGain=rms(expected,time)/rms(wavReference,time),mp4Gain=rms(actual,time)/rms(mp4Reference,time);assert.ok(Math.abs(wavGain-mp4Gain)<.025,`crossfade at ${time}: WAV ${wavGain}, MP4 ${mp4Gain}`);}
});
test('project reload preserves keys and rejects invalid, excessive, detached or silent keyframe data',async()=>{
  const p=project(),loaded=await hydrateProject(JSON.parse(JSON.stringify(p)),async()=>asset,a=>a);assert.deepEqual(loaded.clips,p.clips);
  for(const keys of [null,'expression',Array.from({length:65},(_,i)=>({time:i/30,value:1})),[{time:0,value:Infinity}],[{time:5,value:1}],[{time:0,value:1},{time:0,value:0}]])assert.throws(()=>validateProject({...p,clips:[{...p.clips[0],volumeKeyframes:keys}]}));
  assert.throws(()=>validateProject({...p,assets:[{...asset,hasAudio:false}]}));
  assert.doesNotThrow(()=>validateProject({...p,clips:[{...p.clips[0],volumeKeyframes:undefined}]}));
});

test('split mono AAC volume curves export and transcribe without reading nonexistent stereo channels',async()=>{
  const source=path.join(directory,'モノラルの会話.m4a');
  await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=8','-ac','1','-c:a','aac',source]);
  const mono=await inspectMedia(source,path.join(directory,'cache')),p=project();p.assets=[mono];
  p.clips=[{...p.clips[0],assetId:mono.id,in:0,duration:2,volumeKeyframes:[{time:0,value:.5},{time:2,value:1}]},{...p.clips[0],id:'right',assetId:mono.id,start:2,in:4,duration:2,volumeKeyframes:[{time:0,value:.5},{time:2,value:1}]}];
  const levels={};
  for(const [label,value]of [['curve',p],['unity',{...p,clips:p.clips.map(c=>({...c,volumeKeyframes:undefined}))}]]){
    const wav=path.join(directory,'mono-'+label+'.wav'),mp4=path.join(directory,'mono-'+label+'.mp4');
    await runAudio(buildTimelineAudio(value,wav));await exportProject(value,{width:320,height:180,fps:30,quality:'high',encoder:'cpu'},mp4);
    assert.ok(Math.abs(Number((await probe(mp4)).format.duration)-4)<.04);levels[label]={wav:await pcm(wav),mp4:await pcm(mp4)};
  }
  for(const time of [.4,1.4,2.4,3.4])for(const format of ['wav','mp4']){
    const expected=volumeAt(p.clips[0].volumeKeyframes,time%2),actual=rms(levels.curve[format],time)/rms(levels.unity[format],time);
    assert.ok(Math.abs(expected-actual)<.03,`${format} mono gain at ${time}: ${actual}, expected ${expected}`);
  }
});
