const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ffmpeg, run } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');

async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true }); await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'meter-profile-'));
  const env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(); const errors = [], checks = [], metrics = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 }); await page.locator('.media-card').first().waitFor();
    const file = path.join(results, 'メーター stereo.wav'), projectFile = path.join(results, 'メーター.luma');
    await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,8),0.125,0.875)*sin(2*PI*125*t)|if(lt(t,8),0.5,-0.875)*sin(2*PI*125*t)':s=48000:d=24", '-c:a', 'pcm_f32le', file]);
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await page.getByRole('button', { name: '読み込み', exact: true }).click(); await page.locator('.media-card').nth(4).waitFor({ timeout: 60000 });
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, projectFile);
    await page.keyboard.press('Control+s'); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    const demo = JSON.parse(await fs.readFile(projectFile, 'utf8')), asset = demo.assets.find(a => a.path === file), sound = demo.clips.find(c => c.kind === 'audio');
    assert.ok(asset);
    const base = { ...demo, clips: [{ ...sound, assetId: asset.id, start: 0, in: 0, duration: 24, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 }] };
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, projectFile);
    const status = page.getByRole('status', { name: 'シャトル状態' }), reset = page.getByRole('button', { name: '音量メーターのピークとCLIPをリセット', exact: true });
    const load = async project => {
      await page.keyboard.press('k'); await fs.writeFile(projectFile, JSON.stringify(project)); await page.keyboard.press('Control+o');
      await page.getByRole('button', { name: project.name, exact: true }).waitFor();
    };
    const seek = async seconds => {
      await page.keyboard.press('Home');
      await page.evaluate(n => { for (let i = 0; i < n * 3; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })); }, seconds);
    };
    const levels = async expected => {
      await page.waitForFunction(expected => [...document.querySelectorAll('.meter-channel')].every((el, i) => Math.abs(Number(el.dataset.db) - expected[i]) < .08), expected);
      metrics.push(await page.locator('.meter-channel').evaluateAll(elements => elements.map(el => ({ db: Number(el.dataset.db), zone: el.dataset.zone, accessibility: el.getAttribute('aria-valuetext') }))));
    };
    await load({ ...base, name: '音量メーター検証' }); await seek(1); await page.keyboard.press('l'); await levels([-18.0618, -6.0206]);
    assert.deepEqual(await page.locator('.meter-channel').evaluateAll(elements => elements.map(el => el.dataset.zone)), ['green', 'yellow']);
    assert.equal(await page.locator('.meter-reset.is-clipped').count(), 0);
    await page.screenshot({ path: path.join(results, 'audio-meter-stereo.png') });
    // Actual DOM geometry, including a reduced workspace, must use one scale.
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1120, height: 720 }]) {
      await page.setViewportSize(viewport);
      const geometry = await page.evaluate(() => {
        const channel = document.querySelector('.meter-channel').getBoundingClientRect();
        return [...document.querySelectorAll('.meter-scale > span')].map(el => { const r = el.getBoundingClientRect(), db = Number(el.textContent.replace('−', '-')); return { db, fraction: (channel.bottom - (r.top + r.height / 2)) / channel.height }; });
      });
      for (const tick of geometry) assert.ok(Math.abs(tick.fraction - (tick.db + 60) / 60) < .008, JSON.stringify({ viewport, tick }));
      assert.equal(await page.locator('.audio-meter').evaluate(el => el.getBoundingClientRect().bottom <= window.innerHeight), true);
    }
    checks.push('known stereo amplitudes, green/yellow zones and calibrated ticks at two viewport sizes');
    await page.keyboard.press('k'); await seek(12); await page.keyboard.press('l'); await levels([-1.1598, -1.1598]);
    assert.deepEqual(await page.locator('.meter-channel').evaluateAll(elements => elements.map(el => el.dataset.zone)), ['red', 'red']);
    assert.equal(await page.locator('.meter-reset.is-clipped').count(), 0);
    await page.screenshot({ path: path.join(results, 'audio-meter-red.png') });
    await page.keyboard.press('k'); await page.keyboard.press('j'); await levels([-1.1598, -1.1598]); await page.keyboard.press('k'); await page.keyboard.press('l'); await levels([-1.1598, -1.1598]);
    checks.push('opposite-phase channels remain visible in red without false CLIP, including J/K/L');
    const copy = { ...base.clips[0], id: 'meter-mix-copy', trackId: 'meter-extra' };
    await load({ ...base, name: '音量上限検証', tracks: [...base.tracks, { ...base.tracks.find(t => t.id === sound.trackId), id: copy.trackId, name: '追加音声' }], clips: [...base.clips, copy] });
    await seek(12); await page.keyboard.press('l'); await levels([4.8608, 4.8608]);
    await page.locator('.meter-reset.is-clipped').waitFor();
    assert.equal(await page.locator('.meter-channel').first().getAttribute('aria-valuenow'), '0');
    await page.screenshot({ path: path.join(results, 'audio-meter-clip.png') });
    await page.keyboard.press('k'); await page.waitForFunction(() => document.querySelector('.meter-reading').textContent.startsWith('−∞'));
    assert.equal(await page.locator('.meter-reset.is-clipped').count(), 1);
    assert.match(await page.locator('.meter-maximum').textContent(), /\+4\.9/);
    await reset.focus(); await page.keyboard.press('Space'); assert.equal(await status.textContent(), '停止');
    assert.equal(await page.locator('.meter-reset.is-clipped').count(), 0); assert.match(await page.locator('.meter-maximum').textContent(), /−∞/);
    assert.equal(await page.locator('.unsaved-dot').count(), 0);
    checks.push('summed full-scale overflow latches CLIP, clamps bars, survives stop, and Space resets without playback or dirty history');
    await page.keyboard.press('l'); await levels([4.8608, 4.8608]); await page.keyboard.press('k');
    await load({ ...base, name: '音量メーター読込リセット', clips: base.clips.map(c => ({ ...c, volume: 0 })) });
    assert.equal(await page.locator('.meter-reset.is-clipped').count(), 0); await seek(12); await page.keyboard.press('l');
    await status.filter({ hasText: '1×' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.meter-reading').textContent.startsWith('−∞'));
    await page.keyboard.press('k'); await reset.focus(); await page.keyboard.press('Enter'); assert.equal(await status.textContent(), '停止');
    checks.push('project reload clears peak memory; zero gain remains silent; Enter resets safely');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'audio-meter-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks, metrics, consoleErrors: errors }, null, 2));
    console.log('Stereo dBFS meter, fixed zones, CLIP and keyboard reset verified in Windows.');
  } catch (error) { await page.screenshot({ path: path.join(results, 'audio-meter-failure.png') }).catch(() => {}); throw error; }
  finally { await app.close(); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
