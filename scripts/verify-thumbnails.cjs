// Only the remote image response is mocked. Frame extraction, IPC, file validation,
// JPEG size enforcement, editor persistence and UI are exercised in Electron.
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ffmpeg,run,inspectMedia,probe}=require('../electron/media.cjs');
const {thumbnailReferenceJpeg}=require('../electron/thumbnail-reference.cjs');
const {createHash}=require('node:crypto');
const root=path.join(__dirname,'..');
(async()=>{
 const results=path.join(root,'test-results','thumbnails');await fs.mkdir(results,{recursive:true});
 const source=path.join(results,'料理の見せ場.mp4');await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=4','-c:v','libx264',source]);
 const asset=await inspectMedia(source,path.join(results,'cache'));
 const photo=path.join(results,'参考の人物画像.png'),replacement=path.join(results,'差し替え写真.jpg'),invalid=path.join(results,'画像ではない.txt');
 await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=red:s=120x160','-frames:v','1',photo]);await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=blue:s=128x160','-frames:v','1',replacement]);await fs.writeFile(invalid,'not an image');
 const originalPhoto=await fs.readFile(replacement),photoAsset=await inspectMedia(photo,path.join(results,'cache')),expectedReferenceHash=createHash('sha256').update(await thumbnailReferenceJpeg(replacement)).digest('hex');
 const responses={};for(const [name,size]of [['landscape','1536x864'],['portrait','864x1536']])responses[name]=(await run(ffmpeg,['-v','error','-f','lavfi','-i',`color=c=0x465935:s=${size}`,'-frames:v','1','-f','image2pipe','-c:v','mjpeg','pipe:1'])).toString('base64');
 const clip={id:'c',assetId:asset.id,trackId:'v',name:'料理',kind:'video',start:100,in:0,duration:4,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0};
 const project={version:1,id:'thumbnail-test',name:'10分で作るパスタ',width:1920,height:1080,fps:30,assets:[asset],markers:[],tracks:[{id:'v',name:'映像',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[clip]};
 const profile=await fs.mkdtemp(path.join(results,'profile-')),env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.OPENAI_API_KEY;delete env.LUMA_ENV_FILE;
 const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
 try{
  const page=await app.firstWindow();await page.locator('.app-titlebar').waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
  await app.evaluate((_,responses)=>{globalThis.__thumbnailRequests=[];globalThis.fetch=async(url,options)=>{
   if(!/\/images\/(edits|generations)$/.test(url))throw new Error('Unexpected endpoint');
   if(globalThis.__thumbnailFailure)return new Response('',{status:500});
   const form=typeof options.body==='string'?null:options.body,data=form?Object.fromEntries(form):JSON.parse(options.body),images=form?.getAll('image[]')||[];
   const firstReference=images.length?Buffer.from(await images[0].arrayBuffer()).toString('base64'):undefined;
   globalThis.__thumbnailRequests.push({route:url.split('/').at(-1),model:data.model,size:data.size,quality:data.quality,prompt:data.prompt,references:images.length,firstReference});
   return Response.json({data:[{b64_json:responses[data.size==='864x1536'?'portrait':'landscape']}]});
  };},responses);
  await page.evaluate(()=>window.luma.aiSetKey('sk-fake-key-for-isolated-tests-only'));
  for(const scenario of ['landscape','portrait','text-only']){
   const portrait=scenario==='portrait',p={...project,id:scenario,width:portrait?1080:1920,height:portrait?1920:1080,...(scenario==='text-only'?{clips:[],assets:[]}:{} )};
   const file=path.join(results,`${p.id}.luma`),saved=path.join(results,`${p.id}.jpg`);await fs.writeFile(file,JSON.stringify(p));
   await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[files.file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:files.saved});}, {file,saved});
   await page.keyboard.press('Control+o');await page.getByRole('button',{name:p.name,exact:true}).waitFor();
   await page.getByRole('button',{name:'YouTube',exact:true}).click();await page.getByRole('button',{name:'サムネイル',exact:true}).click();
   assert.equal(await page.getByLabel('サムネイルの生成指示').inputValue(),'');
   if(scenario==='landscape'){
    const forged={...p,assets:[...p.assets,photoAsset],youtube:{sourceKey:'',cues:[],titles:[],description:'',chapters:[],keywords:[],thumbnailPrompt:'',thumbnailReferenceAssetId:photoAsset.id}};
    const rejected=await page.evaluate(async project=>{try{await window.luma.aiThumbnail(project,'');return '';}catch(error){return String(error);}},forged);assert.match(rejected,/未登録/);assert.equal((await app.evaluate(()=>globalThis.__thumbnailRequests)).length,0);
   }
   if(portrait){
    const choose=async file=>{await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.getByRole('button',{name:/^参考画像を(1枚選ぶ|差し替える)$/}).click();await page.waitForFunction(()=>!document.querySelector('.yt-content').disabled);};
    await choose(photo);await page.getByAltText('サムネイルに取り込む参考画像',{exact:true}).waitFor();assert.equal((await app.evaluate(()=>globalThis.__thumbnailRequests)).length,1,'selecting a reference does not upload it');
    await choose(replacement);assert.equal(await page.locator('.yt-reference-preview span').innerText(),path.basename(replacement));assert.equal(await page.locator('.yt-reference-preview img').count(),1);
    await choose(invalid);await page.locator('.yt-error').waitFor();assert.equal(await page.locator('.yt-reference-preview span').innerText(),path.basename(replacement));
    await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});await page.getByRole('button',{name:'参考画像を差し替える',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.yt-content').disabled);assert.equal(await page.locator('.yt-reference-preview img').count(),1);
    await page.getByRole('button',{name:'参考画像を解除',exact:true}).click();assert.equal(await page.locator('.yt-reference-preview img').count(),0);await choose(replacement);
    await page.getByRole('button',{name:'編集に戻る',exact:true}).click();await page.keyboard.press('Control+z');await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));assert.equal(JSON.parse(await fs.readFile(file,'utf8')).youtube.thumbnailReferenceAssetId,undefined);
    await page.keyboard.press('Control+Shift+z');await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));const reloaded=JSON.parse(await fs.readFile(file,'utf8'));assert.ok(reloaded.youtube.thumbnailReferenceAssetId);reloaded.name='参考画像を保存して再読込';await fs.writeFile(file,JSON.stringify(reloaded));
    const collection=await fs.mkdtemp(path.join(results,'collected-'));await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},collection);
    const collectedFile=await page.evaluate(project=>window.luma.collectProject(project),reloaded),moved=path.join(collection,'移動した素材付きプロジェクト');await fs.rename(path.dirname(collectedFile),moved);const movedFile=path.join(moved,'project.luma');
    const collected=JSON.parse(await fs.readFile(movedFile,'utf8')),collectedReference=collected.assets.find(asset=>asset.id===collected.youtube.thumbnailReferenceAssetId);assert.ok(collectedReference?.relativePath);assert.deepEqual(await fs.readFile(path.join(moved,collectedReference.relativePath)),originalPhoto);
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},movedFile);await page.keyboard.press('Control+o');await page.getByRole('button',{name:reloaded.name,exact:true}).waitFor();await page.getByRole('button',{name:'YouTube',exact:true}).click();await page.getByRole('button',{name:'サムネイル',exact:true}).click();await page.getByAltText('サムネイルに取り込む参考画像',{exact:true}).waitFor();assert.equal(await page.locator('.yt-reference-preview span').innerText(),path.basename(replacement));
   }
   if(scenario==='text-only'){await page.getByLabel('サムネイルの生成指示').fill('パスタの作り方。見出しは「たった10分」');await page.getByLabel('サムネイルの生成指示').blur();}
   await page.getByRole('button',{name:'サムネイルを1枚生成',exact:true}).click();
   await page.waitForFunction(w=>document.querySelector('.yt-thumbnail-preview img')?.naturalWidth===w||document.querySelector('.yt-error'),portrait?864:1536);assert.equal(await page.locator('.yt-error').count(),0,await page.locator('.yt-error').allTextContents());
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
  const calls=await app.evaluate(()=>globalThis.__thumbnailRequests);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.model==='gpt-image-2.5-sunburst'&&c.quality==='high'));
  for(const call of calls){if(call.firstReference)call.firstReferenceHash=createHash('sha256').update(Buffer.from(call.firstReference,'base64')).digest('hex');delete call.firstReference;}
  assert.equal(calls[0].references,3);assert.equal(calls[1].references,4);assert.equal(calls[1].firstReferenceHash,expectedReferenceHash);assert.match(calls[1].prompt,/1枚目はユーザー/);assert.equal(calls[2].references,0);assert.equal(calls[2].route,'generations');assert.deepEqual(await fs.readFile(replacement),originalPhoto);
  await fs.writeFile(path.join(results,'requests.json'),JSON.stringify(calls,null,2));console.log('GPT Image 2.5: optional reference selection/replacement/removal, Undo/Redo/reload, project collection/relocation, unregistered file rejection, first-image fidelity, no-reference generation, both orientations, JPEG under 2 MB, and failure retention verified (API mocked).');
 }catch(error){const page=await app.firstWindow();await page.screenshot({path:path.join(results,'failure.png')}).catch(()=>{});throw error;}finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
