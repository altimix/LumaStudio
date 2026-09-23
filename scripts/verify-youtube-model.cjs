// Packaged UI and native IPC check. Only OpenAI responses are mocked.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const { validateProject } = require('../electron/export.cjs');
const { timelineKey } = require('../shared/youtube.mjs');
const root = path.join(__dirname, '..');
const KEY = 'sk-fake-key-for-isolated-tests-only';

async function verify() {
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'youtube-model-'));
  const audio = path.join(profile, 'モデル検証.wav');
  const projectFile = path.join(profile, '投稿文モデル検証.luma');
  const results = path.join(root, 'test-results');
  await fs.mkdir(results, { recursive: true });
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=35', '-ar', '48000', '-ac', '2', audio]);
  const asset = await inspectMedia(audio, path.join(profile, 'cache'));
  const project = {
    version: 1, id: 'youtube-model', name: '投稿文モデル検証', width: 640, height: 360, fps: 30,
    assets: [asset], markers: [],
    tracks: [{ id: 'a', name: 'Audio1', kind: 'audio', muted: false, hidden: false, locked: false, solo: false }],
    clips: [{ id: 'c', assetId: asset.id, trackId: 'a', name: '確認音声', kind: 'audio', start: 0, in: 0, duration: 35, speed: 1, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, exposure: 0, contrast: 1, saturation: 1, volume: 1, fadeIn: 0, fadeOut: 0, text: '', fontSize: 40, color: '#ffffff', textStyle: 'minimal' }],
  };
  project.youtube = { sourceKey: timelineKey(project), cues: [{ start: 1, end: 2, text: '動画編集の説明です。' }], titles: [], description: '', chapters: [], keywords: [], thumbnailPrompt: '' };
  validateProject(project);
  await fs.writeFile(projectFile, JSON.stringify(project));

  const env = { ...process.env, LUMA_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  env.OPENAI_API_KEY = KEY;
  delete env.LUMA_DEMO_FIXTURE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, projectFile);
    await page.keyboard.press('Control+o');
    await page.getByRole('button', { name: '投稿文モデル検証', exact: true }).waitFor({ timeout: 60000 });
    await app.evaluate((_, key) => {
      globalThis.__textModelRequests = [];
      globalThis.fetch = async (url, options) => {
        if (url !== 'https://api.openai.com/v1/responses' || options.headers.Authorization !== `Bearer ${key}`) throw new Error('Unexpected request');
        const request = JSON.parse(options.body);
        globalThis.__textModelRequests.push({ model: request.model, store: request.store, reasoning: request.reasoning, strict: request.text.format.strict });
        const data = { titles: ['案1', '案2', '案3'], description: '動画編集の説明です。', chapters: [], keywords: Array.from({ length: 10 }, (_, index) => `検索語${index}`), hashtags: ['#動画編集', '#字幕', '#YouTube'], thumbnailPrompt: '動画編集の画面' };
        return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(data) }] }] });
      };
    }, KEY);
    const openStudio = async () => {
      await page.getByRole('button', { name: 'YouTube', exact: true }).click();
      await page.getByRole('dialog', { name: 'YouTube制作スタジオ' }).waitFor();
      await page.getByRole('button', { name: 'タイトル・概要欄', exact: true }).click();
    };
    await openStudio();
    const select = page.getByRole('combobox', { name: '投稿文モデル', exact: true });
    assert.equal(await select.inputValue(), 'gpt-6-astra');
    await page.getByRole('button', { name: '投稿文を生成', exact: true }).click();
    await page.getByRole('textbox', { name: 'YouTubeタイトル案1', exact: true }).waitFor({ timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('.yt-progress'));
    await select.selectOption('gpt-6-sol');
    await page.getByRole('button', { name: '投稿文を生成', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.yt-progress'));
    const requests = await app.evaluate(() => globalThis.__textModelRequests);
    assert.deepEqual(requests.map(request => request.model), ['gpt-6-astra', 'gpt-6-sol']);
    assert.ok(requests.every(request => request.store === false && request.strict === true && request.reasoning.effort === 'low'));
    const invalid = await page.evaluate(async p => { try { await window.luma.aiMetadata(p, 'gpt-6-sol-max'); return ''; } catch (error) { return String(error); } }, project);
    assert.match(invalid, /投稿文モデルを選び直してください/);
    assert.equal((await app.evaluate(() => globalThis.__textModelRequests)).length, 2);
    await page.screenshot({ path: path.join(results, 'youtube-model-selection.png') });
    await page.getByRole('button', { name: '編集に戻る', exact: true }).click();
    await openStudio();
    assert.equal(await select.inputValue(), 'gpt-6-sol');
    assert.equal(await page.evaluate(() => localStorage.getItem('luma.youtube.text-model.v1')), 'gpt-6-sol');
    assert.equal(JSON.parse(await fs.readFile(projectFile, 'utf8')).youtube.titles.length, 0, 'model selection does not edit the project file');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'youtube-model-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, requests, consoleErrors: errors }, null, 2));
    console.log('YouTube posting model selection verified in', executablePath ? 'packaged app' : 'development app');
  } catch (error) {
    await page.screenshot({ path: path.join(results, 'youtube-model-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app.close();
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
