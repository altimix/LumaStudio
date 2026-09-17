const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
(async () => {
  const profile = await fs.mkdtemp(path.join(root, '.local', 'operations-'));
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true });
  const env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  try {
    const page = await app.firstWindow(); await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1600, 1000); window.center(); });
    const verifyOperationLayout = async (dialog, name) => {
      for (const factor of [1, 1.25, 1.5]) {
        await app.evaluate(({ BrowserWindow }, size) => { const window=BrowserWindow.getAllWindows()[0];window.setSize(size.width,size.height);window.center(); }, { width:Math.round(1600/factor), height:Math.round(1000/factor) });
        await page.waitForTimeout(220);
        const layout = await dialog.evaluate(element => {
          const box = node => { const rect = node.getBoundingClientRect(); return { x:rect.x, y:rect.y, width:rect.width, height:rect.height, right:rect.right, bottom:rect.bottom, center:rect.x+rect.width/2 }; };
          const heading = element.querySelector('.modal-heading'), title = heading.querySelector('h2'), status = element.querySelector('.project-operation-status'), spinner = element.querySelector('.project-operation-spinner'), message = status.querySelector('span:last-child'), style = getComputedStyle(status);
          return { viewport:{width:innerWidth,height:innerHeight}, dialog:box(element), heading:box(heading), title:box(title), status:box(status), spinner:box(spinner), message:box(message), alignItems:style.alignItems, justifyContent:style.justifyContent, flexDirection:style.flexDirection, textAlign:style.textAlign };
        });
        assert.equal(layout.alignItems, 'center'); assert.equal(layout.justifyContent, 'center'); assert.equal(layout.flexDirection, 'column'); assert.equal(layout.textAlign, 'center');
        assert.ok(Math.abs(layout.dialog.center-layout.viewport.width/2)<2&&Math.abs(layout.dialog.y+layout.dialog.height/2-layout.viewport.height/2)<2, `${name} ${factor}: viewport center ${JSON.stringify({viewport:layout.viewport,dialog:layout.dialog})}`);
        assert.ok(layout.dialog.x>=0&&layout.dialog.right<=layout.viewport.width&&layout.dialog.y>=0&&layout.dialog.bottom<=layout.viewport.height, `${name} ${factor}: viewport containment`);
        for (const item of [layout.title, layout.spinner, layout.message]) assert.ok(Math.abs(item.center-layout.dialog.center)<2, `${name} ${factor}: horizontal center`);
        assert.ok(layout.status.height>=125&&layout.message.x-layout.dialog.x>=25&&layout.dialog.right-layout.message.right>=25, `${name} ${factor}: content padding`);
        assert.ok(layout.status.y>=layout.heading.bottom-1&&layout.status.bottom<=layout.dialog.bottom+1, `${name} ${factor}: vertical containment`);
        if (factor===1||factor===1.5) await page.screenshot({ path:path.join(results,`${name}-${Math.round(factor*100)}.png`) });
      }
      await app.evaluate(({ BrowserWindow }) => { const window=BrowserWindow.getAllWindows()[0];window.setSize(1600,1000);window.center(); });
    };
    const file = path.join(profile, 'operations.luma');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file);
    const save = async () => {
      await fs.rm(file, { force: true });
      await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click();
      for (let i = 0; i < 200; i++) { try { const value = JSON.parse(await fs.readFile(file, 'utf8')); await page.getByRole('dialog', { name: 'プロジェクトを保存しています', exact: true }).waitFor({ state: 'hidden' }); return value; } catch { await new Promise(r => setTimeout(r, 25)); } }
      throw Error('save timed out');
    };
    const before = await save(), track = before.tracks[0];
    const input = page.getByRole('textbox', { name: `トラック名 ${track.name}`, exact: true });
    await input.fill('研究用の映像トラック'); await input.press('Enter');
    assert.equal((await save()).tracks[0].name, '研究用の映像トラック');
    await page.keyboard.press('Control+z');
    assert.equal((await save()).tracks[0].name, track.name, 'one Undo restores the whole original name');
    await page.getByRole('button', { name: `${track.name} ロック`, exact: true }).click();
    assert.equal(await input.isDisabled(), true);
    await page.getByRole('button', { name: `${track.name} ロック解除`, exact: true }).click();
    await input.fill('取り消す名前'); await input.press('Escape'); assert.equal((await save()).tracks[0].name, track.name);
    let next = { ...before, id: 'loaded-project', name: '遅い読込の検証', assets: before.assets.map(a => ({ ...a, offline: true })) };
    await app.evaluate(({ ipcMain }, result) => {
      ipcMain.removeHandler('open-project'); ipcMain.handle('open-project', () => new Promise(resolve => { globalThis.releaseOpen = () => resolve(result); }));
    }, { project: next, path: file });
    await page.keyboard.press('Control+o');
    const openDialog=page.getByRole('dialog', { name: 'プロジェクトを開いています', exact: true });await openDialog.waitFor();await verifyOperationLayout(openDialog,'project-operation-open');
    await page.keyboard.press('Control+n'); await page.keyboard.press('Delete'); await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: 'プロジェクトを開いています', exact: true }).count(), 1);
    await app.evaluate(() => globalThis.releaseOpen());
    await page.getByRole('button', { name: next.name, exact: true }).waitFor();
    assert.deepEqual((await save()).clips, next.clips);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('import'); ipcMain.handle('import', () => new Promise(resolve => { globalThis.releaseImport = () => resolve({ assets: [], errors: [] }); }));
    });
    await page.getByRole('button', { name: '読み込み', exact: true }).click();
    await page.getByRole('dialog', { name: '素材を読み込んでいます', exact: true }).waitFor();
    await page.keyboard.press('Control+n'); await page.keyboard.press('Control+o'); await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: '素材を読み込んでいます', exact: true }).count(), 1);
    await app.evaluate(() => globalThis.releaseImport());
    await page.getByRole('dialog', { name: '素材を読み込んでいます', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await save()).id, next.id);
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('save-project');
      ipcMain.removeHandler('save-project'); ipcMain.handle('save-project', async (...args) => {
        await new Promise(resolve => { globalThis.releaseSave = resolve; });
        ipcMain.removeHandler('save-project'); ipcMain.handle('save-project', original); return original(...args);
      });
    });
    await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click();
    for (let i = 0; i < 200 && !(await app.evaluate(() => !!globalThis.releaseSave)); i++) await new Promise(r => setTimeout(r, 25));
    next = { ...next, name: '保存中に開いたプロジェクト' }; // Same persisted ID, new load generation.
    await app.evaluate(({ ipcMain }, result) => { ipcMain.removeHandler('open-project'); ipcMain.handle('open-project', () => result); }, { project: next, path: file });
    await page.keyboard.press('Control+o');
    await page.getByRole('button', { name: next.name, exact: true }).waitFor();
    await app.evaluate(() => globalThis.releaseSave());
    await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    await page.locator('.toast').filter({ hasText: '以前のプロジェクトを保存しました' }).waitFor();
    assert.equal((await save()).name, next.name);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('relink'); ipcMain.handle('relink', () => new Promise(resolve => { globalThis.releaseRelink = () => resolve(null); }));
    });
    await page.getByRole('button', { name: `${next.assets[0].name} を再リンク`, exact: true }).click();
    await page.getByRole('dialog', { name: '素材を再リンクしています', exact: true }).waitFor();
    await page.keyboard.press('Control+n'); await page.keyboard.press('Control+o');
    await app.evaluate(() => globalThis.releaseRelink());
    await page.getByRole('dialog', { name: '素材を再リンクしています', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await save()).id, next.id);
    // A stale native save must not restore its path after a project reset.
    const oldFile = path.join(profile, 'old.luma'), newFile = path.join(profile, 'new.luma');
    await app.evaluate(({ dialog }, oldFile) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: oldFile });
      const files = process.getBuiltinModule('fs/promises'), rename = files.rename;
      files.rename = async (from, to) => { if (to === oldFile) { await new Promise(resolve => { globalThis.releaseWrite = resolve; }); files.rename = rename; } return rename(from, to); };
    }, oldFile);
    await page.evaluate(project => { window.pendingSave = window.luma.saveProject(project, true); }, before);
    for (let i = 0; i < 200 && !(await app.evaluate(() => !!globalThis.releaseWrite)); i++) await new Promise(r => setTimeout(r, 25));
    assert.equal(await app.evaluate(() => !!globalThis.releaseWrite), true);
    await page.evaluate(() => window.luma.resetProjectPath());
    await app.evaluate(() => globalThis.releaseWrite()); await page.evaluate(() => window.pendingSave);
    await app.evaluate(({ dialog }, newFile) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: newFile }); }, newFile);
    assert.equal(await page.evaluate(project => window.luma.saveProject(project, false), next), newFile);
    assert.equal(JSON.parse(await fs.readFile(oldFile, 'utf8')).id, before.id);
    assert.equal(JSON.parse(await fs.readFile(newFile, 'utf8')).id, next.id);
    console.log('Slow project operations, centered progress layout at 100/125/150%-equivalent viewports, locked track names and single-step rename Undo verified.');
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
