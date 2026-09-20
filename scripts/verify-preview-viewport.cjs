const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { ffmpeg, inspectMedia, run, probe } = require('../electron/media.cjs');
const { validateProject } = require('../electron/export.cjs');
const { setVisualKey } = require('../shared/visual-keyframes.mjs');
const root = path.join(__dirname, '..');
async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true }); await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const media = path.join(results, 'モニター倍率素材.mp4'), file = path.join(results, 'モニター倍率.luma'), output = path.join(results, '枠外ベジェ.mp4');
  await run(ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc2=s=640x360:r=30:d=1','-c:v','libx264','-pix_fmt','yuv420p',media]);
  const asset = await inspectMedia(media, path.join(root, '.local', 'viewport-cache'));
  const clip = { id:'clip',assetId:asset.id,trackId:'v1',name:'倍率確認',kind:'video',start:0,in:0,duration:1,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:0,fadeIn:0,fadeOut:0,text:'',fontSize:30,color:'#ffffff',textStyle:'hero',audioMuted:true };
  const project = { version:1,id:'viewport',name:'モニター倍率の検証',width:640,height:360,fps:30,assets:[asset],markers:[],tracks:[{id:'v1',name:'Video1',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[clip] };
  const profile = await fs.mkdtemp(path.join(root, '.local', 'viewport-')), env = { ...process.env, LUMA_TEST_DATA:profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE, app = await electron.launch({ executablePath, args:executablePath?[]:[root], env, timeout:60000 });
  const page = await app.firstWindow(), checks = [], errors = []; let serial = 0;
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => errors.push(e.message));
  const check = message => { checks.push(message); console.log(message); };
  const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const close = (a,b,label,tolerance=.6) => assert.ok(Math.abs(a-b)<=tolerance, `${label}: ${a} vs ${b}`);
  const stage = page.locator('.preview-stage'), wrap = page.locator('.canvas-wrap'), zoom = page.getByLabel('モニター表示倍率', {exact:true}), hand = page.getByRole('button',{name:'モニターの表示位置をドラッグで移動',exact:true});
  const horizontal = page.getByRole('slider',{name:'モニターの横位置',exact:true}), vertical = page.getByRole('slider',{name:'モニターの縦位置',exact:true});
  const undo = page.getByRole('button',{name:/^元に戻す \(/}), redo = page.getByRole('button',{name:/^やり直す \(/});
  const box = async locator => { const b=await locator.boundingBox();assert.ok(b);return b; };
  const save = async () => {
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    const before=(await fs.stat(file).catch(()=>null))?.mtimeMs;await page.keyboard.press('Control+s');
    const deadline=Date.now()+15000;while((await fs.stat(file).catch(()=>null))?.mtimeMs===before){assert.ok(Date.now()<deadline,'project saved');await new Promise(r=>setTimeout(r,25));}
    await page.getByRole('dialog',{name:'プロジェクトを保存しています',exact:true}).waitFor({state:'hidden'});
    await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
    return JSON.parse(await fs.readFile(file,'utf8'));
  };
  const open = async p => {
    if(await page.locator('.unsaved-dot').count())await save();
    const next={...p,id:`viewport-${++serial}`,name:`モニター倍率 ${serial}`};validateProject(next);await fs.writeFile(file,JSON.stringify(next));
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    await page.keyboard.press('Control+o');await page.getByRole('button',{name:next.name,exact:true}).waitFor();await page.keyboard.press('Home');await frames();return next;
  };
  const pointerDrag = async (x,y,dx,dy,button='left',cancel=false) => {
    await page.mouse.move(x,y);await page.mouse.down({button});await page.mouse.move(x+dx,y+dy,{steps:6});if(cancel)await page.keyboard.press('Escape');await page.mouse.up({button});await frames();
  };
  const fit = async () => { await zoom.selectOption('fit');await frames();const s=await box(stage),w=await box(wrap);close(w.x+w.width/2,s.x+s.width/2,'fit center x');close(w.y+w.height/2,s.y+s.height/2,'fit center y');assert.ok(w.width<=s.width-47&&w.height<=s.height-47); };
  try {
    await page.locator('.app-titlebar').waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1120,800));await page.waitForFunction(()=>innerWidth===1120&&innerHeight===800);await frames();
    await open(project);await page.locator('.media-drag-target').waitFor();const baseline=await save();
    await fit();
    let initialStage=await box(stage);
    await pointerDrag(initialStage.x+initialStage.width/2,initialStage.y+initialStage.height/2,0,0,'middle');assert.equal(await zoom.inputValue(),'fit','middle click without movement keeps Fit');
    await stage.dispatchEvent('wheel',{deltaX:20,deltaY:0});assert.equal(await zoom.inputValue(),'fit','horizontal wheel does not disable Fit');
    for(const scale of [.25,.5,.75,1,2]) {
      await zoom.selectOption(String(scale));await frames();const w=await box(wrap);close(w.width,640*scale,'preset width');close(w.height,360*scale,'preset height');
    }
    await page.getByLabel('プレビュー画質',{exact:true}).selectOption('0.25');
    await page.waitForFunction(()=>document.querySelector('.canvas-wrap canvas').width===160);close((await box(wrap)).width,1280,'quality does not change display scale');
    await page.getByLabel('プレビュー画質',{exact:true}).selectOption('1');
    check('fit and all percentage presets use sequence pixels independently of render quality');

    for(const [slider,axis] of [[horizontal,'x'],[vertical,'y']]) {
      assert.ok(await slider.isVisible());const before=await box(wrap),r=await box(slider);
      await page.mouse.click(r.x+r.width*(axis==='x'?.65:.5),r.y+r.height*(axis==='y'?.65:.5));await frames();
      const after=await box(wrap);assert.ok(after[axis]<before[axis]-5,`${axis} slider reveals the positive frame direction`);
      close(Number(await slider.inputValue()),(await box(stage))[axis]+(await box(stage))[axis==='x'?'width':'height']/2-(after[axis]+after[axis==='x'?'width':'height']/2),'slider value follows viewport');
    }
    const beforeKey=await box(wrap),timeBefore=await page.locator('.preview-meta .timecode').first().textContent();await vertical.focus();await page.keyboard.press('ArrowDown');await frames();assert.ok((await box(wrap)).y<beforeKey.y,'vertical slider supports keyboard');assert.equal(await page.locator('.preview-meta .timecode').first().textContent(),timeBefore,'slider arrows do not seek');
    await fit();await zoom.selectOption('2');await frames();let s=await box(stage),before=await box(wrap);
    await pointerDrag(s.x+s.width/2,s.y+s.height/2,35,20,'middle');let after=await box(wrap);close(after.x-before.x,35,'middle pan x');close(after.y-before.y,20,'middle pan y');
    close(Number(await horizontal.inputValue()),-35,'horizontal slider follows drag');close(Number(await vertical.inputValue()),-20,'vertical slider follows drag');
    await hand.click();before=await box(wrap);await pointerDrag(s.x+s.width/2,s.y+s.height/2,-25,10);after=await box(wrap);close(after.x-before.x,-25,'hand pan');
    before=await box(wrap);await pointerDrag(s.x+s.width/2,s.y+s.height/2,60,15,'left',true);after=await box(wrap);close(after.x,before.x,'Escape restores pan');close(after.y,before.y,'Escape restores pan y');
    await fit();assert.equal(await hand.getAttribute('aria-pressed'),'false');
    check('horizontal and vertical sliders pan in the correct direction and stay synchronized with hand/middle drags, Escape and Fit');

    const anchor={x:s.x+s.width*.58,y:s.y+s.height*.57};before=await box(wrap);
    await page.mouse.move(anchor.x,anchor.y);await page.mouse.wheel(0,-80);
    await page.waitForFunction(w=>document.querySelector('.canvas-wrap').getBoundingClientRect().width>w,before.width);after=await box(wrap);
    close((anchor.x-before.x)/before.width,(anchor.x-after.x)/after.width,'wheel anchored x',.002);close((anchor.y-before.y)/before.height,(anchor.y-after.y)/after.height,'wheel anchored y',.002);
    before=after;
    const prevented=await stage.evaluate((el,p)=>{const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:p.x,clientY:p.y,deltaY:15,ctrlKey:true});el.dispatchEvent(event);return event.defaultPrevented;},anchor);
    assert.equal(prevented,true);await frames();after=await box(wrap);assert.ok(after.width<before.width);close((anchor.x-before.x)/before.width,(anchor.x-after.x)/after.width,'trackpad pinch anchor',.002);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),1);
    const cdp=await page.context().newCDPSession(page),cx=Math.round(s.x+s.width/2),cy=Math.round(s.y+s.height/2);
    before=await box(wrap);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:cx-35,y:cy},{id:2,x:cx+35,y:cy}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:cx-60,y:cy},{id:2,x:cx+60,y:cy}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frames();after=await box(wrap);assert.ok(after.width>before.width*1.5,'touch pinch expands the monitor');
    before=after;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:3,x:cx,y:cy}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:3,x:cx+30,y:cy+10}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await frames();after=await box(wrap);close(after.x,before.x,'touch cancel restores view');
    await cdp.detach();await fit();
    assert.equal(await undo.isDisabled(),true);assert.equal(await page.locator('.unsaved-dot').count(),0);assert.deepEqual((await save()).clips,baseline.clips);
    check('real wheel, ctrl-wheel trackpad gesture and native touch pinch change only the view; touch cancellation restores it');

    await zoom.selectOption('1');await frames();s=await box(stage);
    await pointerDrag(s.x+s.width/2,s.y+s.height/2,18,8,'middle');before=await box(wrap);
    await page.keyboard.down('Alt');await page.mouse.move(s.x+s.width/2,s.y+s.height/2);await page.mouse.down();
    await page.mouse.move(s.x+s.width/2+20,s.y+s.height/2+10,{steps:3});assert.ok(await zoom.isDisabled());await page.mouse.wheel(0,-80);await frames();close((await box(wrap)).width,before.width,'wheel is blocked during an edit');
    await page.mouse.move(s.x+s.width/2+40,s.y+s.height/2+20,{steps:3});await page.mouse.up();await page.keyboard.up('Alt');
    let saved=await save();close(saved.clips[0].x,40/640*100,'zoomed video x',.1);close(saved.clips[0].y,20/360*100,'zoomed video y',.1);
    await page.keyboard.press('Control+z');saved=await save();close(saved.clips[0].x,0,'undo video');assert.equal(await redo.isDisabled(),false);
    await fit();await zoom.selectOption('0.75');assert.equal(await redo.isDisabled(),false);await page.keyboard.press('Control+Shift+z');saved=await save();close(saved.clips[0].x,40/640*100,'redo survives view navigation',.1);
    await page.keyboard.press('Control+z');await save();
    check('zoomed and panned video edits use source coordinates; view navigation preserves Undo and Redo');

    for(const graphic of [undefined,{shape:'rectangle',width:180,height:80,lineWidth:5,fill:true,fillColor:'#ffcc33'}]) {
      const title={...clip,assetId:undefined,kind:'title',audioMuted:undefined,text:'表示位置',name:'表示位置',graphic};
      await open({...project,clips:[title]});await page.locator('.title-drag-target').waitFor();await zoom.selectOption('1');await frames();s=await box(stage);
      await pointerDrag(s.x+s.width/2,s.y+s.height/2,15,7,'middle');const t=await box(page.locator('.title-drag-target'));
      await page.keyboard.down('Alt');await pointerDrag(t.x+t.width/2,t.y+t.height/2,24,12);await page.keyboard.up('Alt');saved=await save();
      close(saved.clips[0].x,24/640*100,'title/shape x',.1);close(saved.clips[0].y,12/360*100,'title/shape y',.1);
    }
    check('text and shapes remain directly draggable at fixed zoom and pan offsets');

    for(const rotation of [0,35]) {
      const tinyTitle={...clip,assetId:undefined,kind:'title',audioMuted:undefined,text:'文字',name:'小さな文字',fontSize:16,textBox:{width:80,height:32},rotation};
      await open({...project,clips:[tinyTitle]});await page.locator('.timeline-clip.title').click();await zoom.selectOption('0.25');await frames();
      const target=page.locator('.title-drag-target'),t=await box(target),canvasBox=await box(wrap),center={x:Math.round(t.x+t.width/2),y:Math.round(t.y+t.height/2)},before=await save();
      assert.equal(await target.evaluate((el,point)=>document.elementFromPoint(point.x,point.y)===el,center),true,'small text center must remain a move target');
      await page.keyboard.down('Alt');await pointerDrag(center.x,center.y,18,9);await page.keyboard.up('Alt');saved=await save();
      close(saved.clips[0].x,18/canvasBox.width*100,'small title drag x',.1);close(saved.clips[0].y,9/canvasBox.height*100,'small title drag y',.1);
      assert.deepEqual(saved.clips[0].textBox,before.clips[0].textBox,'moving small text must not resize its frame');assert.equal(saved.clips[0].fontSize,16);
      await page.keyboard.press('Control+z');assert.deepEqual((await save()).clips,before.clips);
      if(rotation===0){
        const handle=await box(page.getByRole('button',{name:'テキスト枠の下を変更',exact:true}));
        await pointerDrag(Math.round(handle.x+handle.width/2),Math.round(handle.y+handle.height/2),0,8);saved=await save();
        close(saved.clips[0].textBox.height,64,'small title resize uses source dimensions',.1);assert.equal(saved.clips[0].fontSize,16);
        await page.keyboard.press('Control+z');assert.deepEqual((await save()).clips,before.clips);
      }
    }
    check('zoomed-out and rotated small text retains separate move/resize targets without changing font size or Undo behavior');

    await open(project);await page.locator('.media-drag-target').waitFor();await page.locator('.media-drag-target').click();
    const section=page.locator('.inspector-section').filter({has:page.locator('#video-mask-type')});if(!await section.evaluate(el=>el.open))await section.locator('summary').click();
    await page.locator('#video-mask-type').selectOption('bezier');await page.getByRole('button',{name:'モニターでマスクを編集',exact:true}).click();
    await zoom.selectOption('0.25');await frames();let w=await box(wrap);
    for(const [x,y] of [[-.1,.25],[.75,-.1],[1.1,.75],[.25,1.1]]) {await page.mouse.click(w.x+w.width*x,w.y+w.height*y);}
    assert.equal(await page.locator('.bezier-mask-anchor').count(),4);saved=await save();
    for(const [i,axis,value] of [[0,'x',-.1],[1,'y',-.1],[2,'x',1.1],[3,'y',1.1]])close(saved.clips[0].videoMask.points[i][axis],value,'off-frame anchor',.01);
    await page.getByRole('button',{name:'ベジェマスクの点 1を移動',exact:true}).click();saved=await save();assert.equal(saved.clips[0].videoMask.closed,true);
    await page.getByLabel('点 1の種類',{exact:true}).selectOption('curve');const out=page.getByRole('button',{name:'点 1の出力ハンドルを移動',exact:true}),h=await box(out),prior=(await save()).clips[0].videoMask.points[0];
    await page.keyboard.down('Alt');await pointerDrag(h.x+h.width/2,h.y+h.height/2,-12,12);await page.keyboard.up('Alt');saved=await save();assert.equal(saved.clips[0].videoMask.points[0].inX,prior.inX);assert.ok(saved.clips[0].videoMask.points[0].outX<prior.outX);
    const kept=saved.clips[0].videoMask;await page.keyboard.press('Control+z');saved=await save();assert.deepEqual(saved.clips[0].videoMask.points[0],prior);await page.keyboard.press('Control+Shift+z');saved=await save();assert.deepEqual(saved.clips[0].videoMask,kept);
    await open(saved);assert.deepEqual((await save()).clips[0].videoMask,kept);await page.getByRole('button',{name:'モニターでマスクを編集',exact:true}).click();await zoom.selectOption('0.25');
    await page.getByRole('button',{name:'Video1 ロック',exact:true}).click();assert.equal(await page.locator('.bezier-mask-anchor').count(),0);await page.getByRole('button',{name:'Video1 ロック解除',exact:true}).click();await save();
    check('off-frame anchors on all four edges close and persist; independent handles, Undo/Redo and track locks remain valid');

    const staticProject=await save(),keyMask=structuredClone(kept);
    Object.assign(keyMask.points[0],{x:-.123456789,y:1.123456789,inX:-1.23456789,inY:2.23456789,outX:2.3456789,outY:-1.3456789});
    const keyed=setVisualKey(setVisualKey({...staticProject.clips[0],videoMask:keyMask},0),.5);
    await open({...staticProject,clips:[keyed]});
    const keySection=page.locator('.inspector-section').filter({has:page.getByLabel('キーフレームの表示項目',{exact:true})});
    if(!await keySection.evaluate(el=>el.open))await keySection.locator('summary').click();
    for(const coordinate of ['x','y','inX','inY','outX','outY']) {
      await page.getByLabel('キーフレームの表示項目',{exact:true}).selectOption(`videoMask.points.0.${coordinate}`);
      const point=page.locator('.clip-visual-key').nth(1);await point.scrollIntoViewIfNeeded();const r=await box(point),graph=await box(page.locator('.clip-visual-keys'));
      await pointerDrag(r.x+r.width/2,r.y+r.height/2,graph.width*.1,0);saved=await save();assert.ok(saved.clips[0].visualKeyframes[1].time>.5);
      assert.deepEqual(saved.clips[0].visualKeyframes[1].values.videoMask,keyMask,`horizontal keyframe drag preserves exact ${coordinate} geometry`);
      await page.keyboard.press('Control+z');await save();await point.focus();await page.keyboard.press('ArrowUp');saved=await save();
      close(saved.clips[0].visualKeyframes[1].values.videoMask.points[0][coordinate],keyMask.points[0][coordinate]+.001,`off-frame ${coordinate} keyboard edit`,1e-9);
      await page.keyboard.press('Control+z');await save();
    }
    check('all six off-frame Bezier keyframe coordinate channels preserve exact geometry when moving time and accept keyboard value changes');
    await open(staticProject);await page.getByRole('button',{name:'モニターでマスクを編集',exact:true}).click();await zoom.selectOption('0.25');

    await page.getByLabel('プレビュー画質',{exact:true}).selectOption('1');await page.waitForFunction(()=>document.querySelector('.canvas-wrap canvas').width===640);await frames();
    const preview=path.join(results,'preview-viewport-frame.png'),png=await page.locator('.canvas-wrap canvas').evaluate(c=>c.toDataURL('image/png').split(',')[1]);await fs.writeFile(preview,Buffer.from(png,'base64'));
    await page.screenshot({path:path.join(results,'preview-viewport-off-frame.png')});
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('品質',{exact:true}).selectOption('high');await page.getByLabel('書き出し方式',{exact:true}).selectOption('cpu');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.export-success')||document.querySelector('.export-error'),undefined,{timeout:180000});assert.ok(await page.getByText('書き出しが完了しました',{exact:true}).isVisible());
    const stream=(await probe(output)).streams.find(s=>s.codec_type==='video');assert.equal(stream.width,640);assert.equal(stream.height,360);
    const a=await run(ffmpeg,['-v','error','-i',preview,'-pix_fmt','rgb24','-f','rawvideo','pipe:1']),b=await run(ffmpeg,['-v','error','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.equal(a.length,b.length);let difference=0;for(let i=0;i<a.length;i++)difference+=Math.abs(a[i]-b[i]);const meanPixelError=difference/a.length;assert.ok(meanPixelError<8,`preview/export error ${meanPixelError}`);
    check('off-frame Bezier geometry matches real H264 export while zoom and pan leave output dimensions unchanged');
    await page.getByRole('button',{name:'閉じる',exact:true}).click();await page.locator('.modal-backdrop').waitFor({state:'hidden'});
    await zoom.selectOption('2');await frames();await page.screenshot({path:path.join(results,'preview-viewport-sliders.png')});
    if(process.platform==='darwin')await app.evaluate(({BrowserWindow})=>{globalThis.__viewportFullscreenReady=new Promise(resolve=>BrowserWindow.getAllWindows()[0].once('enter-full-screen',resolve));});
    await page.getByRole('button',{name:'プレビューを全画面表示',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);
    if(process.platform==='darwin'){await app.evaluate(()=>globalThis.__viewportFullscreenReady);await page.waitForTimeout(500);}
    await frames();close((await box(wrap)).width,1280,'fullscreen preserves percentage zoom');
    if(process.platform==='darwin')await app.evaluate(({BrowserWindow})=>{globalThis.__viewportFullscreenExited=new Promise(resolve=>BrowserWindow.getAllWindows()[0].once('leave-full-screen',resolve));});
    await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.fullscreenElement);
    if(process.platform==='darwin')await app.evaluate(()=>globalThis.__viewportFullscreenExited);
    await fit();
    check('fullscreen keeps fixed zoom and Fit recenters after leaving fullscreen');assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(results,'preview-viewport-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,meanPixelError,consoleErrors:errors},null,2));console.log('Monitor viewport verified:',checks.length,'checks; export error',meanPixelError.toFixed(3));
  } catch(error) { await page.screenshot({path:path.join(results,'preview-viewport-failure.png')}).catch(()=>{});throw error; }
  finally { await app.close(); }
}
verify().catch(e=>{console.error(e);process.exitCode=1;});
