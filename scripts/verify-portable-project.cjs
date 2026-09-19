const { _electron: electron } = require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ffmpeg,run,inspectMedia}=require('../electron/media.cjs');
const root=path.join(__dirname,'..');
(async()=>{
 await fs.mkdir(path.join(root,'.local'),{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});
 const profile=await fs.mkdtemp(path.join(root,'.local','portable-')),env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 const source=path.join(profile,'素材 日本語.png');await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=green:s=640x360','-frames:v','1',source]);
 const asset=await inspectMedia(source,path.join(profile,'fixture-cache'));
 const project={version:1,id:'portable',name:'持ち運びの検証',width:640,height:360,fps:30,assets:[asset],tracks:[{id:'v',name:'Video1',kind:'video'}],markers:[],clips:[{id:'c',assetId:asset.id,trackId:'v',kind:'image',name:'素材',start:0,in:0,duration:3,speed:1,scale:1,x:0,y:0,rotation:0,opacity:1,volume:1,exposure:0,contrast:1,saturation:1,fadeIn:0,fadeOut:0}]};
 const projectFile=path.join(profile,'original.luma');await fs.writeFile(projectFile,JSON.stringify(project));
 const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const choose=async file=>app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
 try{
 await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});await choose(projectFile);await page.keyboard.press('Control+o');await page.getByRole('button',{name:project.name,exact:true}).waitFor();
 await choose(profile);await page.getByRole('button',{name:'ファイル',exact:true}).click();await page.getByRole('button',{name:'素材をまとめて保存',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('素材付きプロジェクトを保存'));
 const folder=(await fs.readdir(profile)).find(n=>n.startsWith('持ち運びの検証-'));assert.ok(folder);
 const moved=path.join(profile,'移動先');await fs.rename(path.join(profile,folder),moved);await fs.rm(source);
 await choose(path.join(moved,'project.luma'));await page.keyboard.press('Control+o');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));await page.waitForFunction(()=>[...document.querySelectorAll('.media-card')].length===1&&!document.querySelector('.media-card.offline'));
 const opened=await page.evaluate(()=>window.luma.openProject());assert.equal(opened.project.assets[0].offline,undefined);assert.ok(opened.project.assets[0].path.startsWith(moved));
 await page.getByRole('button',{name:asset.name+' をプレビュー',exact:true}).click();await page.locator('.source-monitor img').waitFor();await page.waitForFunction(()=>document.querySelector('.source-monitor img')?.naturalWidth===640);await page.keyboard.press('Escape');
 // Reopen the original with a missing source, then relink a whole folder.
 await choose(projectFile);await page.keyboard.press('Control+o');await page.locator('.media-card.offline').waitFor();
 const relinkDir=path.join(profile,'再リンク');await fs.mkdir(relinkDir);await fs.copyFile(opened.project.assets[0].path,path.join(relinkDir,path.basename(source)));
 await choose(relinkDir);await page.getByRole('button',{name:'ファイル',exact:true}).click();await page.getByRole('button',{name:'フォルダから一括再リンク',exact:true}).click();await page.locator('.media-card.offline').waitFor({state:'detached'});
 await page.keyboard.press('Control+z');await page.locator('.media-card.offline').waitFor();await page.keyboard.press('Control+Shift+z');await page.locator('.media-card.offline').waitFor({state:'detached'});
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(root,'test-results','portable-project.png')});
 console.log('Portable project: collect, moved relative media, image decode, batch relink and Undo/Redo passed.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
