const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const { setVisualKey } = require('../shared/visual-keyframes.mjs');

const root = path.join(__dirname, '..');
async function verify() {
  const results = path.join(root, 'test-results');
  await fs.mkdir(results, { recursive: true });
  const asset = await inspectMedia(path.join(root, 'public/demo/01-journey.mp4'), path.join(results, 'mask-cache-media'));
  const mask = { type:'rectangle', x:.25, y:.5, width:.25, height:.5, feather:.05, inverted:false };
  let clip = { id:'video', assetId:asset.id, trackId:'video', kind:'video', name:'動くマスク',
    start:0, in:0, duration:1, speed:1, x:0, y:0, scale:1, rotation:0, opacity:1,
    exposure:0, contrast:1, saturation:1, volume:1, fadeIn:0, fadeOut:0, videoMask:mask };
  clip = setVisualKey(setVisualKey(clip, 0), .5, { videoMask:{ ...mask, x:.75 } });
  const project = { version:1, id:'mask-cache-project', name:'マスクキャッシュ検証', width:960, height:540, fps:24,
    assets:[asset], tracks:[{ id:'video', kind:'video', name:'映像' }], markers:[], clips:[clip] };
  const projectFile = path.join(results, 'マスクキャッシュ検証.luma');
  const first = path.join(results, 'マスクキャッシュ初回.mp4'), second = path.join(results, 'マスクキャッシュ再書き出し.mp4');
  await fs.writeFile(projectFile, JSON.stringify(project));
  await fs.mkdir(path.join(root, '.local'), { recursive:true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'verify-mask-cache-'));
  const env = { ...process.env, LUMA_TEST_DATA:profile, LUMA_DEMO_FIXTURE:'0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args:executablePath ? [] : [root], env, timeout:60000 });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const exportTo = async file => {
    await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled:false, filePath:selected }); }, file);
    await page.getByRole('button', { name:'書き出し', exact:true }).click();
    await page.getByLabel('品質', { exact:true }).selectOption('standard');
    await page.getByLabel('書き出し方式', { exact:true }).selectOption('cpu');
    await page.getByRole('button', { name:'保存先を選んで書き出す', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('.export-success') || document.querySelector('.export-error'), undefined, { timeout:180000 });
    if (await page.locator('.export-error').isVisible()) throw new Error(await page.locator('.export-error').innerText());
    await page.getByRole('button', { name:'閉じる', exact:true }).click();
  };
  try {
    await page.locator('.loading-screen').waitFor({ state:'hidden', timeout:60000 });
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[selected] }); }, projectFile);
    await page.getByRole('button', { name:'ファイル', exact:true }).click();
    await page.getByRole('button', { name:/^プロジェクトを開く/ }).click();
    await page.getByRole('button', { name:project.name, exact:true }).waitFor({ timeout:60000 });
    await page.locator('.timeline-clip').filter({ hasText:'動くマスク' }).waitFor({ timeout:15000 });
    await exportTo(first);
    const dir = path.join(profile, 'media-cache', 'export-masks');
    const videos = (await fs.readdir(dir)).filter(name => /^[a-f0-9]{64}-[a-f0-9]{64}\.mkv$/.test(name));
    assert.equal(videos.length, 1);
    const cached = path.join(dir, videos[0]), before = (await fs.stat(cached)).mtimeMs;
    await exportTo(second);
    assert.equal((await fs.stat(cached)).mtimeMs, before);
    for (const args of [['-map','0:v:0','-pix_fmt','rgba','-f','framemd5','pipe:1'],
      ['-map','0:a:0','-ac','2','-ar','48000','-f','s16le','pipe:1']]) {
      const decode = file => run(ffmpeg, ['-v','error','-i',file,...args]);
      assert.deepEqual(await decode(second), await decode(first));
    }
    await page.getByRole('button', { name:'ヘルプ', exact:true }).click();
    await page.getByRole('menuitem', { name:'書き出し用マスクキャッシュを削除', exact:true }).click();
    await page.getByText('書き出し用マスクキャッシュを削除しました。', { exact:true }).waitFor();
    assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.mkv')), false);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'export-mask-cache-verification.json'), JSON.stringify({
      passed:true, packaged:!!executablePath, firstBytes:(await fs.stat(first)).size, secondBytes:(await fs.stat(second)).size,
      checks:['first export creates cache','second export reuses cache','all decoded video and PCM audio match','menu clears cache'],
    }, null, 2));
    console.log('Animated mask cache verified in', executablePath ? 'packaged app' : 'development app');
  } catch (error) {
    await page.screenshot({ path:path.join(results, 'export-mask-cache-failure.png') }).catch(() => {});
    throw error;
  } finally { await app.close(); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
