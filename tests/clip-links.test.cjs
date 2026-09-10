const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const { exportProject, validateProject } = require('../electron/export.cjs');
const { buildTimelineAudio, audioClips, runAudio } = require('../electron/youtube.cjs');
const { hydrateProject } = require('../electron/project.cjs');
let dir, asset;
before(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-av-'));
  const file=path.join(dir,'映像と音声.mp4');
  await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=blue:s=320x180:r=30:d=3','-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);
  asset=await inspectMedia(file,path.join(dir,'cache'));
});
after(async()=>{if(dir)await fs.rm(dir,{recursive:true,force:true});});
function project(){
  const c={id:'v',assetId:asset.id,trackId:'v',name:'映像',kind:'video',start:0,in:.5,duration:2,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:.7,fadeIn:.1,fadeOut:.2,text:'',fontSize:94,color:'#ffffff',textStyle:'hero'};
  const track={muted:false,hidden:false,locked:false,solo:false};
  return {version:1,id:'p',name:'AV',width:320,height:180,fps:30,assets:[asset],markers:[],tracks:[{...track,id:'v',kind:'video',name:'映像'},{...track,id:'a',kind:'audio',name:'音声'}],clips:[c]};
}
function detached(p){return {...p,clips:[{...p.clips[0],audioDetached:true,linkId:'link'},{...p.clips[0],id:'a',kind:'audio',trackId:'a',linkId:'link'}]};}
async function pcm(file){return run(ffmpeg,['-v','error','-i',file,'-vn','-ac','1','-ar','16000','-f','s16le','pipe:1']);}
function rms(data){let energy=0;for(let i=0;i<data.length;i+=2)energy+=data.readInt16LE(i)**2;return Math.sqrt(energy/(data.length/2));}
test('real MP4 and transcription audio retain one soundtrack after separation, muting and unlink',async()=>{
  const original=project(),separated=detached(original),before=await fs.readFile(asset.path),levels=[];
  for(const [name,p] of [['original',original],['separated',separated]]){
    const file=path.join(dir,name+'.mp4');await exportProject(p,{width:320,height:180,fps:30,quality:'draft',encoder:'cpu'},file);levels.push(rms(await pcm(file)));
    await runAudio(buildTimelineAudio(p,path.join(dir,name+'.wav')));
  }
  assert.ok(Math.abs(levels[0]-levels[1])<2,JSON.stringify(levels));assert.deepEqual(await fs.readFile(path.join(dir,'original.wav')),await fs.readFile(path.join(dir,'separated.wav')));assert.equal(audioClips(separated).length,1);
  const muted={...separated,clips:separated.clips.map(c=>c.kind==='audio'?{...c,audioMuted:true}:c)};assert.equal(audioClips(muted).length,0);assert.throws(()=>buildTimelineAudio(muted,'unused.wav'),/音声/);
  const silent={...separated,clips:[{...separated.clips[0],linkId:undefined}]},output=path.join(dir,'video-only.mp4');await exportProject(silent,{width:320,height:180,fps:30,quality:'draft',encoder:'cpu'},output);assert.equal(rms(await pcm(output)),0);assert.deepEqual(await fs.readFile(asset.path),before);
});
test('persistence retains source-sharing links and rejects malformed types, mismatched pairs and silent substitutes',async()=>{
  const p=detached(project());assert.doesNotThrow(()=>validateProject(p));const hydrated=await hydrateProject(JSON.parse(JSON.stringify(p)),async()=>asset,a=>a);assert.equal(hydrated.assets[0].offline,undefined);assert.deepEqual(hydrated.clips,p.clips);
  for(const change of [c=>({...c,start:1}),c=>({...c,linkId:''}),c=>({...c,audioDetached:true}),c=>({...c,audioMuted:'yes'})])assert.throws(()=>validateProject({...p,clips:[p.clips[0],change(p.clips[1])]}));
  assert.throws(()=>validateProject({...p,clips:p.clips.slice(0,1)}));assert.throws(()=>validateProject({...p,assets:[{...asset,hasAudio:false}]}));assert.throws(()=>validateProject({...p,clips:[{...p.clips[0],audioTreatment:'speech'},p.clips[1]]}));
  assert.doesNotThrow(()=>validateProject(project()));
});
