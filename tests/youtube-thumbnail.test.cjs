const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {thumbnailFormat,thumbnailFrames,thumbnailBrief}=require('../shared/youtube-thumbnail.mjs');
const {timelineKey}=require('../shared/youtube.mjs');
const {thumbnailJpeg,MAX_THUMBNAIL_BYTES}=require('../electron/thumbnail-jpeg.cjs');
const {generateThumbnail}=require('../electron/youtube.cjs');
const {createOpenAI}=require('../electron/openai.cjs');
const {ffmpeg,run,probe}=require('../electron/media.cjs');
function project(file){
 const asset={id:'a',name:'料理',path:file,kind:'video',duration:10,width:320,height:180,fps:30,hasAudio:false,waveform:[],size:1,codec:'h264'};
 const clip={id:'c',assetId:'a',trackId:'v',name:'料理',kind:'video',start:0,in:2,duration:4,speed:2,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0};
 return {version:1,id:'p',name:'10分で作るパスタ',width:1920,height:1080,fps:30,assets:[asset],tracks:[{id:'v',kind:'video',hidden:false,locked:false,muted:false,solo:false}],clips:[clip],markers:[]};
}
async function temporary(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-thumbnail-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
async function jpeg(width,height){return run(ffmpeg,['-v','error','-f','lavfi','-i',`color=c=green:s=${width}x${height}`,'-frames:v','1','-c:v','mjpeg','-f','image2pipe','pipe:1']);}
test('frame references use visible edited source intervals and never hidden or unused assets',()=>{
 const p=project(path.resolve('food.mp4'));assert.deepEqual(thumbnailFrames(p).map(f=>f.sourceTime),[3.6,6,8.4]);
 p.tracks[0].hidden=true;assert.deepEqual(thumbnailFrames(p),[]);p.tracks[0].hidden=false;p.assets[0].offline=true;assert.deepEqual(thumbnailFrames(p),[]);
});
test('reference sampling ignores leading and interior gaps without double-counting overlapping tracks',()=>{
 const p=project(path.resolve('food.mp4'));p.clips[0].start=100;
 const times=thumbnailFrames(p).map(f=>f.sourceTime);
 assert.equal(times.length,3);[3.6,6,8.4].forEach((expected,i)=>assert.ok(Math.abs(times[i]-expected)<1e-8));
 p.clips.push({...p.clips[0],id:'later',start:1000,in:0});
 const spread=thumbnailFrames(p).map(f=>f.sourceTime);
 [5.2,0,4.8].forEach((expected,i)=>assert.ok(Math.abs(spread[i]-expected)<1e-8));
 p.tracks.push({...p.tracks[0],id:'under'});p.clips.push({...p.clips[0],id:'overlap',trackId:'under'});
 assert.deepEqual(thumbnailFrames(p).map(f=>f.sourceTime),spread);
});
test('brief uses current video content, bounded transcript samples, requested headline and orientation',()=>{
 const p=project(path.resolve('food.mp4'));p.youtube={sourceKey:timelineKey(p),titles:['時短パスタ'],description:'料理のコツ',keywords:['パスタ'],cues:Array.from({length:100},(_,i)=>({text:`説明${i}`,start:i,end:i+1}))};
 let brief=thumbnailBrief(p,'見出しは「たった10分」');assert.match(brief,/時短パスタ/);assert.match(brief,/たった10分/);assert.match(brief,/説明99/);assert.match(brief,/16:9/);assert.ok(!brief.includes(p.assets[0].path));
 p.width=1080;p.height=1920;assert.equal(thumbnailFormat(p).ratio,'9:16');assert.match(thumbnailBrief(p,''),/縦専用/);
 p.youtube.sourceKey='old';assert.ok(!thumbnailBrief(p,'').includes('時短パスタ'));
});
test('brief excludes transparent titles while retaining titles made visible by keyframes',()=>{
 const p=project(path.resolve('food.mp4')),title={...p.clips[0],kind:'title',assetId:undefined};
 p.clips.push({...title,id:'hidden',text:'古い見出し',opacity:0},
  {...title,id:'visible',text:'今の見出し',opacity:1},
  {...title,id:'keys-hidden',text:'隠した原稿',opacity:1,opacityKeyframes:[{time:0,value:0},{time:4,value:0}]},
  {...title,id:'keys-visible',text:'後半の見せ場',opacity:0,opacityKeyframes:[{time:0,value:0},{time:2,value:1}]});
 const brief=thumbnailBrief(p,'');assert.ok(!brief.includes('古い見出し'));assert.ok(!brief.includes('隠した原稿'));
 assert.ok(brief.includes('今の見出し'));assert.ok(brief.includes('後半の見せ場'));
});
test('image API sends reference scenes as multipart at high quality in both aspect ratios',async()=>{
 for(const portrait of [false,true]){
  let request;const image=await jpeg(portrait?864:1536,portrait?1536:864);
  const client=createOpenAI(async()=> 'sk-test-key-for-isolated-tests',async(url,options)=>{request={url,options};return Response.json({data:[{b64_json:image.toString('base64')}]});});
  assert.deepEqual(await client.image('主役を強調',portrait,undefined,[image]),image);
  assert.ok(request.url.endsWith('/images/edits'));const body=request.options.body;
  assert.equal(body.get('quality'),'high');assert.equal(body.get('size'),portrait?'864x1536':'1536x864');assert.equal(body.get('output_format'),'jpeg');assert.equal(body.getAll('image[]').length,1);assert.equal(body.get('input_fidelity'),null);
 }
});
test('generation without metadata uses actual frames and verifies final dimensions before retaining JPEG',async()=>temporary(async dir=>{
 const source=path.join(dir,'元動画.mp4');await run(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=10','-c:v','libx264',source]);
 const p=project(source),calls=[];const client={image:async(prompt,portrait,signal,refs)=>{calls.push({prompt,refs});return jpeg(portrait?864:1536,portrait?1536:864);}};
 for(const portrait of [false,true]){p.width=portrait?1080:1920;p.height=portrait?1920:1080;const file=await generateThumbnail(p,'',client,undefined,dir);const info=(await probe(file)).streams[0];assert.equal(info.width,portrait?864:1536);assert.ok((await fs.stat(file)).size<MAX_THUMBNAIL_BYTES);}
 assert.equal(calls[0].refs.length,3);assert.match(calls[0].prompt,/10分で作るパスタ/);
 const before=(await fs.readdir(dir)).sort();await assert.rejects(generateThumbnail(p,'画像',{image:()=>jpeg(1024,1024)},undefined,dir),/指定サイズ/);assert.deepEqual((await fs.readdir(dir)).sort(),before);
 const controller=new AbortController();await assert.rejects(generateThumbnail(p,'画像',{image:async()=>{controller.abort();return jpeg(864,1536);}},controller.signal,dir));assert.deepEqual((await fs.readdir(dir)).sort(),before);
}));
test('JPEG stays below 2 MB without changing dimensions; PNG and oversized JPEG are converted',async()=>temporary(async dir=>{
 for(const portrait of [false,true]){
 const w=portrait?864:1536,h=portrait?1536:864,file=path.join(dir,'source.jpg'),bytes=await jpeg(w,h);
 await fs.writeFile(file,bytes);assert.deepEqual(await thumbnailJpeg(file),bytes);
 await fs.appendFile(file,Buffer.alloc(MAX_THUMBNAIL_BYTES));const output=await thumbnailJpeg(file);assert.ok(output.length<MAX_THUMBNAIL_BYTES);await fs.writeFile(file,output);const info=(await probe(file)).streams[0];assert.equal(info.width,w);assert.equal(info.height,h);
 const png=path.join(dir,`source-${w}.png`);await run(ffmpeg,['-v','error','-i',file,'-frames:v','1',png]);const converted=await thumbnailJpeg(png);assert.equal(converted[0],255);assert.equal(converted[1],216);assert.ok(converted.length<MAX_THUMBNAIL_BYTES);
 }
}));
