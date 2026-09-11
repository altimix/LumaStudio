const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ffmpeg,run,inspectMedia}=require('../electron/media.cjs');
const root=path.join(__dirname,'..');
(async()=>{
 const results=path.join(root,'test-results','universal-tracks');await fs.mkdir(results,{recursive:true});
 const videoPath=path.join(results,'青い映像.mp4'),audioPath=path.join(results,'テスト音.wav');
 await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=4','-c:v','libx264','-pix_fmt','yuv420p',videoPath]);
 await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=4:sample_rate=48000','-c:a','pcm_s16le',audioPath]);
 const assets=await Promise.all([videoPath,audioPath].map(f=>inspectMedia(f,path.join(results,'cache'))));
 const base={start:0,in:0,duration:4,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'',fontSize:94,color:'#ff0000',textStyle:'hero'};
 const project={version:1,id:'universal',name:'上下を同じように編集',width:320,height:180,fps:30,assets,markers:[],tracks:[{id:'v',kind:'video',name:'Video1',autoName:true},{id:'a',kind:'audio',name:'Audio1',autoName:true}].map(t=>({...t,muted:false,hidden:false,locked:false,solo:false})),clips:[{...base,id:'video',trackId:'v',assetId:assets[0].id,kind:'video',name:'青い映像'},{...base,id:'audio',trackId:'a',assetId:assets[1].id,kind:'audio',name:'テスト音'}]};
 const file=path.join(results,'上下.luma');await fs.writeFile(file,JSON.stringify(project));
 const profile=await fs.mkdtemp(path.join(results,'profile-')),env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.LUMA_DEMO_FIXTURE;delete env.LUMA_TEST_FIXTURES;
 const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('.app-titlebar').waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
  const names=()=>page.locator('.track-label input').evaluateAll(es=>es.map(e=>e.value));
  const expectNames=async expected=>{await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('.track-label input')].map(e=>e.value))===JSON.stringify(expected),expected);assert.deepEqual(await names(),expected);};
  await expectNames(['Video2','Video1','Audio1','Audio2']);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
  async function open(name=project.name){await page.keyboard.press('Control+o');await page.getByRole('button',{name,exact:true}).waitFor();await page.getByRole('dialog',{name:'プロジェクトを開いています',exact:true}).waitFor({state:'hidden'});}
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:0,y:0,width:1600,height:1000}));
  await page.waitForFunction(()=>innerHeight>=900);
  await open();await page.locator('.timeline-clip[data-clip-id="video"]').waitFor();
  // Make all three rows visible before raw pointer gestures (CI desktop sizes vary).
  const divider=await page.getByRole('separator',{name:'タイムラインの高さを変更'}).boundingBox();
  await page.mouse.move(divider.x+divider.width/2,divider.y+divider.height/2);await page.mouse.down();await page.mouse.move(divider.x+divider.width/2,divider.y-180,{steps:12});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('.timeline-container').getBoundingClientRect().height>=320);
  async function drag(id,track){const c=page.locator(`.timeline-clip[data-clip-id="${id}"]`),lane=page.locator(`[data-track-id="${track}"]`);await c.scrollIntoViewIfNeeded();const b=await c.boundingBox(),dest=await lane.boundingBox(),x=b.x+Math.min(35,b.width/2);await page.mouse.move(x,b.y+12);await page.mouse.down();await page.mouse.move(x,dest.y+12,{steps:12});await page.mouse.up();}
  // A locked destination rejects a cross-group move.
  await page.getByRole('button',{name:'Audio1 ロック',exact:true}).click();await drag('video','a');
  assert.equal(await page.locator('.timeline-clip[data-clip-id="video"]').evaluate(e=>e.parentElement.dataset.trackId),'v');
  await page.getByRole('button',{name:'Audio1 ロック解除',exact:true}).click();
  await drag('video','a');await page.waitForFunction(()=>document.querySelectorAll('.track-lane').length===3);
  await expectNames(['Video1','Audio1','Audio2']);
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelectorAll('.track-lane').length===2);await expectNames(['Video1','Audio1']);
  await page.keyboard.press('Control+Shift+z');await page.waitForFunction(()=>document.querySelectorAll('.track-lane').length===3);
  await drag('audio','v');await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
  const saved=JSON.parse(await fs.readFile(file,'utf8')),visual=saved.clips.find(c=>c.id==='video'),sound=saved.clips.find(c=>c.id==='audio');
  assert.equal(saved.tracks.find(t=>t.id===visual.trackId).kind,'audio');assert.equal(sound.trackId,'v');assert.equal(visual.start,0);assert.equal(sound.start,0);
  await fs.writeFile(file,JSON.stringify({...saved,name:'上下の再読込'}));await open('上下の再読込');await page.keyboard.press('Home');
  await page.waitForFunction(()=>{const c=document.querySelector('.canvas-wrap canvas');return Number(c.dataset.previewTime)===0&&c.getContext('2d').getImageData(2,2,1,1).data[2]>180;});
  await page.keyboard.press('Space');await page.waitForFunction(()=>[...document.querySelectorAll('.meter-channel')].some(e=>Number(e.dataset.db)>-40),{},{timeout:30000});
  await page.waitForFunction(()=>Number(document.querySelector('.canvas-wrap canvas').dataset.previewTime)>1);
  const levels=await page.locator('.meter-channel').evaluateAll(es=>es.map(e=>Number(e.dataset.db)));assert.ok(levels.some(db=>Number.isFinite(db)&&db>-40));await page.keyboard.press('Space');
  const heights=await page.locator('.track-lane,.track-label').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));assert.equal(new Set(heights).size,1);
  assert.equal(await page.locator('.track-label.track-boundary').count(),1);assert.equal(await page.locator('.track-lane.track-boundary').count(),1);
  await page.getByRole('button',{name:'Audio1 非表示',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.canvas-wrap canvas').getContext('2d').getImageData(2,2,1,1).data[2]<20);
  await page.getByRole('button',{name:'Audio1 表示',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.canvas-wrap canvas').getContext('2d').getImageData(2,2,1,1).data[2]>180);
  await page.screenshot({path:path.join(results,'editor.png')});
  const output=path.join(results,'上下から書き出し.mp4');await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);
  await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('書き出し方式',{exact:true}).selectOption('cpu');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();await page.getByText('書き出しが完了しました',{exact:true}).waitFor({timeout:120000});
  const rgb=await run(ffmpeg,['-v','error','-i',output,'-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.equal(rgb.length,120*3);for(let i=2;i<rgb.length;i+=3)assert.ok(rgb[i]>180);
  const pcm=await run(ffmpeg,['-v','error','-i',output,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1']);let energy=0;for(let i=0;i<pcm.length;i+=4)energy+=pcm.readFloatLE(i)**2;const rms=Math.sqrt(energy/(pcm.length/4));assert.ok(rms>.03);assert.deepEqual(errors,[]);
  const evidence={passed:true,packaged:!!executablePath,names:await names(),heights,levels,rms,frames:120};await fs.writeFile(path.join(results,'verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }catch(error){const page=await app.firstWindow();await page.screenshot({path:path.join(results,'failure.png')}).catch(()=>{});console.error(await page.locator('.statusbar').textContent().catch(()=>null));throw error;}finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
