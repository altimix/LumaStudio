const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ffmpeg,run,inspectMedia}=require('../electron/media.cjs');
const root=path.join(__dirname,'..');
(async()=>{
 const results=path.join(root,'test-results','cut-rendering');await fs.mkdir(results,{recursive:true});
 const source=path.join(results,'青い映像.mp4');
 await run(ffmpeg,['-y','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=4','-c:v','libx264','-g','90','-pix_fmt','yuv420p',source]);
 const asset=await inspectMedia(source,path.join(results,'cache'));
 const clip={id:'video',assetId:asset.id,trackId:'v',name:'映像',kind:'video',start:0,in:0,duration:4,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'',fontSize:94,color:'#ff0000',textStyle:'hero'};
 const project={version:1,id:'cut-rendering',name:'カットと図形の検証',width:320,height:180,fps:30,assets:[asset],markers:[],tracks:[{id:'g',name:'図形',kind:'video',muted:false,hidden:false,locked:false,solo:false},{id:'v',name:'映像',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[clip]};
 const file=path.join(results,'カット.luma');await fs.writeFile(file,JSON.stringify(project));
 const profile=await fs.mkdtemp(path.join(results,'profile-')),env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
 try{
  const page=await app.firstWindow();
  // A hidden loading screen also matches the initial blank document. Wait for
  // React to mount before waiting for bootstrap and sending keyboard input.
  await page.locator('.app-titlebar').waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
  await page.keyboard.press('Control+o');await page.getByRole('button',{name:project.name,exact:true}).waitFor();
  // Exercise the actual C razor tool, followed by save/reload and Undo/Redo.
  await page.keyboard.press('c');const item=page.locator('.timeline-clip.video');const box=await item.boundingBox();
  await item.click({position:{x:box.width/2,y:box.height/2}});await page.keyboard.press('v');
  await page.waitForFunction(()=>document.querySelectorAll('.timeline-clip.video').length===2);
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelectorAll('.timeline-clip.video').length===1);
  await page.keyboard.press('Control+Shift+z');await page.waitForFunction(()=>document.querySelectorAll('.timeline-clip.video').length===2);
  await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
  const cut=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(cut.clips.length,2);
  for(const [i,shape]of ['arrow','rectangle','ellipse'].entries())cut.clips.push({...clip,id:shape,assetId:undefined,trackId:'g',kind:'title',name:shape,start:.5+i,duration:.8,graphic:{shape,width:100,height:60,lineWidth:6,fill:false,fillColor:'#ff0000'}});
  await fs.writeFile(file,JSON.stringify(cut));await page.keyboard.press('Control+o');await page.keyboard.press('Home');
  await page.waitForFunction(()=>{const c=document.querySelector('.canvas-wrap canvas');return c.getContext('2d').getImageData(2,2,1,1).data[2]>180;});
  await page.evaluate(()=>{
   window.cutSamples=[];window.cutRecording=true;
   const sample=()=>{if(!window.cutRecording)return;const c=document.querySelector('.canvas-wrap canvas'),t=Number(c.dataset.previewTime);const rgba=[...c.getContext('2d').getImageData(2,2,1,1).data];window.cutSamples.push({t,rgba});requestAnimationFrame(sample);};requestAnimationFrame(sample);
  });
  await page.keyboard.press('Space');await page.waitForFunction(()=>Number(document.querySelector('.canvas-wrap canvas').dataset.previewTime)>3.8,{},{timeout:30000});await page.keyboard.press('Space');
  const samples=await page.evaluate(()=>{window.cutRecording=false;return window.cutSamples;});await fs.writeFile(path.join(results,'preview-samples.json'),JSON.stringify(samples));
  const bad=samples.filter(s=>s.t>.1&&s.t<3.8&&s.rgba[2]<180);assert.equal(bad.length,0,JSON.stringify(bad.slice(0,8)));
  await page.screenshot({path:path.join(results,'editor.png')});
  const output=path.join(results,'カットと図形.mp4');
  await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);
  await page.getByRole('button',{name:'書き出し',exact:true}).click();
  await page.getByLabel('書き出し方式',{exact:true}).selectOption('cpu');
  await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();
  await page.getByText('書き出しが完了しました',{exact:true}).waitFor({timeout:120000});
  const pixels=await run(ffmpeg,['-v','error','-i',output,'-vf','crop=2:2:2:2,scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.equal(pixels.length,120*3);
  for(let i=0;i<120;i++)assert.ok(pixels[i*3+2]>180,`export black frame ${i}`);
  console.log(JSON.stringify({previewSamples:samples.length,blackFrames:bad.length,exportFrames:120,shapes:3}));
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
