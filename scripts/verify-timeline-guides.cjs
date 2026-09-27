const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');
(async () => {
  const results = path.join(root, 'test-results', 'timeline-guides'); await fs.mkdir(results, { recursive: true });
  const profile = await fs.mkdtemp(path.join(results, 'profile-')), file = path.join(profile, '切断とトラック.luma');
  const video = path.join(results, '映像.mp4'), audio = path.join(results, '音声.wav'), image = path.join(results, '画像.png');
  await run(ffmpeg, ['-y','-v','error','-f','lavfi','-i','color=blue:s=320x180:r=30:d=4','-c:v','libx264','-pix_fmt','yuv420p',video]);
  await run(ffmpeg, ['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=4','-c:a','pcm_s16le',audio]);
  await run(ffmpeg, ['-y','-v','error','-f','lavfi','-i','color=red:s=64x64','-frames:v','1',image]);
  const assets = await Promise.all([video,audio,image].map(file => inspectMedia(file,path.join(results,'cache'))));
  const base = {start:0,in:0,duration:4,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'切断位置の確認',fontSize:50,color:'#ffffff',textStyle:'minimal'};
  const project = {version:1,id:'guides',name:'切断位置と音声専用トラック',width:320,height:180,fps:30,assets,markers:[],
    tracks:[['v2','video','Video2'],['v1','video','Video1'],['a1','audio','Audio1'],['a2','audio','Audio2']].map(([id,kind,name])=>({id,kind,name,autoName:true,locked:false,hidden:false,muted:false,solo:false})),
    clips:[{...base,id:'title',trackId:'v2',kind:'title',name:'切断ガイド',duration:40},
      {...base,id:'video',trackId:'v1',kind:'video',name:'映像',assetId:assets[0].id},
      {...base,id:'later',trackId:'v1',kind:'video',name:'後の映像',assetId:assets[0].id,start:12},
      {...base,id:'audio',trackId:'a1',kind:'audio',name:'音声',assetId:assets[1].id,start:2}]};
  await fs.writeFile(file,JSON.stringify(project));
  const env = {...process.env,LUMA_TEST_DATA:profile,LUMA_DEMO_FIXTURE:'0'}; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE, app = await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
  const page = await app.firstWindow(), checks = [], errors = []; page.on('pageerror',e=>errors.push(e.message));
  const button = name => page.getByRole('button',{name,exact:true});
  const settle = () => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const zoom = () => page.getByRole('slider',{name:'タイムラインのズーム'}).inputValue().then(Number);
  const lane = id => page.locator(`.track-lane[data-track-id="${id}"]`);
  const save = async () => {
    const before = (await fs.stat(file)).mtimeMs; await button(/^プロジェクトを保存 \(/).click();
    const until = Date.now()+15000;
    while((await fs.stat(file)).mtimeMs===before){assert.ok(Date.now()<until,'save completed');await new Promise(resolve=>setTimeout(resolve,30));}
    await page.getByRole('dialog',{name:'プロジェクトを保存しています',exact:true}).waitFor({state:'hidden'}); return JSON.parse(await fs.readFile(file,'utf8'));
  };
  const point = async (time,track='v2',offset=5) => {
    await settle();const b=await lane(track).boundingBox();return{x:b.x+time*await zoom()+offset,y:b.y+12};
  };
  const head = async () => {await settle();return await page.locator('.playhead').evaluate(el=>Number.parseFloat(el.style.left))/await zoom();};
  const guideTime = async () => {await settle();return Number(await page.locator('.razor-guide').getAttribute('data-time'));};
  // Electron's OS-level drag loop can block CDP on macOS. Send the same HTML5
  // events through the real library and lane handlers, including protected-mode types.
  const dropAsset = async assetId => {
    const accepted=await page.evaluate(assetId=>{
      const source=document.querySelector(`.media-card[data-asset-id="${assetId}"]`),target=document.querySelector('.track-lane[data-track-id="a2"]');
      const dataTransfer=new DataTransfer(),rect=target.getBoundingClientRect();
      source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer}));
      const drag=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer,clientX:rect.left+80,clientY:rect.top+24});target.dispatchEvent(drag);
      if(drag.defaultPrevented)target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientX:rect.left+80,clientY:rect.top+24}));
      source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));return drag.defaultPrevented;
    },assetId);await settle();return accepted;
  };
  try {
    await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
    await page.waitForFunction(()=>innerWidth===1440&&innerHeight===900);
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    await page.keyboard.press('Control+o');await button(project.name).waitFor();await settle();
    const divider=await page.getByRole('separator',{name:'タイムラインの高さを変更'}).boundingBox();
    await page.mouse.move(divider.x+divider.width/2,divider.y+divider.height/2);await page.mouse.down();await page.mouse.move(divider.x+divider.width/2,divider.y-120,{steps:6});await page.mouse.up();
    const heights=await page.locator('.track-lane,.track-label').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));assert.ok(heights.every(h=>h===48));
    const controls=await page.locator('.track-label').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect(),cs=[...e.querySelectorAll('input,button')].map(x=>x.getBoundingClientRect());return{aligned:cs.every(c=>Math.abs(c.top+c.height/2-(r.top+r.height/2))<1),contained:cs.every(c=>c.left>=r.left&&c.right<=r.right),count:e.querySelectorAll('button').length};}));
    assert.ok(controls.every(c=>c.aligned&&c.contained));assert.deepEqual(controls.map(c=>c.count),[5,5,4,4]);
    const heightHandle=button('トラックの高さ（末尾の丸）');await heightHandle.focus();await page.keyboard.press('ArrowUp');assert.ok((await lane('v2').boundingBox()).height>48);
    const thumb=page.locator('.timeline-navigation.vertical .timeline-navigation-thumb'),thumbBox=await thumb.boundingBox();await thumb.dblclick({position:{x:thumbBox.width/2,y:thumbBox.height/2}});assert.equal((await lane('v2').boundingBox()).height,48);
    checks.push('48px initial/minimum rows, one-row accessible controls, differentiated Audio controls, height increase/reset');
    await page.locator('.brand').click();for(let i=0;i<8;i++)await page.keyboard.press('a');assert.equal(await zoom(),200);
    await page.keyboard.press('c');await settle();let pt=await point(2);await page.mouse.move(pt.x-20,pt.y);await page.mouse.move(pt.x,pt.y,{steps:4});await page.locator('.razor-guide.snapped').waitFor();assert.equal(await guideTime(),2);
    await page.screenshot({path:path.join(results,'snapped-cut-guide.png')});
    await page.mouse.click(pt.x,pt.y);let saved=await save();assert.ok(saved.clips.some(c=>c.kind==='title'&&c.start===2));
    await button(/^元に戻す \(/).click();assert.deepEqual((await save()).clips,project.clips);
    await page.locator('.brand').click();await page.keyboard.press('n');pt=await point(2);await page.mouse.move(pt.x,pt.y);assert.ok(Math.abs(await guideTime()-61/30)<1e-7);assert.equal(await page.locator('.razor-guide.snapped').count(),0);
    await page.mouse.click(pt.x,pt.y);saved=await save();assert.ok(saved.clips.some(c=>c.kind==='title'&&Math.abs(c.start-61/30)<1e-7));
    await button(/^元に戻す \(/).click();await page.locator('.brand').click();await page.keyboard.press('n');
    // A guide at an existing edge does not introduce a tiny/zero-length clip.
    pt=await point(4,'v1',-5);await page.mouse.move(pt.x,pt.y);assert.equal(await guideTime(),4);assert.equal(await page.locator('.razor-guide.at-edge').count(),1);await page.mouse.click(pt.x,pt.y);assert.deepEqual((await save()).clips,project.clips);
    await button('Video2 ロック').click();pt=await point(2);await page.mouse.move(pt.x,pt.y);assert.equal(await page.locator('.razor-guide').count(),0);await page.mouse.click(pt.x,pt.y);assert.equal((await save()).clips.length,project.clips.length);await button('Video2 ロック解除').click();
    checks.push('cut guide matches real split with snap on/off; edge cuts and locked tracks stay unchanged; one Undo restores clips');
    await page.locator('.timeline-scroll').evaluate(v=>{v.scrollLeft=2400;});await settle();pt=await point(16);await page.mouse.move(pt.x,pt.y);assert.equal(await guideTime(),16);
    await page.mouse.move(pt.x,pt.y-70,{steps:4});await settle();assert.equal(await page.locator('.razor-guide').count(),0);await page.locator('.brand').click();await page.keyboard.press('v');
    let ruler=await page.locator('.timeline-ruler').boundingBox();await page.mouse.click(pt.x,ruler.y+8);assert.equal(await head(),16);
    await page.keyboard.press('ArrowRight');assert.ok(Math.abs(await head()-(16+1/30))<1e-4);
    await page.keyboard.press('n');await page.mouse.click(pt.x,ruler.y+8);assert.ok(Math.abs(await head()-(16+1/30))<1e-4);
    await page.keyboard.press('n');await page.locator('.timeline-scroll').evaluate(v=>{v.scrollLeft=2400;});pt=await point(16);ruler=await page.locator('.timeline-ruler').boundingBox();
    await page.mouse.move(pt.x-50,ruler.y+8);await page.mouse.down();await page.mouse.move(pt.x,ruler.y+8,{steps:6});await page.mouse.up();assert.equal(await head(),16);
    await page.locator('.timeline-scroll').evaluate(v=>{v.scrollLeft=0;});pt=await point(2,'a2');await page.mouse.click(pt.x,pt.y);assert.equal(await head(),2);
    await page.keyboard.press('n');await page.mouse.click(pt.x,pt.y);assert.ok(Math.abs(await head()-61/30)<1e-4);await page.keyboard.press('n');
    checks.push('scroll-aware razor and ruler/drag/empty-lane seek snapping; frame navigation remains unsnapped');
    // Native pointer movement and HTML5 asset drags must both respect track kinds.
    await page.locator('.brand').click();for(let i=0;i<6;i++)await page.keyboard.press('s');await page.keyboard.press('Home');
    const before=await save(),source=await page.locator('.timeline-clip[data-clip-id="video"]').boundingBox(),dest=await lane('a2').boundingBox();
    await page.mouse.move(source.x+25,source.y+12);await page.mouse.down();await page.mouse.move(source.x+35,dest.y+12,{steps:10});assert.equal(await page.evaluate(()=>document.documentElement.dataset.timelineGesture),'blocked');await page.mouse.up();assert.deepEqual(await save(),before);
    for(const asset of [assets[0],assets[2]]){assert.equal(await dropAsset(asset.id),false);assert.deepEqual(await save(),before);}
    assert.equal(await dropAsset(assets[1].id),true);saved=await save();assert.equal(saved.clips.length,before.clips.length+1);assert.equal(saved.clips.at(-1).kind,'audio');assert.equal(saved.clips.at(-1).trackId,'a2');
    await button(/^元に戻す \(/).click();assert.deepEqual(await save(),before);await button(/^やり直す \(/).click();assert.deepEqual(await save(),saved);
    checks.push('native video move and HTML5 video/image library drops onto Audio rejected atomically; audio drop and Undo/Redo succeed');
    await page.locator('.brand').click();await page.keyboard.press('Control+o');await button(project.name).waitFor();assert.deepEqual((await save()).clips,saved.clips);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,720));await page.waitForFunction(()=>innerWidth===1280&&innerHeight===720);await settle();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(results,'compact-1280.png')});
    assert.deepEqual(errors,[]);const evidence={passed:true,packaged:!!executablePath,checks,heights,controls};await fs.writeFile(path.join(results,'verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
  } catch(error) {console.error(await page.evaluate(()=>({focus:document.hasFocus(),tool:document.querySelector('.timeline-scroll').className,gesture:document.documentElement.dataset.timelineGesture,guide:document.querySelector('.razor-guide')?.outerHTML})));await page.screenshot({path:path.join(results,'failure.png')}).catch(()=>{});throw error;}
  finally {await app.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
