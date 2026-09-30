const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ffmpeg, run } = require('../electron/media.cjs');
const root = path.join(__dirname, '..'), rate = 48000;
const pcm = bytes => new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));

async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true });
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'audio-edges-'));
  const file = path.join(profile, '冒頭と末尾.luma'), source = path.join(profile, '音声 & edge.mp3');
  // Nonzero endpoints expose hard clicks; a chirp distinguishes startup noise
  // from a harmless gain change and permits sample alignment of real output.
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.3*cos(2*PI*(197*t+3*t*t)):s=22050:d=8.125', '-c:a', 'libmp3lame', '-q:a', '2', source]);
  const reference = pcm(await run(ffmpeg, ['-v', 'error', '-i', source, '-af', 'aresample=48000:async=1:first_pts=0', '-ac', '2', '-ar', '48000', '-f', 'f32le', 'pipe:1']));
  const project = { version: 1, id: 'audio-edges', name: '音声の冒頭・末尾検証', width: 640, height: 360, fps: 30,
    assets: [], clips: [], markers: [], tracks: [{ id: 'audio', name: '音声', kind: 'audio', muted: false, hidden: false, locked: false, solo: false }] };
  await fs.writeFile(file, JSON.stringify(project));
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const env = { ...process.env, LUMA_TEST_DATA: profile, LUMA_DEMO_FIXTURE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
  let app; const metrics = [];
  try {
    app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, file);
    await page.keyboard.press('Control+o'); await page.getByRole('button', { name: project.name, exact: true }).waitFor();
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, source);
    await page.getByRole('button', { name: '読み込み', exact: true }).click();
    await page.getByRole('button', { name: `${path.basename(source)} を追加`, exact: true }).click();
    await page.keyboard.press('Control+s'); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    const imported = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.ok(Math.abs(imported.assets[0].audioDuration - reference.length / 2 / rate) < 1 / rate);
    await page.evaluate(() => {
      const create = AudioContext.prototype.createAnalyser;
      AudioContext.prototype.createAnalyser = function () {
        const analyser = create.call(this), destination = this.createMediaStreamDestination();
        analyser.connect(destination); window.edgeCapture = { stream: destination.stream, context: this }; return analyser;
      };
    });
    // Initialize the graph, then record its output on Chromium's media thread.
    await page.getByRole('button', { name: '再生 (Space)', exact: true }).click();
    await page.waitForFunction(() => window.edgeCapture?.context.state === 'running');
    await page.keyboard.press('k');
    for (const scenario of [{ name: 'full MP3', in: 0, duration: imported.clips[0].duration, speed: 1 },
      { name: 'split at PCM endpoint', in: 0, duration: imported.clips[0].duration, speed: 1, splitAtAudioEnd: true },
      { name: 'trimmed MP3 at 2x', in: 7.5, duration: (imported.assets[0].duration - 7.5) / 2, speed: 2 }]) {
      const name = `${project.name} ${scenario.name}`;
      const { splitAtAudioEnd, ...edit } = scenario, clip = { ...imported.clips[0], start: 0, ...edit };
      const audioEnd = imported.assets[0].audioDuration;
      const clips = splitAtAudioEnd ? [{ ...clip, duration: audioEnd }, { ...clip, id: 'padding-only', start: audioEnd, in: audioEnd, duration: clip.duration - audioEnd }] : [clip];
      await fs.writeFile(file, JSON.stringify({ ...imported, name, clips }));
      await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, file);
      await page.keyboard.press('Control+o'); await page.getByRole('button', { name, exact: true }).waitFor();
      await page.getByRole('button', { name: '先頭へ (Home)', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.ruler-label .timecode')?.textContent === '00:00:00:00');
      await page.evaluate(() => {
        const capture = window.edgeCapture; capture.chunks = [];
        capture.recorder = new MediaRecorder(capture.stream, { mimeType: 'audio/webm;codecs=pcm' });
        capture.recorder.ondataavailable = event => { if (event.data.size) capture.chunks.push(event.data); };
        capture.recorder.start(50);
      });
      await page.getByRole('button', { name: '再生 (Space)', exact: true }).click();
      await page.getByRole('button', { name: '一時停止 (Space)', exact: true }).waitFor();
      await page.getByRole('button', { name: '再生 (Space)', exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await page.locator('.toast').filter({ hasText: '音声を再生できません' }).count(), 0, await page.locator('.toast').allTextContents());
      await page.waitForTimeout(250);
      const bytes = await page.evaluate(async () => {
        const capture = window.edgeCapture;
        await new Promise(resolve => { capture.recorder.onstop = resolve; capture.recorder.stop(); });
        return Array.from(new Uint8Array(await new Blob(capture.chunks).arrayBuffer()));
      });
      const recording = path.join(results, `audio-edges-${metrics.length}.webm`); await fs.writeFile(recording, Buffer.from(bytes));
      const actual = pcm(await run(ffmpeg, ['-v', 'error', '-i', recording, '-ac', '2', '-ar', String(rate), '-f', 'f32le', 'pipe:1']));
      const frames = Math.round(Math.min(scenario.duration, (reference.length / 2 / rate - scenario.in) / scenario.speed) * rate);
      const expected = new Float32Array(frames);
      for (let i = 0; i < frames; i++) expected[i] = reference[(Math.round(scenario.in * rate) + i * scenario.speed) * 2] * Math.min(1, i / (rate * .003), (frames - i) / (rate * .003));
      let first = -1; for (let i = 0; i < actual.length; i += 2) if (Math.abs(actual[i]) > .001) { first = i / 2; break; }
      assert.ok(first >= 0, 'audible PCM was recorded');
      assert.ok(actual.length / 2 >= first + frames + 128, `complete recorded interval: ${actual.length / 2} frames, first ${first}, expected ${frames}; position ${await page.locator('.ruler-label .timecode').textContent()}`);
      let alignment = -1, best = Infinity;
      for (let start = Math.max(0, first - 128); start <= first + 128; start++) {
        let error = 0; for (let i = 256; i < Math.min(4096, frames); i++) error += (actual[(start + i) * 2] - expected[i]) ** 2;
        if (error < best) { best = error; alignment = start; }
      }
      const peakError = (from, to) => { let peak = 0; for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(actual[(alignment + i) * 2] - expected[i])); return peak; };
      // Speed resampling can differ slightly, but must retain the original signal.
      const head = peakError(0, Math.min(4800, frames)), tail = peakError(Math.max(0, frames - 2400), frames);
      assert.ok(head < .008 && tail < .008, `${scenario.name}: head ${head}, tail ${tail}`);
      let silence = 0; for (let i = (alignment + frames + 128) * 2; i < actual.length; i++) silence = Math.max(silence, Math.abs(actual[i]));
      assert.ok(silence < 1e-6, `PCM beyond EOF: ${silence}`);
      metrics.push({ scenario: scenario.name, head, tail, silence, frames, alignment });
      console.log(JSON.stringify(metrics.at(-1)));
    }
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('.toast').filter({ hasText: '音声を再生できません' }).count(), 0);
    await page.screenshot({ path: path.join(results, 'audio-edges.png') });
    await fs.writeFile(path.join(results, 'audio-edges-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, metrics }, null, 2));
    console.log('Audio edges verified:', JSON.stringify(metrics));
  } finally { if (app) await app.close(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
