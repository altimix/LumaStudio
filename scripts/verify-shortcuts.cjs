const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { probe } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');
async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'shortcuts-profile-'));
  const env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  const projectFile = path.join(results, 'ショートカット検証.luma');
  try {
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await page.locator('.media-card').first().waitFor();
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, projectFile);
    const readSaved=async action=>{
      const before=(await fs.stat(projectFile).catch(()=>null))?.mtimeMs;
      await action();const deadline=Date.now()+10000;
      while((await fs.stat(projectFile).catch(()=>null))?.mtimeMs===before){assert.ok(Date.now()<deadline,'atomic shortcut fixture save completed');await new Promise(resolve=>setTimeout(resolve,25));}
      await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
      return JSON.parse(await fs.readFile(projectFile,'utf8'));
    };
    const demo=await readSaved(()=>page.getByRole('button',{name:'プロジェクトを保存 (Ctrl+S)',exact:true}).click());
    const video = demo.clips.find(c => c.kind === 'video'); const audio = demo.clips.find(c => c.kind === 'audio'); const title = demo.clips.find(c => c.kind === 'title');
    const original = { ...demo, name: '左手ショートカット検証', width: 1280, height: 720, markers: [], clips: [
      { ...video, start: 0, duration: 8, in: 0, speed: 1, fadeIn: 0, fadeOut: 0 },
      { ...audio, start: 0, duration: 8, in: 0, fadeIn: 0, fadeOut: 0 },
      { ...title, start: 2, duration: 4, text: '左手で、編集する。', fadeIn: 0, fadeOut: 0, opacityKeyframes: [{ time: 0, value: 0 }, { time: 4, value: 1 }] },
    ] };
    await fs.writeFile(projectFile, JSON.stringify(original));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, projectFile);
    await page.getByRole('button', { name: 'ファイル', exact: true }).click(); await page.getByRole('button', { name: /^プロジェクトを開く/ }).click();
    await page.getByRole('button', { name: '左手ショートカット検証', exact: true }).waitFor();
    const count = async n => page.waitForFunction(n => document.querySelectorAll('.timeline-clip').length === n, n);
    const time = () => page.locator('.preview-meta .timecode').first().textContent();
    const seek = async frames => { await page.keyboard.press('Home'); for (let i = 0; i < Math.floor(frames / 10); i++) await page.keyboard.press('Shift+ArrowRight'); for (let i = 0; i < frames % 10; i++) await page.keyboard.press('ArrowRight'); };
    const status = page.getByRole('status', { name: 'シャトル状態' });
    const save=()=>readSaved(()=>page.keyboard.press('Control+s'));
    await count(3); await seek(120);
    await page.locator('.track-menu-wrap > button').click();
    for (const key of ['z', 'q', 'w', 'Shift+d']) { await page.keyboard.press(key); await count(3); }
    assert.equal(await time(), '00:00:04:00'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.track-menu-wrap .popup-menu').count(), 0);
    // All tracks, not just the selected video.
    await page.keyboard.press('z'); await count(6); await page.keyboard.press('Control+z'); await count(3);
    const drag = await page.locator('.timeline-clip.video').first().boundingBox();
    await page.mouse.move(drag.x + 60, drag.y + 20); await page.mouse.down(); await page.mouse.move(drag.x + 110, drag.y + 20, { steps: 6 });
    await page.keyboard.press('q'); await page.keyboard.press('Escape'); await page.mouse.up(); await count(3);
    await page.keyboard.press('Control+Shift+z'); await count(6); await page.keyboard.press('Control+z'); await count(3);
    // Typed letters and composition must never cut or transport.
    await page.locator('.timeline-clip.video').first().click(); const name = page.getByRole('textbox', { name: 'クリップ名', exact: true });
    await name.fill('zqwasd1jkl'); await name.blur(); await count(3); assert.equal(await status.textContent(), '停止'); await page.keyboard.press('Control+z');
    await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', isComposing: true, bubbles: true })); }); await count(3);
    // Zoom aliases and the relocated snap key.
    const zoom = page.getByRole('slider', { name: 'タイムラインのズーム', exact: true }); const initialZoom = Number(await zoom.inputValue());
    await page.keyboard.press('a'); assert.ok(Number(await zoom.inputValue()) > initialZoom); await page.keyboard.press('s'); assert.equal(Number(await zoom.inputValue()), initialZoom);
    const snap = page.getByRole('button', { name: 'スナップ (N)', exact: true }); const snapBefore = await snap.getAttribute('aria-pressed'); await page.keyboard.press('n'); assert.notEqual(await snap.getAttribute('aria-pressed'), snapBefore); await page.keyboard.press('n');
    await seek(120); await page.keyboard.press('e'); assert.equal(await time(), '00:00:03:29'); await page.keyboard.press('r'); assert.equal(await time(), '00:00:04:00'); await page.keyboard.press('Shift+e'); assert.equal(await time(), '00:00:03:20'); await page.keyboard.press('Shift+r');
    // Playback advances forward and in reverse; repeated keydown does not accelerate.
    await page.keyboard.press('1'); await page.waitForFunction(() => document.querySelector('.preview-meta .timecode').textContent !== '00:00:04:00'); await page.keyboard.press('1'); assert.equal(await status.textContent(), '停止');
    await seek(210); await page.keyboard.press('j');
    // Observe transitions in the renderer: slow host round trips must not let a
    // short reverse fixture reach zero before the intermediate assertion.
    const reverse = await page.evaluate(async () => {
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const key = (key, repeat = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }));
      const status = () => document.querySelector('.shuttle-status').textContent;
      const one = status(); key('j', true); await frame(); const repeated = status();
      key('j'); await frame(); const two = status();
      const deadline = performance.now() + 3000;
      while (document.querySelector('.preview-meta .timecode').textContent >= '00:00:07:00' && performance.now() < deadline) await frame();
      const time = document.querySelector('.preview-meta .timecode').textContent;
      // Video decoders may run muted until seeked to deliver Windows reverse
      // frames. Only the timeline audio engine may produce shuttle audio.
      const media = [...document.querySelectorAll('.media-elements video, .media-elements audio')];
      const mediaSilent = media.length > 0 && media.every(el => el.muted || el.paused);
      key('k'); await frame();
      const stoppedDeadline = performance.now() + 5000;
      const settled = () => [...document.querySelectorAll('.media-elements video, .media-elements audio')].every(el => el.paused && !el.seeking);
      while (!settled() && performance.now() < stoppedDeadline) await frame();
      return { one, repeated, two, time, mediaSilent, mediaSettled: settled(), stopped: status() };
    });
    assert.match(reverse.one, /逆再生 1×/); assert.match(reverse.repeated, /逆再生 1×/); assert.match(reverse.two, /逆再生 2×/);
    assert.ok(reverse.time < '00:00:07:00' && reverse.time > '00:00:00:00'); assert.ok(reverse.mediaSilent); assert.ok(reverse.mediaSettled); assert.equal(reverse.stopped, '停止');
    await seek(0); await page.keyboard.press('l'); await page.keyboard.press('l'); assert.match(await status.textContent(), /再生 2×/); assert.doesNotMatch(await status.textContent(), /消音/); await page.keyboard.press('k');
    // Boundary stop at both ends (one-frame distance avoids timing-sensitive assertions).
    await seek(239); await page.keyboard.press('l'); await page.waitForFunction(() => document.querySelector('.shuttle-status').textContent === '停止'); assert.equal(await time(), '00:00:08:00');
    await seek(1); await page.keyboard.press('j'); await page.waitForFunction(() => document.querySelector('.shuttle-status').textContent === '停止'); assert.equal(await time(), '00:00:00:00');
    await seek(120);
    const lock = page.getByRole('button', { name: 'テロップ・オーバーレイ ロック', exact: true }); await lock.click(); await page.keyboard.press('q'); await count(3); await page.getByText(/該当トラックのロックを解除/).waitFor(); await page.keyboard.press('z'); await count(5); await page.keyboard.press('Control+z'); await count(3); await page.getByRole('button', { name: 'テロップ・オーバーレイ ロック解除', exact: true }).click(); await seek(120);
    // Q/W are single undoable edits and persist exact source intervals.
    await page.keyboard.press('q'); await count(5); assert.equal(await time(), '00:00:02:00'); let saved = await save();
    assert.deepEqual(saved.clips.filter(c => c.kind === 'video').map(c => [c.start, c.in, c.duration]), [[0, 0, 2], [2, 4, 4]]);
    await page.keyboard.press('Control+z'); await count(3); await seek(120); await page.keyboard.press('w'); await count(5); saved = await save();
    assert.deepEqual(saved.clips.filter(c => c.kind === 'video').map(c => [c.start, c.in, c.duration]), [[0, 0, 4], [4, 6, 2]]);
    // History can jump backwards AND forwards, then branch after a new edit.
    await page.getByRole('button', { name: 'ウィンドウ', exact: true }).click(); await page.getByRole('button', { name: 'ヒストリー', exact: true }).click();
    const history = page.getByRole('complementary', { name: 'ヒストリー', exact: true }); const states = history.locator('li button');
    const last = await states.count() - 1; await states.first().click(); await count(3); await states.nth(last).click(); await count(5);
    await seek(90); await page.waitForFunction(() => { const c = document.querySelector('.canvas-wrap canvas'); const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return d[0] + d[1] + d[2] > 20; }); await page.screenshot({ animations: 'disabled', path: path.join(results, 'shortcut-history.png') }); await page.getByRole('button', { name: 'ヒストリーを閉じる', exact: true }).click();
    await page.keyboard.press('Control+z'); await count(3); await seek(120); await page.keyboard.press('z'); await count(6);
    await page.locator('.timeline-clip.video').first().click(); await page.keyboard.press('Shift+d'); await count(5); saved = await save();
    assert.equal(saved.clips.filter(c => c.kind === 'video')[0].start, 0); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await count(3);
    await seek(120); await page.keyboard.press('q'); await count(5); saved = await save();
    // Modal search uses the user's search terms; typed shortcut keys leave the timeline intact.
    await page.getByRole('button', { name: 'ショートカット', exact: true }).click(); const search = page.getByRole('searchbox', { name: 'ショートカットを検索', exact: true });
    await search.fill('前の編集'); assert.equal(await page.locator('.shortcut-list>div').count(), 1); await page.keyboard.press('z'); await count(5); await search.fill('複数フレーム'); assert.equal(await page.locator('.shortcut-list>div').count(), 2); await search.fill(''); await page.screenshot({ animations: 'disabled', path: path.join(results, 'editing-shortcuts.png') }); await page.keyboard.press('Escape');
    await page.keyboard.press('Control+o'); await count(5); await page.waitForFunction(() => document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]').disabled);
    const output = path.join(results, 'ショートカット検証.mp4');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, output);
    await page.getByRole('button', { name: '書き出し', exact: true }).click(); await page.getByLabel('品質', { exact: true }).selectOption('draft'); await page.getByRole('button', { name: '保存先を選んで書き出す', exact: true }).click(); await page.getByText('書き出しが完了しました', { exact: true }).waitFor({ timeout: 120000 });
    const info = await probe(output); assert.ok(Math.abs(Number(info.format.duration) - 6) < 0.05); assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'shortcuts-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks: ['Z all tracks and locks', 'input, IME and track menu guard', 'drag cancellation preserves redo', 'A/S zoom and N snap', 'E/R frame and Shift ten frames', '1 playback', 'J/K/L direction and repeat guard', 'boundary stops', 'Q/W source intervals and locks', 'history jump and branch', 'Shift+D ripple delete', 'searchable shortcuts', 'save/reload history reset', '6 second MP4 export'], output, duration: info.format.duration }, null, 2));
    console.log('Windows editing shortcuts and history verified.');
  } catch (error) { await page.screenshot({ path: path.join(results, 'shortcuts-failure.png') }).catch(() => {}); throw error; }
  finally { await app.close(); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
