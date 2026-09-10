const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
(async () => {
  if (process.platform !== 'darwin') throw new Error('Macで実行してください。');
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'mac-profile-'));
  const env = { ...process.env, LUMA_DEMO_FIXTURE: '1', LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  try {
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      globalThis.__macClipboard = await Promise.all((await clipboard.read()).filter(item => item.types.length).map(async item =>
        new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
    });
    const page = await app.firstWindow();
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await page.locator('.timeline-clip').first().waitFor();
    assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].label), 'Luma Studio');
    const name = page.getByRole('textbox', { name: 'クリップ名', exact: true });
    await name.focus(); await page.keyboard.press('Meta+a');
    await app.evaluate(({ clipboard }) => clipboard.writeText('Mac 日本語の貼り付け'));
    await page.keyboard.press('Meta+v');
    assert.equal(await name.inputValue(), 'Mac 日本語の貼り付け');
    await name.blur();
    await page.keyboard.press('Meta+z');
    assert.notEqual(await name.inputValue(), 'Mac 日本語の貼り付け');
    await page.keyboard.press('Meta+Shift+z');
    assert.equal(await name.inputValue(), 'Mac 日本語の貼り付け');
    const file = path.join(profile, 'Mac 日本語 保存.luma');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file);
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    assert.ok(JSON.parse(await fs.readFile(file, 'utf8')).clips.some(c => c.name === 'Mac 日本語の貼り付け'));
    const count = await page.locator('.timeline-clip').count();
    await page.keyboard.press('Backspace');
    assert.ok(await page.locator('.timeline-clip').count() < count);
    await page.keyboard.press('Meta+z');
    assert.equal(await page.locator('.timeline-clip').count(), count);
    // Cmd+Q must preserve the existing close guard instead of bypassing it.
    await app.evaluate(({ dialog }) => { process.env.LUMA_TEST_CLOSE = '1'; dialog.showMessageBoxSync = () => 0; });
    await page.locator('.timeline-clip.video').first().click();
    await name.fill('終了をキャンセル'); await name.blur();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(i => i.accelerator === 'Command+Q').click());
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    await page.screenshot({ path: path.join(root, 'test-results', 'macos-editor.png') });
    console.log('Mac: メニュー、Command操作、入力欄の貼り付け、保存、削除、終了キャンセルを検証しました。');
  } finally {
    await app.evaluate(async ({ clipboard }) => { process.env.LUMA_TEST_CLOSE = '0'; if (globalThis.__macClipboard?.length) await clipboard.write(globalThis.__macClipboard); else if (globalThis.__macClipboard) clipboard.clear(); });
    await app.close(); await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
