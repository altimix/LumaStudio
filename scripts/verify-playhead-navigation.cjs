const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');

async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true });
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'navigation-profile-'));
  const env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(), errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  const file = path.join(results, '再生ヘッド移動検証.luma');
  const view = () => page.locator('.timeline-scroll').evaluate(v => {
    const head = document.querySelector('.playhead');
    return { left: v.scrollLeft, top: v.scrollTop, width: v.clientWidth, x: head.getBoundingClientRect().left - v.getBoundingClientRect().left - v.clientLeft, time: Number.parseFloat(head.style.left) / Number(document.querySelector('.zoom-slider').value), labels: document.querySelector('.track-labels').scrollTop };
  });
  const visible = async label => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const v = await view(); assert.ok(v.x >= -1 && v.x <= v.width + 1, `${label}: ${JSON.stringify(v)}`); checks.push(label); return v;
  };
  const scroll = left => page.locator('.timeline-scroll').evaluate((v, x) => { v.scrollLeft = x; }, left);
  const sample = ms => page.evaluate(milliseconds => new Promise(resolve => {
    const frames = []; let start, frame;
    // Windows may deliver the first animation callback after the requested sample
    // window. Measure rendered frames from that callback, with a bounded deadline.
    const deadline = setTimeout(() => { cancelAnimationFrame(frame); resolve(frames); }, 5000);
    const collect = now => {
      start ??= now;
      const v = document.querySelector('.timeline-scroll'), head = document.querySelector('.playhead');
      frames.push({ elapsed: now - start, visibility: document.visibilityState, x: head.getBoundingClientRect().left - v.getBoundingClientRect().left - v.clientLeft, width: v.clientWidth, left: v.scrollLeft, time: Number.parseFloat(head.style.left) / Number(document.querySelector('.zoom-slider').value) });
      if (now - start >= milliseconds && frames.length >= 3) { clearTimeout(deadline); resolve(frames); } else frame = requestAnimationFrame(collect);
    }; frame = requestAnimationFrame(collect);
  }), ms);
  const framesVisible = (frames, label) => { assert.ok(frames.length >= 3, `${label}: insufficient frames ${JSON.stringify(frames)}`); assert.deepEqual(frames.filter(v => v.x < -1 || v.x > v.width + 1), [], label); };
  try {
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await page.locator('.media-card').first().waitFor();
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, file);
    await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click();
    await page.getByText('プロジェクトを保存しました', { exact: true }).waitFor();
    const demo = JSON.parse(await fs.readFile(file, 'utf8')), title = demo.clips.find(c => c.kind === 'title');
    const fixture = { ...demo, id: 'navigation-test', name: 'すべての移動で再生ヘッドに追従', width: 1280, height: 720, markers: [{ id: 'jump-marker', time: 60, label: 'ジャンプ検証' }], clips: [{ ...title, id: 'navigation-title', start: 0, in: 0, duration: 120, fadeIn: 0, fadeOut: 0, text: 'Home / End / マウス\n再生ヘッドに追従', opacityKeyframes: [{ time: 0, value: 1 }, { time: 90, value: 1 }] }], youtube: { sourceKey: '', cues: [{ start: 70, end: 72, text: '字幕から移動' }, { start: 140, end: 142, text: '素材末尾より後への移動' }], titles: [], description: '', keywords: [], chapters: [], thumbnailPrompt: '' } };
    while (fixture.tracks.length < 12) fixture.tracks.push({ ...fixture.tracks[0], id: `navigation-track-${fixture.tracks.length}`, name: '表示位置の検証' });
    await fs.writeFile(file, JSON.stringify(fixture));
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, file);
    await page.keyboard.press('Control+o'); await page.getByRole('button', { name: fixture.name, exact: true }).waitFor();
    for (let i = 0; i < 8; i++) await page.keyboard.press('a');
    for (const key of ['End', 'Home']) {
      await scroll(8000); await page.keyboard.press(key); await visible(`${key} while stopped`);
      await scroll(8000); await page.keyboard.press(key); await visible(`${key} repeated at the same time`);
    }
    for (const key of ['r', 'ArrowRight', 'Shift+r', 'Shift+ArrowRight', 'e', 'ArrowLeft', 'Shift+e', 'Shift+ArrowLeft']) {
      await page.keyboard.press(key.toLowerCase().includes('left') || key.endsWith('e') ? 'End' : 'Home');
      await scroll(8000); await page.keyboard.press(key); await visible(`${key} frame navigation`);
    }
    for (const name of ['先頭へ (Home)', '末尾へ (End)', '1フレーム戻る (←)', '1フレーム進む (→)']) {
      await scroll(8000); await page.getByRole('button', { name, exact: true }).click(); await visible(`preview button: ${name}`);
    }
    await page.locator('.timeline-scroll').evaluate(v => { v.scrollTop = 100; });
    await page.keyboard.press('Home'); await visible('vertical position survives Home');
    assert.equal((await view()).top, 100); assert.equal((await view()).labels, 100);
    await scroll(8000); const browsed = await view(); await sample(200); assert.equal((await view()).left, browsed.left);
    checks.push('manual scrolling while paused does not snap back');
    await page.locator('.timeline-scroll').evaluate(v => { v.scrollTop = 0; });
    const heightBefore = await page.locator('.timeline-scroll').evaluate(v => ({ height: v.clientHeight, width: v.clientWidth, left: v.scrollLeft }));
    const separator = await page.getByRole('separator', { name: 'タイムラインの高さを変更', exact: true }).boundingBox();
    await page.mouse.move(separator.x + separator.width / 2, separator.y + separator.height / 2);
    await page.mouse.down(); await page.mouse.move(separator.x + separator.width / 2, separator.y - 40, { steps: 5 }); await page.mouse.up(); await sample(150);
    const heightAfter = await page.locator('.timeline-scroll').evaluate(v => ({ height: v.clientHeight, width: v.clientWidth, left: v.scrollLeft }));
    assert.notEqual(heightAfter.height, heightBefore.height); assert.equal(heightAfter.width, heightBefore.width); assert.equal(heightAfter.left, heightBefore.left);
    checks.push('timeline height-only resize preserves paused horizontal browsing');

    const toggle = page.getByRole('button', { name: '再生ヘッドの自動追従', exact: true });
    await toggle.click(); await scroll(500); await page.keyboard.press('End'); await page.keyboard.press('e');
    assert.equal((await view()).left, 500); checks.push('follow OFF permits offscreen navigation');
    await page.getByRole('button', { name: '再生ヘッドを表示', exact: true }).click(); await visible('manual reveal with follow OFF'); await scroll(500);
    await toggle.click(); await visible('follow ON reveals a stopped playhead');
    for (const key of ['s', 'a']) { await page.keyboard.press(key); await visible(`${key} zoom while stopped`); }
    const beforeWheel = await page.getByRole('slider', { name: 'タイムラインのズーム', exact: true }).inputValue();
    const wheelBox = await page.locator('.timeline-scroll').boundingBox(); await page.mouse.move(wheelBox.x + 200, wheelBox.y + 10);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, 120); await page.keyboard.up('Control');
    await page.waitForFunction(before => document.querySelector('.zoom-slider').value !== before, beforeWheel); await visible('Ctrl wheel zoom while stopped');
    await page.getByRole('button', { name: 'タイムライン全体を表示', exact: true }).click(); await visible('fit entire timeline while stopped');
    const zoom = page.getByRole('slider', { name: 'タイムラインのズーム', exact: true });
    await zoom.focus(); await page.keyboard.press('Home'); await visible('zoom slider minimum');
    await page.keyboard.press('End'); await visible('zoom slider maximum'); await zoom.blur();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
    await page.keyboard.press('End');
    await page.locator('.timeline-scroll').evaluate(v => { v.scrollLeft = Number.parseFloat(document.querySelector('.playhead').style.left) - v.clientWidth * 0.9; });
    const wide = await view();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760)); const narrow = await visible('resize narrower while stopped');
    assert.ok(wide.width > narrow.width + 100); assert.ok(wide.x > narrow.width);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000)); await visible('resize wider while stopped');

    const marker = page.getByRole('button', { name: 'マーカー ジャンプ検証', exact: true });
    await marker.click(); assert.equal((await visible('marker click')).time, 60);
    await marker.focus(); await scroll(0); await page.keyboard.press('Enter'); await visible('marker activation at the same time');
    const clip = page.locator('[data-clip-id="navigation-title"]');
    await clip.focus(); await scroll(8000); await page.keyboard.press('Enter'); assert.equal((await visible('clip Enter')).time, 0);
    await scroll(8000); await page.keyboard.press('Enter'); await visible('clip Enter at the same time');
    await page.getByRole('button', { name: '90.00 秒のキーフレームへ', exact: true }).click(); assert.equal((await visible('opacity keyframe jump')).time, 90);
    const cueJump = async index => {
      await page.getByRole('button', { name: 'YouTube', exact: true }).click();
      await page.locator('.yt-cue-jump').nth(index).click();
    };
    await cueJump(0); assert.equal((await visible('subtitle jump')).time, 70);
    await cueJump(1); assert.equal((await visible('subtitle jump beyond the last clip')).time, 140);

    const reopen = async () => {
      const dirty = await page.locator('.unsaved-dot').count();
      await page.keyboard.press('Control+o');
      if (dirty) await page.getByRole('button', { name: '保存しないで続行', exact: true }).click();
      await page.waitForFunction(() => {
        const v = document.querySelector('.timeline-scroll'), h = document.querySelector('.playhead');
        const time = Number.parseFloat(h.style.left) / Number(document.querySelector('.zoom-slider').value), x = h.getBoundingClientRect().left - v.getBoundingClientRect().left;
        return Math.abs(time - 2.4) < 0.001 && x >= 0 && x <= v.clientWidth;
      });
    };
    await reopen(); await visible('project reopen resets the viewport');
    await scroll(8000); await reopen(); await visible('same project and same time reopen');
    for (const side of [-1, 1]) {
      await scroll(8000); const box = await page.locator('.timeline-scroll').boundingBox(), v = await view();
      await page.mouse.click(box.x + (side > 0 ? v.width - 3 : 3), box.y + 10); await visible(`ruler click at the ${side > 0 ? 'right' : 'left'} edge`);
    }

    const startDrag = async (source, direction) => {
      await page.keyboard.press('k'); await page.keyboard.press(source === 'lane' ? 'c' : 'v'); await scroll(8000);
      const v = await view(), box = await page.locator('.timeline-scroll').boundingBox();
      await page.mouse.click(box.x + v.width / 2, box.y + 10);
      let y = box.y + 10;
      if (source === 'handle') { const handle = await page.locator('.playhead-handle').boundingBox(); y = handle.y + 5; }
      if (source === 'line') {
        // Use the visible part of the scrub line; a fixed fourth-track offset
        // can fall below the viewport on a small CI display.
        y = await page.evaluate(x => {
          const viewport = document.querySelector('.timeline-scroll').getBoundingClientRect();
          for (let candidate = viewport.top + 40; candidate < Math.min(viewport.bottom - 12, innerHeight); candidate += 4) {
            if (document.elementFromPoint(x, candidate)?.closest('.playhead-scrub-hit')) return candidate;
          }
          throw new Error('No visible playhead scrub line');
        }, box.x + (await view()).x);
      }
      if (source === 'lane') { const lane = await page.locator('.track-lane').nth(1).boundingBox(); y = lane.y + 8; }
      await page.evaluate(() => { window.addEventListener('pointerdown', event => {
        window.navigationPointerId = event.pointerId;
        const target = event.target;
        window.navigationPointerTarget = target.closest('.playhead-handle') ? 'handle' : target.closest('.playhead-scrub-hit') ? 'line' : target.closest('.timeline-ruler') ? 'ruler' : target.matches('.track-lane') ? 'lane' : 'other';
      }, { once: true }); });
      await page.mouse.move(box.x + (await view()).x + (source === 'lane' ? 100 : 0), y); await page.mouse.down();
      assert.equal(await page.evaluate(() => window.navigationPointerTarget), source, 'the intended scrub surface receives the pointer');
      await page.mouse.move(box.x + (direction > 0 ? v.width - 3 : 3), y);
      return { box, y, width: v.width };
    };
    for (const source of ['handle', 'line', 'ruler', 'lane']) for (const direction of [-1, 1]) {
      const vertical = source === 'line' ? 100 : 0;
      await page.locator('.timeline-scroll').evaluate((v, top) => { v.scrollTop = top; }, vertical);
      const drag = await startDrag(source, direction), before = await view();
      const frames = await sample(300); framesVisible(frames, `${source} edge frames`);
      assert.ok(((await view()).left - before.left) * direction > 30, `${source} keeps scrolling with a stationary pointer`);
      await page.mouse.move(drag.box.x + (direction > 0 ? drag.width + 80 : -80), drag.y);
      const outside = await view(); framesVisible(await sample(200), `${source} outside frames`);
      assert.ok(((await view()).left - outside.left) * direction > 30);
      await page.mouse.up(); await visible(`${source} drag ${direction > 0 ? 'right' : 'left'} and outside`);
      const ended = await view(); await sample(150); assert.equal((await view()).time, ended.time); assert.equal((await view()).left, ended.left);
      assert.equal(ended.top, vertical); assert.equal(ended.labels, vertical);
    }
    await toggle.click(); const disabledDrag = await startDrag('handle', 1), disabledBefore = await view();
    await page.mouse.move(disabledDrag.box.x + disabledDrag.width + 80, disabledDrag.y); await sample(200);
    assert.equal((await view()).left, disabledBefore.left); await page.mouse.up(); checks.push('follow OFF disables mouse edge scrolling');
    await toggle.click(); await visible('follow ON after disabled mouse dragging');
    await startDrag('handle', 1);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
    framesVisible(await sample(300), 'resize while scrubbing'); await page.mouse.up(); await visible('resize during a pointer drag');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
    for (const ending of ['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'hide']) {
      let focusSession;
      if (ending === 'blur' || ending === 'hide') {
        // Playwright normally emulates a focused page. Disable that emulation to
        // exercise real native focus/visibility events during this lifecycle test.
        focusSession = await page.context().newCDPSession(page);
        await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
        await page.waitForFunction(() => document.hasFocus(), null, { timeout: 5000 });
      }
      await startDrag('handle', 1); await sample(100);
      if (ending === 'Escape') await page.keyboard.press('Escape');
      if (ending === 'pointercancel') await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.navigationPointerId, bubbles: true })));
      if (ending === 'lostpointercapture') await page.locator('.timeline-scroll').evaluate(v => v.releasePointerCapture(window.navigationPointerId));
      if (ending === 'blur') {
        // On Windows blur() alone may leave focus unchanged. Focus another test-owned
        // native window and verify that the editor really loses focus.
        await app.evaluate(async ({ BrowserWindow }) => {
          const sink = new BrowserWindow({ width: 160, height: 100, show: false, skipTaskbar: true, title: '追従検証', webPreferences: { sandbox: true } });
          globalThis.navigationFocusSink = sink; await sink.loadURL('about:blank'); sink.show(); sink.focus();
        });
        await page.waitForFunction(() => !document.hasFocus(), null, { timeout: 5000 });
      }
      if (ending === 'hide') {
        await app.evaluate(async ({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0]; win.hide(); await new Promise(resolve => setTimeout(resolve, 200)); win.show();
        });
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const ended = await view(); await sample(200); assert.equal((await view()).time, ended.time, `${ending}: time stays stopped`); assert.equal((await view()).left, ended.left, `${ending}: scrolling stays stopped`);
      await page.mouse.up(); await app.evaluate(({ BrowserWindow }) => { globalThis.navigationFocusSink?.destroy(); delete globalThis.navigationFocusSink; BrowserWindow.getAllWindows()[0].focus(); });
      if (focusSession) { await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await focusSession.detach(); }
      await page.keyboard.press('Home'); assert.equal((await visible(`${ending} ends dragging and releases shortcuts`)).time, 0);
    }
    assert.equal(await page.getByRole('button', { name: '元に戻す (Ctrl+Z)', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.unsaved-dot').count(), 0); checks.push('all navigation and scrubbing leave editing history and saved state intact');

    // The visible line crosses clips, but must never steal their editing gestures.
    await marker.click();
    const clickClipAtHead = async () => {
      const box = await clip.boundingBox(), viewport = await page.locator('.timeline-scroll').boundingBox();
      await page.mouse.click(viewport.x + (await view()).x, box.y + 20);
    };
    await clickClipAtHead(); assert.equal(await clip.getAttribute('aria-pressed'), 'true');
    assert.equal((await view()).time, 60); checks.push('clip selection takes priority where the playhead crosses a clip');
    await page.keyboard.press('End');
    const trim = await clip.locator('.trim-handle.right').boundingBox();
    await page.mouse.move(trim.x + trim.width / 2, trim.y + 20); await page.mouse.down();
    await page.mouse.move(trim.x + trim.width / 2 - 60, trim.y + 20, { steps: 5 }); await page.mouse.up();
    assert.ok(Number(await page.locator('#prop-duration').inputValue()) < 120); checks.push('trim handle takes priority where the playhead meets a clip boundary');
    await reopen(); await marker.click(); await page.keyboard.press('c'); await clickClipAtHead();
    assert.equal(await page.locator('.timeline-clip').count(), 2); checks.push('razor tool cuts a clip at the playhead line');
    await page.keyboard.press('v'); await reopen();

    // Editing routes that assign a new playhead position use the same viewport policy.
    await clip.focus(); await page.keyboard.press('Enter'); await scroll(8000);
    const lengthView = await view(); await page.locator('#prop-duration').fill('130'); await page.locator('#prop-duration').blur();
    await sample(150); assert.equal((await view()).left, lengthView.left); checks.push('editing clip duration preserves paused browsing');
    await page.keyboard.press('Control+z'); await visible('Undo after a duration edit'); await reopen();
    const asset = demo.assets.find(a => a.kind === 'video');
    await scroll(8000); await page.getByRole('button', { name: `${asset.name} を追加`, exact: true }).click();
    assert.equal((await visible('media add button')).time, 0);
    await scroll(8000); await page.getByRole('button', { name: `${asset.name} をプレビュー`, exact: true }).click();
    await page.getByRole('button', { name: 'タイムラインに追加', exact: true }).click(); await visible('source monitor adds media');
    await cueJump(1); await page.keyboard.press('Control+z'); assert.equal((await visible('Undo clamps and reveals playhead')).time, 120);
    await scroll(0); await page.keyboard.press('Control+Shift+z'); await visible('Redo reveals the restored position');
    await page.getByRole('button', { name: 'ウィンドウ', exact: true }).click(); await page.getByRole('button', { name: 'ヒストリー', exact: true }).click();
    const states = page.getByRole('complementary', { name: 'ヒストリー', exact: true }).locator('li button');
    await scroll(0); await states.first().click(); await visible('history panel restores and reveals position');
    await page.getByRole('button', { name: 'ヒストリーを閉じる', exact: true }).click();
    await reopen();
    await page.keyboard.press('Home'); for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await scroll(8000); await page.keyboard.press('q'); assert.equal((await visible('Q ripple trim moves the head')).time, 0);
    await reopen(); await page.keyboard.press('Home'); for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await scroll(8000); await page.keyboard.press('w'); await visible('W ripple trim reveals its position');
    await reopen();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(results, 'playhead-navigation.png') });
    await fs.writeFile(path.join(results, 'playhead-navigation-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks, consoleErrors: errors }, null, 2));
    console.log(`Playhead navigation verified: ${checks.length} cases.`);
  } catch (error) {
    await page.screenshot({ path: path.join(results, 'playhead-navigation-failure.png') }).catch(() => {});
    await fs.writeFile(path.join(results, 'playhead-navigation-failure.json'), JSON.stringify({ message: error.message, checks, viewport: await view(), focused: await page.evaluate(() => document.hasFocus()) }, null, 2));
    throw error;
  } finally { await app.close(); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
