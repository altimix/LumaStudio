const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),results=path.join(root,'test-results');

(async()=>{
  await fs.mkdir(path.join(root,'.local'),{recursive:true});await fs.mkdir(results,{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'.local','save-on-exit-profile-')),file=path.join(profile,'終了時に保存した編集.luma');
  const env={...process.env,LUMA_TEST_DATA:profile,LUMA_TEST_CLOSE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.LUMA_VERIFY_EXE||path.join(root,'release','win-unpacked','Luma Studio.exe');
  let app,page;const checks=[],errors=[];
  const poll=async predicate=>{const deadline=Date.now()+10000;while(!await predicate()){assert.ok(Date.now()<deadline,'native operation completed');await new Promise(resolve=>setTimeout(resolve,25));}};
  const launch=async()=>{
    app=await electron.launch({executablePath,args:[],env,timeout:60000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
    await page.locator('.media-card').first().waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden'});
    await app.evaluate(({dialog},file)=>{
      globalThis.__exitDialogs=[];globalThis.__exitChoice=0;globalThis.__saveDialogs=0;
      dialog.showMessageBoxSync=(_window,options)=>{globalThis.__exitDialogs.push(options);return options.title==='書き出し中です'?(globalThis.__exportChoice||0):globalThis.__exitChoice;};
      dialog.showSaveDialog=async()=>{globalThis.__saveDialogs++;return{canceled:true};};
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
    },file);
  };
  const edit=async name=>{await page.locator('.timeline-clip').first().click({position:{x:30,y:24}});const input=page.getByRole('textbox',{name:'クリップ名',exact:true});await input.fill(name);await input.blur();await page.locator('.unsaved-dot').waitFor();};
  const requestClose=async choice=>{await app.evaluate(({BrowserWindow},choice)=>{globalThis.__exitChoice=choice;setImmediate(()=>BrowserWindow.getAllWindows()[0].close());},choice);};
  const remain=async choice=>{const count=await app.evaluate(()=>globalThis.__exitDialogs.length);await requestClose(choice);await poll(async()=>await app.evaluate(()=>globalThis.__exitDialogs.length)>count);assert.ok(!page.isClosed());return app.evaluate(()=>globalThis.__exitDialogs.at(-1));};
  const finish=async choice=>{await page.getByRole('dialog',{name:'プロジェクトを保存しています',exact:true}).waitFor({state:'hidden'});const closed=app.waitForEvent('close',{timeout:30000});await requestClose(choice);await closed;app=null;};
  const open=async()=>{const p=JSON.parse(await fs.readFile(file,'utf8'));await page.keyboard.press('Control+o');await page.locator(`.timeline-clip[data-clip-id="${p.clips[0].id}"]`).waitFor();await page.waitForFunction(()=>document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]')?.disabled===true);};
  const saved=async()=>JSON.parse(await fs.readFile(file,'utf8'));
  try{
    await launch();
    const trackInput = page.locator('.track-label input').first();
    await trackInput.fill('終了前に確定するトラック名');
    assert.equal(await page.locator('.unsaved-dot').count(), 0);
    await remain(0);
    await page.locator('.unsaved-dot').waitFor();
    assert.equal(await trackInput.inputValue(), '終了前に確定するトラック名');
    checks.push('native close flushes focused track-name drafts before checking dirty state');
    await edit('新規の保存前');
    const options=await remain(0);assert.deepEqual(options.buttons,['編集を続ける','保存せずに終了','保存して終了']);assert.equal(options.defaultId,0);assert.equal(options.cancelId,0);
    await remain(-1);assert.equal(await app.evaluate(()=>globalThis.__saveDialogs),0);
    checks.push('native close presents the three Japanese choices and continuing or cancelling keeps the dirty edit open');
    await remain(2);await poll(async()=>await app.evaluate(()=>globalThis.__saveDialogs)===1);await page.getByRole('dialog',{name:'プロジェクトを保存しています',exact:true}).waitFor({state:'hidden'});await remain(0);await assert.rejects(fs.access(file));
    checks.push('cancelling the new-project save destination returns to editing and permits a later close request');
    const previous='preserve this existing file on failure';await fs.writeFile(file,previous);
    await app.evaluate(({dialog},file)=>{
      dialog.showSaveDialog=async()=>{globalThis.__saveDialogs++;return{canceled:false,filePath:file};};
      const files=process.getBuiltinModule('fs/promises'),rename=files.rename;globalThis.__restoreRename=()=>{files.rename=rename;};
      files.rename=async(from,to)=>{if(to===file)throw new Error('test exit write failure');return rename(from,to);};
    },file);
    await remain(2);await page.locator('.toast').filter({hasText:'test exit write failure'}).waitFor();assert.equal(await fs.readFile(file,'utf8'),previous);assert.ok(!page.isClosed());assert.equal((await fs.readdir(profile)).filter(name=>name.endsWith('.tmp')).length,0);await app.evaluate(()=>globalThis.__restoreRename());
    checks.push('a failed atomic replacement preserves the existing file, removes its temporary file, and leaves editing open');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>{globalThis.__saveDialogs++;await new Promise(resolve=>{globalThis.__releaseSave=resolve;});return{canceled:false,filePath:file};};},file);
    await page.evaluate(()=>{window.luma.onSaveBeforeClose(id=>{window.__closeRequest=id;});});await remain(2);await page.getByRole('dialog',{name:'プロジェクトを保存しています',exact:true}).waitFor();
    const pending=await app.evaluate(()=>({dialogs:globalThis.__exitDialogs.length,saves:globalThis.__saveDialogs}));await requestClose(2);assert.deepEqual(await app.evaluate(()=>({dialogs:globalThis.__exitDialogs.length,saves:globalThis.__saveDialogs})),pending);
    const rejected=await page.evaluate(async()=>{try{await window.luma.finishSaveBeforeClose(window.__closeRequest-1,true);return false;}catch{return true;}});assert.equal(rejected,true);assert.ok(!page.isClosed());await page.keyboard.press('Control+z');await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'プロジェクトを保存しています',exact:true}).waitFor();await page.screenshot({path:path.join(results,'save-on-exit-pending.png')});
    const closed=app.waitForEvent('close',{timeout:30000});await app.evaluate(()=>globalThis.__releaseSave());await closed;app=null;
    assert.ok((await saved()).clips.some(c=>c.name==='新規の保存前'));await assert.rejects(fs.access(path.join(profile,'autosave.luma')));
    checks.push('save-and-exit waits for the new project, blocks duplicate closes and keyboard edits, rejects stale replies, and retires recovery');
    await launch();assert.equal(await page.locator('.recovery-banner').count(),0);await open();await edit('既存の編集を上書き');await finish(2);assert.ok((await saved()).clips.some(c=>c.name==='既存の編集を上書き'));
    checks.push('save-and-exit reuses an existing project path without opening a new save dialog and reloads the saved edit');
    await launch();await open();await edit('保存しない編集');await page.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('自動保存'));const beforeDiscard=await fs.readFile(file,'utf8');await finish(1);assert.equal(await fs.readFile(file,'utf8'),beforeDiscard);
    await launch();await page.locator('.recovery-banner').waitFor();const cleanClosed=app.waitForEvent('close',{timeout:30000});await requestClose(0);await cleanClosed;app=null;
    checks.push('exit-without-saving preserves the project bytes and recovery; a clean project exits without a confirmation');
    await launch();await open();await edit('保存開始時点');
    await app.evaluate((_electron,file)=>{const files=process.getBuiltinModule('fs/promises'),rename=files.rename;globalThis.__restoreRename=()=>{files.rename=rename;};files.rename=async(from,to)=>{if(to===file)await new Promise(resolve=>{globalThis.__releaseWrite=resolve;});return rename(from,to);};},file);
    await remain(2);await poll(async()=>await app.evaluate(()=>!!globalThis.__releaseWrite));
    // Model edits may also arrive asynchronously (for example completed audio analysis).
    await page.getByRole('textbox',{name:'クリップ名',exact:true}).evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'保存中に到着した変更');input.dispatchEvent(new Event('input',{bubbles:true}));});
    await app.evaluate(()=>{globalThis.__restoreRename();globalThis.__releaseWrite();});await page.locator('.toast').filter({hasText:'保存中に新しい変更'}).waitFor();assert.ok(!page.isClosed());assert.ok((await saved()).clips.some(c=>c.name==='保存開始時点'));assert.equal(await page.getByRole('textbox',{name:'クリップ名',exact:true}).inputValue(),'保存中に到着した変更');await page.locator('.unsaved-dot').waitFor();await page.getByRole('dialog',{name:'プロジェクトを保存しています',exact:true}).waitFor({state:'hidden'});await finish(2);assert.ok((await saved()).clips.some(c=>c.name==='保存中に到着した変更'));
    checks.push('an edit arriving during saving prevents exit and remains available for a second save-and-exit');
    await launch();await open();await edit('自動保存の整理が失敗しても保持');
    await app.evaluate((_electron,autosave)=>{const files=process.getBuiltinModule('fs/promises'),rm=files.rm;globalThis.__restoreRm=()=>{files.rm=rm;};files.rm=async(file,...args)=>{if(file===autosave)throw new Error('test exit recovery cleanup failure');return rm(file,...args);};},path.join(profile,'autosave.luma'));
    await remain(2);await page.locator('.toast').filter({hasText:'test exit recovery cleanup failure'}).waitFor();assert.ok(!page.isClosed());assert.ok((await saved()).clips.some(c=>c.name==='自動保存の整理が失敗しても保持'));await app.evaluate(()=>globalThis.__restoreRm());await finish(0);
    checks.push('recovery cleanup failure leaves the window open after a successful project write');
    await launch();await open();await edit('書き出し中の編集');
    await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},path.join(profile,'終了確認中の動画.mp4'));
    await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('書き出しサイズ',{exact:true}).selectOption('4k');await page.getByLabel('書き出し方式',{exact:true}).selectOption('cpu');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();
    await page.waitForFunction(()=>Number(document.querySelector('.export-progress progress')?.value)>0,{},{timeout:120000});
    const duringExport=await remain(0);assert.equal(duringExport.title,'書き出し中です');assert.deepEqual(duringExport.buttons,['編集を続ける','書き出しを中止して終了']);
    await app.evaluate(()=>{globalThis.__exportChoice=1;});const afterAbort=await remain(0);assert.deepEqual(afterAbort.buttons,options.buttons);assert.ok(!page.isClosed());await page.locator('.export-error').filter({hasText:/キャンセル|中止/}).waitFor({timeout:30000});await finish(2);assert.ok((await saved()).clips.some(c=>c.name==='書き出し中の編集'));
    checks.push('continuing during export keeps it running; aborting export then presents all three unsaved-edit choices and allows saving');
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(results,'save-on-exit-verification.json'),JSON.stringify({passed:true,packaged:true,checks,dialog:options,consoleErrors:errors},null,2));console.log(`Save-on-exit verified: ${checks.length} checks.`);
  }catch(e){if(page&&!page.isClosed())await page.screenshot({path:path.join(results,'save-on-exit-failure.png')}).catch(()=>{});await fs.writeFile(path.join(results,'save-on-exit-failure.json'),JSON.stringify({checks,error:String(e)},null,2));throw e;}
  finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}}
})().catch(error=>{console.error(error);process.exitCode=1;});
