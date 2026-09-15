const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ffmpeg, run, inspectMedia, probe } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');
(async () => {
  const results = path.join(root,'test-results','frame-save'); await fs.mkdir(results,{recursive:true});
  await fs.mkdir(path.join(root,'.local'),{recursive:true});
  const profile = await fs.mkdtemp(path.join(root,'.local','frame-save-profile-'));
  const folder = path.join(profile,'写真 保存先'), importFolder = path.join(profile,'読み込み 素材');
  await fs.mkdir(folder); await fs.mkdir(importFolder);
  const source = path.join(importFolder,'赤から青.mp4');
  await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=red:s=1280x720:r=30:d=2','-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='gte(n,15)'",'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',source]);
  const asset = {...await inspectMedia(source,path.join(profile,'cache')),url:'',thumbnail:''};
  const base = {id:'video',assetId:asset.id,trackId:'video-track',name:'動画',kind:'video',start:0,in:0,duration:2,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'',fontSize:50,color:'#00ff00',textStyle:'minimal'};
  const project = {version:1,id:'frame-test',name:'写真保存の検証',width:1280,height:720,fps:30,assets:[asset],markers:[],tracks:[{id:'overlay',kind:'video',name:'図形'},{id:'video-track',kind:'video',name:'映像',locked:true}],clips:[base,{...base,id:'shape',assetId:undefined,trackId:'overlay',kind:'title',name:'緑の図形',graphic:{shape:'rectangle',width:150,height:100,lineWidth:2,fill:true,fillColor:'#00ff00'}}]};
  const projectFile = path.join(profile,'project.luma'); await fs.writeFile(projectFile,JSON.stringify(project));
  const executablePath = process.env.LUMA_VERIFY_EXE, env = {...process.env,LUMA_TEST_DATA:profile,LUMA_DEMO_FIXTURE:'0'};delete env.ELECTRON_RUN_AS_NODE;
  let app;const checks=[],errors=[];
  async function launch() {
    app = await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
    const page = await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
    await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},projectFile);
    await page.getByRole('button',{name:'ファイル',exact:true}).click();await page.getByRole('button',{name:/^プロジェクトを開く/}).click();await page.getByRole('button',{name:project.name,exact:true}).waitFor();return page;
  }
  try {
    let page = await launch();
    const count=()=>page.locator('.media-card').count();
    const dialog=()=>page.getByRole('dialog',{name:'現在のコマを保存',exact:true});
    const open=async()=>{await page.getByRole('button',{name:'現在のコマを保存',exact:true}).click();assert.equal(await dialog().getByRole('checkbox').isChecked(),true);};
    const close=async()=>{await dialog().getByRole('button',{name:'閉じる',exact:true}).last().click();};
    const setSave=async(file,cancel=false)=>app.evaluate(({dialog},{file,cancel})=>{dialog.showSaveDialog=async(_window,options)=>{globalThis.lastFrameDialog=options;return {canceled:cancel,filePath:file};};},{file,cancel});
    const saveProject=async()=>{
      await setSave(projectFile);const before=(await fs.stat(projectFile)).mtimeMs;
      await page.getByRole('button',{name:'プロジェクトを保存 (Ctrl+S)',exact:true}).click();
      const deadline=Date.now()+10000;
      while((await fs.stat(projectFile)).mtimeMs===before){assert.ok(Date.now()<deadline,'native save completed before restart');await new Promise(resolve=>setTimeout(resolve,25));}
      await page.getByRole('dialog',{name:'プロジェクトを保存しています',exact:true}).waitFor({state:'hidden'});
      await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
      return JSON.parse(await fs.readFile(projectFile,'utf8'));
    };
    const pixels=async file=>{const meta=(await probe(file)).streams[0];assert.equal(meta.width,1280);assert.equal(meta.height,720);const rgb=await run(ffmpeg,['-v','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);return (x,y)=>[...rgb.subarray((y*1280+x)*3,(y*1280+x)*3+3)];};
    await page.getByRole('button',{name:'先頭へ (Home)',exact:true}).click();
    await page.getByLabel('プレビュー画質',{exact:true}).selectOption('0.25');
    await page.getByRole('button',{name:'素材パネルを折りたたむ',exact:true}).click();
    const initial=await count(); const png=path.join(folder,'最初のコマ.png');await setSave(png);await open();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.preview-meta .timecode').first().textContent(),'00:00:00:00');
    await page.screenshot({path:path.join(results,'dialog.png')});
    await dialog().getByRole('button',{name:'保存先を選んで保存',exact:true}).click();await dialog().getByText('写真を保存し、プロジェクトの素材に追加しました。',{exact:true}).waitFor({timeout:30000});
    assert.equal(await count(),initial+1);assert.match((await app.evaluate(()=>globalThis.lastFrameDialog)).defaultPath,/写真保存の検証_00-00-00-00\.png$/);
    assert.ok(await page.getByRole('tab',{name:'メディア',exact:true}).isVisible());
    let px=await pixels(png);assert.ok(px(10,10)[0]>240&&px(10,10)[2]<10);assert.deepEqual(px(640,360),[0,255,0]);await close();assert.equal(await page.getByLabel('プレビュー画質').inputValue(),'0.25');
    await page.getByRole('button',{name:'元に戻す (Ctrl+Z)',exact:true}).click();assert.equal(await count(),initial);await fs.access(png);
    await page.getByRole('button',{name:'やり直す (Ctrl+Shift+Z)',exact:true}).click();assert.equal(await count(),initial+1);
    const saved=await saveProject();assert.deepEqual(saved.clips,JSON.parse(JSON.stringify(project.clips)));assert.equal(saved.assets.length,2);
    checks.push('PNG full resolution from quarter preview, red frame and green overlay pixels, default checked, imported photo reveals the already selected media panel, modal blocks timeline shortcuts, undo/redo retains file and locked timeline');
    const jpg=path.join(folder,'青いコマ.jpg');await setSave(jpg);
    await page.keyboard.press('Home');for(let i=0;i<15;i++)await page.getByRole('button',{name:'1フレーム進む (→)',exact:true}).click();
    await open();await dialog().getByRole('combobox').selectOption('jpg');await dialog().getByRole('checkbox').uncheck();await dialog().getByRole('button',{name:'保存先を選んで保存',exact:true}).click();await dialog().getByText('写真を保存しました。',{exact:true}).waitFor({timeout:30000});
    assert.equal(await count(),initial+1);assert.equal(path.dirname((await app.evaluate(()=>globalThis.lastFrameDialog)).defaultPath),folder);
    px=await pixels(jpg);assert.ok(px(10,10)[2]>240&&px(10,10)[0]<10,JSON.stringify(px(10,10)));assert.ok(px(640,360)[1]>240);assert.equal((await fs.readFile(jpg))[0],255);await close();
    checks.push('JPEG correct blue frame immediately after seek, overlay retained, unchecked leaves assets unchanged, save folder remembered');
    await setSave(path.join(folder,'cancel.png'),true);await open();await dialog().getByRole('button',{name:'保存先を選んで保存',exact:true}).click();await dialog().getByRole('button',{name:'保存先を選んで保存',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.frame-save-form [role=status]'));assert.equal(await count(),initial+1);await assert.rejects(fs.stat(path.join(folder,'cancel.png')));await close();
    await setSave(png);await open();await dialog().getByRole('button',{name:'保存先を選んで保存',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'元の素材'}).waitFor();assert.equal(await count(),initial+1);await close();
    checks.push('cancel and source overwrite rejection do not alter project or files');
    // Native import folder is independent, even when selecting an existing asset.
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async(_window,options)=>{globalThis.lastImportDialog=options;return {canceled:false,filePaths:[file]};};},source);
    await page.getByRole('button', { name: '素材を追加', exact: true }).click(); await page.getByRole('menuitem', { name: '素材を読み込む', exact: false }).click();await page.waitForFunction(()=>!document.querySelector('.import-progress'));
    for(let i=0;i<100;i++){try{await fs.access(path.join(profile,'import-folder.json'));break;}catch{await new Promise(r=>setTimeout(r,50));}}
    assert.equal(JSON.parse(await fs.readFile(path.join(profile,'import-folder.json'))).folder,importFolder);
    await saveProject();await app.close();page=await launch();
    assert.equal(await page.locator('.media-card').count(),2);assert.equal(await page.locator('.media-card.offline').count(),0);
    await setSave('',true);await open();await dialog().getByRole('button',{name:'保存先を選んで保存',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.frame-save-form [role=status]'));assert.equal(path.dirname((await app.evaluate(()=>globalThis.lastFrameDialog)).defaultPath),folder);await close();
    await app.evaluate(({dialog})=>{dialog.showOpenDialog=async(_window,options)=>{globalThis.lastImportDialog=options;return {canceled:true,filePaths:[]};};});await page.getByRole('button', { name: '素材を追加', exact: true }).click(); await page.getByRole('menuitem', { name: '素材を読み込む', exact: false }).click();
    assert.equal((await app.evaluate(()=>globalThis.lastImportDialog)).defaultPath,importFolder);
    checks.push('save/reopen and app restart preserve imported photo and separate photo/import folder preferences');
    // A corrupt image remains offline, but its source path is still protected.
    const offlineSource=path.join(importFolder,'壊れたオフライン.png');
    await run(ffmpeg,['-v','error','-ss','0','-i',source,'-frames:v','1',offlineSource]);
    const offlineAsset={...await inspectMedia(offlineSource,path.join(profile,'cache')),url:'',thumbnail:''};
    const offlineContents=Buffer.from('original corrupt image');await fs.writeFile(offlineSource,offlineContents);
    const offlineFixture={...project,id:'offline-frame-protection',name:'オフライン素材の保護',assets:[asset,offlineAsset]};
    const offlineProject=path.join(profile,'offline.luma');await fs.writeFile(offlineProject,JSON.stringify(offlineFixture));
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},offlineProject);
    await page.keyboard.press('Control+o');await page.getByRole('button',{name:offlineFixture.name,exact:true}).waitFor();await page.locator('.media-card.offline').waitFor();
    await setSave(offlineSource);await open();await dialog().getByRole('checkbox').uncheck();await dialog().getByRole('button',{name:'保存先を選んで保存',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'元の素材'}).waitFor({timeout:30000});
    assert.deepEqual(await fs.readFile(offlineSource),offlineContents);await close();
    checks.push('offline source paths from a loaded project cannot be overwritten');
    await page.screenshot({path:path.join(results,'result.png')});
    await page.locator('.preview-bottom').screenshot({path:path.join(results,'monitor-controls.png')});
    // Full-resolution capture must also wait for async transition composition.
    await page.evaluate(() => {
      globalThis.__frameWorkerRequests=[];
      const getContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){
        if(type==='webgl2')return null;
        return getContext.call(this,type,...args);
      };
      const postMessage=Worker.prototype.postMessage;
      Worker.prototype.postMessage=function(message,...args){
        if(['pageTurn','pagePeel'].includes(message?.kind))globalThis.__frameWorkerRequests.push({kind:message.kind,width:message.width,height:message.height});
        return postMessage.call(this,message,...args);
      };
    });
    const stills = [];
    for (const [name,time] of [['red',0],['blue',1]]) {
      const file=path.join(profile,name+'.png');await run(ffmpeg,['-v','error','-ss',String(time),'-i',source,'-frames:v','1',file]);
      stills.push({...await inspectMedia(file,path.join(profile,'cache')),url:'',thumbnail:''});
    }
    for (const kind of ['dissolve','pageTurn','pagePeel']) {
      const fixture={...project,id:'transition-'+kind,name:'写真のトランジション '+kind,assets:stills,clips:[{...base,id:'from',kind:'image',assetId:stills[0].id,duration:1},{...base,id:'to',kind:'image',assetId:stills[1].id,start:.5,duration:1},project.clips[1]],transitions:[{id:'blend',fromId:'from',toId:'to',video:kind}]};
      const file=path.join(profile,kind+'.luma');await fs.writeFile(file,JSON.stringify(fixture));
      await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
      await page.keyboard.press('Control+o');await page.getByRole('button',{name:fixture.name,exact:true}).waitFor();
      await page.getByRole('button',{name:'先頭へ (Home)',exact:true}).click();for(let i=0;i<23;i++)await page.getByRole('button',{name:'1フレーム進む (→)',exact:true}).click();
      await page.getByLabel('プレビュー画質').selectOption('1');
      await page.waitForFunction(()=>{const c=document.querySelector('canvas[aria-label="動画プレビュー"]');return c.width===1280&&c.dataset.transitionsReady==='true'&&c.dataset.transitionKind;});
      const expected=await page.locator('canvas[aria-label="動画プレビュー"]').evaluate(c=>[...c.getContext('2d').getImageData(10,10,1,1).data].slice(0,3));
      await page.getByLabel('プレビュー画質').selectOption('0.25');
      const workerRequestStart=await page.evaluate(()=>globalThis.__frameWorkerRequests.length);
      const output=path.join(results,kind+'.png');await setSave(output);await open();await dialog().getByRole('checkbox').uncheck();await dialog().getByRole('button',{name:'保存先を選んで保存',exact:true}).click();await dialog().getByText('写真を保存しました。',{exact:true}).waitFor({timeout:30000});
      const pixel=await pixels(output);assert.deepEqual(pixel(10,10),expected,kind);assert.deepEqual(pixel(640,360),[0,255,0]);await close();
      if(kind!=='dissolve'){
        const requests=await page.evaluate(start=>globalThis.__frameWorkerRequests.slice(start),workerRequestStart);
        assert.ok(requests.some(request=>request.kind===kind&&request.width===1280&&request.height===720),`${kind} did not use the project dimensions in the worker fallback: ${JSON.stringify(requests)}`);
      }
    }
    checks.push('dissolve, page turn and page peel saved pixels match full-resolution preview; forced worker fallback receives 1280x720 while original quality remains quarter');
    assert.deepEqual(errors,[]);
    await fs.copyFile(png,path.join(results,'saved.png'));await fs.copyFile(jpg,path.join(results,'saved.jpg'));
    await fs.writeFile(path.join(results,'verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
  } catch(error) {
    if(app)await app.firstWindow().then(page=>page.screenshot({path:path.join(results,'failure.png')})).catch(()=>{});
    throw error;
  } finally { if(app)await app.close().catch(()=>{}); await fs.rm(profile,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
