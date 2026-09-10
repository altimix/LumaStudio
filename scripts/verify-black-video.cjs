const { _electron:electron }=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ffmpeg,run}=require('../electron/media.cjs');
const root=path.join(__dirname,'..');
async function verify(){
  const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'.local','black-profile-')),file=path.join(profile,'black.luma');
  await fs.writeFile(file,JSON.stringify({version:1,id:'black-test',name:'黒背景の検証',width:320,height:180,fps:30,assets:[],clips:[],markers:[],tracks:[{id:'video',kind:'video',name:'映像',muted:false,hidden:false,locked:false,solo:false}]}));
  const executablePath=process.env.LUMA_VERIFY_EXE,env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000}),page=await app.firstWindow(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.locator('.media-card').first().waitFor({timeout:60000});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    await page.keyboard.press('Control+o');await page.getByRole('button',{name:'黒背景の検証',exact:true}).waitFor();
    // Hold a real generation result while a different file with the same saved ID is opened.
    await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('black-video');ipcMain.removeHandler('black-video');ipcMain.handle('black-video',async(...args)=>{ipcMain.removeHandler('black-video');ipcMain.handle('black-video',original);const result=await original(...args);await new Promise(resolve=>{globalThis.releaseBlack=resolve;});return result;});});
    await page.getByRole('button',{name:'ブラックビデオを追加',exact:true}).click();
    await app.evaluate(async()=>{for(let i=0;i<200&&!globalThis.releaseBlack;i++)await new Promise(r=>setTimeout(r,50));if(!globalThis.releaseBlack)throw Error('Generation did not reach the held result.');});
    const copiedFile=path.join(profile,'same-id.luma'),copied={...JSON.parse(await fs.readFile(file,'utf8')),name:'同じIDの別プロジェクト'};await fs.writeFile(copiedFile,JSON.stringify(copied));
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},copiedFile);
    await page.keyboard.press('Control+o');await page.getByRole('button',{name:copied.name,exact:true}).waitFor();
    await app.evaluate(()=>{globalThis.releaseBlack();delete globalThis.releaseBlack;});
    await page.getByRole('button',{name:'ブラックビデオを追加',exact:true}).waitFor();assert.equal(await page.locator('.media-card').count(),0);
    await page.getByText('プロジェクトが変更されたため追加を中止しました。もう一度追加してください。',{exact:true}).waitFor();
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    await page.keyboard.press('Control+o');await page.getByRole('button',{name:'黒背景の検証',exact:true}).waitFor();
    await page.getByRole('button',{name:'ブラックビデオを追加',exact:true}).click();await page.locator('.media-card').waitFor();
    await page.getByRole('button',{name:'選択素材をタイムラインに追加',exact:true}).click();await page.locator('.timeline-clip.image').waitFor();
    await page.locator('#prop-duration').fill('75');await page.locator('#prop-duration').press('Enter');
    const save=async()=>{await page.getByRole('button',{name:'プロジェクトを保存 (Ctrl+S)',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));return JSON.parse(await fs.readFile(file,'utf8'));};
    const long=await save();assert.equal(long.clips[0].duration,75);assert.equal(long.assets[0].kind,'image');assert.equal(long.assets[0].hasAudio,false);
    await page.locator('#prop-duration').fill('2');await page.locator('#prop-duration').press('Enter');await save();
    await page.keyboard.press('Control+o');await page.waitForFunction(()=>document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]')?.disabled);
    assert.equal(await page.locator('.media-card.offline').count(),0);assert.equal((await save()).clips[0].duration,2);
    const output=path.join(results,'black-video.mp4');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('品質',{exact:true}).selectOption('draft');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();await page.getByText('書き出しが完了しました',{exact:true}).waitFor({timeout:120000});
    const pixels=await run(ffmpeg,['-v','error','-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);assert.ok(pixels.length>0&&pixels.every(v=>v<=1));assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(results,'black-video.png')});await fs.writeFile(path.join(results,'black-video-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks:['生成・素材追加','75秒へ延長','保存・再読込','実MP4の黒画素検証']},null,2));
    console.log('Black video verified');
  }finally{await app.close();}
}
verify().catch(e=>{console.error(e);process.exitCode=1;});
