const { _electron: electron } = require('playwright');
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const {run,ffmpeg}=require('../electron/media.cjs');
const root=path.join(__dirname,'..');
(async()=>{
 await fs.mkdir(path.join(root,'.local'),{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});
 const profile=await fs.mkdtemp(path.join(root,'.local','recovery-profile-'));const env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 const executablePath=process.env.LUMA_VERIFY_EXE||path.join(root,'release','win-unpacked','Luma Studio.exe');
 let app;
 async function launch(){app=await electron.launch({executablePath,args:[],env,timeout:60000});const page=await app.firstWindow();await page.locator('.media-card').first().waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});return page;}
 try{
  let page=await launch();
  const original=path.join(profile,'素材（再リンクテスト）.avi');const moved=path.join(profile,'移動した素材.avi');
  const demo=path.join(profile,'demo-media',require('../package.json').version,'03-beyond.mp4');await fs.access(demo);
  await run(ffmpeg,['-y','-i',demo,'-t','1','-c:v','mpeg4','-q:v','3','-c:a','pcm_s16le',original]);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},original);
  await page.getByRole('button',{name:'読み込み',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===5);
  assert.equal(await page.locator('.proxy-tag').count(),1);
  await page.getByRole('button',{name:'素材（再リンクテスト）.avi を追加',exact:true}).click();
  await page.getByRole('textbox',{name:'クリップ名',exact:true}).fill('自動保存テスト');
  await page.getByRole('textbox',{name:'クリップ名',exact:true}).blur();
  await page.waitForFunction(()=>document.querySelector('.statusbar').textContent.includes('自動保存'));
  const backup=JSON.parse(await fs.readFile(path.join(profile,'autosave.luma'),'utf8'));
  assert.ok(backup.project.clips.some(c=>c.name==='自動保存テスト'));require('../shared/clip-links.mjs').validateClipLinks(backup.project);assert.equal(backup.project.clips.filter(c=>c.linkId).length,2);
  assert.ok(backup.project.assets.filter(a=>a.name!=='素材（再リンクテスト）.avi').every(a=>a.path.startsWith(path.join(profile,'demo-media'))));
  await app.close();app=undefined;await fs.rename(original,moved);
  // The path still exists, but a shorter replacement cannot cover the saved edit.
  await run(ffmpeg,['-y','-i',moved,'-t','0.2','-c:v','mpeg4','-q:v','3','-c:a','pcm_s16le',original]);
  page=await launch();await page.getByRole('button',{name:'復元する',exact:true}).click();
  await page.locator('.media-card.offline').waitFor();assert.equal(await page.locator('.media-card.offline').count(),1);
  assert.equal(await page.locator('.timeline-clip').count(),7);
  // Saving an offline edit is valid; exporting it must request relink rather than use the replacement.
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(profile,'offline.mp4'));
  await page.getByRole('button',{name:'書き出し',exact:true}).click();
  await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();
  await page.getByRole('dialog').getByText(/素材がオフライン/).waitFor();
  await page.keyboard.press('Escape');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},original);
  await page.getByRole('button',{name:'素材（再リンクテスト）.avi を再リンク',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.toast[role="status"]')?.textContent.includes('元の素材以上の長さ'));
  assert.equal(await page.locator('.media-card.offline').count(),1);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},moved);
  await page.getByRole('button',{name:'素材（再リンクテスト）.avi を再リンク',exact:true}).click();
  await page.locator('.media-card.offline').waitFor({state:'detached'});
  await page.getByRole('button',{name:'移動した素材.avi をプレビュー',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.source-monitor video')?.readyState>=2);
  assert.equal(await page.locator('.source-monitor video').evaluate(v=>v.videoWidth),1280);
  await page.keyboard.press('Escape');
  const savedProject=path.join(profile,'手動保存した編集.luma');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},savedProject);
  await page.getByRole('button',{name:'プロジェクトを保存 (Ctrl+S)',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.toast[role="status"]')?.textContent.includes('プロジェクトを保存しました'));
  await fs.access(savedProject);await assert.rejects(fs.access(path.join(profile,'autosave.luma')));
  await app.close();app=undefined;page=await launch();
  assert.equal(await page.locator('.recovery-banner').count(),0);
  // Explicitly discarding a recovery also persists across launch.
  await app.close();app=undefined;await fs.writeFile(path.join(profile,'autosave.luma'),JSON.stringify(backup));
  page=await launch();await page.getByRole('button',{name:'この自動保存を破棄',exact:true}).click();
  await page.locator('.recovery-banner').waitFor({state:'detached'});
  await app.close();app=undefined;page=await launch();assert.equal(await page.locator('.recovery-banner').count(),0);
  await fs.writeFile(path.join(root,'test-results','recovery-verification.json'),JSON.stringify({passed:true,packaged:true,checks:['native AVI import','automatic H.264 preview proxy','autosave','restart recovery','persistent bundled demo sources','replaced source offline detection','offline export rejection','short replacement relink rejection','native relink','relinked proxy video decode','manual save retires recovery','explicit discard persists after restart']},null,2));
  console.log('Recovery, proxy, native import and relink checks passed.');
 }finally{if(app)await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
