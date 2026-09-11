const { readStartupProject, rebaseStartupYoutube } = require('./startup-project.cjs');
const { blackVideo } = require('./black-video.cjs');
const { hasClipAudio } = require('../shared/clip-links.mjs');
const { app, BrowserWindow, ipcMain, protocol, net, dialog, shell, Menu, session, safeStorage, clipboard } = require('electron');
const { createUpdateChecker } = require('./updates.cjs');
const { copyText } = require('./clipboard.cjs');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { inspectMedia, probe, assertMediaRevision } = require('./media.cjs');
const { createBgmLibrary } = require('./bgm.cjs');
const { createAudioReader, decodeAudioChunk } = require('./audio.cjs');
const { createWaveformReader } = require('./waveform.cjs');
const { createAudioProcessor } = require('./audio-normalize.cjs');
const { createFontLibrary } = require('./fonts.cjs');
const { soundFile } = require('./sounds.cjs');
const { SOUNDS } = require('../shared/sounds.mjs');
const { exportEncoders, validateEncoder } = require('./encoders.cjs');
const { validateTreatment } = require('../shared/audio-treatment.mjs');
const { validateProject, exportProject, exportAssets } = require('./export.cjs');
const { assertDestination, atomicWrite } = require('./persistence.cjs');
const { assertReplacement, hydrateProject, parseProjectJson, serializeProject, MAX_PROJECT_BYTES } = require('./project.cjs');
const { createRecoveryStore } = require('./recovery.cjs');
const { createCredentials, createOpenAI } = require('./openai.cjs');
const { audioClips, totalTime, transcribeTimeline, generateMetadata, generateThumbnail } = require('./youtube.cjs');
const { subtitleFile, youtubeText } = require('../shared/youtube.mjs');
app.setName('Luma Studio');
// Timeline compositing needs CPU-readable frames. On Windows, GPU-backed NV12
// readback can stall the renderer for ~500 ms, even with software decoding.
// Keep WebGL/canvas compositing and FFmpeg GPU encoding enabled.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-accelerated-video-decode');
  app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
}
if (process.env.LUMA_TEST_DATA) app.setPath('userData', process.env.LUMA_TEST_DATA);
protocol.registerSchemesAsPrivileged([
  { scheme: 'luma', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);
let exportFinished = Promise.resolve();
let window; let exportController; let projectPath = null; let projectPathGeneration = 0; let dirty = false; let importing = false;
let pendingCloseId = null; let preparingCloseId = null; let rendererGone = false; let nextCloseId = 0; let allowClose = false;
const mediaFiles = new Map(); const completedExports = new Set();
const registeredAssets = new Map(); const protectedSourcePaths = new Set();
const assetKey = a => `${a.id}/${a.revision || a.id}`;
let aiController;
let audioPrepareController;
const fontLibrary = createFontLibrary(() => path.join(cacheDir(), 'fonts'), (file, key) => { mediaFiles.set('font/' + key, file); return 'media://local/font/' + key; });
const audioProcessor = createAudioProcessor(() => path.join(cacheDir(), 'audio-treatment'));
const audioReader = createAudioReader(async (file, index, signal, treatment) => {
  const prepared = treatment ? await audioProcessor.get(file, treatment, signal) : { file };
  return decodeAudioChunk(prepared.file, index, AbortSignal.any([signal, AbortSignal.timeout(30000)]));
}, assertMediaRevision);
const root = path.join(__dirname, '..');
const demoDir = () => app.isPackaged ? process.env.LUMA_TEST_FIXTURES : path.join(root, 'public', 'demo');
async function persistentDemoDir() {
  const dest = path.join(app.getPath('userData'), 'demo-media', app.getVersion());
  await fs.mkdir(dest, { recursive: true });
  for (const name of ['01-journey.mp4','02-encounter.mp4','03-beyond.mp4','04-atmosphere.wav']) {
    const source=path.join(demoDir(),name); const target=path.join(dest,name);
    try { await fs.access(target); } catch { await fs.copyFile(source,target); }
  }
  return dest;
}
const cacheDir = () => path.join(app.getPath('userData'), 'media-cache');
const waveformReader = createWaveformReader(cacheDir,async(file,treatment,signal)=>(await audioProcessor.get(file,treatment,signal)).file);
const autosavePath = () => path.join(app.getPath('userData'), 'autosave.luma');
function present(a) {
  registeredAssets.set(assetKey(a), a);
  protectedSourcePaths.add(a.path);
  if (a.playbackPath) mediaFiles.set(`asset/${assetKey(a)}`, { file: a.playbackPath, asset: a });
  if (a.thumbnailPath) mediaFiles.set(`thumb/${assetKey(a)}`, { file: a.thumbnailPath, asset: a });
  const url = `media://local/asset/${assetKey(a)}`;
  audioReader.register(url, a);
  waveformReader.register(url, a);
  return { ...a, url, thumbnail: a.thumbnailPath ? `media://local/thumb/${assetKey(a)}` : '' };
}
async function hydrate(p) {
  return hydrateProject(p, file => inspectMedia(file, cacheDir()), present);
}
const serialize = serializeProject;
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('IPC sender rejected.');
    return fn(...args);
  });
}
function installIPC() {
  const updateChecker = createUpdateChecker({ currentVersion: app.getVersion(), platform: process.platform, arch: process.arch,
    ...(process.env.LUMA_TEST_DATA ? { fetchRelease: async () => ({ tag_name: `v${app.getVersion()}`, draft: false, prerelease: false, assets: [] }) } : {}) });
  handle('check-updates', refresh => { if (refresh !== undefined && typeof refresh !== 'boolean') throw new Error('更新確認の指定が不正です。'); return updateChecker.check(refresh === true); });
  handle('open-update-page', async () => {
    const result = await updateChecker.check();
    if (!['available', 'unsupported'].includes(result.status)) throw new Error('新しいバージョンは確認されていません。');
    await shell.openExternal(result.releaseUrl);
  });
  handle('copy-text', text => copyText(clipboard, text));
  const waveformRequests=new Map();
  handle('waveform-read', async (url,start,end,bins,options,requestId) => {
    if(requestId===undefined)return waveformReader.read(url,start,end,bins,options);
    if(typeof requestId!=='string'||!requestId||requestId.length>128||waveformRequests.has(requestId))throw Error('波形リクエストが不正です。');
    const controller=new AbortController();waveformRequests.set(requestId,controller);
    try{return await waveformReader.read(url,start,end,bins,options,controller.signal);}
    finally{waveformRequests.delete(requestId);}
  });
  handle('waveform-cancel', requestId => {if(typeof requestId==='string')waveformRequests.get(requestId)?.abort();});
  const bundledBgm = path.join(app.getPath('userData'), 'bundled-bgm', 'v1');
  let preparingBgm;
  const bgm = createBgmLibrary({ configFile:path.join(app.getPath('userData'),'bgm-library.json'),
    candidates:[process.env.PORTABLE_EXECUTABLE_DIR && path.join(process.env.PORTABLE_EXECUTABLE_DIR,'bgm'), app.isPackaged ? path.join(path.dirname(app.getPath('exe')),'bgm') : path.join(root,'bgm'), app.isPackaged ? bundledBgm : path.join(root,'.local','bundled-bgm')],
    probe, inspect:file=>inspectMedia(file,cacheDir()), present });
  handle('bgm-list', async () => {
    if (app.isPackaged) {
      preparingBgm ??= require('./bundled-bgm.cjs').prepareBundledBgm(path.join(process.resourcesPath, 'bgm'), bundledBgm).catch(error => { preparingBgm = undefined; throw error; });
      await preparingBgm;
    }
    return bgm.list();
  });
  handle('bgm-choose', async () => {
    const result = await dialog.showOpenDialog(window, {title:'BGMフォルダを選択',properties:['openDirectory']});
    return result.canceled ? null : bgm.list(result.filePaths[0]);
  });
  handle('bgm-load', id => bgm.load(id));
  const recoveryFiles = createRecoveryStore(autosavePath());
  const credentials = createCredentials(path.join(app.getPath('userData'), 'openai-key.bin'), safeStorage,
    [process.env.LUMA_ENV_FILE, path.join(process.env.PORTABLE_EXECUTABLE_DIR || root, '.env'), path.join(process.cwd(), '.env')].filter(Boolean), process.env.OPENAI_API_KEY);
  const ai = createOpenAI(() => credentials.get());
  const progress = data => { if (!window.isDestroyed()) window.webContents.send('ai-progress', data); };
  const job = async work => {
    if (aiController) throw new Error('前のAI処理が完了するまでお待ちください。');
    aiController = new AbortController();
    try { return await work(aiController.signal); }
    catch (e) { if (aiController.signal.aborted) throw new Error('AI処理を中止しました。'); throw e; }
    finally { aiController = undefined; }
  };
  const registered = async a => {
    const known = a && registeredAssets.get(assetKey(a));
    if (!known || known.path !== a.path || (a.revision || a.id) !== (known.revision || known.id)) throw new Error('未登録または変更された素材です。素材を読み込み直してください。');
    await assertMediaRevision(known);
    return known;
  };
  const validateExportSources = async p => {
    for (const asset of exportAssets(p)) {
      if (asset.offline) throw new Error(`素材がオフラインです。再リンクしてください: ${asset.name}`);
      await registered(asset);
    }
  };
  const preparedAudioPaths = async (p, signal) => {
    const result = {};
    for (const c of audioClips(p)) if (c.audioTreatment) {
      const a = await registered(p.assets.find(a => a.id === c.assetId));
      result[c.id] = (await audioProcessor.get(a.path, c.audioTreatment, signal)).file;
    }
    return result;
  };
  handle('audio-prepare', async (p, id, treatment, requestId) => {
    validateProject(p); validateTreatment(treatment);
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId))) throw new Error('音声処理の要求IDが不正です。');
    const clip = p.clips.find(c => c.id === id), asset = p.assets.find(a => a.id === clip?.assetId);
    if (!treatment || !clip || !hasClipAudio(clip,asset) || asset.offline || p.tracks.find(t => t.id === clip.trackId)?.locked) throw new Error('音声のある、ロックされていないクリップを選択してください。');
    const source = await registered(asset); if (audioPrepareController) throw new Error('前の音声処理が終わるまでお待ちください。');
    const controller = new AbortController(); audioPrepareController = controller;
    const recipient = window.webContents;
    try {
      const { inputLufs, outputLufs, peak } = await audioProcessor.get(source.path, treatment, controller.signal, {
        duration: source.duration,
        onProgress: progress => { if (requestId && !controller.signal.aborted && !recipient.isDestroyed()) recipient.send('audio-prepare-progress', { ...progress, requestId }); }
      });
      return { inputLufs, outputLufs, peak };
    } finally { if (audioPrepareController === controller) audioPrepareController = undefined; }
  });
  handle('audio-prepare-cancel', () => audioPrepareController?.abort());
  handle('font-load', (family, weight) => fontLibrary.load(family, weight));
  handle('sound-asset', async (id,minimumDuration=0) => {
    const sound=SOUNDS.find(item=>item.id===id);if(!sound)throw new Error('効果音の種類が不正です。');
    const asset=await inspectMedia(await soundFile(app.getPath('userData'), id,minimumDuration), cacheDir());
    return present({...asset,name:sound.name+'.wav'});
  });
  handle('ai-status', () => credentials.status());
  handle('ai-set-key', key => credentials.set(key));
  handle('ai-clear-key', () => credentials.set(''));
  handle('ai-import-env', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'OpenAI APIキーを含む.envを選択', properties: ['openFile'] });
    return result.canceled ? credentials.status() : credentials.importEnv(result.filePaths[0]);
  });
  handle('ai-transcribe', (p, vocabulary) => job(async signal => {
    validateProject(p); for (const c of audioClips(p)) await registered(p.assets.find(a => a.id === c.assetId));
    await credentials.get(); return transcribeTimeline(p, vocabulary, ai, signal, progress, await preparedAudioPaths(p, signal));
  }));
  handle('ai-metadata', p => job(signal => { progress({ progress: 0, message: 'タイトル・概要欄・検索ワードを生成中' }); return generateMetadata(p, ai, signal); }));
  handle('ai-thumbnail', (p, prompt) => job(async signal => {
    progress({ progress: 0, message: 'サムネイル画像を生成中（数分かかることがあります）' });
    const file = await generateThumbnail(p, prompt, ai, signal, path.join(app.getPath('userData'), 'youtube-images'));
    return present(await inspectMedia(file, cacheDir()));
  }));
  handle('ai-cancel', () => aiController?.abort());
  handle('ai-save-output', async (p, format) => {
    validateProject(p); if (!['srt', 'vtt', 'txt', 'jpg'].includes(format) || !p.youtube) throw new Error('保存する投稿素材がありません。');
    let contents;
    if (format === 'jpg') { const a = p.assets.find(a => a.id === p.youtube.thumbnailAssetId); if (!a || (await registered(a)).kind !== 'image') throw new Error('サムネイルを生成してください。'); contents = await fs.readFile(a.path); }
    else contents = format === 'txt' ? youtubeText(p.youtube, totalTime(p)) : subtitleFile(p.youtube.cues, format);
    const result = await dialog.showSaveDialog(window, { title: 'YouTube投稿素材を保存', defaultPath: `${p.name.replace(/[<>:"/\\|?*]/g, '_')}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (result.canceled) return null;
    await assertDestination(result.filePath, `.${format}`, [...p.assets.map(a => a.path), ...[...registeredAssets.values()].map(a => a.path),...startupProtectedPaths,...protectedSourcePaths]);
    await atomicWrite(result.filePath, contents); completedExports.add(result.filePath); return result.filePath;
  });
  handle('audio-chunk', (url, index, treatment) => audioReader.read(url, index, treatment));
  handle('black-video', async (width,height) => present(await inspectMedia(await blackVideo(path.join(app.getPath('userData'),'generated-media'),width,height),cacheDir())));
  const startupProtectedPaths=new Set();
  handle('bootstrap', async () => {
    let startupProject=null,startupError='';
    const useTestFixtures = !!process.env.LUMA_TEST_DATA && process.env.LUMA_DEMO_FIXTURE === '1';
    if (useTestFixtures) {
      const startupRoot=path.join(app.getPath('userData'),'初期プロジェクト');
      startupProtectedPaths.add(path.join(startupRoot,'初期プロジェクト.luma'));
      try{const template=await readStartupProject(startupRoot);if(template){for(const asset of template.assets)startupProtectedPaths.add(asset.path);const hydrated=await hydrate(template);if(hydrated.assets.some(asset=>asset.offline))throw Error('初期素材を読み込めません。素材付きZIPを再展開してください。');startupProject=template.assets.every((asset,i)=>asset.size===hydrated.assets[i].size&&asset.duration===hydrated.assets[i].duration&&asset.hasAudio===hydrated.assets[i].hasAudio)?rebaseStartupYoutube(template,hydrated):hydrated;}}catch(error){startupError=`初期プロジェクトを読み込めませんでした：${error.message}`;}
    }
    const assets = [];
    try {
      if (useTestFixtures && !startupProject) {
        const files = await persistentDemoDir().then(dir => ['01-journey.mp4','02-encounter.mp4','03-beyond.mp4','04-atmosphere.wav'].map(name => path.join(dir,name)));
        for (const file of files) {
          startupProtectedPaths.add(file);
          assets.push(present(await inspectMedia(file,cacheDir())));
        }
      }
    } catch (error) { startupError = '初期素材を読み込めませんでした：' + error.message; }

    let recovery = null;
    try {
      const data = JSON.parse(await fs.readFile(autosavePath(), 'utf8'));
      recovery = { project: await hydrate(data.project), savedAt: data.savedAt };
    } catch {}
    return { assets, recovery, startupProject, startupError, version: app.getVersion() };
  });
  const importFiles = async paths => {
    if (importing) throw new Error('前の素材を読み込み中です。');
    if (!paths) {
      const result = await dialog.showOpenDialog(window, { title: '素材を読み込む', properties: ['openFile', 'multiSelections'], filters: [{ name: '動画・音声・画像', extensions: ['mp4','mov','mkv','avi','webm','m4v','mxf','mp3','wav','aac','m4a','flac','ogg','png','jpg','jpeg','webp','bmp','gif','tif','tiff'] }] });
      if (result.canceled) return { assets: [], errors: [] }; paths = result.filePaths;
    }
    if (!Array.isArray(paths) || paths.length > 100 || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('読み込み先が不正です。');
    importing = true;
    try {
      const assets = []; const errors = [];
      for (const [i, file] of paths.entries()) {
        window.webContents.send('import-progress', { index: i + 1, total: paths.length, name: path.basename(file) });
        try { assets.push(present(await inspectMedia(file, cacheDir()))); } catch (e) { errors.push(`${path.basename(file)}: ${e.message.slice(-350)}`); }
      }
      return { assets, errors };
    } finally { importing = false; }
  };
  handle('import', () => importFiles());
  handle('import-dropped', paths => {
    if (!Array.isArray(paths) || !paths.length) throw new Error('ドロップしたファイルが不正です。');
    return importFiles(paths);
  });
  handle('relink', async (asset) => {
    const result = await dialog.showOpenDialog(window, { title: `素材を再リンク: ${asset.name}`, properties: ['openFile'] });
    if (result.canceled) return null;
    const fresh = await inspectMedia(result.filePaths[0], cacheDir());
    assertReplacement(asset, fresh);
    return present({ ...fresh, id: asset.id, revision: fresh.id });
  });
  handle('save-project', async (p, saveAs = false) => {
    const contents = serialize(p);
    const pathGeneration = projectPathGeneration;
    let target = projectPath;
    if (!target || saveAs) {
      const result = await dialog.showSaveDialog(window, { title: 'プロジェクトを保存', defaultPath: target || `${p.name.replace(/[<>:"/\\|?*]/g, '_')}.luma`, filters: [{ name: 'Luma Studio Project', extensions: ['luma'] }] });
      if (result.canceled) return null; target = result.filePath;
    }
    await assertDestination(target, '.luma', [...p.assets.map(a => a.path),...startupProtectedPaths,...protectedSourcePaths]);
    await atomicWrite(target, contents); if (pathGeneration === projectPathGeneration) projectPath = target;
    return target;
  });
  handle('open-project', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'プロジェクトを開く', properties: ['openFile'], filters: [{ name: 'Luma Studio Project', extensions: ['luma'] }] });
    if (result.canceled) return null;
    const target = result.filePaths[0];
    if ((await fs.stat(target)).size > MAX_PROJECT_BYTES) throw new Error('プロジェクトファイルが大きすぎます。');
    const p = await hydrate(parseProjectJson(await fs.readFile(target, 'utf8')));
    await recoveryFiles.clear(); projectPathGeneration++; projectPath = target; dirty = false;
    return { project: p, path: target };
  });
  handle('autosave', (p) => {
    const contents = JSON.stringify({ savedAt: new Date().toISOString(), project: JSON.parse(serialize(p)) });
    return recoveryFiles.write(contents);
  });
  handle('clear-recovery', expectedSavedAt => {
    if (expectedSavedAt !== undefined && typeof expectedSavedAt !== 'string') throw new Error('自動保存の識別子が不正です。');
    return recoveryFiles.clear(expectedSavedAt);
  });
  handle('reset-project-path', async (keepRecovery = false) => {
    projectPathGeneration++; projectPath = null; dirty = keepRecovery === true;
    if (keepRecovery !== true) await recoveryFiles.clear();
  });
  handle('dirty', value => { dirty = !!value; });
  handle('finish-prepare-close', async (requestId, edited, canClose) => {
    if (preparingCloseId === null || requestId !== preparingCloseId || typeof edited !== 'boolean' || typeof canClose !== 'boolean') throw new Error('終了要求が一致しません。');
    preparingCloseId = null; dirty = edited;
    if (!canClose) return;
    if (exportController) {
      const answer = exportController.signal.aborted ? 1 : dialog.showMessageBoxSync(window, { type: 'question', buttons: ['編集を続ける', '書き出しを中止して終了'], defaultId: 0, cancelId: 0, title: '書き出し中です', message: '動画の書き出しを中止して終了しますか？' });
      if (answer === 0) return; exportController.abort();
      preparingCloseId = requestId;
      try { await exportFinished; } finally { preparingCloseId = null; }
    }
    if (dirty && (!process.env.LUMA_TEST_DATA || process.env.LUMA_TEST_CLOSE === '1')) {
      const answer = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['編集を続ける', '保存せずに終了', '保存して終了'], defaultId: 0, cancelId: 0, noLink: true, title: 'Luma Studio', message: '未保存の変更があります。保存して終了しますか？', detail: '「保存して終了」はプロジェクトを保存してから終了します。保存先の選択をキャンセルすると編集に戻ります。最新の自動保存は、次回起動時に復元できます。' });
      if (answer !== 1 && answer !== 2) return;
      if (answer === 2) { pendingCloseId = ++nextCloseId; window.webContents.send('save-before-close', pendingCloseId); return; }
    }
    allowClose = true; window.close();
  });
  handle('finish-save-before-close', (requestId, saved) => {
    if (requestId !== pendingCloseId || pendingCloseId === null || typeof saved !== 'boolean') throw new Error('終了要求が一致しません。');
    pendingCloseId = null;
    if (saved) { allowClose = true; window.close(); }
  });
  handle('export', async (p, settings, titleImages) => {
    if (exportController) throw new Error('書き出しはすでに実行中です。');
    validateProject(p);
    await validateExportSources(p);
    validateEncoder(settings?.encoder);
    const result = await dialog.showSaveDialog(window, { title: '動画を書き出す', defaultPath: `${p.name.replace(/[<>:"/\\|?*]/g, '_')}.mp4`, filters: [{ name: 'H.264 / AAC', extensions: ['mp4'] }] });
    if (result.canceled) return null;
    const output = result.filePath;
    await validateExportSources(p);
    await assertDestination(output, '.mp4', [...p.assets.map(a => a.path),...startupProtectedPaths,...protectedSourcePaths]);
    exportController = new AbortController();
    let finishExport; exportFinished = new Promise(resolve => { finishExport = resolve; });
    try {
      if (!window.isDestroyed()) window.webContents.send('export-progress', { status: 'preparing', progress: 0, output });
      const audioPaths = await preparedAudioPaths(p, exportController.signal);
      const completed = await exportProject(p, settings, output, { titleImages, audioPaths, signal: exportController.signal, onProgress: progress => { if (!window.isDestroyed()) window.webContents.send('export-progress', progress); } });
      completedExports.add(completed); return completed;
    } finally { exportController = null; finishExport(); }
  });
  handle('cancel-export', () => exportController?.abort());
  handle('export-encoders', (refresh = false) => exportEncoders.detect(refresh === true));
  handle('reveal', output => { if (completedExports.has(output)) shell.showItemInFolder(output); });
}
app.whenReady().then(async () => {
  protocol.handle('luma', async request => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, 'dist', '.' + relative);
    if (url.host !== 'app' || !file.startsWith(path.resolve(root, 'dist') + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  protocol.handle('media', async request => {
    const url = new URL(request.url); const entry = mediaFiles.get(url.pathname.slice(1));
    const file = typeof entry === 'string' ? entry : entry?.file;
    if (entry?.asset) {
      try { await assertMediaRevision(entry.asset); } catch { return new Response('Source changed', { status: 410 }); }
    }
    if (url.host !== 'local' || !file) return new Response('Not found', { status: 404 });
    const size = (await fs.stat(file)).size;
    const mime = { '.ttf':'font/ttf', '.mp4':'video/mp4', '.m4v':'video/mp4', '.mov':'video/quicktime', '.webm':'video/webm', '.wav':'audio/wav', '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.aac':'audio/aac', '.ogg':'audio/ogg', '.flac':'audio/flac', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.bmp':'image/bmp' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = new Headers({ 'Content-Type': mime, 'Accept-Ranges':'bytes', 'Access-Control-Expose-Headers':'Content-Length,Content-Range,Accept-Ranges' });
    const origin = request.headers.get('origin');
    headers.set('Access-Control-Allow-Origin', origin === process.env.LUMA_DEV_URL ? origin : 'luma://app');
    let start=0, end=size-1, status=200;
    const range=request.headers.get('range');
    if (range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
      if (match[1]) { start=Number(match[1]); end=match[2] ? Math.min(size-1,Number(match[2])) : size-1; }
      else start=Math.max(0,size-Number(match[2]));
      if (start>end || start>=size) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
      status=206; headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
    }
    headers.set('Content-Length',String(end-start+1));
    if (request.method==='HEAD') return new Response(null,{status,headers});
    return new Response(Readable.toWeb(createReadStream(file,{start,end})),{status,headers});
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => callback(permission==='fullscreen'&&wc===window?.webContents&&details.isMainFrame&&details.requestingUrl===wc.mainFrame.url));
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { label: 'Luma Studio', submenu: [
      { role: 'about', label: 'Luma Studioについて' }, { type: 'separator' },
      { role: 'hide', label: 'Luma Studioを隠す' }, { role: 'hideOthers', label: 'ほかを隠す' },
      { role: 'unhide', label: 'すべて表示' }, { type: 'separator' },
      { label: 'Luma Studioを終了', accelerator: 'Command+Q', click: () => window?.close() },
    ] },
    { label: '編集', submenu: [
      { role: 'cut', label: '切り取り', accelerator: null },
      { role: 'copy', label: 'コピー', accelerator: null },
      { role: 'paste', label: '貼り付け', accelerator: null },
      { role: 'selectAll', label: 'すべて選択', accelerator: null },
    ] },
    { label: 'ウィンドウ', submenu: [{ role: 'minimize', label: 'しまう' }, { role: 'zoom', label: '拡大／縮小' }, { role: 'close', label: '閉じる' }] },
  ]) : null);
  // Keep the video compositor on the audio clock when another window is focused.
  window = new BrowserWindow({ width: 1600, height: 1000, minWidth: 1100, minHeight: 720, backgroundColor: '#131518', title: 'Luma Studio', icon: path.join(__dirname, 'luma.ico'), show: false, ...(process.platform === 'darwin' ? { titleBarStyle: 'default', enableLargerThanScreen: !!process.env.LUMA_TEST_DATA } : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#17191d', symbolColor: '#969eac', height: 40 } }), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  installIPC();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('luma://app/') && !url.startsWith(process.env.LUMA_DEV_URL || 'luma://app/')) event.preventDefault(); });
  window.on('close', event => {
    // Dedicated close tests opt in; other isolated test apps must clean up without a user response.
    if (allowClose || rendererGone || (process.env.LUMA_TEST_DATA && process.env.LUMA_TEST_CLOSE !== '1')) return;
    event.preventDefault();
    if (pendingCloseId !== null || preparingCloseId !== null) return;
    preparingCloseId = ++nextCloseId;
    window.webContents.send('prepare-close', preparingCloseId);
  });
  window.webContents.on('render-process-gone', () => { pendingCloseId = null; preparingCloseId = null; rendererGone = true; });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(process.env.LUMA_DEV_URL || 'luma://app/');
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { audioPrepareController?.abort(); audioProcessor.close(); audioReader.close(); waveformReader.close(); aiController?.abort(); });
