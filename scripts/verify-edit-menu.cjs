const {_electron:electron}=require('playwright');const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');const root=path.join(__dirname,'..');
(async()=>{
 await fs.mkdir(path.join(root,'.local'),{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});const profile=await fs.mkdtemp(path.join(root,'.local','edit-menu-')),env={...process.env,LUMA_TEST_DATA:profile,LUMA_DEMO_FIXTURE:'1',LUMA_TEST_FIXTURES:path.join(root,'public','demo')};delete env.ELECTRON_RUN_AS_NODE;
 const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000}),page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const menu=()=>page.getByRole('menu',{name:'編集',exact:true}),open=()=>page.locator('.app-menu').getByRole('button',{name:'編集',exact:true}).click();const action=label=>menu().getByRole('menuitem',{name:new RegExp('^'+label)});
 try{
 await page.locator('.media-card').first().waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
 const count=await page.locator('.timeline-clip').count(),mac=process.platform==='darwin';const saveButton=page.getByRole('button',{name:`プロジェクトを保存 (${mac?'⌘':'Ctrl'}+S)`,exact:true});assert.equal(await saveButton.count(),1);
 await open();assert.ok(await action('元に戻す').isDisabled());assert.ok(await action('再生ヘッドに貼り付け').isDisabled());await action('コピー').click();
 await open();assert.ok(await action('再生ヘッドに貼り付け').isEnabled());await action('複製').click();await page.waitForFunction(n=>document.querySelectorAll('.timeline-clip').length>n,count);
 await open();await action('元に戻す').click();assert.equal(await page.locator('.timeline-clip').count(),count);
 await open();await action('やり直す').click();assert.ok(await page.locator('.timeline-clip').count()>count);
 await page.locator('.timeline-clip').last().click();await open();await action('削除').click();assert.equal(await page.locator('.timeline-clip').count(),count);
 await open();await action('すべてのクリップを選択').click();assert.equal(await page.locator('.timeline-clip.selected').count(),count);
 await page.getByRole('button',{name:'Video1 ロック',exact:true}).click();await open();assert.ok(await action('削除').isDisabled());assert.ok(await action('複製').isDisabled());
 await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement?.textContent.startsWith('すべてのクリップ')),true);await page.keyboard.press('Escape');assert.equal(await menu().count(),0);
 await page.screenshot({path:path.join(root,'test-results','edit-menu.png')});assert.deepEqual(errors,[]);console.log('Edit menu: Undo/Redo/copy/duplicate/delete/select-all, lock protection, keyboard navigation and OS labels passed.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
