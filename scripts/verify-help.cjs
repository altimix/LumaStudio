const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
async function verify(){
 const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});
 const profile=await fs.mkdtemp(path.join(root,'.local','help-profile-')),env={...process.env,LUMA_TEST_DATA:profile,LUMA_DEMO_FIXTURE:'0'};delete env.ELECTRON_RUN_AS_NODE;
 const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000}),page=await app.firstWindow(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.locator('.loading-screen').waitFor({state:'detached',timeout:60000});
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setBounds({x:0,y:0,width:1280,height:900});});
  await page.waitForFunction(()=>innerWidth>=1200);
  const before=await page.locator('.ruler-label .timecode').textContent();
  const help=page.getByRole('button',{name:'ヘルプ',exact:true});await help.click();await page.getByRole('menuitem',{name:'初めての動画編集',exact:true}).waitFor();
  await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'アップデート');assert.equal(await page.locator('.ruler-label .timecode').textContent(),before);
  await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'はじめての動画編集'}).waitFor();await page.keyboard.press('Escape');
  await help.click();await page.getByRole('menuitem',{name:'ショートカットキー一覧',exact:true}).click();
  const diagram=page.getByRole('region',{name:'キーボード図'});await diagram.waitFor();
  await diagram.getByRole('button',{name:'Mac',exact:true}).click();await diagram.getByRole('button',{name:'⌘ Command',exact:true}).click();await diagram.getByRole('button',{name:'S：保存',exact:true}).click();assert.match(await page.locator('.keyboard-detail').textContent(),/⌘ \+ S保存/);
  await diagram.getByRole('button',{name:'Windows',exact:true}).click();assert.match(await page.locator('.keyboard-detail').textContent(),/Ctrl \+ S保存/);
  await diagram.getByRole('button',{name:'通常',exact:true}).click();await diagram.getByRole('button',{name:'Z：全トラックに編集点',exact:true}).click();assert.equal(await page.locator('.timeline-clip').count(),0);
  await page.screenshot({path:path.join(results,'help-keyboard.png')});
  const search=page.getByRole('searchbox',{name:'ショートカットを検索'});await search.fill('リップル削除');assert.equal(await page.locator('.shortcut-list>div').count(),1);await page.keyboard.press('Escape');
  await help.click();await page.getByRole('menuitem',{name:'アップデート',exact:true}).click();await page.getByText('新しい安定版はありません。',{exact:false}).waitFor();
  await page.getByRole('button',{name:'更新を確認',exact:true}).click();await page.getByText('新しい安定版はありません。',{exact:false}).waitFor();await page.screenshot({path:path.join(results,'help-updates.png')});
  assert.equal(await page.getByRole('button',{name:'ダウンロードページを開く'}).count(),0);
  const invalid=await page.evaluate(async()=>{try{await window.luma.checkUpdates('bad');return false;}catch{return true;}});assert.equal(invalid,true);
  await app.evaluate(({ipcMain,app})=>{ipcMain.removeHandler('check-updates');ipcMain.handle('check-updates',()=>({status:'available',currentVersion:app.getVersion(),latestVersion:'2.0.0',checkedAt:Date.now(),platform:process.platform,arch:process.arch}));});
  await page.getByRole('button',{name:'更新を確認',exact:true}).click();await page.getByText('Luma Studio 2.0.0 が利用できます。',{exact:false}).waitFor();await page.getByRole('button',{name:'ダウンロードページを開く'}).waitFor();await page.keyboard.press('Escape');await page.getByRole('button',{name:'更新あり',exact:true}).click();await page.getByRole('dialog',{name:'アップデート',exact:true}).waitFor();
  await app.evaluate(({ipcMain,app})=>{ipcMain.removeHandler('check-updates');ipcMain.handle('check-updates',()=>({status:'error',currentVersion:app.getVersion(),checkedAt:Date.now(),platform:process.platform,arch:process.arch,message:'通信環境を確認してください。'}));});
  await page.getByRole('button',{name:'更新を確認',exact:true}).click();await page.getByText('通信環境を確認してください。',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'ダウンロードページを開く'}).count(),0);

  assert.deepEqual(errors,[]);await fs.writeFile(path.join(results,'help-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks:['three help pages','menu keyboard does not move playhead','Mac and Windows keyboard mappings','keyboard diagram does not edit','shortcut search','startup and manual current-version check','invalid IPC rejected'],consoleErrors:errors},null,2));console.log('Help menu, keyboard diagram and update checks verified.');
 }catch(error){await page.screenshot({path:path.join(results,'help-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
