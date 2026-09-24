const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.join(__dirname, '..');
const version = require('../package.json').version;

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function extractedTools(previous) {
  for (const name of await fs.readdir(os.tmpdir())) {
    if (previous.has(name)) continue;
    const folder = path.join(os.tmpdir(), name, 'resources', 'app.asar.unpacked', 'vendor', 'media', 'win32-x64');
    try { await fs.access(path.join(folder, 'ffmpeg.exe')); return folder; } catch { /* Not the portable extraction. */ }
  }
  throw new Error('ポータブルEXEの一時展開先が見つかりません。');
}

async function verify() {
  if (process.platform !== 'win32') return;
  const scratch = await fs.mkdtemp(path.join(root, '.local', 'portable-exe-'));
  const profile = path.join(scratch, 'user-data');
  const exe = path.join(root, 'release', `Luma-Studio-${version}-Windows.exe`);
  const results = path.join(root, 'test-results');
  const source = path.join(results, 'portable-exported.mp4');
  let launcher, browser, page;
  try {
    await fs.mkdir(profile, { recursive: true });
    await fs.mkdir(results, { recursive: true });
    await fs.access(source);
    const previous = new Set(await fs.readdir(os.tmpdir()));
    const port = await freePort();
    const env = { ...process.env, LUMA_TEST_DATA: profile, LUMA_DEMO_FIXTURE: '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PORTABLE_EXECUTABLE_DIR; // The NSIS launcher must set this itself.
    launcher = spawn(exe, [`--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: 'ignore' });
    const endpoint = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if ((await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Extracting. */ }
      await delay(1000);
    }
    assert.ok(ready, 'portable EXE starts its Electron child with remote debugging');
    browser = await chromium.connectOverCDP(endpoint);
    for (let attempt = 0; attempt < 30 && !page; attempt++) {
      page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('luma://app/'));
      if (!page) await delay(500);
    }
    assert.ok(page, 'portable EXE opened the editor');
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    const staged = path.join(profile, 'media-tools', version);
    assert.ok((await fs.readdir(staged)).length > 0, 'the portable launcher configured persistent media tools');
    const temporary = await extractedTools(previous);
    await fs.rm(path.join(temporary, 'ffmpeg.exe'));
    await fs.rm(path.join(temporary, 'ffprobe.exe'));

    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'portable-verify-file'; document.body.append(input); });
    await page.locator('#portable-verify-file').setInputFiles(source);
    await page.evaluate(() => {
      const input = document.querySelector('#portable-verify-file');
      const transfer = new DataTransfer(); transfer.items.add(input.files[0]);
      document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    const card = page.locator('.media-card').filter({ hasText: 'portable-exported.mp4' });
    await card.waitFor({ timeout: 60000 });
    const decoded = await page.evaluate(async () => {
      const input = document.querySelector('#portable-verify-file');
      const result = await window.luma.importDroppedFiles([input.files[0]]);
      if (result.errors.length || result.assets.length !== 1) throw new Error(result.errors.join('\n') || '素材の再読み込みに失敗しました。');
      const chunk = await window.luma.readAudioChunk(result.assets[0].url, 0);
      let peak = 0;
      for (const value of chunk) peak = Math.max(peak, Math.abs(value));
      return { length: chunk.length, peak };
    });
    assert.equal(decoded.length, 48000 * 8 * 2);
    assert.ok(decoded.peak > 0.01, 'portable EXE decodes audible PCM after its temporary tools disappear');
    await card.getByRole('button', { name: 'portable-exported.mp4 を追加', exact: true }).click();
    await page.getByRole('button', { name: '再生 (Space)', exact: true }).click();
    await page.waitForTimeout(900);
    assert.equal(await page.locator('.toast').filter({ hasText: '音声を再生できません' }).count(), 0);
    await page.screenshot({ path: path.join(results, 'portable-exe-audio.png') });
    await fs.writeFile(path.join(results, 'portable-exe-verification.json'), JSON.stringify({ passed: true, checks: ['actual NSIS portable EXE started', 'portable launcher staged tools', 'temporary FFmpeg and FFprobe removed', 'media imported into timeline and audible PCM decoded without playback error'], decoded }, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (launcher?.pid) try { execFileSync('taskkill', ['/PID', String(launcher.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already closed. */ }
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
