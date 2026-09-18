const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ffmpeg,run,inspectMedia}=require('../electron/media.cjs');
const {timelineKey}=require('../shared/youtube.mjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const profile=await fs.mkdtemp(path.join(root,'.local','caption-video-'));
 const source=path.join(profile,'赤緑青.mp4');
 await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=red:s=640x360:r=30:d=2','-f','lavfi','-i','color=lime:s=640x360:r=30:d=2','-f','lavfi','-i','color=blue:s=640x360:r=30:d=2','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',source]);
 const asset=await inspectMedia(source,path.join(profile,'cache'));
 const project={version:1,id:'caption-video',name:'字幕と映像の確認',width:640,height:360,fps:30,assets:[asset],tracks:[{id:'v',name:'Video1',kind:'video'}],markers:[],clips:[{id:'c',assetId:asset.id,trackId:'v',kind:'video',name:'赤緑青',start:0,in:0,duration:6,speed:1,scale:1,x:0,y:0,rotation:0,opacity:1,volume:0,exposure:0,contrast:1,saturation:1,fadeIn:0,fadeOut:0}]};
 project.youtube={sourceKey:timelineKey(project),cues:[{start:.3,end:1.8,text:'赤い映像'},{start:2.3,end:3.8,text:'緑の映像'},{start:4.3,end:6,text:'青い映像'}],titles:[],description:'',thumbnailPrompt:'',keywords:[],hashtags:[],chapters:[]};
 const file=path.join(profile,'video.luma');await fs.writeFile(file,JSON.stringify(project));
 const env={...process.env,LUMA_TEST_DATA:profile,LUMA_DEMO_FIXTURE:'0'};delete env.ELECTRON_RUN_AS_NODE;
 const executablePath=process.env.LUMA_VERIFY_EXE;
 const app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  await page.keyboard.press('Control+o');await page.getByRole('button',{name:project.name,exact:true}).waitFor();
  await page.getByRole('button',{name:'YouTube',exact:true}).click();
  const checks=[];
  for(let i=0;i<3;i++){
   await page.getByRole('button',{name:`字幕${i+1}の映像を確認`,exact:true}).click();
   await page.waitForFunction(index=>{const c=document.querySelector('.caption-monitor canvas');if(!c)return false;const p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return p[index]>200&&p[(index+1)%3]<30&&p[(index+2)%3]<30;},i);
   assert.equal(await page.locator('.canvas-wrap canvas').count(),1);
   await page.evaluate(()=>{window.videoFrames=[];const c=document.querySelector('.caption-monitor canvas');window.videoObserver=new MutationObserver(()=>{if(document.querySelector('.caption-monitor-controls button[aria-pressed="true"]'))window.videoFrames.push({time:Number(c.dataset.previewTime),pixel:[...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data]});});window.videoObserver.observe(c,{attributes:true,attributeFilter:['data-preview-time']});});
   await page.getByRole('button',{name:'この字幕を反復再生',exact:true}).click();
   await page.waitForFunction(()=>window.videoFrames.filter((v,j)=>j>0&&v.time<window.videoFrames[j-1].time-.1).length>=2,undefined,{timeout:15000});
   await page.getByRole('button',{name:'反復再生を停止',exact:true}).click();
   const frames=await page.evaluate(()=>{window.videoObserver.disconnect();return window.videoFrames;});
   await fs.writeFile(path.join(root,'test-results',`caption-video-frames-${i}.json`),JSON.stringify(frames));assert.ok(frames.length>20);const cue=project.youtube.cues[i];
   assert.equal(frames.filter(f=>f.time<cue.start-1e-6||f.time>=cue.end).length,0);
   assert.equal(frames.filter(f=>f.pixel[i]<200||f.pixel[(i+1)%3]>30||f.pixel[(i+2)%3]>30).length,0,'loop must display the selected video color without black or next-cue flashes');
   checks.push({cue:i+1,samples:frames.length,wraps:frames.filter((v,j)=>j>0&&v.time<frames[j-1].time-.1).length});
  }
  await page.screenshot({path:path.join(root,'test-results','caption-real-video.png')});assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'test-results','caption-real-video.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,errors},null,2));
  console.log(JSON.stringify({passed:true,checks}));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
