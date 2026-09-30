const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true });
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'playhead-time-')), file = path.join(profile, '秒数表示.luma');
  const env = { ...process.env, LUMA_TEST_DATA: profile, LUMA_DEMO_FIXTURE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(), errors = [], checks = []; page.on('pageerror', error => errors.push(error.message));
  const value = page.locator('.playhead-seconds strong');
  const expectTime = async (time, fps) => {
    const text = (Math.round(time * fps) / fps).toFixed(3);
    await page.waitForFunction(expected => document.querySelector('.playhead-seconds strong')?.textContent === expected, text);
    const group = page.getByRole('group', { name: '再生ヘッドの現在位置', exact: true }); assert.ok(await group.isVisible());
    const box = await group.boundingBox(), label = await page.locator('.ruler-label').boundingBox();
    assert.ok(box.x >= label.x && box.x + box.width <= label.x + label.width + 1, 'time display fits the fixed label');
    assert.equal(await group.getAttribute('aria-live'), null, 'playback does not announce each frame');
  };
  try {
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
    for (const fps of [24, 30, 60]) {
      const project = { version: 1, id: 'time-display', name: `秒数表示 ${fps} fps`, width: 640, height: 360, fps,
        assets: [], markers: [{ id: 'long-time', label: '1時間を超える位置', time: 3601 + 1 / fps }],
        tracks: [{ id: 'v', name: '映像', kind: 'video', muted: false, hidden: false, locked: false, solo: false }],
        clips: [{ id: 'title', trackId: 'v', kind: 'title', name: '長尺シーケンス', start: 0, in: 0, duration: 3602, speed: 1,
          x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, exposure: 0, contrast: 1, saturation: 1, volume: 1, fadeIn: 0, fadeOut: 0,
          text: '秒数表示', fontSize: 48, color: '#ffffff', textStyle: 'minimal' }] };
      await fs.writeFile(file, JSON.stringify(project));
      await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, file);
      await page.keyboard.press('Control+o'); await page.getByRole('button', { name: project.name, exact: true }).waitFor();
      await page.locator('.timeline-content').focus(); await page.keyboard.press('Home'); await expectTime(0, fps);
      await page.keyboard.press('ArrowRight'); await expectTime(1 / fps, fps);
      await page.keyboard.press('Shift+ArrowRight'); await expectTime(11 / fps, fps);
      await page.keyboard.press('ArrowLeft'); await expectTime(10 / fps, fps);
      const ruler = await page.locator('.timeline-scroll').boundingBox();
      await page.mouse.click(ruler.x + 130, ruler.y + 10);
      const head = await page.locator('.playhead-handle').boundingBox();
      await page.mouse.move(head.x + head.width / 2, head.y + 5); await page.mouse.down();
      await page.mouse.move(ruler.x + 200, head.y + 5, { steps: 4 }); await page.mouse.up();
      const position = await page.evaluate(() => Number.parseFloat(document.querySelector('.playhead').style.left) / Number(document.querySelector('.zoom-slider').value));
      await expectTime(position, fps);
      const paused = await value.innerText(); await page.keyboard.press('l');
      await page.waitForFunction(old => document.querySelector('.playhead-seconds strong')?.textContent !== old, paused);
      await page.keyboard.press('k'); const stopped = await value.innerText(); await page.waitForTimeout(150); assert.equal(await value.innerText(), stopped);
      await page.keyboard.press('j'); await page.waitForFunction(old => document.querySelector('.playhead-seconds strong')?.textContent !== old, stopped); await page.keyboard.press('k');
      await page.getByRole('button', { name: 'マーカー 1時間を超える位置', exact: true }).evaluate(button => button.click());
      await expectTime(3601 + 1 / fps, fps);
      await page.getByRole('button', { name: '再生ヘッドの自動追従', exact: true }).click();
      await page.locator('.timeline-scroll').evaluate(element => { element.scrollLeft = 0; });
      await expectTime(3601 + 1 / fps, fps);
      await page.getByRole('button', { name: '再生ヘッドの自動追従', exact: true }).click();
      checks.push(`${fps} fps: frame keys, click, drag, forward/reverse playback, stop, long time, narrow window and scroll`);
    }
    await page.screenshot({ path: path.join(results, 'playhead-time.png') });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'playhead-time-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks }, null, 2));
    console.log('Playhead seconds verified:', checks);
  } catch (error) { await page.screenshot({ path: path.join(results, 'playhead-time-failure.png') }).catch(() => {}); throw error; }
  finally { await app.close(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
