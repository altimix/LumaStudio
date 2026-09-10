const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
(async () => {
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'clean-profile-'));
  const legacy = path.join(profile, '初期プロジェクト');
  await fs.mkdir(legacy); await fs.writeFile(path.join(legacy, '初期プロジェクト.luma'), 'old template must not be loaded');
  const env = { ...process.env, LUMA_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.LUMA_DEMO_FIXTURE; delete env.LUMA_TEST_FIXTURES;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const launch = () => electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const empty = async page => {
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await page.getByRole('button', { name: '新しいプロジェクト', exact: true }).waitFor();
    assert.equal(await page.locator('.media-card').count(), 0);
    assert.equal(await page.locator('.timeline-clip').count(), 0);
    const boot = await page.evaluate(() => window.luma.bootstrap());
    assert.deepEqual(boot.assets, []); assert.equal(boot.startupProject, null); assert.equal(boot.startupError, '');
  };
  let app = await launch();
  const saveFile = path.join(profile, '空のプロジェクト.luma');
  try {
    const page = await app.firstWindow(); await empty(page);
    if (executablePath) {
      const resources = await app.evaluate(() => process.resourcesPath);
      for (const name of ['demo', 'opening-media']) assert.equal(await fs.stat(path.join(resources, name)).then(() => true, () => false), false);
    }
    const library = await page.evaluate(() => window.luma.listBgm());
    assert.deepEqual(library.tracks.map(t => t.name), ['bgm001.mp3','bgm002.mp3','bgm003.mp3','bgm004.mp3','bgm005.mp3']);
    assert.deepEqual(library.errors, []);
    for (const track of library.tracks) {
      const asset = await page.evaluate(id => window.luma.loadBgm(id), track.id);
      assert.equal(asset.kind, 'audio'); assert.ok(asset.duration > 0);
      if (executablePath) assert.ok(asset.path.startsWith(profile), 'BGM survives portable extraction cleanup');
    }
    await empty(page);
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saveFile);
    await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click();
    await page.getByText('プロジェクトを保存しました', { exact: true }).waitFor();
    const saved = JSON.parse(await fs.readFile(saveFile, 'utf8'));
    assert.deepEqual(saved.assets, []); assert.deepEqual(saved.clips, []); assert.deepEqual(saved.markers, []);
    await page.screenshot({ path: path.join(root, 'test-results', 'clean-start.png') });
    await page.getByRole('tab', { name: 'BGM', exact: true }).click();
    await page.locator('.bgm-track').first().waitFor();
    assert.equal(await page.locator('.bgm-track').count(), 5);
    await page.getByRole('button', { name: 'BGMをタイムラインに追加', exact: true }).click();
    await page.locator('.timeline-clip.audio').first().waitFor();
    await page.getByRole('tab', { name: 'メディア', exact: true }).click();
    const source = path.join(root, 'public', 'demo', '01-journey.mp4');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: '読み込み', exact: true }).click();
    await page.getByRole('button', { name: '01-journey.mp4 を追加', exact: true }).click();
    await page.locator('.timeline-clip.video').first().waitFor();
    await page.getByRole('textbox', { name: 'クリップ名', exact: true }).fill('クリーン版からの編集');
    await page.getByRole('textbox', { name: 'クリップ名', exact: true }).blur();
    const deadline = Date.now() + 10000;
    while (true) {
      const data = await fs.readFile(path.join(profile, 'autosave.luma'), 'utf8').then(JSON.parse, () => null);
      if (data?.project.clips.some(c => c.name === 'クリーン版からの編集')) break;
      assert.ok(Date.now() < deadline, 'autosave completes'); await new Promise(r => setTimeout(r, 100));
    }
  } finally { await app.close(); }
  app = await launch();
  try {
    const page = await app.firstWindow(); await empty(page);
    await page.getByRole('button', { name: '復元する', exact: true }).click();
    await page.locator('.timeline-clip.video').first().waitFor();
    assert.equal(await page.locator('.timeline-clip.audio').filter({ hasText: 'bgm001' }).count(), 1);
    assert.equal(await page.locator('.timeline-clip.offline').count(), 0);
    assert.equal(await page.getByRole('textbox', { name: 'クリップ名', exact: true }).inputValue(), 'クリーン版からの編集');
    assert.equal(await fs.readFile(path.join(legacy, '初期プロジェクト.luma'), 'utf8'), 'old template must not be loaded');
    await fs.writeFile(path.join(root, 'test-results', 'clean-start-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks: ['empty assets/clips/markers saved', 'no bundled demo/opening media', 'five bundled BGM tracks load without automatic placement', 'legacy template ignored and preserved', 'import/edit/autosave from empty project', 'clean restart with explicit recovery'] }, null, 2));
    console.log('Clean startup, empty save, import and explicit recovery verified.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
