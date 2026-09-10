const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ffmpeg, run, probe } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');
async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true }); await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const videoFile = path.join(results, '直接配置する動画.mp4'), imageFile = path.join(results, '直接配置する画像.png'), file = path.join(results, 'モニター配置.luma');
  await run(ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=red:s=320x180:r=30:d=6','-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',videoFile]);
  await run(ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=green:s=160x160','-frames:v','1',imageFile]);
  const profile = await fs.mkdtemp(path.join(root, '.local', 'preview-transform-')), env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE, app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(), checks = [], errors = []; let serial = 0;
  page.on('pageerror', error => errors.push(error.message));
  const close = (actual, expected, label, tolerance = .03) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
  const fields = clip => ({ x: clip.x, y: clip.y, scale: clip.scale, rotation: clip.rotation });
  const target = id => page.locator(`.media-drag-target[data-media-clip-id="${id}"]`);
  const handle = (id, corner) => page.locator(`.media-resize-handle[data-media-clip-id="${id}"][data-media-corner="${corner}"]`);
  const center = async locator => { const r = await locator.boundingBox(); assert.ok(r, 'visible transform control'); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const save = async () => {
    await page.evaluate(() => {
      if (window.__monitorSaveTrace) return;
      const trace = window.__monitorSaveTrace = { keys: [], feedback: [] };
      window.addEventListener('keydown', event => {
        if (!['s', 'z'].includes(event.key.toLowerCase())) return;
        queueMicrotask(() => { trace.keys.push({ key: event.key, ctrl: event.ctrlKey, alt: event.altKey, prevented: event.defaultPrevented, focused: document.hasFocus(), target: event.target?.tagName }); trace.keys = trace.keys.slice(-20); });
      });
      new MutationObserver(() => {
        const text = document.querySelector('.toast')?.textContent;
        if (text && trace.feedback.at(-1) !== text) { trace.feedback.push(text); trace.feedback = trace.feedback.slice(-20); }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const before = (await fs.stat(file).catch(() => null))?.mtimeMs;
    await page.keyboard.press('Control+s'); const deadline = Date.now() + 10000;
    while ((await fs.stat(file).catch(() => null))?.mtimeMs === before) {
      if (Date.now() >= deadline) {
        const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), className: document.activeElement?.className }));
        const trace = await page.evaluate(() => window.__monitorSaveTrace);
        const details = { focus, errors, trace };
        await fs.writeFile(path.join(results, 'preview-transform-save-failure.json'), JSON.stringify(details, null, 2));
        assert.fail('atomic project save: ' + JSON.stringify(details));
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    await page.getByRole('dialog', { name: 'プロジェクトを保存しています', exact: true }).waitFor({ state: 'hidden' }); return JSON.parse(await fs.readFile(file, 'utf8'));
  };
  const open = async project => {
    if (await page.locator('.unsaved-dot').count()) await save();
    const next = { ...project, id: `monitor-${++serial}`, name: `モニター配置の検証 ${serial}` };
    await fs.writeFile(file, JSON.stringify(next)); await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await page.keyboard.press('Control+o'); await page.getByRole('button', { name: next.name, exact: true }).waitFor(); await page.keyboard.press('Home'); return next;
  };
  const drag = async (locator, dx, dy, project, cancel) => {
    const point = await center(locator), view = await page.locator('.canvas-wrap').boundingBox();
    // These assertions measure free movement / resizing. Snapping has its own
    // native checks below, including the same narrow Shorts monitor used by CI.
    await page.keyboard.down('Alt');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + dx / project.width * view.width, point.y + dy / project.height * view.height, { steps: 8 });
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (cancel === 'pointer') await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    if (cancel === 'resize') {
      // Hosted Macs can start at the app minimum on a small virtual display.
      // Temporarily lower the test window minimum so this really causes resize.
      const beforeSize = await page.evaluate(() => [innerWidth, innerHeight]);
      await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const [width,height] = w.getSize(); globalThis.__monitorBounds = [width,height]; globalThis.__monitorMinimum = w.getMinimumSize(); w.setMinimumSize(Math.min(globalThis.__monitorMinimum[0], width - 80), Math.min(globalThis.__monitorMinimum[1], height - 40)); w.setSize(width - 80, height - 40); });
      await page.waitForFunction(([width,height]) => innerWidth !== width || innerHeight !== height, beforeSize);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    await page.mouse.up();
    await page.keyboard.up('Alt');
    if (cancel === 'resize') await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(...globalThis.__monitorMinimum); w.setSize(...globalThis.__monitorBounds); });
  };
  try {
    await page.locator('.media-card').first().waitFor({ timeout: 60000 }); await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file);
    const demo = await save(); await open({ ...demo, width: 640, height: 360, clips: [], assets: [], markers: [] });
    await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, [videoFile, imageFile]);
    await page.getByRole('button', { name: '読み込み', exact: true }).click();
    await page.getByRole('button', { name: '直接配置する画像.png を追加', exact: true }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: '直接配置する動画.mp4 を追加', exact: true }).click();
    let project = await save(), video = project.clips.find(c => c.kind === 'video'); const audio = project.clips.find(c => c.kind === 'audio'), image = project.assets.find(a => a.path === imageFile);
    assert.ok(audio && video.linkId === audio.linkId, 'fixture is a real linked AV pair');
    project = await open({ ...project, clips: project.clips.map(c => c.id === video.id ? { ...c, x: 0, y: 0, scale: .55, fadeIn: 0, fadeOut: 0 } : c) });
    await target(video.id).waitFor(); await target(video.id).click();
    assert.equal(await page.getByRole('button', { name: '元に戻す (Ctrl+Z)', exact: true }).isDisabled(), true); assert.equal(await page.locator('.unsaved-dot').count(), 0);
    await page.locator(`.media-card[data-asset-id="${video.assetId}"] .media-card-info`).click();
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.library-panel')), true);
    await target(video.id).click();
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.media-drag-layer')), true);
    const beforeDelete = await save();
    await page.keyboard.press('Delete'); const deleted = await save();
    assert.equal(deleted.clips.length, 0, 'Delete removes the selected linked timeline clips');
    assert.deepEqual(deleted.assets, beforeDelete.assets, 'monitor Delete preserves project media');
    await page.keyboard.press('Control+z'); await save(); await target(video.id).click();
    await page.locator('#prop-x').fill('3'); await drag(target(video.id), 32, 0, project);
    close((await save()).clips.find(c => c.id === video.id).x, 8, 'drag starts from the committed inspector value');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.media-drag-layer')), true);
    await page.keyboard.press('Control+z');
    close((await save()).clips.find(c => c.id === video.id).x, 3, 'undoing drag preserves the prior numeric edit');
    await page.keyboard.press('Control+z'); await save();
    checks.push('monitor focus routes Delete to timeline clips and commits inspector edits before starting a gesture');
    await drag(target(video.id), 80, 36, project); let moved = await save(), changed = moved.clips.find(c => c.id === video.id);
    close(changed.x, 12.5, 'horizontal movement'); close(changed.y, 10, 'vertical movement'); assert.deepEqual(moved.clips.find(c => c.id === audio.id), audio);
    await page.keyboard.press('Control+z'); let undone = await save(); close(undone.clips.find(c => c.id === video.id).x, 0, 'single undo');
    await page.keyboard.press('Control+Shift+z'); close((await save()).clips.find(c => c.id === video.id).x, changed.x, 'single redo');
    checks.push('clicking is clean; video drag updates percentage fields in one Undo/Redo and preserves linked audio');

    const fixed = await center(handle(video.id, '左上')); await drag(handle(video.id, '右下'), 64, 36, project);
    const resized = await save(), resizedVideo = resized.clips.find(c => c.id === video.id), fixedAfter = await center(handle(video.id, '左上'));
    assert.ok(resizedVideo.scale > .55); close(fixedAfter.x, fixed.x, 'fixed corner X', 1); close(fixedAfter.y, fixed.y, 'fixed corner Y', 1);
    const ratio = await target(video.id).evaluate(element => { const s = getComputedStyle(element); return parseFloat(s.width) / parseFloat(s.height); }); close(ratio, 16 / 9, 'video aspect ratio', .01);
    checks.push('corner resizing keeps video aspect ratio and the opposite corner in place');
    for (const cancel of ['escape', 'blur', 'resize', 'pointer']) {
      await drag(target(video.id), -48, -28, project, cancel); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
      assert.deepEqual(fields((await save()).clips.find(c => c.id === video.id)), fields(resizedVideo));
    }
    await page.keyboard.press('Control+z'); close((await save()).clips.find(c => c.id === video.id).scale, .55, 'cancelled drags add no undo steps');
    await page.keyboard.press('Control+Shift+z'); await save();
    checks.push('Escape, pointer cancellation, focus loss and monitor resize restore transforms and clean history');

    const track = project.tracks.find(t => t.id === video.trackId);
    await page.getByRole('button', { name: track.name + ' ロック', exact: true }).click(); const locked = await save();
    assert.equal(await handle(video.id, '右下').count(), 0); await drag(target(video.id), -32, 16, project);
    assert.deepEqual(fields((await save()).clips.find(c => c.id === video.id)), fields(locked.clips.find(c => c.id === video.id)));
    await page.getByRole('button', { name: track.name + ' ロック解除', exact: true }).click(); await save();
    await page.getByRole('button', { name: '位置・大きさを戻す', exact: true }).click(); const reset = await save();
    assert.deepEqual(fields(reset.clips.find(c => c.id === video.id)), { x: 0, y: 0, scale: 1, rotation: 0 });
    checks.push('locked video cannot move; reset restores position and scale without altering other properties');

    for (const scale of [1.5, 3]) {
      project = await open({ ...reset, clips: reset.clips.map(c => c.id === video.id ? { ...c, scale } : c) });
      await target(video.id).waitFor(); await target(video.id).click();
      for (const corner of ['左上', '右上', '右下', '左下']) {
        const point = await center(handle(video.id, corner));
        assert.equal(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.getAttribute('data-media-corner'), point), corner, 'enlarged clip corner stays reachable');
      }
      await drag(handle(video.id, '右下'), -64, -36, project);
      close((await save()).clips.find(c => c.id === video.id).scale, scale - .1, 'resize an enlarged clip without reset');
      await page.keyboard.press('Control+z');
      close((await save()).clips.find(c => c.id === video.id).scale, scale, 'undo enlarged clip resize');
    }
    checks.push('150% and 300% clips keep all four resize handles reachable and resize without resetting their transforms');

    const upper = { ...project.tracks[0], id: 'front-media', name: '前面素材' };
    const graphic = { ...video, id: 'back-graphic', kind: 'title', assetId: undefined, linkId: undefined, audioDetached: undefined, trackId: project.tracks[0].id, x: 0, y: 0, scale: 1, rotation: 0, start: 0, duration: 6, graphic: { shape: 'rectangle', width: 220, height: 150, lineWidth: 4, fill: true, fillColor: '#004cff' }, color: '#004cff' };
    const picture = { ...video, id: 'front-image', name: image.name, kind: 'image', assetId: image.id, trackId: upper.id, linkId: undefined, audioDetached: undefined, x: 0, y: 0, scale: .45, rotation: 0, start: 0, in: 0, duration: 6 };
    project = await open({ ...reset, tracks: [upper, ...reset.tracks], clips: [...reset.clips, graphic, picture] });
    await target(picture.id).waitFor(); await page.locator('.title-drag-target').waitFor();
    const middle = await center(target(picture.id)); await page.mouse.click(middle.x, middle.y);
    assert.equal(await target(picture.id).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: upper.name + ' 非表示', exact: true }).click(); await target(picture.id).waitFor({ state: 'hidden' });
    await page.mouse.click(middle.x, middle.y); await page.locator('.title-drag-target.selected').waitFor();
    await page.getByRole('button', { name: upper.name + ' 表示', exact: true }).click();
    checks.push('video, image and graphic hit targets follow the actual track stacking order; hidden tracks have no targets');

    project = await open({ ...project, width: 360, height: 640, clips: [ { ...picture, scale: .45, rotation: 31 }, { ...audio, linkId: undefined } ] });
    await target(picture.id).waitFor(); await target(picture.id).click();
    const portraitAnchor = await center(handle(picture.id, '右下')); await drag(handle(picture.id, '左上'), -25, -25, project);
    const afterPortrait = await center(handle(picture.id, '右下')), portraitSaved = await save();
    close(afterPortrait.x, portraitAnchor.x, 'rotated portrait anchor X', 1); close(afterPortrait.y, portraitAnchor.y, 'rotated portrait anchor Y', 1);
    close(await target(picture.id).evaluate(element => { const s = getComputedStyle(element); return parseFloat(s.width) / parseFloat(s.height); }), 1, 'square image ratio', .01);
    assert.ok(portraitSaved.clips.find(c => c.id === picture.id).scale > .45);
    await page.getByLabel('プレビュー画質', { exact: true }).selectOption('0.25');
    await page.waitForFunction(() => document.querySelector('.canvas-wrap canvas').width === 90);
    await drag(target(picture.id), 36, -32, project); const quarter = await save();
    close(quarter.clips.find(c => c.id === picture.id).x - portraitSaved.clips.find(c => c.id === picture.id).x, 10, 'quarter-quality coordinates');
    checks.push('rotated images resize with a fixed corner in portrait sequences; quarter preview quality preserves project coordinates');

    await page.keyboard.press('l'); await page.waitForFunction(() => document.querySelector('[aria-label="シャトル状態"]').textContent.includes('再生'));
    assert.equal(await page.locator('.media-drag-target').count(), 0); await page.keyboard.press('k'); await target(picture.id).waitFor();
    await page.getByRole('button', { name: '末尾へ (End)', exact: true }).click(); await target(picture.id).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '先頭へ (Home)', exact: true }).click(); await target(picture.id).waitFor();
    checks.push('playing and out-of-range media hide transform controls without changing edits');

    const snapping = await require('./verify-monitor-snapping.cjs')({ page, open, save, project: { ...reset, tracks: [upper, ...reset.tracks] }, video, picture, graphic, results, checks });

    const finalVideo = { ...video, x: -12, y: 8, scale: .72, rotation: 13, fadeIn: 0, fadeOut: 0 };
    const finalImage = { ...picture, x: 18, y: -12, scale: .56, rotation: -27 };
    await page.evaluate(() => Object.defineProperty(HTMLVideoElement.prototype, 'readyState', { configurable: true, get: () => 0 }));
    project = await open({ ...reset, width: 640, height: 360, tracks: [upper, ...reset.tracks], clips: [finalVideo, audio, finalImage] });
    await target(finalImage.id).waitFor(); assert.equal(await target(finalVideo.id).count(), 0);
    const imagePoint = await center(target(finalImage.id)), imageView = await page.locator('.canvas-wrap').boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.move(imagePoint.x, imagePoint.y); await page.mouse.down();
    await page.mouse.move(imagePoint.x - 16 / project.width * imageView.width, imagePoint.y + 9 / project.height * imageView.height, { steps: 4 });
    await page.evaluate(() => { delete HTMLVideoElement.prototype.readyState; });
    await target(finalVideo.id).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.mouse.move(imagePoint.x - 32 / project.width * imageView.width, imagePoint.y + 18 / project.height * imageView.height, { steps: 4 });
    await page.mouse.up(); await page.keyboard.up('Alt'); const persisted = await save();
    close(persisted.clips.find(c => c.id === finalImage.id).x, 13, 'unrelated video readiness preserves image drag X');
    close(persisted.clips.find(c => c.id === finalImage.id).y, -7, 'unrelated video readiness preserves image drag Y');
    checks.push('an unrelated video becoming ready during image dragging does not cancel the gesture');
    await open(persisted); await target(finalImage.id).waitFor();
    assert.deepEqual((await save()).clips.map(fields), persisted.clips.map(fields));
    await page.getByLabel('プレビュー画質', { exact: true }).selectOption('1');
    await page.waitForFunction(() => document.querySelector('.canvas-wrap canvas').width === 640);
    await target(finalVideo.id).waitFor();
    await target(finalImage.id).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const preview = path.join(results, 'preview-transform-frame.png');
    await fs.writeFile(preview, Buffer.from(await page.locator('.canvas-wrap canvas').evaluate(c => c.toDataURL('image/png').split(',')[1]), 'base64'));
    await target(finalImage.id).click();
    for (const corner of ['左上', '右上', '右下', '左下']) {
      const point = await center(handle(finalImage.id, corner));
      assert.equal(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.getAttribute('data-media-corner'), point), corner, 'resize handles remain accessible above the hint');
    }
    await page.screenshot({ path: path.join(results, 'preview-transform-editor.png') });
    const output = path.join(results, 'preview-transform-native.mp4'); await app.evaluate(({ dialog }, output) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: output }); }, output);
    await page.getByRole('button', { name: '書き出し', exact: true }).click(); await page.getByLabel('品質', { exact: true }).selectOption('high'); await page.getByLabel('書き出し方式', { exact: true }).selectOption('cpu');
    await page.getByRole('button', { name: '保存先を選んで書き出す', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.export-success') || document.querySelector('.export-error'), undefined, { timeout: 180000 });
    assert.ok(await page.getByText('書き出しが完了しました', { exact: true }).isVisible());
    const info = await probe(output); assert.equal(info.streams.find(s => s.codec_type === 'video').width, 640); close(Number(info.format.duration), 6, 'output duration', .08);
    const actual = await run(ffmpeg, ['-v','error','-i',preview,'-pix_fmt','rgb24','-f','rawvideo','pipe:1']), reference = await run(ffmpeg, ['-v','error','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
    assert.equal(actual.length, reference.length); let difference = 0; for (let i = 0; i < actual.length; i++) difference += Math.abs(actual[i] - reference[i]); const meanPixelError = difference / actual.length;
    assert.ok(meanPixelError < 6, 'preview matches exported transforms: ' + meanPixelError); assert.deepEqual(errors, []);
    checks.push('saved video/image transforms reload and match an actual H264/AAC export without changing sequence length');
    await fs.writeFile(path.join(results, 'preview-transform-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks, meanPixelError, snapping, consoleErrors: errors }, null, 2));
    console.log('Program monitor media transforms verified:', checks.length, 'checks; pixel error', meanPixelError.toFixed(3));
  } catch (error) { await page.screenshot({ path: path.join(results, 'preview-transform-failure.png') }).catch(() => {}); throw error; }
  finally { await app.close(); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
