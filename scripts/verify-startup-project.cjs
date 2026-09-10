const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ffmpeg,run,inspectMedia}=require('../electron/media.cjs');
const {bundleStartupProject,hash}=require('./bundle-startup-project.cjs');
const {timelineKey}=require('../shared/youtube.mjs');
const root=path.join(__dirname,'..');
async function verify(){
  const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'.local','startup-profile-')),source=path.join(profile,'source.png');
  await run(ffmpeg,['-v','error','-f','lavfi','-i','color=blue:s=320x180','-frames:v','1','-update','1',source]);
  const asset=await inspectMedia(source,path.join(profile,'cache'));
  const project={version:1,id:'initial',name:'初期テンプレートの検証',width:320,height:180,fps:30,assets:[asset],clips:[],markers:[],tracks:[{id:'v1',kind:'video',name:'映像',muted:false,hidden:false,locked:false,solo:false}]};
  project.youtube={sourceKey:timelineKey(project),cues:[],titles:['保存済みの投稿タイトル'],description:'保存済みの概要欄',chapters:[],keywords:[],thumbnailPrompt:'',thumbnailAssetId:asset.id};
  const movie=path.join(profile,'original.mp4');await run(ffmpeg,['-v','error','-f','lavfi','-i','color=red:s=320x180:r=30:d=1','-c:v','libx264','-pix_fmt','yuv420p',movie]);project.assets.push(await inspectMedia(movie,path.join(profile,'cache')));
  const input=path.join(profile,'source.luma');await fs.writeFile(input,JSON.stringify(project));
  const staging=path.join(profile,'staging');await bundleStartupProject(input,staging);
  const directory=path.join(profile,'初期プロジェクト');await fs.rename(staging,directory);await fs.unlink(source);await fs.unlink(movie);
  const template=path.join(directory,'初期プロジェクト.luma'),before=await hash(template),output=path.join(profile,'編集したプロジェクト.luma');
  const executablePath=process.env.LUMA_VERIFY_EXE,env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.getByRole('button',{name:project.name,exact:true}).waitFor({timeout:60000});assert.equal(await page.locator('.media-card').count(),2);assert.equal(await page.locator('.media-card.offline').count(),0);
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},template);
    await page.getByRole('button',{name:'プロジェクトを保存 (Ctrl+S)',exact:true}).click();
    await page.getByText('元の素材を保存先に指定することはできません。',{exact:false}).first().waitFor();
    assert.equal(await hash(template),before,'Save cannot overwrite the template');
    const initialSave=path.join(profile,'初回保存.luma');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},initialSave);
    await page.getByRole('button',{name:'プロジェクトを保存 (Ctrl+S)',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.project-subtitle')?.textContent?.includes('初回保存')||!document.querySelector('.unsaved-dot'));
    let initial;for(let i=0;i<100;i++){try{initial=JSON.parse(await fs.readFile(initialSave,'utf8'));break;}catch{await new Promise(r=>setTimeout(r,50));}}
    assert.ok(initial);assert.equal(initial.youtube.thumbnailAssetId,initial.assets[0].id);assert.notEqual(initial.youtube.sourceKey,timelineKey(initial));assert.deepEqual(initial.youtube.titles,project.youtube.titles);
    await page.locator('.media-card').first().click();await page.getByRole('button',{name:'選択素材をタイムラインに追加',exact:true}).click();await page.locator('.timeline-clip.image').waitFor();
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.keyboard.press('Control+Shift+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
    const saved=JSON.parse(await fs.readFile(output,'utf8'));assert.notEqual(saved.id,project.id);assert.equal(saved.clips.length,1);assert.equal(await hash(template),before);assert.ok(saved.assets[0].path.startsWith(directory));assert.deepEqual(errors,[]);
    const protectedMovie=saved.assets.find(a=>a.kind==='video'),mediaHash=await hash(protectedMovie.path);
    const withoutMovie={...saved,assets:saved.assets.filter(a=>a.id!==protectedMovie.id)};
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},protectedMovie.path);
    const rejection=await page.evaluate(async p=>{try{await window.luma.exportProject(p,{width:320,height:180,fps:30,quality:'draft',encoder:'cpu'},[]);return '';}catch(e){return e.message;}},withoutMovie);
    assert.match(rejection,/元の素材を保存先/,'removed bundled media stays protected from export');assert.equal(await hash(protectedMovie.path),mediaHash);
    await page.screenshot({path:path.join(results,'startup-project.png')});await fs.writeFile(path.join(results,'startup-project-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks:['相対パスで素材を同梱','保存済みサムネイル参照・YouTubeデータの引継ぎ','元素材削除後・フォルダ移動後の起動','初期素材をタイムラインへ追加','別プロジェクトへ保存・テンプレート不変','素材一覧から除外後も同梱動画の上書きを拒否']},null,2));console.log('Startup project verified');
  }finally{await app.close();}
}
verify().catch(e=>{console.error(e);process.exitCode=1;});
