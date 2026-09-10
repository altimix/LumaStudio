const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'); const path = require('node:path'); const assert = require('node:assert/strict');
const { audioFixture, RATE } = require('../tests/helpers/audio.cjs');
const { ffmpeg, run } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');
const treatment = process.env.LUMA_VERIFY_TREATMENT === 'speech' ? 'speech' : undefined;
const reportName = treatment ? 'normalization' : 'audio';
function rms(data) { return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / Math.max(1, data.length)); }
function firstSound(data) { return data.findIndex(value => Math.abs(value) > 0.001); }
// Compare actual rendered samples, not transport labels or the meter, against the source.
function correlation(actual, original, approximate, direction, channel) {
  const start = firstSound(actual) + 4096; const length = 1024; let best = -1; let frame = -1; let gain = 0;
  assert.ok(start >= 4096 && start + length < actual.length, 'enough actual PCM output');
  for (let offset = -1800; offset <= 1800; offset++) {
    const candidate = Math.round(approximate + direction * 4096) + offset;
    let ab = 0; let aa = 0; let bb = 0;
    for (let i = 0; i < length; i += 2) {
      const a = actual[start + i]; const b = original[(candidate + direction * i) * 2 + channel] || 0;
      ab += a * b; aa += a * a; bb += b * b;
    }
    const score = ab / Math.sqrt(aa * bb || 1);
    if (score > best) { best = score; frame = candidate; gain = ab / (bb || 1); }
  }
  return { score: best, sourceFrame: frame, capturedOffset: start, gain };
}
async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true }); await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'audio-profile-'));
  const env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  const projectFile = path.join(results, 'シャトル音声検証.luma');
  const metrics = []; const checks = [];
  try {
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 }); await page.locator('.media-card').first().waitFor();
    const audioFile = path.join(results, 'シャトル 音声 & stereo.wav'); let original = await audioFixture(audioFile, 64);
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, audioFile);
    await page.getByRole('button', { name: '読み込み', exact: true }).click(); await page.locator('.media-card').nth(4).waitFor({ timeout: 60000 });
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, projectFile);
    await page.keyboard.press('Control+s'); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    const demo = JSON.parse(await fs.readFile(projectFile, 'utf8')); const sound = demo.clips.find(c => c.kind === 'audio'); const video = demo.clips.find(c => c.kind === 'video'); const asset = demo.assets.find(a => a.path === audioFile); assert.ok(asset);
    const fixture = { ...demo, name: 'シャトル音声検証', clips: [
      { ...video, duration: 8, start: 0, in: 0, volume: 0 },
      { ...sound, assetId: asset.id, start: 0, in: 0, duration: 64, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
    ] };
    await fs.writeFile(projectFile, JSON.stringify(fixture));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, projectFile);
    await page.keyboard.press('Control+o'); await page.getByRole('button', { name: fixture.name, exact: true }).waitFor();

    if (treatment) {
      const cancelAsset=demo.assets.find(a=>a.hasAudio&&a.id!==asset.id);
      const cancellation=await page.evaluate(async originalAsset=>{
        const imported=await window.luma.importMedia([originalAsset.path]);const a=imported.assets[0];
        const requestId=crypto.randomUUID(),options={absolute:true,treatment:'normalize'};
        const result=window.luma.readWaveform(a.url,0,Math.min(a.duration,5),300,options,requestId).then(()=>false,()=>true);
        await window.luma.cancelWaveform(requestId);
        const cancelled=await result;
        const retry=await window.luma.readWaveform(a.url,0,Math.min(a.duration,5),300,options,crypto.randomUUID());
        return {cancelled,bins:retry.length};
      },cancelAsset);
      assert.deepEqual(cancellation,{cancelled:true,bins:300});checks.push('native waveform cancellation releases treatment work and permits retry');
      const audioClip = page.locator('.timeline-clip[data-clip-id="'+sound.id+'"]'); await audioClip.focus(); await page.keyboard.press('Enter');
      await page.locator('.inspector-tabs').getByRole('button',{name:'オーディオ',exact:true}).click();
      const apply = page.getByRole('button',{name:'解析して適用',exact:true});
      const treatmentStatus=page.locator('.audio-enhancement .audio-treatment-status');
      await page.getByRole('combobox',{name:'調整方法',exact:true}).selectOption('normalize');await apply.click();await page.locator('.audio-enhancement').getByRole('button',{name:'処理を中止',exact:true}).click();await apply.waitFor();await treatmentStatus.filter({hasText:'中止'}).waitFor();await page.getByRole('combobox',{name:'調整方法',exact:true}).selectOption('speech');checks.push('cancelled native analysis does not apply partial processing');
      const wave=audioClip.locator('.detailed-waveform canvas');
      const waveSnapshot=async()=>{await wave.locator('xpath=self::*[@data-waveform-detail="ready"]').waitFor({timeout:30000});return wave.evaluate(c=>c.toDataURL());};
      const originalWave=await waveSnapshot();
      await page.evaluate(()=>{
        window.normalizationEvents=[];window.normalizationSamples=[];
        window.offNormalization=window.luma.onAudioPrepareProgress(value=>window.normalizationEvents.push(value));
        window.normalizationObserver=new MutationObserver(()=>{
          const bars=[...document.querySelectorAll('.audio-job-progress progress')];
          if(bars.length===2)window.normalizationSamples.push(bars.map(bar=>bar.value));
        });
        window.normalizationObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['value']});
      });
      await apply.click();
      await page.waitForFunction(()=>{const bar=document.querySelector('.audio-enhancement progress');return bar&&bar.value>0&&bar.value<100;});
      assert.match(await page.locator('.audio-enhancement .audio-job-time').innerText(),/経過.*残り/s);
      await page.screenshot({path:path.join(results,'normalization-progress.png')});
      await treatmentStatus.filter({hasText:'調整後'}).waitFor({timeout:120000});
      const processedWave=await waveSnapshot();assert.notEqual(processedWave,originalWave,'processed audio changes the actual waveform');
      await page.locator('#prop-volume').fill('50');await page.locator('#prop-volume').press('Enter');
      assert.notEqual(await waveSnapshot(),processedWave,'volume percent changes waveform height');
      await audioClip.focus();await page.keyboard.press('Control+z');assert.equal(await waveSnapshot(),processedWave,'Undo restores the previous waveform');
      const observed=await page.evaluate(()=>{
        window.offNormalization();window.normalizationObserver.disconnect();
        return {events:window.normalizationEvents,samples:window.normalizationSamples};
      });
      assert.ok(observed.events.some(p=>p.phase==='speech'&&p.progress>0&&p.progress<.96));assert.ok(!observed.events.some(p=>p.phase==='analysis'||p.phase==='processing'));
      assert.ok(observed.samples.some(values=>values[0]>0&&values[0]<100));
      assert.ok(observed.samples.every((values,i)=>values[0]===values[1]&&(!i||values[0]>=observed.samples[i-1][0])));
      assert.deepEqual(observed.samples.at(-1),[100,100]);
      metrics.push({name:'normalization-progress',...observed});checks.push('waveform pixels follow processed audio, volume percent and Undo');checks.push('real FFmpeg speech pass updates both percentage bars monotonically, with elapsed/remaining time and 100 only after apply');
      const save = async()=>{await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));return JSON.parse(await fs.readFile(projectFile,'utf8'));};
      assert.equal((await save()).clips.find(c=>c.id===sound.id).audioTreatment,'speech');
      await page.keyboard.press('Control+z');assert.equal((await save()).clips.find(c=>c.id===sound.id).audioTreatment,undefined);
      await page.keyboard.press('Control+Shift+z');assert.equal((await save()).clips.find(c=>c.id===sound.id).audioTreatment,'speech');await audioClip.focus();await page.keyboard.press('Enter');
      await page.getByRole('button',{name:'自動調整を解除',exact:true}).click();assert.equal((await save()).clips.find(c=>c.id===sound.id).audioTreatment,undefined);
      await page.keyboard.press('Control+z');assert.equal((await save()).clips.find(c=>c.id===sound.id).audioTreatment,'speech');await audioClip.focus();await page.keyboard.press('Enter');
      await page.evaluate(()=>{window.cachedNormalization=[];window.offNormalization=window.luma.onAudioPrepareProgress(p=>window.cachedNormalization.push(p));});
      await apply.click();await treatmentStatus.filter({hasText:'調整後'}).waitFor({timeout:120000});
      const cached=await page.evaluate(()=>{window.offNormalization();return window.cachedNormalization;});
      assert.ok(cached.some(p=>p.phase==='cached'));assert.ok(!cached.some(p=>p.phase==='speech'||p.phase==='analysis'||p.phase==='processing'));checks.push('reapplying prepared speech uses cached audio without a new analysis pass');
      const trackName=fixture.tracks.find(t=>t.id===sound.trackId).name;
      await page.getByRole('button',{name:trackName+' ロック',exact:true}).click();assert.equal(await apply.isDisabled(),true);await page.getByRole('button',{name:trackName+' ロック解除',exact:true}).click();
      await save(); await page.keyboard.press('Control+o');await page.waitForFunction(name=>document.querySelector('input[aria-label="クリップ名"]')?.value===name,fixture.clips[0].name);await audioClip.focus();await page.keyboard.press('Enter');await page.locator('.inspector-tabs').getByRole('button',{name:'オーディオ',exact:true}).click();await page.getByText('適用中：会話を聴きやすく。',{exact:false}).waitFor();
      fixture.clips[1].audioTreatment='speech';
      const {createAudioProcessor}=require('../electron/audio-normalize.cjs');const service=createAudioProcessor(path.join(results,'normalization-reference'));let prepared;
      try{prepared=await service.get(audioFile,'speech');}finally{service.close();}
      const pcm=await run(ffmpeg,['-v','error','-i',prepared.file,'-ac','2','-ar',String(RATE),'-f','f32le','pipe:1']);original=new Float32Array(pcm.buffer.slice(pcm.byteOffset,pcm.byteOffset+pcm.byteLength));
      metrics.push({name:'speech-loudness',outputLufs:prepared.outputLufs,truePeak:prepared.peak});checks.push('speech apply, bypass, one-step Undo/Redo, lock and project reload');
      await page.screenshot({path:path.join(results,'normalization-controls.png')});
    }
    // Record the real output as lossless PCM on Chromium's media thread. A JS
    // ScriptProcessor tap can itself drop blocks while CI's UI thread is busy.
    await page.evaluate(() => {
      window.audioCapture = { chunks: [], enabled: false, context: null, starts: [] };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when, offset, duration) { window.audioCapture.starts.push({ now: this.context.currentTime, when, offset, duration, rate: this.playbackRate.value }); return start.call(this, when, offset, duration); };
      const create = AudioContext.prototype.createAnalyser;
      AudioContext.prototype.createAnalyser = function () {
        const analyser = create.call(this); const destination = this.createMediaStreamDestination();
        analyser.connect(destination); window.audioCapture.context = this; window.audioCapture.stream = destination.stream; window.audioCapture.analyser = analyser;
        return analyser;
      };
    });
    const status = page.getByRole('status', { name: 'シャトル状態' });
    const captureStart = () => page.evaluate(() => {
      if (!MediaRecorder.isTypeSupported('audio/webm;codecs=pcm')) throw new Error('Lossless PCM capture is required for this test.');
      const capture = window.audioCapture; capture.chunks = []; capture.starts = [];
      capture.recorder = new MediaRecorder(capture.stream, { mimeType: 'audio/webm;codecs=pcm' });
      capture.recorder.ondataavailable = event => { if (event.data.size) capture.chunks.push(event.data); }; capture.recorder.start(50);
    });
    async function captured(nonzero = true, frames = 24000) {
      if (nonzero) await page.waitForFunction(() => { const data = new Float32Array(256); window.audioCapture.analyser.getFloatTimeDomainData(data); return data.some(value => Math.abs(value) > 0.001); }, null, { timeout: 15000 });
      const minimum = await page.evaluate(() => window.audioCapture.chunks.reduce((sum, blob) => sum + blob.size, 0));
      await page.waitForFunction(bytes => window.audioCapture.chunks.reduce((sum, blob) => sum + blob.size, 0) >= bytes, minimum + frames * 8 + 4096, { timeout: 15000 });
      const bytes = await page.evaluate(async () => {
        const capture = window.audioCapture; await new Promise(resolve => { capture.recorder.onstop = resolve; capture.recorder.stop(); });
        return Array.from(new Uint8Array(await new Blob(capture.chunks).arrayBuffer()));
      });
      const recording = path.join(results, 'audio-output-last.webm'); await fs.writeFile(recording, Buffer.from(bytes));
      const raw = await run(ffmpeg, ['-v', 'error', '-i', recording, '-map', '0:a:0', '-ac', '2', '-ar', String(RATE), '-f', 'f32le', 'pipe:1']);
      const pcm = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      return [0, 1].map(channel => Array.from({ length: pcm.length / 2 }, (_, i) => pcm[i * 2 + channel]));
    }
    // Drain the test tap's queued input after a stop before comparing a NEW source interval.
    async function drainStop() { await captureStart(); const data = await captured(false, 12000); assert.ok(rms(data[0].slice(-4096)) < 1e-7, 'stopped output settles to silence'); }
    const rapid = keys => page.evaluate(keys => { for (const key of keys) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }, keys);
    const seek = async frames => { await page.keyboard.press('Home'); await page.evaluate(frames => {
      for (let i = 0; i < Math.floor(frames / 10); i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
      for (let i = 0; i < frames % 10; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    }, frames); };
    await rapid(['l', 'k']); await drainStop();
    await page.keyboard.press('Home'); await captureStart(); await page.keyboard.press('l'); const forward = await captured(); await page.keyboard.press('k');
    for (const ch of [0, 1]) { const match = correlation(forward[ch], original, 0, 1, ch); metrics.push({ name: `forward-channel-${ch}`, ...match }); assert.ok(match.score > 0.98, JSON.stringify(match)); }
    checks.push('forward stereo output matches original PCM');
    await drainStop();
    await page.keyboard.press('End'); await captureStart(); await page.keyboard.press('j'); const reverse = await captured(); await page.keyboard.press('k');
    for (const ch of [0, 1]) { const match = correlation(reverse[ch], original, RATE * 64 - 1, -1, ch); metrics.push({ name: `reverse-channel-${ch}`, ...match }); assert.ok(match.score > 0.98, JSON.stringify(match)); }
    checks.push('J renders reversed stereo PCM from the exact source tail');
    // Every K/L pair is dispatched within ONE JS task, so RAF cannot see the stop.
    await seek(90);
    for (let i = 0; i < 6; i++) {
      await captureStart(); await rapid(['k', 'l']); const data = await captured(true, 12000);
      const level = rms(data[0]); assert.ok(level > 0.07, `K/L cycle ${i}: ${level}`); metrics.push({ name: `K-L-${i}`, rms: level });
    }
    await page.evaluate(() => window.audioCapture.context.suspend()); await captureStart(); await rapid(['k', 'l']); const resumed = await captured();
    assert.equal(await page.evaluate(() => window.audioCapture.context.state), 'running'); assert.ok(rms(resumed[0]) > 0.07);
    checks.push('six same-frame K/L restarts and suspended-context recovery');
    await rapid(['j', 'k', 'l']); await captureStart(); assert.ok(rms((await captured())[0]) > 0.07); await page.keyboard.press('k');
    checks.push('J-K-L returns to audible forward playback');
    for (const key of ['l', 'j']) {
      for (const [index, speed] of [1, 2, 4, 8, 16].entries()) {
        await page.keyboard.press('k'); await seek(30 * (key === 'l' ? 16 : 48)); await captureStart(); await rapid(Array(index + 1).fill(key));
        // Inspect the transport while recording. Serializing and decoding the PCM
        // can take longer than the remaining three seconds at 16x on a busy host.
        await status.filter({ hasText: new RegExp(`${speed}×`) }).waitFor();
        const data = await captured(true, 12000); assert.ok(rms(data[0]) > 0.04, `${key} ${speed}x is audible`);
        metrics.push({ name: `${key}-${speed}x`, rms: rms(data[0]) });
      }
    }
    await captureStart(); await rapid(['k', 'l']); assert.ok(rms((await captured())[0]) > 0.07); await page.keyboard.press('k');
    checks.push('all ten shuttle directions/rates and fast-K-L produce actual output');
    // Force a real 8-second decode-window boundary in both directions.
    for (const [frames, key] of [[231, 'l'], [249, 'j']]) {
      await drainStop();
      await seek(frames); await captureStart(); await page.keyboard.press(key); const data = await captured(true, 40000); await page.keyboard.press('k');
      const first = firstSound(data[0]); let longest = 0; let run = 0;
      for (let i = first + 100; i < data[0].length - 100; i++) { run = Math.abs(data[0][i]) < 1e-8 && Math.abs(data[1][i]) < 1e-8 ? run + 1 : 0; longest = Math.max(longest, run); }
      if (longest >= RATE * 0.003) await fs.writeFile(path.join(results, 'audio-boundary-debug.json'), JSON.stringify({ key, first, longest, samples: data, starts: await page.evaluate(() => window.audioCapture.starts) }));
      assert.ok(longest < RATE * 0.003, `${key} window boundary dropout: ${longest} samples`); metrics.push({ name: `${key}-window-boundary`, silenceSamples: longest });
    }
    checks.push('forward and reverse window joins do not drop PCM');
    async function loadFixture(project) {
      await page.keyboard.press('k'); await drainStop(); await fs.writeFile(projectFile, JSON.stringify(project));
      await page.keyboard.press('Control+o');
      await page.getByRole('button', { name: project.name, exact: true }).waitFor();
    }
    const trimmed = { ...fixture, name: '素材in点と速度の音声検証', clips: [{ ...fixture.clips[1], start: 2, in: 7.5, duration: 2, speed: 2 }] };
    await loadFixture(trimmed);
    for (const [frames, key, direction, sourceFrame] of [[90, 'l', 2, 9.5 * RATE], [105, 'j', -2, 10.5 * RATE - 1]]) {
      await seek(frames); await captureStart(); await page.keyboard.press(key); const data = await captured(true, 16000); await page.keyboard.press('k');
      const match = correlation(data[0], original, sourceFrame, direction, 0); assert.ok(match.score > 0.98, JSON.stringify(match)); metrics.push({ name: `${key}-trimmed-speed-2`, ...match }); await drainStop();
    }
    checks.push('nonzero source in and 2x clip speed match PCM in both directions');
    const mixTrack = { ...fixture.tracks.find(t => t.id === sound.trackId), id: 'audio-mix-test', name: 'ミックス検証' };
    const mix = { ...fixture, name: '音量ミックス検証', tracks: [...fixture.tracks, mixTrack], clips: [
      { ...fixture.clips[1], duration: 10, volume: 0.25 }, { ...fixture.clips[1], id: 'mix-copy', trackId: mixTrack.id, duration: 10, volume: 0.5 },
    ] };
    for (const [name, expectedGain, tracks] of [
      ['mix', 0.75, mix.tracks],
      ['mute', 0.5, mix.tracks.map(t => t.id === sound.trackId ? { ...t, muted: true } : t)],
      ['solo', 0.25, mix.tracks.map(t => t.id === sound.trackId ? { ...t, solo: true } : t)],
    ]) {
      await loadFixture({ ...mix, name: `音量 ${name} 検証`, tracks }); await seek(60); await captureStart(); await page.keyboard.press('l'); const data = await captured(); await page.keyboard.press('k');
      const match = correlation(data[0], original, 2 * RATE, 1, 0); assert.ok(match.score > 0.98 && Math.abs(match.gain - expectedGain) < 0.02, JSON.stringify({ name, expectedGain, ...match })); metrics.push({ name, ...match });
    }
    checks.push('real PCM gains honor overlapping tracks, volume, mute and solo');
    await loadFixture({ ...fixture, name: '音声フェード検証', clips: [{ ...fixture.clips[1], duration: 8, fadeIn: 2, fadeOut: 2 }] });
    for (const [frames, key, direction] of [[30, 'l', 1], [45, 'j', -1], [210, 'l', 1], [225, 'j', -1]]) {
      await drainStop(); await seek(frames); await captureStart(); await page.keyboard.press(key); const data = await captured(true, 16000); await page.keyboard.press('k');
      const match = correlation(data[0], original, frames / 30 * RATE - (direction < 0 ? 1 : 0), direction, 0);
      const midpoint = (match.sourceFrame + direction * 512) / RATE; const expectedGain = Math.min(1, midpoint / 2, (8 - midpoint) / 2);
      assert.ok(match.score > 0.98 && Math.abs(match.gain - expectedGain) < 0.015, JSON.stringify({ frames, key, expectedGain, ...match })); metrics.push({ name: `${key}-fade-at-${frames}`, expectedGain, ...match });
    }
    checks.push('fade-in and fade-out follow clip time in both directions');
    await loadFixture({ ...fixture, name: '映像内音声検証', clips: [{ ...video, audioTreatment: treatment, start: 0, duration: 8, in: 0, volume: 1, fadeIn: 0, fadeOut: 0 }] });
    await seek(90); await captureStart(); await page.keyboard.press('j'); assert.ok(rms((await captured())[0]) > 0.005); await page.keyboard.press('k'); checks.push('embedded video audio is audible in reverse');
    await loadFixture({ ...fixture, name: 'シャトル音声検証 完了' });
    // Stop before the first asynchronous scheduling turn. Deferred-decode races also have unit coverage.
    await seek(30 * 38); await captureStart(); await rapid(['l', 'k']); await captured(false, 36000);
    await captureStart(); const stopped = await captured(false, 12000); assert.ok(rms(stopped[0]) < 1e-7); assert.equal(await status.textContent(), '停止');
    checks.push('same-frame L-K leaves output silent');
    // Native boundary validation, including a local path disguised as an audio request.
    const denied = await page.evaluate(async file => {
      const rejected = [];
      for (const [url, index] of [[file, 0], ['media://local/asset/not-registered', 0]]) { try { await window.luma.readAudioChunk(url, index); rejected.push(false); } catch { rejected.push(true); } }
      return rejected;
    }, audioFile); assert.deepEqual(denied, [true, true]); checks.push('native IPC rejects arbitrary or unregistered paths');
    await seek(120); await page.keyboard.press('j'); await page.waitForFunction(() => Number.parseFloat(document.querySelector('.meter-reading').textContent) > -40);
    await page.waitForFunction(() => { const canvas = document.querySelector('.canvas-wrap canvas'); const pixel = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data; return pixel[0] + pixel[1] + pixel[2] > 20; });
    await page.screenshot({ path: path.join(results, treatment ? 'normalization-shuttle.png' : 'shuttle-audio.png'), animations: 'disabled' }); await page.keyboard.press('k');

    if(treatment){
      const output=path.join(results,'normalization.mp4');const short={...fixture,name:'会話音声の書き出し検証',width:320,height:180,clips:fixture.clips.map(c=>({...c,duration:6}))};await loadFixture(short);
      await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
      await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByRole('combobox',{name:'品質',exact:true}).selectOption('draft');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();await page.locator('.export-success').waitFor({timeout:180000});await page.getByRole('button',{name:'閉じる',exact:true}).click();
      const bytes=await run(ffmpeg,['-v','error','-i',output,'-map','0:a:0','-ac','2','-ar',String(RATE),'-f','f32le','pipe:1']);const exported=Array.from({length:bytes.length/8},(_,i)=>bytes.readFloatLE(i*8));const match=correlation(exported,original,0,1,0);assert.ok(match.score>.97 && Math.abs(match.gain-1)<.04,JSON.stringify(match));metrics.push({name:'AAC-export',...match});checks.push('actual MP4 audio matches normalized preview within AAC tolerance');
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, reportName + '-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, capture: 'lossless PCM MediaRecorder', checks, metrics, consoleErrors: errors }, null, 2));
    console.log('Windows forward/reverse PCM, K/L restart, all shuttle rates and decode boundaries verified.');
  } catch (error) { await page.screenshot({ path: path.join(results, reportName + '-failure.png') }).catch(() => {}); const media = await page.evaluate(() => [...document.querySelectorAll('.media-elements video')].map(el => ({ src: el.src, time: el.currentTime, ready: el.readyState, seeking: el.seeking, error: el.error?.message }))); await fs.writeFile(path.join(results, reportName + '-failure.json'), JSON.stringify({ message: error.message, metrics, checks, errors, media }, null, 2)); throw error; }
  finally { await app.close(); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
