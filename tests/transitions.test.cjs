const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {ffmpeg,run,probe,inspectMedia}=require('../electron/media.cjs');const {exportProject}=require('../electron/export.cjs');const {applyTransition}=require('../shared/transitions.mjs');const {blendTransition,xfadeExpression}=require('../shared/video-transitions.mjs');
let dir,assets;const width=320,height=180,fps=20;
before(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-transitions-'));assets=[];for(const [i,color,hz]of [[0,'red',440],[1,'blue',880]]){const file=path.join(dir,i+'.mp4');await run(ffmpeg,['-v','error','-y','-f','lavfi','-i',`color=${color}:s=${width}x${height}:r=${fps}:d=3`,'-f','lavfi','-i',`sine=frequency=${hz}:sample_rate=48000:duration=3`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);assets.push(await inspectMedia(file,path.join(dir,'cache')));}});
after(async()=>{if(dir)await fs.rm(dir,{recursive:true,force:true});});
function fixture(){const clip={id:'a',assetId:assets[0].id,trackId:'v',name:'red',kind:'video',start:0,in:.5,duration:2,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'',fontSize:94,color:'#ffffff',textStyle:'hero'};return {version:1,id:'p',name:'Transitions',width,height,fps,assets,markers:[],tracks:[{id:'v',name:'video',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[clip,{...clip,id:'b',name:'blue',assetId:assets[1].id,start:2}]};}
test('page peel has a shaded curved front and glossy grey back through the turn',()=>{
  const a=new Uint8ClampedArray(width*height*4),b=new Uint8ClampedArray(a.length),out=new Uint8ClampedArray(a.length);
  for(let i=0;i<a.length;i+=4){a[i]=255;a[i+3]=255;b[i+2]=255;b[i+3]=255;}
  for(const progress of [.25,.5,.75]){
    blendTransition('pagePeel',a,b,out,width,height,progress);const grey=[];let shadedFront=0;
    for(let i=0;i<out.length;i+=4){
      if(out[i]>90&&out[i+2]-out[i]===8&&out[i+1]-out[i]===3)grey.push(out[i]);
      if(out[i]>130&&out[i]<240&&out[i+1]===0&&out[i+2]===0)shadedFront++;
    }
    assert.ok(grey.length>200&&shadedFront>200,'a visible rolled front and back');
    assert.ok(Math.min(...grey)<130&&Math.max(...grey)>180&&Math.max(...grey)<230,'grey shadow and specular highlight, not a white back');
  }
  blendTransition('pagePeel',a,b,out,width,height,0);assert.deepEqual(out,a);
  blendTransition('pagePeel',a,b,out,width,height,1);assert.deepEqual(out,b);
});
test('page geometry matches FFmpeg plane sampling and is distinct from a wipe or dissolve',async()=>{
  const frame=w=>new Uint8ClampedArray(width*height*4).map((_,i)=>i%4===3?255:i%4===w?254:0),a=frame(0),b=frame(2);
  for(const kind of ['dissolve','pageTurn','pagePeel']){
    const raw=await run(ffmpeg,['-v','error','-f','lavfi','-i',`color=red:s=${width}x${height}:r=4:d=2`,'-f','lavfi','-i',`color=blue:s=${width}x${height}:r=4:d=2`,'-filter_complex',`[0:v]format=gbrap,settb=AVTB[a];[1:v]format=gbrap,settb=AVTB[b];[a][b]xfade=transition=custom:duration=1:offset=0:expr='${xfadeExpression(kind)}'[v]`,'-map','[v]','-t','1','-f','rawvideo','-pix_fmt','rgba','pipe:1']);
    for(const [n,p]of [[0,0],[1,.25],[2,.5],[3,.75]]){const out=new Uint8ClampedArray(a.length);blendTransition(kind,a,b,out,width,height,p);let error=0;for(let i=0;i<a.length;i++)error+=Math.abs(out[i]-raw[n*a.length+i]);assert.ok(error/a.length<2,`${kind} ${p}: ${error/a.length}`);}
  }
});
for(const kind of ['dissolve','pageTurn','pagePeel'])test(`exports ${kind} as a full-frame chain with correct sequence duration`,async()=>{
  let p=applyTransition(fixture(),'a','b',{duration:1,video:kind,autoAudio:true},'t');p.clips.push({...p.clips[0],id:'c',start:4});p=applyTransition(p,'b','c',{duration:1,video:kind},'u');const file=path.join(dir,kind+'.mp4');await exportProject(p,{width,height,fps,quality:'high',encoder:'cpu'},file);assert.ok(Math.abs(Number((await probe(file)).format.duration)-6)<.06);
  const pixel=async(time)=>[...await run(ffmpeg,['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])];assert.ok((await pixel(.5))[0]>220);assert.ok((await pixel(3))[2]>220);assert.ok((await pixel(5.5))[0]>220);
});
test('rendered audio has the expected linear or equal-power gain at three points',async()=>{
  for(const curve of ['constantGain','constantPower']){const p=applyTransition(fixture(),'a','b',{duration:1,audio:curve},'t'),file=path.join(dir,curve+'.mp4');await exportProject(p,{width,height,fps,quality:'draft',encoder:'cpu'},file);
    const pcm=await run(ffmpeg,['-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);
    function amplitude(t,hz){const n=2400,start=Math.round((t-.025)*48000);let re=0,im=0;for(let i=0;i<n;i++){const value=pcm.readFloatLE((start+i)*4),phase=2*Math.PI*hz*(start+i)/48000;re+=value*Math.cos(phase);im+=value*Math.sin(phase);}return 2*Math.hypot(re,im)/n;}
    const a=amplitude(.5,440),b=amplitude(3.25,880);for(const progress of [.25,.5,.75])for(const [hz,base,value]of [[440,a,1-progress],[880,b,progress]]){const expected=curve==='constantGain'?value:Math.sin(value*Math.PI/2);assert.ok(Math.abs(amplitude(1.5+progress,hz)/base-expected)<.035,`${curve} ${progress} ${hz}`);}
  }
});

test('transition layers retain transparent margins above a lower video track',async()=>{
  const background=path.join(dir,'green.png');await run(ffmpeg,['-v','error','-f','lavfi','-i','color=lime:s=320x180','-frames:v','1',background]);const asset=await inspectMedia(background,path.join(dir,'cache'));
  for(const kind of ['dissolve','pageTurn','pagePeel']){let p=fixture();p.assets=[...p.assets,asset];p.tracks.push({...p.tracks[0],id:'background'});p.clips=p.clips.map(c=>({...c,scale:.5}));p.clips.push({...p.clips[0],id:'bg',trackId:'background',kind:'image',assetId:asset.id,start:0,duration:3,scale:1,volume:0});p=applyTransition(p,'a','b',{duration:1,video:kind},'t');const file=path.join(dir,kind+'-transparent.mp4');await exportProject(p,{width,height,fps,quality:'high',encoder:'cpu'},file);const rgb=await run(ffmpeg,['-v','error','-ss','2','-i',file,'-frames:v','1','-vf','crop=8:8:0:0,scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.ok(rgb[1]>230&&rgb[0]<15&&rgb[2]<15,kind+': '+[...rgb]);}
});


test('dissolve preserves the contribution of nonoverlapping opaque and translucent layers',async()=>{
  const background=path.join(dir,'dissolve-green.png');await run(ffmpeg,['-v','error','-f','lavfi','-i','color=lime:s=320x180','-frames:v','1',background]);const asset=await inspectMedia(background,path.join(dir,'cache'));
  for(const opacity of [1,.5]){
    const out=new Uint8ClampedArray(8);blendTransition('dissolve',new Uint8ClampedArray([254,0,0,Math.floor(255*opacity),0,0,0,0]),new Uint8ClampedArray([0,0,0,0,0,0,254,255]),out,2,1,.5);
    assert.deepEqual([...out],[254,0,0,Math.floor(255*opacity/2),0,0,254,127]);
    let p=fixture();p.assets=[...p.assets,asset];p.tracks.push({...p.tracks[0],id:'background'});p.clips=p.clips.map((c,i)=>({...c,scale:.5,x:i?25:-25,opacity:i?1:opacity}));p.clips.push({...p.clips[0],id:'bg',trackId:'background',kind:'image',assetId:asset.id,start:0,duration:3,scale:1,x:0,opacity:1,volume:0});p=applyTransition(p,'a','b',{duration:1,video:'dissolve'},'t');const file=path.join(dir,'dissolve-alpha-'+opacity+'.mp4');await exportProject(p,{width,height,fps,quality:'high',encoder:'cpu'},file);
    for(const [x,expected]of [[80,[127*opacity,255-127*opacity,0]],[240,[0,128,127]]]){const rgb=await run(ffmpeg,['-v','error','-ss','2','-i',file,'-frames:v','1','-vf','crop=8:8:'+x+':86,scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);for(let c=0;c<3;c++)assert.ok(Math.abs(rgb[c]-expected[c])<8,'opacity '+opacity+', x '+x+': '+[...rgb]);}
  }
});
