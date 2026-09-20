const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {ffmpeg,run,inspectMedia}=require('../electron/media.cjs');
const {exportProject,validateProject}=require('../electron/export.cjs');
const {setVisualKey,visualClipAt}=require('../shared/visual-keyframes.mjs');
const {DEFAULT_CHROMA_KEY}=require('../shared/chroma-key.mjs');
const {createTitleFrameBroker,pngFrame}=require('../electron/frame-sequence.cjs');
let dir,asset,red,blue;
before(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-visual-keys-'));
  const file=path.join(dir,'色付き素材.png');
  await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=0x4060a0:s=128x128','-frames:v','1',file]);
  asset=await inspectMedia(file,path.join(dir,'cache'));
  red=await run(ffmpeg,['-v','error','-f','lavfi','-i','color=c=red:s=128x128','-frames:v','1','-c:v','png','-f','image2pipe','pipe:1']);
  blue=await run(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=128x128','-frames:v','1','-c:v','png','-f','image2pipe','pipe:1']);
});
after(async()=>{if(dir)await fs.rm(dir,{recursive:true,force:true});});
const settings={width:128,height:128,fps:10,quality:'high',encoder:'cpu'};
function project(patch={}){
  return {version:1,id:'p',name:'キーフレーム',width:128,height:128,fps:10,assets:[asset],markers:[],tracks:[{id:'v',kind:'video'}],clips:[{id:'c',assetId:asset.id,trackId:'v',kind:'image',name:'画像',start:0,in:0,duration:1.2,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'日本語',fontSize:40,color:'#ffffff',textStyle:'minimal',...patch}]};
}
async function pixels(file,time){return run(ffmpeg,['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);}
const pixel=(bytes,x,y)=>[...bytes.subarray((y*128+x)*3,(y*128+x)*3+3)];
const close=(a,b,tolerance=8)=>a.forEach((value,index)=>assert.ok(Math.abs(value-b[index])<=tolerance,`${a} differs from ${b}`));
async function render(name,p,options){const output=path.join(dir,`${name}.mp4`);await exportProject(p,settings,output,options);return output;}

test('common position, scale and opacity animate at the expected MP4 frames',async()=>{
  const p=project({scale:.25,x:-25});p.clips[0]=setVisualKey(setVisualKey(p.clips[0],0),1,{x:25,scale:.5,opacity:.5});
  const out=await render('transform',p),start=await pixels(out,0),middle=await pixels(out,.5),end=await pixels(out,1);
  assert.ok(pixel(start,32,64)[2]>130);assert.ok(pixel(start,64,64)[2]<8);
  assert.ok(pixel(middle,64,64)[2]>95);assert.ok(pixel(middle,32,64)[2]<8);
  close(pixel(end,96,64),pixel(start,32,64).map(value=>value*.5));assert.ok(pixel(end,40,64)[2]<8);
});
test('rotation and negative placement retain transparent outside bounds',async()=>{
  const p=project({scale:.3,crop:{top:.3,bottom:.3,left:0,right:0}});p.clips[0]=setVisualKey(setVisualKey(p.clips[0],0),1,{rotation:90,x:-40});
  const out=await render('rotation',p),start=await pixels(out,0),end=await pixels(out,1);
  assert.ok(pixel(start,78,64)[2]>100);assert.ok(pixel(start,64,78)[2]<10);
  assert.ok(pixel(end,13,78)[2]>100);assert.ok(pixel(end,28,64)[2]<10);
});
test('animated zooms retain the same fine source detail as static image and video transforms',async()=>{
  const source=path.join(dir,'細線.ppm'),width=256,height=128,rgb=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgb.fill(x%2?235:20,(y*width+x)*3,(y*width+x+1)*3);
  await fs.writeFile(source,Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),rgb]));
  for(const kind of ['image','video']){
    const file=path.join(dir,kind==='image'?'fine-detail.png':'fine-detail.mkv');
    await run(ffmpeg,['-v','error','-y','-loop','1','-framerate','10','-i',source,...(kind==='image'?['-frames:v','1']:['-t','1.2','-c:v','ffv1','-pix_fmt','gbrp']),file]);
    const sourceAsset=await inspectMedia(file,path.join(dir,'cache'));
    for(const [label,transform,start] of [['zoom',{scale:2,rotation:0},{scale:1}],['rotate',{scale:2,rotation:90},{scale:2,rotation:0}],['move',{scale:2,rotation:0,x:25,y:-25},{scale:2,x:-25,y:25}]]){
      const still=project({assetId:sourceAsset.id,kind,...transform,volume:0});still.assets=[sourceAsset];
      const animated=structuredClone(still);animated.clips[0]=setVisualKey(setVisualKey(animated.clips[0],0,start),1,transform);
      const staticFrame=await pixels(await render(`detail-static-${kind}-${label}`,still),1);
      const movingFrame=await pixels(await render(`detail-moving-${kind}-${label}`,animated),1);
      let error=0,count=0;
      for(let y=16;y<112;y++)for(let x=16;x<112;x++)for(let c=0;c<3;c++){error+=Math.abs(staticFrame[(y*128+x)*3+c]-movingFrame[(y*128+x)*3+c]);count++;}
      assert.ok(error/count<8,`${kind} ${label}: animated/static mean pixel difference ${error/count}`);
    }
  }
});
test('RGB exposure, contrast and saturation use the same smooth appearance',async()=>{
  const p=project();p.clips[0]=setVisualKey(setVisualKey(p.clips[0],0),1,{exposure:1,contrast:.7,saturation:0});
  const out=await render('color',p),start=pixel(await pixels(out,0),64,64),middle=pixel(await pixels(out,.5),64,64),end=pixel(await pixels(out,1),64,64);
  assert.ok(start[2]-start[0]>70);assert.ok(middle[2]-middle[0]>25);assert.ok(Math.max(...end)-Math.min(...end)<5);assert.ok(end[0]>start[0]+60);
});
test('mask motion, crop and disabled effects stay synchronized with their frame stream',async()=>{
  const mask={type:'rectangle',x:.25,y:.5,width:.25,height:.5,feather:0,inverted:false},p=project({videoMask:mask});
  p.clips[0]=setVisualKey(setVisualKey(setVisualKey(p.clips[0],0),.8,{videoMask:{...mask,x:.75}}),1,{videoMask:undefined,crop:{left:.5,right:0,top:0,bottom:0}});
  const out=await render('mask',p);
  for(const [time,x]of [[0,32],[.4,64],[.8,96]]){const image=await pixels(out,time);assert.ok(pixel(image,x,64)[2]>120);assert.ok(pixel(image,x===32?96:32,64)[2]<10);}
  const image=await pixels(out,1);assert.ok(pixel(image,32,64)[2]<10);assert.ok(pixel(image,96,20)[2]>120);
});
test('chroma properties and on-off switches apply to source pixels',async()=>{
  const p=project({chromaKey:{...DEFAULT_CHROMA_KEY,color:'#4060a0',greenSpill:0,blueSpill:0}});
  p.clips[0]=setVisualKey(setVisualKey(p.clips[0],0),1,{chromaKey:undefined});
  const out=await render('chroma',p);assert.ok(pixel(await pixels(out,.9),64,64)[2]<8);assert.ok(pixel(await pixels(out,1),64,64)[2]>120);
});
test('animated title frames are streamed at export FPS and honor clip placement',async()=>{
  const p=project({kind:'title',assetId:undefined,start:.2,scale:.5});p.clips[0]=setVisualKey(setVisualKey(p.clips[0],0),1,{fontSize:80,color:'#0000ff'});
  const times=[],out=await render('title',p,{titleFrameProvider:async(c,time,width,height)=>{times.push(time);assert.equal(width,128);assert.equal(height,128);return time<.5?red:blue;}});
  assert.equal(times.length,12);assert.equal(times[5],.5);assert.ok(pixel(await pixels(out,0),64,64)[0]<10);
  assert.ok(pixel(await pixels(out,.2),64,64)[0]>200);assert.ok(pixel(await pixels(out,.7),64,64)[2]>200);
  assert.ok(pixel(await pixels(out,.7),8,8)[2]<10);
});
test('canceling frame preparation preserves the prior output and removes temporary output',async()=>{
  const p=project({kind:'title',assetId:undefined}),controller=new AbortController();p.clips[0]=setVisualKey(setVisualKey(p.clips[0],0),1,{fontSize:80});
  const output=path.join(dir,'existing.mp4');await fs.writeFile(output,'original');
  await assert.rejects(exportProject(p,settings,output,{signal:controller.signal,titleFrameProvider:async()=>{controller.abort();return red;}}),/キャンセル/);
  assert.equal(await fs.readFile(output,'utf8'),'original');assert.equal((await fs.readdir(dir)).filter(name=>name.startsWith('.luma-')).length,0);
});
test('invalid export frame rates fail before requesting any animated frames',async()=>{
  const p=project({kind:'title',assetId:undefined});p.clips[0]=setVisualKey(setVisualKey(p.clips[0],0),1,{fontSize:80});let requested=false;
  for(const fps of [0,Infinity,NaN,100000,.5])await assert.rejects(exportProject(p,{...settings,fps},path.join(dir,'invalid.mp4'),{titleFrameProvider:()=>{requested=true;return red;}}),/FPS/);
  assert.equal(requested,false);
});
test('frame IPC rejects stale IDs, wrong dimensions and canceled requests',async()=>{
  let request;const broker=createTitleFrameBroker(value=>{request=value;});
  const pending=broker.request(project().clips[0],0,128,128,128);
  assert.equal(broker.finish('stale',red),false);
  const data='data:image/png;base64,'+red.toString('base64');assert.equal(broker.finish(request.id,data),true);assert.deepEqual(await pending,red);
  const wrong=broker.request(project().clips[0],0,256,128,128);broker.finish(request.id,data);await assert.rejects(wrong,/サイズ/);
  const controller=new AbortController(),canceled=broker.request(project().clips[0],0,128,128,128,controller.signal);controller.abort();await assert.rejects(canceled,/キャンセル/);
  assert.equal(broker.finish(request.id,data),false);assert.throws(()=>pngFrame('not-png',128,128),/不正/);
});
test('save validation checks every visual point, including text boxes and effect payloads',()=>{
  const p=project({kind:'title',assetId:undefined});p.clips[0]=setVisualKey(p.clips[0],0);
  p.clips[0].visualKeyframes[0].values.textBox={width:-1,height:100};assert.throws(()=>validateProject(p),/テキスト/);
  delete p.clips[0].visualKeyframes[0].values.textBox;p.clips[0].visualKeyframes[0].values.textShadow='yes';assert.throws(()=>validateProject(p));
});
