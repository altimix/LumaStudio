const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ffmpeg, run } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');

async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true });
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'keyframe-profile-'));
  const env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.locator('.media-card').first().waitFor({ timeout: 60000 });
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    const project = { version: 1, id: 'keyframes', name: '日本語テロップのアニメーション', width: 1280, height: 720, fps: 30, assets: [], markers: [], tracks: [{ id: 'titles', name: 'テロップ', kind: 'video', muted: false, hidden: false, locked: false, solo: false }], clips: [{ id: 'title', trackId: 'titles', kind: 'title', name: '不透明度アニメーション', start: 0, in: 0, duration: 2, speed: 1, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, exposure: 0, contrast: 1, saturation: 1, volume: 1, fadeIn: 0, fadeOut: 0, text: '物語は、ここから。', fontSize: 220, color: '#ffffff', textStyle: 'minimal' }] };
    const file = path.join(results, 'キーフレーム検証.luma'); await fs.writeFile(file, JSON.stringify(project));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await page.getByRole('button', { name: 'ファイル', exact: true }).click();
    await page.getByRole('button', { name: /^プロジェクトを開く/ }).click();
    await page.getByRole('button', { name: '日本語テロップのアニメーション', exact: true }).waitFor();
    await page.locator('.timeline-clip.title').first().click();
    const time = page.getByRole('spinbutton', { name: 'キーフレームの時刻', exact: true });
    const value = page.getByRole('spinbutton', { name: 'キーフレームの不透明度', exact: true });
    for (const [t, v] of [[0, 0], [1, 100]]) {
      await time.fill(String(t)); await value.fill(String(v)); await page.getByRole('button', { name: 'キーフレームを追加', exact: true }).click();
    }
    assert.equal(await page.locator('.keyframe-row').count(), 2);
    await value.fill('80'); await page.getByRole('button', { name: 'キーフレームを更新', exact: true }).click();
    assert.match(await page.locator('.keyframe-row').last().textContent(), /80%/);
    await page.getByRole('button', { name: '元に戻す (Ctrl+Z)', exact: true }).click();
    await page.locator('.timeline-clip.title').click();
    assert.match(await page.locator('.keyframe-row').last().textContent(), /100%/);
    await page.getByRole('button', { name: '1.00 秒のキーフレームを削除', exact: true }).click();
    assert.equal(await page.locator('.keyframe-row').count(), 1);
    await page.getByRole('button', { name: '元に戻す (Ctrl+Z)', exact: true }).click();
    await page.getByRole('button', { name: 'やり直す (Ctrl+Shift+Z)', exact: true }).click();
    await page.locator('.timeline-clip.title').click(); assert.equal(await page.locator('.keyframe-row').count(), 1);
    await page.getByRole('button', { name: '元に戻す (Ctrl+Z)', exact: true }).click();
    await page.locator('.timeline-clip.title').click();
    await page.getByRole('button', { name: 'テロップ ロック', exact: true }).click();
    assert.equal(await time.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '1.00 秒のキーフレームを削除', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '元に戻す (Ctrl+Z)', exact: true }).click();
    await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).clips[0].opacityKeyframes, [{ time: 0, value: 0 }, { time: 1, value: 1 }]);
    await page.keyboard.press('Control+o'); await page.locator('.timeline-clip.title').click();
    assert.equal(await page.locator('.keyframe-row').count(), 2);

    const preview = [];
    for (const frames of [0, 15, 30]) {
      await page.getByRole('button', { name: '先頭へ (Home)', exact: true }).click();
      for (let n = 0; n < Math.floor(frames / 10); n++) await page.keyboard.press('Shift+ArrowRight');
      for (let n = 0; n < frames % 10; n++) await page.keyboard.press('ArrowRight');
      await page.waitForFunction(expected => document.querySelector('.keyframe-readout strong')?.textContent === `${expected}%`, frames / 30 * 100);
      preview.push(await page.locator('.canvas-wrap canvas').evaluate(async c => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let sum = 0; for (let i = 0; i < pixels.length; i += 4) sum += pixels[i];
        return sum / (pixels.length / 4);
      }));
    }
    assert.ok(preview[2] > 2, `Japanese text must be visible: ${preview}`);
    assert.ok(preview[0] < 0.1, `zero opacity: ${preview}`);
    assert.ok(Math.abs(preview[1] / preview[2] - 0.5) < 0.04, `half opacity: ${preview}`);
    await page.locator('.title-opacity').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(results, 'title-keyframes.png') });
    const output = path.join(results, 'キーフレーム検証.mp4');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, output);
    await page.getByRole('button', { name: '書き出し', exact: true }).click();
    await page.getByLabel('品質', { exact: true }).selectOption('draft');
    await page.getByRole('button', { name: '保存先を選んで書き出す', exact: true }).click();
    await page.getByText('書き出しが完了しました', { exact: true }).waitFor({ timeout: 120000 });
    const rendered = [];
    for (const time of [0, 0.5, 1]) {
      const pixels = await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-vf', 'scale=640:360', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
      let sum = 0; for (let i = 0; i < pixels.length; i += 3) sum += pixels[i];
      rendered.push(sum / (pixels.length / 3));
    }
    assert.ok(rendered[0] < 0.2); assert.ok(rendered[2] > 2);
    assert.ok(Math.abs(rendered[1] / rendered[2] - 0.5) < 0.05, `MP4 opacity: ${rendered}`);
    assert.ok(Math.abs(preview[1] / preview[2] - rendered[1] / rendered[2]) < 0.05);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'keyframe-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks: ['legacy title project', 'add / update / delete keys', 'undo / redo', 'locked title protection', 'native save / reload', 'Japanese canvas 0 / 50 / 100 percent', 'native MP4 0 / 50 / 100 percent', 'preview and output agreement'], previewMean: preview, exportMean: rendered, output }, null, 2));
    console.log('Title opacity keyframes verified:', { preview, rendered });
  } catch (error) {
    await page.screenshot({ path: path.join(results, 'keyframes-failure.png') }).catch(() => {}); throw error;
  } finally { await app.close(); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
