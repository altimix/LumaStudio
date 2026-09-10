const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ffmpeg, run, probe, inspectMedia } = require('../electron/media.cjs');
const { exportProject, validateProject } = require('../electron/export.cjs');
let dir, asset, titlePNG;
before(async()=>{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-tests-'));
 const input=path.join(dir,'映像 [test] & space.mp4');
 await run(ffmpeg,['-y','-f','lavfi','-i','color=c=blue:s=320x180:r=10:d=2','-f','lavfi','-i','sine=frequency=440:duration=2:sample_rate=48000','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',input]);
 asset=await inspectMedia(input,path.join(dir,'cache'));
 titlePNG='data:image/png;base64,'+(await run(ffmpeg,['-f','lavfi','-i','color=c=red:s=320x180','-frames:v','1','-c:v','png','-f','image2pipe','pipe:1'])).toString('base64');
});
after(async()=>{if(dir)await fs.rm(dir,{recursive:true,force:true});});
function project(){
 const clip={id:'c1',assetId:asset.id,trackId:'v1',name:'blue',kind:'video',start:0,in:0,duration:1,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:0.8,fadeIn:0,fadeOut:0,text:'',fontSize:94,color:'#ffffff',textStyle:'hero'};
 return {version:1,id:'p',name:'Export test',width:320,height:180,fps:10,assets:[asset],markers:[],tracks:[{id:'v2',name:'title',kind:'video',muted:false,hidden:false,locked:false,solo:false},{id:'v1',name:'video',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[clip,{...clip,id:'c2',start:1.5,duration:1,speed:2},{...clip,id:'title',assetId:undefined,trackId:'v2',kind:'title',start:0.2,duration:0.5}]};
}
const settings={width:320,height:180,fps:10,quality:'draft'};
test('long source durations survive project validation without minute, hour or week caps', () => {
 const p=project();p.assets=[{...asset,duration:9*86400}];p.clips=[{...p.clips[0],start:13*3600,in:86400,duration:8*86400}];p.markers=[{id:'long',label:'long',time:13*3600}];
 assert.equal(validateProject(p),p);
 for(const value of [NaN,Infinity,-1]) { assert.throws(()=>validateProject({...p,assets:[{...p.assets[0],duration:value}]})); }
});
async function pixel(file,time){return [...await run(ffmpeg,['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])];}
async function rms(file,time){const b=await run(ffmpeg,['-v','error','-ss',String(time),'-i',file,'-t','0.1','-vn','-f','f32le','-ac','1','pipe:1']);let sum=0;for(let i=0;i<b.length;i+=4)sum+=b.readFloatLE(i)**2;return Math.sqrt(sum/(b.length/4));}
test('imports real metadata, thumbnail and waveform with Japanese file paths',()=>{assert.equal(asset.kind,'video');assert.equal(asset.width,320);assert.ok(asset.hasAudio);assert.equal(asset.waveform.length,2048);assert.ok(asset.duration>=2);});
test('renders layer order, titles, a black/silent gap, speed changes, H.264 and AAC',async()=>{
 const p=project();const output=path.join(dir,'書き出し.mp4');const progress=[];
 await exportProject(p,settings,output,{titleImages:{title:titlePNG},onProgress:x=>progress.push(x)});
 const info=await probe(output);assert.equal(info.streams.find(s=>s.codec_type==='video').codec_name,'h264');assert.equal(info.streams.find(s=>s.codec_type==='audio').codec_name,'aac');assert.ok(Math.abs(Number(info.format.duration)-2.5)<0.12);
 const red=await pixel(output,0.4);assert.ok(red[0]>200&&red[2]<30,`title pixel ${red}`);
 const gap=await pixel(output,1.2);assert.ok(gap.every(c=>c<12),`gap pixel ${gap}`);
 const blue=await pixel(output,1.9);assert.ok(blue[2]>180&&blue[0]<30,`video pixel ${blue}`);
 assert.ok(await rms(output,0.1)>0.02);assert.ok(await rms(output,1.2)<0.005);assert.ok(await rms(output,1.8)>0.02);
 assert.equal(progress.at(-1).status,'complete');assert.equal(progress.at(-1).progress,1);
});
test('respects track visibility, mute, opacity and frame transforms',async()=>{
 const p=project();p.tracks[0].hidden=true;p.tracks[1].muted=true;p.clips[0].scale=0.6;p.clips[0].rotation=30;p.clips[0].opacity=0.5;
 const out=path.join(dir,'transform.mp4');await exportProject(p,settings,out,{titleImages:{title:titlePNG}});
 const rgb=await pixel(out,0.4);assert.ok(rgb[2]>10&&rgb[2]<140&&rgb[0]<25,`transformed average ${rgb}`);assert.ok(await rms(out,0.2)<0.005);
});
test('cancels without overwriting an existing file or leaving partial output',async()=>{
 const output=path.join(dir,'keep.mp4');await fs.writeFile(output,'existing-user-content');const controller=new AbortController();controller.abort();
 await assert.rejects(exportProject(project(),settings,output,{titleImages:{title:titlePNG},signal:controller.signal}),/キャンセル/);
 assert.equal(await fs.readFile(output,'utf8'),'existing-user-content');assert.ok(!(await fs.readdir(dir)).some(n=>n.startsWith('.luma-')));
});
test('rejects corrupt project values and out-of-bounds source ranges',()=>{const p=project();p.clips[0].speed=NaN;assert.throws(()=>validateProject(p),/速度/);p.clips[0].speed=1;p.clips[0].in=20;assert.throws(()=>validateProject(p),/素材の長さ/);});
test('rejects text box metadata on video, audio and image clips at the native boundary',()=>{
 for(const kind of ['video','audio','image']){
  const p=project();p.assets=[{...asset,kind}];p.clips=[{...p.clips[0],kind,textBox:{width:200,height:100}}];
  assert.throws(()=>validateProject(p),/テキスト枠/);
 }
});

test('rejects network URLs and relative asset paths before FFmpeg can open them',()=>{
 const p=project();p.assets=[{...asset,path:'https://example.invalid/media.mp4'}];
 assert.throws(()=>validateProject(p),/絶対パス/);
 p.assets[0].path='relative.mp4';assert.throws(()=>validateProject(p),/絶対パス/);
});

test('rejects malformed offline waveform and persisted metadata before hydration',()=>{
 for(const waveform of [undefined,null,{},'bad',[NaN],[Infinity],[-1],[2]]) {
  const p=project();p.assets=[{...asset,path:path.join(dir,'missing.mp4'),waveform}];
  assert.throws(()=>validateProject(p),/波形データ/);
 }
 for(const patch of [{hasAudio:'yes'},{codec:123},{width:NaN},{height:null},{fps:'30'},{size:-1}]) {
  const p=project();p.assets=[{...asset,...patch}];assert.throws(()=>validateProject(p));
 }
});

test('refuses an offline source even if a replacement exists at the saved path',async()=>{
 const p=project();p.assets=[{...asset,offline:true}];const output=path.join(dir,'offline.mp4');
 await assert.rejects(exportProject(p,settings,output,{titleImages:{title:titlePNG}}),/再リンク/);
 await assert.rejects(fs.access(output));
});

test('renders animated title opacity at local clip time and multiplies fades',async()=>{
 const p=project();p.clips=[{...p.clips[0],duration:2},{...p.clips[2],start:0.2,duration:1.5,opacity:0.3,opacityKeyframes:[{time:0,value:0},{time:0.5,value:1},{time:1.5,value:0}]}];
 for(const fadeIn of [0,0.5]) {
  p.clips[1].fadeIn=fadeIn;const out=path.join(dir,`keyframes-${fadeIn}.mp4`);
  await exportProject(p,settings,out,{titleImages:{title:titlePNG}});
  for(const [t,alpha] of [[0.2,0],[0.4,fadeIn?0.16:0.4],[0.7,1],[1.2,0.5]]) {
   const rgb=await pixel(out,t);
   assert.ok(Math.abs(rgb[0]-255*alpha)<12,`red at ${t}s fade=${fadeIn}: ${rgb}`);
   assert.ok(Math.abs(rgb[2]-255*(1-alpha))<12,`blue at ${t}s fade=${fadeIn}: ${rgb}`);
  }
 }
});

test('rejects malformed, excessive, unsorted and non-title opacity keys',()=>{
 for(const keys of [null,{},[{time:NaN,value:0}],[{time:-1,value:0}],[{time:1,value:0}],[{time:0,value:2}],[{time:0,value:Infinity}],[{time:0.2,value:0},{time:0.2,value:1}],[{time:0.2,value:0},{time:0.1,value:1}],Array.from({length:65},(_,i)=>({time:i/200,value:1}))]) {
  const p=project();p.clips[2].opacityKeyframes=keys;assert.throws(()=>validateProject(p),/キーフレーム/);
 }
 const p=project();p.clips[0].opacityKeyframes=[{time:0,value:1}];assert.throws(()=>validateProject(p),/テロップ/);
});

test('animated GIFs have the same fixed first frame in preview and at every exported time', async () => {
  const file = path.join(dir, 'animated.gif');
  await run(ffmpeg, ['-v','error','-f','lavfi','-i','color=red:s=320x180:r=10:d=0.5','-f','lavfi','-i','color=blue:s=320x180:r=10:d=0.5','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0','-loop','0',file]);
  const image = await inspectMedia(file, path.join(dir, 'image-cache'));
  assert.equal(image.kind, 'image'); assert.match(image.playbackPath, /\.png$/);
  const p = project(); p.assets = [image]; p.clips = [{ ...p.clips[0], assetId: image.id, kind: 'image', duration: 2 }];
  const output = path.join(dir, 'frozen-image.mp4');
  await exportProject(p, settings, output);
  const pixel = async (source, time) => [...await run(ffmpeg, ['-v','error', ...(time === undefined ? [] : ['-ss', String(time)]), '-i',source,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])];
  const preview = await pixel(image.playbackPath);
  for (const time of [0, 0.7, 1.5]) {
    const rendered = await pixel(output, time);
    assert.ok(rendered.every((value, i) => Math.abs(value - preview[i]) < 8), `${time}: ${rendered} vs ${preview}`);
  }
});
