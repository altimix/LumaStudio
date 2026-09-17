const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { ffmpeg, run, inspectMedia, probe } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');

async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true }); await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const mediaFile = path.join(results, 'クロップマスク素材.mp4'), projectFile = path.join(results, 'クロップマスク検証.luma'), output = path.join(results, 'クロップマスク検証.mp4');
  await run(ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=c=0x095bd8:s=640x360:r=30:d=3','-c:v','libx264','-pix_fmt','yuv420p',mediaFile]);
  const asset = await inspectMedia(mediaFile, path.join(root, '.local', 'crop-mask-cache'));
  const project = { version:1,id:'crop-mask-project',name:'クロップとマスクの検証',width:640,height:360,fps:30,assets:[asset],markers:[],tracks:[
    {id:'v1',name:'Video1',kind:'video',muted:false,hidden:false,locked:false,solo:false},
    {id:'v2',name:'Video2',kind:'video',muted:false,hidden:false,locked:false,solo:false},
  ],clips:[{id:'clip',assetId:asset.id,trackId:'v1',name:asset.name,kind:'video',start:0,in:0,duration:3,speed:1,x:0,y:0,scale:1,rotation:17,opacity:1,exposure:0,contrast:1,saturation:1,volume:0,fadeIn:0,fadeOut:0,text:'',fontSize:94,color:'#ffffff',textStyle:'hero',audioMuted:true}] };
  await fs.writeFile(projectFile, JSON.stringify(project));
  const profile = await fs.mkdtemp(path.join(root, '.local', 'crop-mask-')), env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE, app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(), errors = [], checks = []; page.on('pageerror', error => errors.push(error.message));
  let openSerial = 0;
  const open = async file => {
    const next = JSON.parse(await fs.readFile(file, 'utf8'));
    openSerial += 1;
    next.id = `crop-mask-project-${openSerial}`;
    next.name = `クロップとマスクの検証 ${openSerial}`;
    await fs.writeFile(file, JSON.stringify(next));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled:false,filePaths:[file] }); }, file);
    await page.keyboard.press('Control+o'); await page.getByRole('button', { name: next.name, exact:true }).waitFor({ timeout:60000 }); await page.keyboard.press('Home');
    await page.locator('.media-drag-target[data-media-clip-id="clip"]').waitFor({ timeout:60000 });
  };
  const save = async () => {
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled:false,filePath:file }); }, projectFile);
    const before = (await fs.stat(projectFile).catch(() => null))?.mtimeMs; await page.keyboard.press('Control+s');
    await page.waitForFunction(({ before }) => window.luma && !document.querySelector('.unsaved-dot'), { before }, { timeout:20000 });
    const deadline=Date.now()+20000;while((await fs.stat(projectFile)).mtimeMs===before){if(Date.now()>deadline)throw new Error('プロジェクト保存が完了しませんでした。');await new Promise(resolve=>setTimeout(resolve,25));}
    return JSON.parse(await fs.readFile(projectFile,'utf8'));
  };
  const center = async locator => { const box=await locator.boundingBox();assert.ok(box,'visible control');return{x:box.x+box.width/2,y:box.y+box.height/2}; };
  const drag = async (locator,dx,dy,cancel=false) => { const p=await center(locator),view=await page.locator('.canvas-wrap').boundingBox();assert.ok(view);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+dx/project.width*view.width,p.y+dy/project.height*view.height,{steps:8});if(cancel)await page.keyboard.press('Escape');await page.mouse.up(); };
  try {
    await page.locator('.app-titlebar').waitFor({ timeout:60000 }); await page.locator('.loading-screen').waitFor({ state:'hidden',timeout:60000 }); await open(projectFile);
    await page.getByRole('button',{name:'モニターでクロップ',exact:true}).click();
    const left=page.locator('[data-crop-edge="left"]');await left.waitFor();assert.equal(await page.locator('.media-effect-handle.edge').count(),4);
    await drag(left,64,0);let saved=await save();assert.ok(Math.abs(saved.clips[0].crop.left-.1)<.015,`left crop ${saved.clips[0].crop.left}`);
    await page.keyboard.press('Control+z');let undone=await save();assert.ok(!undone.clips[0].crop||undone.clips[0].crop.left===0);await page.keyboard.press('Control+Shift+z');saved=await save();assert.ok(saved.clips[0].crop.left>.08);
    checks.push('monitor crop edge is one Undo/Redo edit and persists');
    const bottomInput=page.getByLabel('下',{exact:true});await bottomInput.fill('0.1');await bottomInput.press('Enter');
    const topSlider=page.getByRole('slider',{name:'上スライダー',exact:true}),sliderBox=await topSlider.boundingBox();assert.ok(sliderBox);await page.mouse.move(sliderBox.x+2,sliderBox.y+sliderBox.height/2);await page.mouse.down();await page.mouse.move(sliderBox.x+sliderBox.width-2,sliderBox.y+sliderBox.height/2,{steps:12});await page.mouse.up();await topSlider.dispatchEvent('pointerup',{button:0});await topSlider.evaluate(element=>element.blur());
    saved=await save();assert.ok(saved.clips[0].crop.top+saved.clips[0].crop.bottom<=.99,`crop total ${saved.clips[0].crop.top+saved.clips[0].crop.bottom}`);await page.keyboard.press('Control+z');saved=await save();assert.equal(saved.clips[0].crop.top,0);
    checks.push('fractional opposite crop keeps the slider endpoint within the persisted limit');

    await page.locator('#video-mask-type').selectOption('ellipse');await page.getByRole('button',{name:'モニターでマスクを編集',exact:true}).click();
    const body=page.getByRole('button',{name:'マスクを移動',exact:true});await body.waitFor();assert.equal(await page.locator('.media-effect-handle:not(.edge)').count(),4);
    await drag(body,32,-18);saved=await save();assert.ok(Math.hypot(saved.clips[0].videoMask.x-.5,saved.clips[0].videoMask.y-.5)>.04);assert.ok(saved.clips[0].videoMask.x>=0&&saved.clips[0].videoMask.x<=1&&saved.clips[0].videoMask.y>=0&&saved.clips[0].videoMask.y<=1);
    const beforeCancel=JSON.stringify(saved.clips[0].videoMask);await drag(body,40,20,true);assert.equal(JSON.stringify((await save()).clips[0].videoMask),beforeCancel);
    const corner=page.getByRole('button',{name:'マスクの右下を変更',exact:true});await drag(corner,32,18);saved=await save();assert.ok(saved.clips[0].videoMask.width>.7&&saved.clips[0].videoMask.height>.7);
    const resized={...saved.clips[0].videoMask};await page.locator('#video-mask-type').selectOption('rectangle');await page.locator('#video-mask-type').selectOption('ellipse');saved=await save();assert.ok(Math.abs(saved.clips[0].videoMask.width-resized.width)<1e-8&&Math.abs(saved.clips[0].videoMask.height-resized.height)<1e-8);
    await page.locator('#video-mask-type').selectOption('none');await page.locator('.media-drag-target[data-media-clip-id="clip"]').waitFor();await page.keyboard.press('Control+z');await page.locator('#video-mask-type').waitFor();assert.equal(await page.locator('#video-mask-type').inputValue(),'ellipse');await page.getByRole('button',{name:'モニターでマスクを編集',exact:true}).click();
    checks.push('ellipse mask moves, resizes, cancels with Escape, keeps geometry across shape changes and exits edit mode when removed');

    await page.getByRole('button',{name:'Video1 ロック',exact:true}).click();await save();assert.equal(await page.locator('.media-effect-handle').count(),0);await page.getByRole('button',{name:'Video1 ロック解除',exact:true}).click();await save();
    checks.push('locked tracks hide and protect crop/mask controls');

    await open(projectFile);await page.locator('#video-mask-type').waitFor();assert.equal(await page.locator('#video-mask-type').inputValue(),'ellipse');
    await page.getByLabel('プレビュー画質',{exact:true}).selectOption('1');await page.waitForFunction(()=>document.querySelector('.canvas-wrap canvas').width===640);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const preview=path.join(results,'crop-mask-preview.png');const previewData=await page.locator('.canvas-wrap canvas').evaluate(canvas=>({width:canvas.width,height:canvas.height,data:canvas.toDataURL('image/png').split(',')[1]}));await fs.writeFile(preview,Buffer.from(previewData.data,'base64'));
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('品質',{exact:true}).selectOption('high');await page.getByLabel('書き出し方式',{exact:true}).selectOption('cpu');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.export-success')||document.querySelector('.export-error'),undefined,{timeout:180000});assert.ok(await page.getByText('書き出しが完了しました',{exact:true}).isVisible());
    const info=await probe(output);assert.equal(info.streams.find(s=>s.codec_type==='video').width,640);
    const actual=await run(ffmpeg,['-v','error','-i',preview,'-pix_fmt','rgb24','-f','rawvideo','pipe:1']),reference=await run(ffmpeg,['-v','error','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.equal(actual.length,reference.length);let difference=0;for(let i=0;i<actual.length;i++)difference+=Math.abs(actual[i]-reference[i]);const meanPixelError=difference/actual.length;assert.ok(meanPixelError<8,`preview/export mean pixel error ${meanPixelError}`);
    const sample=async(x,y)=>[...await run(ffmpeg,['-v','error','-i',output,'-frames:v','1','-vf',`crop=2:2:${x}:${y},scale=1:1`,'-pix_fmt','rgb24','-f','rawvideo','pipe:1'])];assert.ok((await sample(320,180))[2]>150);assert.ok((await sample(10,10)).every(v=>v<18));
    checks.push('saved mask reloads and preview matches an actual H264 export');assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(results,'crop-mask-editor.png')});await fs.writeFile(path.join(results,'crop-mask-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,meanPixelError,consoleErrors:errors},null,2));
    console.log('Crop and mask verified:',checks.length,'checks; pixel error',meanPixelError.toFixed(3));
  } catch(error){await page.screenshot({path:path.join(results,'crop-mask-failure.png')}).catch(()=>{});throw error;} finally{await app.close();}
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
