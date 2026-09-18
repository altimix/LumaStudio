const {_electron:electron}=require('playwright');const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
(async()=>{
 await fs.mkdir(path.join(root,'.local'),{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});const profile=await fs.mkdtemp(path.join(root,'.local','backup-history-')),env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 const project={version:1,id:'backup-fixture',name:'復元する作品',width:1280,height:720,fps:30,assets:[],tracks:[{id:'v',name:'Video1',kind:'video'}],clips:[],markers:[]};
 const legacy={savedAt:'2024-01-01T00:00:00.000Z',project:{...project,name:'旧形式の版'}};await fs.writeFile(path.join(profile,'autosave.luma'),JSON.stringify(legacy));
 const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000}),page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
 const imported=await page.evaluate(()=>window.luma.listBackups());assert.equal(imported.length,1);assert.equal(imported[0].savedAt,legacy.savedAt);
 await page.evaluate(()=>window.luma.bootstrap());assert.equal((await page.evaluate(()=>window.luma.listBackups())).length,1);assert.deepEqual(JSON.parse(await fs.readFile(path.join(profile,'autosave.luma'),'utf8')),legacy);
 await page.evaluate(async p=>{await window.luma.autosave({...p,name:'以前の版'});await window.luma.autosave(p);await window.luma.clearRecovery();},project);
 const list=await page.evaluate(()=>window.luma.listBackups());assert.equal(list.length,3);assert.equal(list[0].name,project.name);
 await page.getByRole('button',{name:'ファイル',exact:true}).click();await page.getByRole('button',{name:'バックアップ履歴',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'バックアップ履歴',exact:true});await dialog.getByRole('button',{name:'この版を復元'}).first().waitFor();
 assert.equal(await dialog.getByRole('option',{name:project.name,exact:true}).count(),1);assert.equal(await dialog.getByRole('option',{name:'以前の版',exact:true}).count(),0);
 await page.screenshot({path:path.join(root,'test-results','backup-history.png'),animations:'disabled'});
 await dialog.locator('article').filter({hasText:'以前の版'}).getByRole('button',{name:'この版を復元'}).click();await page.getByRole('button',{name:'以前の版',exact:true}).waitFor();assert.equal(await page.locator('.unsaved-dot').count(),1);
 const file=path.join(profile,'recovered.luma');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).name,'以前の版');assert.ok((await page.evaluate(()=>window.luma.listBackups())).length>=2);assert.deepEqual(errors,[]);
 await app.evaluate(({ipcMain},p)=>{ipcMain.removeHandler('read-backup');ipcMain.handle('read-backup',()=>new Promise(resolve=>{globalThis.__finishBackup=()=>resolve({project:p,savedAt:new Date().toISOString()});}));},project);
 await page.getByRole('button',{name:'ファイル',exact:true}).click();await page.getByRole('button',{name:'バックアップ履歴',exact:true}).click();await dialog.getByRole('button',{name:'この版を復元'}).first().click();
 await page.getByRole('button',{name:'ファイル',exact:true}).focus();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await app.evaluate(()=>globalThis.__finishBackup());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.getByRole('button',{name:'以前の版',exact:true}).count(),1);assert.equal(await page.locator('.unsaved-dot').count(),0);
 console.log('Backup history UI: versions remain after save/discard, selected older version restores dirty, new save path works.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
