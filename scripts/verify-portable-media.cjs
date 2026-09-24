const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ffmpeg, run } = require('../electron/media.cjs');

const root = path.join(__dirname, '..');
const version = require('../package.json').version;
const results = path.join(root, 'test-results');

async function verify() {
  if (process.platform !== 'win32') return;
  await fs.mkdir(results, { recursive: true });
  const scratch = await fs.mkdtemp(path.join(root, '.local', 'portable-media-'));
  const packaged = path.join(root, 'release', 'win-unpacked');
  const executablePath = path.join(scratch, 'extracted', 'Luma Studio.exe');
  const profile = path.join(scratch, 'user-data');
  const source = path.join(scratch, 'source.mp4');
  const output = path.join(scratch, 'exported.mp4');
  const sevenZip = path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe');
  let app;
  try {
    await fs.access(sevenZip);
    const portableExe = path.join(root, 'release', `Luma-Studio-${version}-Windows.exe`);
    const archiveDir = path.join(scratch, 'archive');
    await fs.mkdir(archiveDir);
    execFileSync(sevenZip, ['e', '-y', `-o${archiveDir}`, portableExe, '$PLUGINSDIR/app-64.7z'], { stdio: 'ignore' });
    const listing = execFileSync(sevenZip, ['l', path.join(archiveDir, 'app-64.7z')], { encoding: 'utf8' }).replaceAll('\\', '/');
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) assert.ok(listing.includes(`resources/app.asar.unpacked/vendor/media/win32-x64/${name}`), `portable EXE contains ${name}`);

    await fs.cp(packaged, path.join(scratch, 'extracted'), { recursive: true });
    await fs.mkdir(profile, { recursive: true });
    await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=10:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
    const env = { ...process.env, LUMA_TEST_DATA: profile, PORTABLE_EXECUTABLE_DIR: path.dirname(executablePath), LUMA_DEMO_FIXTURE: '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath, args: [], env, timeout: 60000 });
    const page = await app.firstWindow();
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: '読み込み', exact: true }).click();
    await page.locator('.media-card').filter({ hasText: 'source.mp4' }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: 'source.mp4 を追加', exact: true }).click();
    const originalFolder = path.join(scratch, 'extracted', 'resources', 'app.asar.unpacked', 'vendor', 'media', 'win32-x64');
    const staged = path.join(profile, 'media-tools', version);
    assert.ok((await fs.readdir(staged)).length > 0, 'portable startup staged the media tools');
    await fs.rm(path.join(originalFolder, 'ffmpeg.exe'));
    await fs.rm(path.join(originalFolder, 'ffprobe.exe'));
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, output);
    await page.getByRole('button', { name: '書き出し', exact: true }).click();
    await page.getByLabel('書き出しサイズ', { exact: true }).selectOption('720');
    await page.getByLabel('書き出し方式', { exact: true }).selectOption('cpu');
    await page.getByLabel('品質', { exact: true }).selectOption('draft');
    await page.getByRole('button', { name: '保存先を選んで書き出す', exact: true }).click();
    await page.getByText('書き出しが完了しました', { exact: true }).waitFor({ timeout: 180000 });
    await fs.copyFile(output, path.join(results, 'portable-exported.mp4'));
    await page.getByRole('dialog', { name: '動画を書き出す' }).getByRole('button', { name: '閉じる' }).click();

    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, output);
    await page.getByRole('button', { name: '読み込み', exact: true }).click();
    const card = page.locator('.media-card').filter({ hasText: 'exported.mp4' });
    await card.waitFor({ timeout: 60000 });
    const decoded = await page.evaluate(async () => {
      const result = await window.luma.importMedia();
      if (result.errors.length || result.assets.length !== 1) throw new Error(result.errors.join('\n') || 'MP4の再取り込みに失敗しました。');
      return (await window.luma.readAudioChunk(result.assets[0].url, 0)).length;
    });
    assert.equal(decoded, 48000 * 8 * 2, 'exported MP4 audio is decoded through the staged FFmpeg');
    await card.getByRole('button', { name: 'exported.mp4 を追加', exact: true }).click();
    await page.getByRole('button', { name: '先頭へ (Home)', exact: true }).click();
    await page.getByRole('button', { name: '再生 (Space)', exact: true }).click();
    await page.waitForTimeout(900);
    assert.equal(await page.locator('.toast').filter({ hasText: '音声を再生できません' }).count(), 0);
    await page.getByRole('button', { name: '一時停止 (Space)', exact: true }).click();
    await fs.writeFile(path.join(results, 'portable-media-verification.json'), JSON.stringify({ passed: true, checks: ['portable EXE contains FFmpeg and FFprobe', 'source FFmpeg and FFprobe removed', 'export completed without extraction tools', 'exported MP4 imported and played without audio error'] }, null, 2));
  } finally {
    if (app) await app.close();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
