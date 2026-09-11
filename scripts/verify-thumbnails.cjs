// Only the remote image response is mocked. Frame extraction, IPC, file validation,
// JPEG size enforcement, editor persistence and UI are exercised in Electron.
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ffmpeg,run,inspectMedia,probe}=require('../electron/media.cjs');
const root=path.join(__dirname,'..');
(async()=>{
 const results=path.join(root,'test-results','thumbnails');await fs.mkdir(results,{recursive:true});
 const source=path.join(results,'料理の見せ場.mp4');await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=4','-c:v','libx264',source]);
 const asset=await inspectMedia(source,path.join(results,'cache'));
 const responses={};for(const [name,size]of [['landscape','1536x864'],['portrait','864x1536']])responses[name]=(await run(ffmpeg,['-v','error','-f','lavfi','-i',`color=c=0x465935:s=${size}`,'-frames:v','1','-f','image2pipe','-c:v','mjpeg','pipe:1'])).toString('base64');
 const clip={id:'c',assetId:asset.id,trackId:'v',name:'料理',kind:'video',start:100,in:0,duration:4,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0};
 const project={version:1,id:'thumbnail-test',name:'10分で作るパスタ',width:1920,height:1080,fps:30,assets:[asset],markers:[],tracks:[{id:'v',name:'映像',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[clip]};
 const profile=await fs.mkdtemp(path.join(results,'profile-')),env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.OPENAI_API_KEY;delete env.LUMA_ENV_FILE;
 const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
 try{
  const page=await app.firstWindow();await page.locator('.app-titlebar').waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
  await app.evaluate((_,responses)=>{globalThis.__thumbnailRequests=[];globalThis.fetch=async(url,options)=>{
   if(!url.endsWith('/images/edits'))throw new Error('Unexpected endpoint');
   if(globalThis.__thumbnailFailure)return new Response('',{status:500});
   const form=options.body;globalThis.__thumbnailRequests.push({size:form.get('size'),quality:form.get('quality'),prompt:form.get('prompt'),references:form.getAll('image[]').length});
   return Response.json({data:[{b64_json:responses[form.get('size')==='864x1536'?'portrait':'landscape']}]});
  };},responses);
  await page.evaluate(()=>window.luma.aiSetKey('sk-fake-key-for-isolated-tests-only'));
  for(const portrait of [false,true]){
   const p={...project,id:portrait?'portrait':'landscape',width:portrait?1080:1920,height:portrait?1920:1080};
   const file=path.join(results,`${p.id}.luma`),saved=path.join(results,`${p.id}.jpg`);await fs.writeFile(file,JSON.stringify(p));
   await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[files.file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:files.saved});}, {file,saved});
   await page.keyboard.press('Control+o');await page.getByRole('button',{name:p.name,exact:true}).waitFor();
   await page.getByRole('button',{name:'YouTube',exact:true}).click();await page.getByRole('button',{name:'サムネイル',exact:true}).click();
   assert.equal(await page.getByLabel('サムネイルの生成指示').inputValue(),'');
   await page.getByRole('button',{name:'サムネイルを1枚生成',exact:true}).click();
   await page.waitForFunction(w=>document.querySelector('.yt-thumbnail-preview img')?.naturalWidth===w,portrait?864:1536);
   await page.getByRole('button',{name:'JPEGを保存',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('.yt-progress'));
   const bytes=await fs.readFile(saved);assert.ok(bytes.length<2_000_000);assert.equal(bytes[0],255);assert.equal(bytes[1],216);
   const image=(await probe(saved)).streams[0];assert.equal(image.width,portrait?864:1536);assert.equal(image.height,portrait?1536:864);
   await page.screenshot({path:path.join(results,`${p.id}-ui.png`)});
   const img=page.locator('.yt-thumbnail-preview img'),before=await img.getAttribute('src');
   await app.evaluate(()=>{globalThis.__thumbnailFailure=true;});await page.getByRole('button',{name:'サムネイルを1枚生成',exact:true}).click();await page.locator('.yt-error').waitFor();assert.equal(await img.getAttribute('src'),before);
   await app.evaluate(()=>{globalThis.__thumbnailFailure=false;});await page.screenshot({path:path.join(results,`${p.id}-error.png`)});
   await page.getByRole('button',{name:'編集に戻る',exact:true}).click();
   // Save before the next project switch so the prompt does not interrupt this test.
   await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
  }
  const calls=await app.evaluate(()=>globalThis.__thumbnailRequests);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.references===3&&c.quality==='high'&&c.prompt.includes('10分で作るパスタ')));
  await fs.writeFile(path.join(results,'requests.json'),JSON.stringify(calls,null,2));console.log('Two orientations: reference frames, high quality, JPEG under 2 MB, failure preserves existing image.');
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
