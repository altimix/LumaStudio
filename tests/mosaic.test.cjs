const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {ffmpeg,run,inspectMedia}=require('../electron/media.cjs');
const {exportProject,validateProject}=require('../electron/export.cjs');
const {DEFAULT_MOSAIC,mosaicBounds,validateMosaic}=require('../shared/mosaic.mjs');
let dir,asset;
before(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-mosaic-'));
  const pixels=Buffer.alloc(128*128);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++)pixels[y*128+x]=(Math.floor(x/4)+Math.floor(y/4))%2?255:0;
  const source=path.join(dir,'source.pgm'),file=path.join(dir,'source.png');
  await fs.writeFile(source,Buffer.concat([Buffer.from('P5\n128 128\n255\n'),pixels]));
  await run(ffmpeg,['-v','error','-y','-i',source,'-frames:v','1',file]);
  asset=await inspectMedia(file,path.join(dir,'cache'));
});
after(async()=>{if(dir)await fs.rm(dir,{recursive:true,force:true});});
function project(mosaic){
  const clip={id:'c',assetId:asset.id,trackId:'v',kind:'image',name:'模様',start:0,in:0,duration:1,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'',fontSize:40,color:'#ffffff',textStyle:'minimal',...(mosaic!==undefined?{mosaic}:{})};
  return {version:1,id:'p',name:'モザイク',width:128,height:128,fps:10,assets:[asset],markers:[],tracks:[{id:'v',kind:'video'}],clips:[clip]};
}
async function frame(file){return run(ffmpeg,['-v','error','-ss','0.2','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);}
function gray(bytes,x,y){return bytes[(y*128+x)*3];}

test('rejects malformed mosaic metadata and keeps legacy projects valid',()=>{
  const p=project();assert.doesNotThrow(()=>validateProject(p));
  for(const mosaic of [null,{...DEFAULT_MOSAIC,x:NaN},{...DEFAULT_MOSAIC,width:0},{...DEFAULT_MOSAIC,blockSize:.2},{...DEFAULT_MOSAIC,x:.05}]){
    assert.throws(()=>validateMosaic({kind:'video',mosaic}),/モザイク/);
    assert.throws(()=>validateProject(project(mosaic)),/モザイク/);
  }
  assert.throws(()=>validateMosaic({kind:'audio',mosaic:{...DEFAULT_MOSAIC}}),/映像または画像/);
  assert.deepEqual(mosaicBounds({...DEFAULT_MOSAIC,blockSize:.1},128,128),{left:45,top:45,right:84,bottom:84,block:13});
});

test('pixelates only the selected region in the exported MP4',async()=>{
  const mosaic={x:.5,y:.5,width:.5,height:.5,blockSize:.1};
  const base=path.join(dir,'base.mp4'),effect=path.join(dir,'mosaic.mp4'),settings={width:128,height:128,fps:10,quality:'high',encoder:'cpu'};
  await exportProject(project(),settings,base);
  await exportProject(project(mosaic),settings,effect);
  const original=await frame(base),result=await frame(effect);
  assert.ok(Math.abs(gray(original,61,61)-gray(original,65,61))>100,'source checker pattern varies within one mosaic block');
  assert.ok(Math.abs(gray(result,61,61)-gray(result,65,61))<20,'selected pixels share one block');
  assert.ok(Math.abs(gray(original,16,16)-gray(result,16,16))<12,'outside pixels stay unchanged');
});
