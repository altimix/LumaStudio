const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ffmpeg, run, probe } = require('../electron/media.cjs');

const root = path.join(__dirname, '..');
async function verify() {
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'verify-mp3-'));
  const source = path.join(profile, '音声 [BGM] & テスト.wav');
  const output = path.join(profile, '完成した音声.mp3');
  const projectFile = path.join(profile, '音声だけの編集.luma');
  const results = path.join(root, 'test-results');
  await fs.mkdir(results, { recursive: true });
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=48000', '-c:a', 'pcm_s16le', source]);
  await fs.writeFile(projectFile, JSON.stringify({
    version: 1, id: 'mp3-packaged', name: '音声だけの編集', width: 640, height: 360, fps: 24,
    assets: [], clips: [], markers: [], tracks: [
      { id: 'video', name: '映像', kind: 'video', muted: false, hidden: false, locked: false, solo: false },
      { id: 'audio', name: '音声', kind: 'audio', muted: false, hidden: false, locked: false, solo: false },
    ],
  }));
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
    await page.getByRole('button', { name: '音声だけの編集', exact: true }).waitFor({ timeout: 60000 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () =>
      ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: '読み込み', exact: true }).click();
    await page.locator('.media-card').filter({ hasText: path.basename(source) }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: `${path.basename(source)} を追加`, exact: true }).click();
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    const imported = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    assert.equal(imported.clips.length, 1);
    assert.equal(imported.clips[0].kind, 'audio');

    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () =>
      ({ canceled: false, filePath: file }); }, output);
    await page.getByRole('button', { name: '書き出し', exact: true }).click();
    await page.getByLabel('書き出し形式', { exact: true }).selectOption('mp3');
    assert.equal(await page.getByLabel('書き出しサイズ', { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(results, 'export-mp3-dialog.png') });
    await page.getByRole('button', { name: '保存先を選んでMP3を書き出す', exact: true }).click();
    await page.getByText('書き出しが完了しました', { exact: true }).waitFor({ timeout: 120000 });
    const info = await probe(output), audio = info.streams.find(stream => stream.codec_type === 'audio');
    assert.equal(info.streams.some(stream => stream.codec_type === 'video'), false);
    assert.equal(audio.codec_name, 'mp3');
    assert.equal(Number(audio.sample_rate), 48000);
    assert.equal(audio.channels, 2);
    assert.ok(Math.abs(Number(info.format.duration) - 2) < .08);
    await page.getByRole('dialog', { name: '音声をMP3で書き出す' }).getByRole('button', { name: '閉じる' }).click();

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
    assert.ok(decoded > 0);
    await card.getByRole('button', { name: `${path.basename(output)} を追加`, exact: true }).click();
    await page.getByRole('button', { name: '先頭へ (Home)', exact: true }).click();
    await page.getByRole('button', { name: '再生 (Space)', exact: true }).click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.toast').filter({ hasText: '音声を再生できません' }).count(), 0);
    await page.getByRole('button', { name: '一時停止 (Space)', exact: true }).click();
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'export-mp3-verification.json'), JSON.stringify({
      passed: true, packaged: !!executablePath,
      checks: ['audio-only timeline through UI', 'MP3 48 kHz stereo without video', 'MP3 reimport and audio playback'],
    }, null, 2));
    console.log('MP3 export verified in', executablePath ? 'packaged app' : 'development app');
  } finally {
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
