const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ffmpeg, run, probe } = require('../electron/media.cjs');

const root = path.join(__dirname, '..');
async function verify() {
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'verify-direct-copy-'));
  const source = path.join(profile, '元動画 [映像] & 音.mp4');
  const output = path.join(profile, '再圧縮なし.mp4');
  const projectFile = path.join(profile, '無編集の動画.luma');
  const results = path.join(root, 'test-results');
  await fs.mkdir(results, { recursive: true });
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    'testsrc2=s=640x360:r=24:d=2', '-f', 'lavfi', '-i',
    'sine=frequency=440:duration=2:sample_rate=48000', '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
    '-t', '2', '-movflags', '+faststart', source]);
  const project = { version: 1, id: 'direct-copy', name: '無編集の動画',
    width: 640, height: 360, fps: 24, assets: [], clips: [], markers: [],
    tracks: [{ id: 'video', name: '映像', kind: 'video', muted: false,
      hidden: false, locked: false, solo: false },
    { id: 'audio', name: '音声', kind: 'audio', muted: false,
      hidden: false, locked: false, solo: false }] };
  await fs.writeFile(projectFile, JSON.stringify(project));
  const env = { ...process.env, LUMA_TEST_DATA: profile, LUMA_DEMO_FIXTURE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  let app;
  try {
    app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () =>
      ({ canceled: false, filePaths: [file] }); }, projectFile);
    await page.getByRole('button', { name: 'ファイル', exact: true }).click();
    await page.getByRole('button', { name: /^プロジェクトを開く/ }).click();
    await page.getByRole('button', { name: project.name, exact: true }).waitFor({ timeout: 60000 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () =>
      ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: '読み込み', exact: true }).click();
    await page.locator('.media-card').filter({ hasText: path.basename(source) }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: `${path.basename(source)} を追加`, exact: true }).click();
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    const imported = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    assert.equal(imported.clips.length, 2);
    const video = imported.clips.find(clip => clip.kind === 'video');
    const audio = imported.clips.find(clip => clip.kind === 'audio');
    assert.equal(video.audioDetached, true);
    assert.ok(video.linkId);
    assert.equal(audio.linkId, video.linkId);
    assert.equal(audio.assetId, video.assetId);
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () =>
      ({ canceled: false, filePath: file }); }, output);
    await page.getByRole('button', { name: '書き出し', exact: true }).click();
    await page.getByLabel('書き出し方式', { exact: true }).selectOption('auto');
    await page.getByLabel('品質', { exact: true }).selectOption('standard');
    await page.getByRole('button', { name: '保存先を選んで書き出す', exact: true }).click();
    await page.getByText('書き出しが完了しました', { exact: true }).waitFor({ timeout: 120000 });
    assert.match(await page.locator('.export-encoder-used').innerText(), /再圧縮なし/);
    assert.deepEqual(await fs.readFile(output), await fs.readFile(source));
    const info = await probe(output);
    assert.equal(info.streams.find(stream => stream.codec_type === 'video').nb_frames, '48');
    assert.equal(info.streams.find(stream => stream.codec_type === 'audio').sample_rate, '48000');
    await page.getByRole('dialog', { name: '動画を書き出す' }).getByRole('button', { name: '閉じる' }).click();

    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () =>
      ({ canceled: false, filePaths: [file] }); }, output);
    await page.getByRole('button', { name: '素材を追加', exact: true }).click();
    await page.getByRole('menuitem', { name: '素材を読み込む', exact: false }).click();
    const card = page.locator('.media-card').filter({ hasText: path.basename(output) });
    await card.waitFor({ timeout: 60000 });
    const decoded = await page.evaluate(async () => {
      const imported = await window.luma.importMedia();
      if (imported.errors.length || imported.assets.length !== 1) throw new Error(imported.errors.join('\n'));
      return (await window.luma.readAudioChunk(imported.assets[0].url, 0)).length;
    });
    assert.equal(decoded, 48000 * 8 * 2);
    await card.getByRole('button', { name: `${path.basename(output)} を追加`, exact: true }).click();
    await page.getByRole('button', { name: '先頭へ (Home)', exact: true }).click();
    await page.getByRole('button', { name: '再生 (Space)', exact: true }).click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.toast').filter({ hasText: '音声を再生できません' }).count(), 0);
    await page.getByRole('button', { name: '一時停止 (Space)', exact: true }).click();
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'export-direct-copy-verification.json'), JSON.stringify({
      passed: true, packaged: !!executablePath, sourceBytes: (await fs.stat(source)).size,
      checks: ['UI import creates linked video and audio', 'strict route selected',
        'output bytes equal source', '48 frames and AAC 48 kHz', 'MP4 reimport and audio playback'],
    }, null, 2));
    console.log('Direct-copy export verified in', executablePath ? 'packaged app' : 'development app');
  } finally {
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
