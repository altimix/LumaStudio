const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ffmpeg, inspectMedia, probe, run } = require('../electron/media.cjs');

const root = path.join(__dirname, '..');

async function verify() {
  const results = path.join(root, 'test-results');
  await fs.mkdir(results, { recursive: true });
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const mediaFile = path.join(results, 'ベジェマスク素材.mp4');
  const projectFile = path.join(results, 'ベジェマスク検証.luma');
  const output = path.join(results, 'ベジェマスク検証.mp4');
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x095bd8:s=640x360:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mediaFile]);
  const asset = await inspectMedia(mediaFile, path.join(root, '.local', 'bezier-mask-cache'));
  const clip = { id:'clip',assetId:asset.id,trackId:'v1',name:asset.name,kind:'video',start:0,in:0,duration:3,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:0,fadeIn:0,fadeOut:0,text:'',fontSize:94,color:'#ffffff',textStyle:'hero',audioMuted:true };
  const project = { version:1,id:'bezier-mask-project',name:'ベジェマスクの検証',width:640,height:360,fps:30,assets:[asset],markers:[],tracks:[{id:'v1',name:'Video1',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[clip] };
  await fs.writeFile(projectFile, JSON.stringify(project));
  const profile = await fs.mkdtemp(path.join(root, '.local', 'bezier-mask-'));
  const env = { ...process.env, LUMA_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  let openSerial = 0;
  const open = async file => {
    const next = JSON.parse(await fs.readFile(file, 'utf8'));
    openSerial += 1;
    next.id = `bezier-mask-project-${openSerial}`;
    next.name = `ベジェマスクの検証 ${openSerial}`;
    await fs.writeFile(file, JSON.stringify(next));
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled:false,filePaths:[selected] }); }, file);
    await page.keyboard.press('Control+o');
    await page.getByRole('button', { name:next.name, exact:true }).waitFor({ timeout:60000 });
    await page.keyboard.press('Home');
    await page.locator('.media-drag-target[data-media-clip-id="clip"]').waitFor({ timeout:60000 });
  };
  const save = async () => {
    await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled:false,filePath:selected }); }, projectFile);
    const before = (await fs.stat(projectFile).catch(() => null))?.mtimeMs;
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window.luma && !document.querySelector('.unsaved-dot'), undefined, { timeout:20000 });
    const deadline = Date.now() + 20000;
    while ((await fs.stat(projectFile)).mtimeMs === before) {
      if (Date.now() > deadline) throw new Error('プロジェクト保存が完了しませんでした。');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return JSON.parse(await fs.readFile(projectFile, 'utf8'));
  };
  const center = async locator => {
    const box = await locator.boundingBox();
    assert.ok(box, 'visible control');
    return { x:box.x + box.width / 2, y:box.y + box.height / 2 };
  };
  const drag = async (locator, dx, dy, cancel = '') => {
    const point = await center(locator), view = await page.locator('.canvas-wrap').boundingBox();
    assert.ok(view);
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + dx / project.width * view.width, point.y + dy / project.height * view.height, { steps:8 });
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'resize') await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.mouse.up();
  };
  try {
    await page.locator('.app-titlebar').waitFor({ timeout:60000 });
    await page.locator('.loading-screen').waitFor({ state:'hidden', timeout:60000 });
    await open(projectFile);
    await require('./verify-bezier-modifiers.cjs')({ page, save, checks, loadMask: async mask => { const current = await save(); current.clips[0].videoMask = mask; await fs.writeFile(projectFile, JSON.stringify(current)); await open(projectFile); } });
    await page.locator('#video-mask-type').selectOption('bezier');
    await page.getByRole('button', { name:'モニターでマスクを編集', exact:true }).click();
    const addTarget = page.getByRole('button', { name:'ベジェマスクの点を追加', exact:true });
    let added = 0;
    for (const [x, y] of [[.2,.2],[.8,.2],[.8,.8],[.2,.8]]) {
      const box = await addTarget.boundingBox(); assert.ok(box);
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
      added += 1;
      await page.waitForFunction(count => document.querySelectorAll('.bezier-mask-anchor').length === count, added);
    }
    assert.equal(await page.locator('.bezier-mask-anchor').count(), 4);
    assert.equal(await page.getByText('作成中の開いたパス', { exact:true }).isVisible(), true);
    let saved = await save();
    assert.equal(saved.clips[0].videoMask.closed, false);
    assert.equal(saved.clips[0].videoMask.points.length, 4);
    checks.push('open path adds bounded points and stays non-destructive until closed');

    await page.getByRole('button', { name:'パスを閉じる', exact:true }).click();
    await page.getByLabel('点 1の種類', { exact:true }).selectOption('curve');
    await page.getByRole('button', { name:'点 4を削除', exact:true }).click();
    assert.equal(await page.locator('.bezier-mask-anchor').count(), 3);
    assert.equal(await page.locator('.bezier-mask-handle').count(), 2);
    saved = await save();
    assert.equal(saved.clips[0].videoMask.closed, true);
    assert.equal(saved.clips[0].videoMask.points.length, 3);
    assert.equal(saved.clips[0].videoMask.points[0].kind, 'curve');
    checks.push('closed paths support line or curve points and point deletion');

    const anchor = page.getByRole('button', { name:'ベジェマスクの点 2を移動', exact:true });
    const beforeAnchor = JSON.stringify(saved.clips[0].videoMask.points[1]);
    await drag(anchor, -38, 28);
    saved = await save();
    assert.notEqual(JSON.stringify(saved.clips[0].videoMask.points[1]), beforeAnchor);
    const movedAnchor = JSON.stringify(saved.clips[0].videoMask.points[1]);
    await page.keyboard.press('Control+z'); saved = await save(); assert.equal(JSON.stringify(saved.clips[0].videoMask.points[1]), beforeAnchor);
    await page.keyboard.press('Control+Shift+z'); saved = await save(); assert.equal(JSON.stringify(saved.clips[0].videoMask.points[1]), movedAnchor);
    checks.push('anchor drag is one Undo and Redo edit');

    const outHandle = page.getByRole('button', { name:'点 1の出力ハンドルを移動', exact:true });
    const beforeCancel = JSON.stringify(saved.clips[0].videoMask.points[0]);
    await drag(outHandle, 30, -24, 'escape');
    saved = await save(); assert.equal(JSON.stringify(saved.clips[0].videoMask.points[0]), beforeCancel);
    await drag(outHandle, 24, 18, 'resize');
    saved = await save(); assert.equal(JSON.stringify(saved.clips[0].videoMask.points[0]), beforeCancel);
    await drag(outHandle, 20, -18);
    saved = await save(); assert.notEqual(JSON.stringify(saved.clips[0].videoMask.points[0]), beforeCancel);
    checks.push('curve handles mirror smoothly and Escape or layout changes restore the prior edit');

    await page.getByRole('button', { name:'Video1 ロック', exact:true }).click();
    await save(); assert.equal(await page.locator('.bezier-mask-anchor').count(), 0);
    await page.getByRole('button', { name:'Video1 ロック解除', exact:true }).click();
    checks.push('locked tracks hide and protect Bezier controls');

    const rotation = page.locator('#prop-rotation'); await rotation.fill('17'); await rotation.press('Enter');
    const scale = page.locator('#prop-scale'); await scale.fill('85'); await scale.press('Enter');
    await save(); await open(projectFile);
    await page.locator('#video-mask-type').waitFor();
    assert.equal(await page.locator('#video-mask-type').inputValue(), 'bezier');
    assert.equal(await page.getByText('閉じたパス', { exact:true }).isVisible(), true);
    await page.getByRole('button', { name:'モニターでマスクを編集', exact:true }).click();
    await page.getByLabel('プレビュー画質', { exact:true }).selectOption('1');
    await page.waitForFunction(() => document.querySelector('.canvas-wrap canvas').width === 640);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const preview = path.join(results, 'bezier-mask-preview.png');
    const previewData = await page.locator('.canvas-wrap canvas').evaluate(canvas => ({ data:canvas.toDataURL('image/png').split(',')[1] }));
    await fs.writeFile(preview, Buffer.from(previewData.data, 'base64'));
    await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled:false,filePath:selected }); }, output);
    await page.getByRole('button', { name:'書き出し', exact:true }).click();
    await page.getByLabel('品質', { exact:true }).selectOption('high');
    await page.getByLabel('書き出し方式', { exact:true }).selectOption('cpu');
    await page.getByRole('button', { name:'保存先を選んで書き出す', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('.export-success') || document.querySelector('.export-error'), undefined, { timeout:180000 });
    if (await page.locator('.export-error').isVisible()) console.error(await page.locator('.export-error').innerText());
    assert.equal(await page.getByText('書き出しが完了しました', { exact:true }).isVisible(), true);
    const info = await probe(output); assert.equal(info.streams.find(stream => stream.codec_type === 'video').width, 640);
    const actual = await run(ffmpeg, ['-v','error','-i',preview,'-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
    const reference = await run(ffmpeg, ['-v','error','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
    assert.equal(actual.length, reference.length);
    let difference = 0; for (let index = 0; index < actual.length; index++) difference += Math.abs(actual[index] - reference[index]);
    const meanPixelError = difference / actual.length;
    assert.ok(meanPixelError < 8, `preview/export mean pixel error ${meanPixelError}`);
    const sample = async (x,y) => [...await run(ffmpeg, ['-v','error','-i',output,'-frames:v','1','-vf',`crop=2:2:${x}:${y},scale=1:1`,'-pix_fmt','rgb24','-f','rawvideo','pipe:1'])];
    assert.ok((await sample(320,180))[2] > 150); assert.ok((await sample(10,10)).every(value => value < 18));
    checks.push('saved path reloads and preview matches the H264 export');
    assert.deepEqual(errors, []);
    await page.getByRole('button', { name:'閉じる', exact:true }).click();
    await page.locator('.modal-backdrop').waitFor({ state:'hidden' });
    await page.screenshot({ path:path.join(results, 'bezier-mask-editor.png') });
    await fs.writeFile(path.join(results, 'bezier-mask-verification.json'), JSON.stringify({ passed:true,packaged:!!executablePath,checks,meanPixelError,consoleErrors:errors }, null, 2));
    console.log('Bezier mask verified:', checks.length, 'checks; pixel error', meanPixelError.toFixed(3));
  } catch (error) {
    await page.screenshot({ path:path.join(results, 'bezier-mask-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app.close();
  }
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
