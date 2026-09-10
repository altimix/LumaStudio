const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true });
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'follow-profile-'));
  const env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(), errors = [], checks = [], rates = [];
  page.on('pageerror', e => errors.push(e.message));
  const projectFile = path.join(results, '再生ヘッド追従検証.luma');
  try {
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await page.locator('.media-card').first().waitFor();
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, projectFile);
    await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click();
    await page.getByText('プロジェクトを保存しました', { exact: true }).waitFor();
    const demo = JSON.parse(await fs.readFile(projectFile, 'utf8')), title = demo.clips.find(c => c.kind === 'title'); assert.ok(title);
    const fixture = { ...demo, id: 'timeline-follow-test', name: '再生位置を見失わない', width: 1280, height: 720, assets: [], markers: [], clips: [{ ...title, start: 0, in: 0, duration: 120, fadeIn: 0, fadeOut: 0, text: 'J / K / L\n再生ヘッドに自動追従', opacityKeyframes: undefined }] };
    while (fixture.tracks.length < 12) fixture.tracks.push({ ...fixture.tracks[0], id: `follow-track-${fixture.tracks.length}`, name: '表示位置の検証' });
    await fs.writeFile(projectFile, JSON.stringify(fixture));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, projectFile);
    await page.keyboard.press('Control+o'); await page.getByRole('button', { name: fixture.name, exact: true }).waitFor();
    for (let i = 0; i < 8; i++) await page.keyboard.press('a');
    assert.equal(await page.getByRole('slider', { name: 'タイムラインのズーム' }).inputValue(), '200');
    const viewport = () => page.locator('.timeline-scroll').evaluate(v => {
      const head = document.querySelector('.playhead');
      return { left: v.scrollLeft, top: v.scrollTop, width: v.clientWidth, max: v.scrollWidth - v.clientWidth, x: head.getBoundingClientRect().left - v.getBoundingClientRect().left - v.clientLeft, absoluteX: Number.parseFloat(head.style.left), labelTop: document.querySelector('.track-labels').scrollTop };
    });
    const stopped = async () => { await page.keyboard.press('k'); await page.waitForFunction(() => document.querySelector('.shuttle-status').textContent === '停止'); };
    const sample = milliseconds => page.evaluate(ms => new Promise(resolve => {
      const frames = []; let begin, frame;
      // Start the interval at the first rendered frame; a delayed Windows callback
      // must not consume the whole sample before any geometry has been observed.
      const deadline = setTimeout(() => { cancelAnimationFrame(frame); resolve(frames); }, 5000);
      const collect = now => {
        begin ??= now;
        const v = document.querySelector('.timeline-scroll'), head = document.querySelector('.playhead');
        frames.push({ x: head.getBoundingClientRect().left - v.getBoundingClientRect().left - v.clientLeft, width: v.clientWidth, left: v.scrollLeft, top: v.scrollTop });
        if (now - begin >= ms && frames.length >= 3) { clearTimeout(deadline); resolve(frames); } else frame = requestAnimationFrame(collect);
      };
      frame = requestAnimationFrame(collect);
    }), milliseconds);
    const visible = (frames, label) => { assert.ok(frames.length >= 3, `${label}: animation frames observed`); assert.deepEqual(frames.filter(f => f.x < -1 || f.x > f.width + 1), [], `${label}: playhead remains inside viewport`); };
    const nearEdge = async direction => {
      await stopped(); await page.locator('.timeline-scroll').evaluate(v => { v.scrollTop = 0; v.scrollLeft = 8000; });
      const box = await page.locator('.timeline-scroll').boundingBox(), state = await viewport();
      await page.mouse.click(box.x + (direction > 0 ? state.width - 70 : 70), box.y + 10);
      return viewport();
    };
    // Read actual rendered geometry while the real transport runs, including multiple page crossings.
    for (const direction of [1, -1]) for (const rate of [1, 2, 4, 8, 16]) {
      const before = await nearEdge(direction), key = direction > 0 ? 'l' : 'j';
      for (let i = 0; i <= Math.log2(rate); i++) await page.keyboard.press(key);
      await page.waitForFunction(text => document.querySelector('.shuttle-status').textContent.startsWith(text), `${direction > 0 ? '再生' : '逆再生'} ${rate}×`);
      // On a cold Windows audio device the context may report running while its
      // clock is still zero. Measure follow only once the transport has started.
      await page.waitForFunction(({position,direction})=>(Number.parseFloat(document.querySelector('.playhead').style.left)-position)*direction>0,{position:before.absoluteX,direction},{timeout:10000});
      const frames = await sample(650), after = await viewport(); visible(frames, `${key} ${rate}x`);
      assert.ok((after.left - before.left) * direction > 0, `${key} ${rate}x scrolls in playback direction`);
      assert.ok((after.absoluteX - before.absoluteX) * direction > 0, 'transport advances');
      rates.push({ direction, rate, frames: frames.length, from: before.left, to: after.left });
    }
    checks.push('all ten shuttle directions/rates keep the playhead visible');
    for (const key of ['1', 'Space']) {
      const before = await nearEdge(1); await page.keyboard.press(key);
      visible(await sample(350), `${key} normal playback`); assert.ok((await viewport()).left > before.left);
    }
    checks.push('normal playback with 1 and Space also follows');
    await stopped();
    const toggle = page.getByRole('button', { name: '再生ヘッドの自動追従', exact: true }), reveal = page.getByRole('button', { name: '再生ヘッドを表示', exact: true });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await page.locator('.timeline-scroll').evaluate(v => { v.scrollLeft = 400; v.scrollTop = 100; });
    const manual = await viewport(); await sample(250); assert.equal((await viewport()).left, manual.left);
    await reveal.click(); const centered = await viewport(); assert.ok(Math.abs(centered.x - centered.width / 2) <= 1); assert.equal(centered.top, 100); assert.equal(centered.labelTop, 100);
    await page.keyboard.press('l'); await reveal.click(); visible(await sample(250), 'K/L restart');
    assert.ok((await page.locator('.shuttle-status').textContent()).startsWith('再生 1×')); await stopped();
    checks.push('K permits manual scrolling; reveal centers the stopped playhead and K/L resumes');
    await toggle.click(); assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await page.locator('.timeline-scroll').evaluate(v => { v.scrollLeft = 500; });
    await page.keyboard.press('l'); const disabledFrames = await sample(400); assert.ok(disabledFrames.every(f => f.left === 500)); assert.ok(disabledFrames.every(f => f.top === 100));
    await toggle.click(); visible(await sample(250), 're-enable while playing'); assert.equal((await viewport()).top, 100);
    checks.push('follow OFF preserves manual horizontal and vertical position; ON follows immediately');
    await page.keyboard.press('s'); visible(await sample(200), 'zoom out during playback'); await page.keyboard.press('a'); visible(await sample(200), 'zoom in during playback');
    // Windows may constrain the initial window to the CI desktop. Explicitly expand it
    // before testing a shrink, and assert against the measured CSS viewport width.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000)); visible(await sample(250), 'expand before resize test');
    await page.keyboard.press('j');
    await page.locator('.timeline-scroll').evaluate(v => { v.scrollLeft = Number.parseFloat(document.querySelector('.playhead').style.left) - v.clientWidth * 0.9; });
    const beforeShrink = await viewport(); assert.ok(beforeShrink.x > beforeShrink.width * 0.8, 'head is near the right edge before shrinking the window');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760)); visible(await sample(350), 'narrow window');
    const narrow = await viewport(); assert.ok(narrow.width < beforeShrink.width - 100, 'the viewport actually shrinks');
    assert.ok(beforeShrink.x > narrow.width, 'shrinking requires revealing a head that would be outside the new viewport');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000)); visible(await sample(250), 'wide window');
    const expanded = await viewport(); assert.ok(expanded.width > narrow.width + 100, 'the viewport actually expands');
    const viewportWidths = { beforeShrink: beforeShrink.width, narrow: narrow.width, expanded: expanded.width };
    checks.push('playback follows after zoom and window resizing without changing vertical scroll');
    await stopped(); await page.locator('.timeline-scroll').evaluate(v => { v.scrollTop = 0; });
    await page.keyboard.press('Home'); await page.keyboard.press('j'); visible(await sample(200), 'reverse from sequence start'); await stopped();
    await page.keyboard.press('End'); await page.keyboard.press('l'); visible(await sample(200), 'forward from sequence end'); await stopped();
    await page.keyboard.press('Home'); for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.press('j');
    await page.waitForFunction(() => document.querySelector('.shuttle-status').textContent === '停止'); visible(await sample(100), 'automatic stop at start');
    await page.keyboard.press('End'); for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.press('l');
    await page.waitForFunction(() => document.querySelector('.shuttle-status').textContent === '停止'); visible(await sample(100), 'automatic stop at end');
    checks.push('boundary restarts and automatic stops keep the final position visible');
    await nearEdge(1); await page.keyboard.press('l'); await sample(100);
    const box = await page.locator('.timeline-scroll').boundingBox(); const beforeScrub = await viewport();
    await page.mouse.move(box.x + beforeScrub.width / 2, box.y + 10); await page.mouse.down();
    // Playback may page the viewport during native mouse IPC before pointerdown.
    // The invariant starts once the gesture has stopped transport.
    assert.equal(await page.locator('.shuttle-status').textContent(), '停止');
    const scrubLeft = (await viewport()).left;
    await page.mouse.move(box.x + beforeScrub.width / 2 + 8, box.y + 10);
    await sample(100); assert.equal((await viewport()).left, scrubLeft); await page.mouse.up();
    assert.equal(await page.locator('.shuttle-status').textContent(), '停止');
    assert.equal(await page.getByRole('button', { name: '元に戻す (Ctrl+Z)', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.unsaved-dot').count(), 0);
    checks.push('ruler scrubbing retains viewport; following does not create edits or undo history');
    await reveal.click(); await page.screenshot({ path: path.join(results, 'timeline-follow.png'), animations: 'disabled' });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'timeline-follow-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks, rates, viewportWidths, consoleErrors: errors }, null, 2));
    console.log('Timeline playhead following verified at all J/L rates, stopped browsing and viewport changes.');
  } catch (error) { await page.screenshot({ path: path.join(results, 'timeline-follow-failure.png') }).catch(() => {}); throw error; }
  finally { await app.close(); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
