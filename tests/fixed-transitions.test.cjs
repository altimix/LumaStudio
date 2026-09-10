const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {ffmpeg,run,inspectMedia,probe}=require('../electron/media.cjs'),{exportProject}=require('../electron/export.cjs');
const {applyTransition,visualSourceTime,transitionPlan}=require('../shared/transitions.mjs'),{blendTransition}=require('../shared/video-transitions.mjs');
const {buildTimelineAudio}=require('../electron/youtube.cjs');
let dir,asset;const w=320,h=180,fps=20;
before(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-fixed-'));const file=path.join(dir,'moving.mp4');await run(ffmpeg,['-v','error','-y','-f','lavfi','-i',`testsrc2=s=${w}x${h}:r=${fps}:d=3`,'-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);asset=await inspectMedia(file,path.join(dir,'cache'));});
after(async()=>{if(dir)await fs.rm(dir,{recursive:true,force:true});});
function project(speed=1,hasHandles=false){const c={id:'a',assetId:asset.id,trackId:'v',name:'motion',kind:'video',start:0,in:hasHandles?.5:0,duration:(hasHandles?2:3)/speed,speed,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'',fontSize:94,color:'#ffffff',textStyle:'hero'};return {version:1,id:'p',name:'Fixed transitions',width:w,height:h,fps,assets:[asset],markers:[{id:'m',time:c.duration+1,label:'固定'}],tracks:[{id:'v',name:'video',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[c,{...c,id:'b',start:c.duration}]};}
const rgba=async(file,time)=>run(ffmpeg,['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1']);
for(const speed of [.5,1,2])test(`freeze handles retain moving endpoint frames and duration at ${speed}x`,async()=>{
  const p=project(speed),cut=p.clips[1].start,next=applyTransition(p,'a','b',{duration:.6,video:'dissolve',autoAudio:true},'t');assert.strictEqual(next.clips,p.clips);assert.deepEqual(next.markers,p.markers);
  const file=path.join(dir,'fixed-'+speed+'.mp4');await exportProject(next,{width:w,height:h,fps,quality:'high',encoder:'cpu'},file);assert.ok(Math.abs(Number((await probe(file)).format.duration)-p.clips[1].start-p.clips[1].duration)<1/fps);
  const pair=transitionPlan(next)[0];for(const time of [cut-.2,cut+.15]){
    const a=await rgba(asset.path,visualSourceTime(p.clips[0],asset,time)),b=await rgba(asset.path,visualSourceTime(p.clips[1],asset,time)),actual=await rgba(file,time),expected=new Uint8ClampedArray(a.length);blendTransition('dissolve',a,b,expected,w,h,(time-pair.start)/pair.duration);
    assert.equal(actual.length,expected.length);let difference=0;for(let i=0;i<actual.length;i++)difference+=Math.abs(actual[i]-expected[i]);assert.ok(difference/actual.length<5,`${speed}x at ${time}: ${difference/actual.length}`);
  }
});
test('available handles keep moving instead of freezing and audio analysis uses the same interval',async()=>{
  const p=project(1,true),next=applyTransition(p,'a','b',{duration:.6,video:'dissolve',audio:'constantPower'},'t'),file=path.join(dir,'handles.mp4');await exportProject(next,{width:w,height:h,fps,quality:'high',encoder:'cpu'},file);
  const time=2.15,pair=transitionPlan(next)[0],a=await rgba(asset.path,2.65),b=await rgba(asset.path,.65),actual=await rgba(file,time),expected=new Uint8ClampedArray(a.length);blendTransition('dissolve',a,b,expected,w,h,(time-pair.start)/pair.duration);let difference=0;for(let i=0;i<actual.length;i++)difference+=Math.abs(actual[i]-expected[i]);assert.ok(difference/actual.length<5);
  const wav=path.join(dir,'analysis.wav');await run(ffmpeg,buildTimelineAudio(next,wav));assert.ok(Math.abs(Number((await probe(wav)).format.duration)-4)<.001);
  const pcm=await run(ffmpeg,['-v','error','-i',wav,'-f','f32le','-ac','1','-ar','16000','pipe:1']);let energy=0;for(let i=1.8*16000;i<2.2*16000;i++)energy+=pcm.readFloatLE(i*4)**2;assert.ok(energy/6400>.003);
});
