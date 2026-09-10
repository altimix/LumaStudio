const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..');
const digest = data => createHash('sha256').update(data).digest('hex');

(async () => {
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'file-safety-profile-'));
  const env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE || path.join(root, 'release', 'win-unpacked', 'Luma Studio.exe');
  const app = await electron.launch({ executablePath, args: [], env, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await page.locator('.media-card').first().waitFor();
    const original = path.join(profile, 'demo-media', require('../package.json').version, '01-journey.mp4');
    const before = digest(await fs.readFile(original));
    // Native save dialogs permit explicitly typed extensions; filters do not protect source files.
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, original);
    await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click();
    await page.locator('.toast[role="status"]').waitFor();
    assert.equal(digest(await fs.readFile(original)), before, 'Saving a project must never overwrite source media');
    assert.match(await page.locator('.toast[role="status"]').textContent(), /素材|拡張子/);
    const previousProject = path.join(profile, '以前の編集.luma');
    const newProject = path.join(profile, '新規の編集.luma');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, previousProject);
    await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.toast[role="status"]')?.textContent.includes('プロジェクトを保存しました'));
    const previousDigest = digest(await fs.readFile(previousProject));
    const forgedPath = path.join(profile, '未登録の映像.mp4'); await fs.copyFile(original, forgedPath);
    for (const patch of [{ path: forgedPath }, { revision: 'unregistered-revision' }]) {
      const forged = JSON.parse(await fs.readFile(previousProject, 'utf8')); Object.assign(forged.assets[0], patch);
      const message = await page.evaluate(async project => {
        try { await window.luma.exportProject(project, { width: 1280, height: 720, fps: 30, quality: 'draft', encoder: 'cpu' }, {}); return ''; }
        catch (error) { return error.message; }
      }, forged);
      assert.match(message, /未登録または変更された素材/);
    }

    const sourceProject = JSON.parse(await fs.readFile(previousProject, 'utf8'));
    const changedSource = path.join(profile, '外部変更される素材.mp4'); await fs.copyFile(original, changedSource);
    const rejectedImports = await page.evaluate(async file => {
      const messages = [];
      for (const run of [() => window.luma.importMedia([file]), () => window.luma.importDroppedFiles([new File(['fake'], 'fake.mp4')])]) {
        try { await run(); messages.push(''); } catch (error) { messages.push(error.message); }
      }
      return messages;
    }, changedSource);
    assert.match(rejectedImports[0], /ファイル選択またはドロップ/);
    assert.match(rejectedImports[1], /実際のファイル/);
    await page.evaluate(() => { const input = document.createElement('input'); input.id = 'genuine-drop'; input.type = 'file'; input.hidden = true; document.body.appendChild(input); });
    await page.locator('#genuine-drop').setInputFiles(changedSource);
    const imported = await page.locator('#genuine-drop').evaluate(input => window.luma.importDroppedFiles([...input.files]));
    await page.locator('#genuine-drop').evaluate(input => input.remove());
    const replacedId = sourceProject.assets[0].id; sourceProject.assets[0] = imported.assets[0];
    sourceProject.clips = sourceProject.clips.map(c => c.assetId === replacedId ? { ...c, assetId: imported.assets[0].id } : c);
    const originalStat = await fs.stat(changedSource);
    await fs.utimes(changedSource, originalStat.atime, new Date(originalStat.mtimeMs + 2000));
    const changedMessage = await page.evaluate(async project => {
      try { await window.luma.exportProject(project, { width: 1280, height: 720, fps: 30, quality: 'draft', encoder: 'cpu' }, {}); return ''; }
      catch (error) { return error.message; }
    }, sourceProject);
    assert.match(changedMessage, /変更または削除/);
    // Exercise the real save IPC with a transient Windows replacement refusal.
    await app.evaluate(async (_electron, destination) => {
      const files = process.getBuiltinModule('fs/promises'), rename = files.rename;
      const original = await files.readFile(destination, 'utf8');
      const probe = globalThis.__lumaRenameProbe = { attempts: 0, preserved: true, completed: false };
      globalThis.__lumaRestoreRename = () => { files.rename = rename; };
      files.rename = async (source, target) => {
        if (target !== destination) return rename(source, target);
        probe.attempts++;
        if (probe.attempts <= 2) {
          probe.preserved &&= await files.readFile(destination, 'utf8') === original;
          throw Object.assign(new Error('test temporary Windows sharing violation'), { code: 'EPERM' });
        }
        await rename(source, target); probe.completed = true;
      };
    }, previousProject);
    try {
      await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click();
      let probe;
      for (let attempt = 0; attempt < 60; attempt++) {
        probe = await app.evaluate(() => globalThis.__lumaRenameProbe);
        if (probe.completed || (process.platform !== 'win32' && probe.attempts === 1)) break;
        await page.waitForTimeout(50);
      }
      assert.deepEqual(probe, process.platform === 'win32' ? { attempts: 3, preserved: true, completed: true } : { attempts: 1, preserved: true, completed: false }, 'Windows retries sharing locks; Mac rejects permission failures with the previous file intact');
      assert.equal(digest(await fs.readFile(previousProject)), previousDigest, 'The retried replacement must contain the complete saved project');
    } finally {
      await app.evaluate(() => { globalThis.__lumaRestoreRename(); delete globalThis.__lumaRestoreRename; delete globalThis.__lumaRenameProbe; });
    }
    // Inject a cleanup failure only in this isolated test process.
    await app.evaluate(({ dialog }, paths) => {
      const files = process.getBuiltinModule('fs/promises'); const originalRm = files.rm;
      globalThis.__lumaRestoreRm = () => { files.rm = originalRm; };
      files.rm = async (file, ...args) => { if (file === paths.autosave) throw new Error('test recovery cleanup failure'); return originalRm(file, ...args); };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.destination });
    }, { autosave: path.join(profile, 'autosave.luma'), destination: newProject });
    await page.getByRole('button', { name: 'ファイル', exact: true }).click();
    await page.getByRole('button', { name: /^新規プロジェクト/ }).click();
    await page.getByRole('button', { name: /YouTube 横動画/ }).click();
    await page.getByRole('button', { name: '新しいプロジェクト', exact: true }).waitFor();
    await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click();
    let created = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await fs.access(newProject); created = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.equal(created, true, 'A new project must prompt for its own destination even when recovery cleanup fails');
    assert.equal(digest(await fs.readFile(previousProject)), previousDigest, 'The previous project must remain unchanged');
    await app.evaluate(() => { globalThis.__lumaRestoreRm(); delete globalThis.__lumaRestoreRm; });
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await fs.writeFile(path.join(root, 'test-results', 'file-safety-verification.json'), JSON.stringify({ passed: true, packaged: true, checks: ['native project save refuses a source-media destination', 'source SHA256 remains unchanged', 'native save preserves the previous file on replacement failure (Windows retries transient locks)', 'new project destination after recovery cleanup failure', 'previous project SHA256 remains unchanged'] }, null, 2));
    console.log('Source-file safety verified in packaged app.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
