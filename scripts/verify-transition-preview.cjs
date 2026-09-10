const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const { exportProject } = require('../electron/export.cjs');

module.exports = async function ({ app, page, file, baseline, results, profile, checks }) {
  await fs.rm(path.join(results, 'transition-preview-performance.json'), { force: true });
  let revision = 0;
  const open = async project => {
    const name = `つなぎ目の描画 ${++revision}`;
    await fs.writeFile(file, JSON.stringify({ ...project, id: name, name }));
    await page.keyboard.press('Control+o');
    await page.getByRole('button', { name, exact: true }).waitFor();
  };
  const seek = async time => {
    const zoom = Number(await page.getByRole('slider', { name: 'タイムラインのズーム', exact: true }).inputValue());
    await page.locator('.timeline-ruler').click({ position: { x: time * zoom, y: 25 } });
    await page.waitForFunction(time => {
      const c = document.querySelector('.canvas-wrap canvas');
      return Math.abs(Number(c.dataset.previewTime) - time) < .001 && c.dataset.transitionsReady === 'true';
    }, time);
  };
  const image = async name => {
    const target = path.join(results, name);
    await fs.writeFile(target, Buffer.from(await page.locator('.canvas-wrap canvas').evaluate(c => c.toDataURL('image/png').split(',')[1]), 'base64'));
    return target;
  };
  const base = baseline.clips[0], track = baseline.tracks.find(t => t.id === base.trackId);
  const fixture = (assets, kind, width, height, duration = 4) => ({
    ...baseline, width, height, fps: 30, assets, markers: [], tracks: [{ ...track, hidden: false, locked: false }],
    clips: assets.map((asset, i) => ({ ...base, id: 'smooth-' + i, assetId: asset.id, kind: asset.kind, start: i * duration, duration, in: 0, speed: 1, volume: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, exposure: 0, contrast: 1, saturation: 1, fadeIn: 0, fadeOut: 0 })),
    transitions: [{ id: `smooth-${revision}-${kind}`, fromId: 'smooth-0', toId: 'smooth-1', mode: 'fixed', duration: 2, video: kind }]
  });
  await page.getByLabel('プレビュー画質', { exact: true }).selectOption('1');
  await page.evaluate(() => {
    const get = HTMLCanvasElement.prototype.getContext, post = Worker.prototype.postMessage, raf = window.requestAnimationFrame.bind(window);
    const draw = WebGL2RenderingContext.prototype.drawArrays, isLost = WebGL2RenderingContext.prototype.isContextLost, parameter = WebGL2RenderingContext.prototype.getParameter;
    globalThis.__transitionProbe = { contexts: [], workers: [], frames: [], prewarmed: false, active: false, noGpu: false, direction: 1 };
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      const probe = globalThis.__transitionProbe;
      if (kind === 'webgl2' && probe.noGpu) return null;
      const context = get.call(this, kind, ...args);
      if (kind === 'webgl2' && context && !probe.contexts.includes(context)) probe.contexts.push(context);
      return context;
    };
    // Also observe contexts created before this helper and reused by the pool.
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      const contexts = globalThis.__transitionProbe.contexts;
      const previous = contexts.indexOf(this); if (previous >= 0) contexts.splice(previous, 1);
      contexts.push(this); return draw.apply(this, args);
    };
    WebGL2RenderingContext.prototype.isContextLost = function () {
      return globalThis.__transitionProbe.noGpu || isLost.call(this);
    };
    WebGL2RenderingContext.prototype.getParameter = function (name) {
      return globalThis.__transitionProbe.smallGpu && name === this.MAX_TEXTURE_SIZE ? 512 : parameter.call(this, name);
    };
    Worker.prototype.postMessage = function (...args) {
      if (args[0]?.kind === 'pagePeel') globalThis.__transitionProbe.workers.push({ width: args[0].width, height: args[0].height });
      return post.apply(this, args);
    };
    window.requestAnimationFrame = callback => raf(now => {
      const c = document.querySelector('.canvas-wrap canvas'), before = c?.dataset.previewTime, start = performance.now();
      callback(now);
      const elapsed = performance.now() - start, probe = globalThis.__transitionProbe;
      if (!probe.active || !c || c.dataset.previewTime === before) return;
      const time = Number(c.dataset.previewTime), incoming = document.querySelector(`video[data-clip-id="smooth-${probe.direction > 0 ? 1 : 0}"]`);
      const near = probe.direction > 0 ? time >= 2.6 && time < 3 : time > 5 && time <= 5.4;
      if (near && incoming?.readyState >= 2 && !incoming.seeking) probe.prewarmed = true;
      if (time >= 3 && time < 5) probe.frames.push({ time, wall: now, elapsed, ready: c.dataset.transitionsReady === 'true', visible: c.dataset.transitionsPresented === 'true', backend: c.dataset.transitionBackend,
        videos: [...document.querySelectorAll('.media-elements video')].map(v => ({ id: v.dataset.clipId, time: v.currentTime, seeking: v.seeking, ready: v.readyState, paused: v.paused })) });
    });
    globalThis.__restoreTransitionProbe = () => { HTMLCanvasElement.prototype.getContext = get; WebGL2RenderingContext.prototype.drawArrays = draw; WebGL2RenderingContext.prototype.isContextLost = isLost; WebGL2RenderingContext.prototype.getParameter = parameter; Worker.prototype.postMessage = post; window.requestAnimationFrame = raf; };
  });
  const parity = {}, playback = [];
  let latencyRecovery;
  let gpuAvailable = false;
  try {
    const patterns = [];
    for (let i = 0; i < 2; i++) {
      const target = path.join(profile, `pattern-${i}.png`);
      await run(ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc=size=320x180:rate=1:duration=1','-vf',i ? 'hflip,hue=h=110' : 'null','-frames:v','1',target]);
      patterns.push(await inspectMedia(target, path.join(profile, 'cache')));
    }
    for (const kind of ['dissolve','pageTurn','pagePeel']) {
      const project = fixture(patterns, kind, 320, 180);
      project.clips[0] = { ...project.clips[0], scale: .85, x: -4, opacity: .75 };
      project.clips[1] = { ...project.clips[1], scale: .8, x: 6, opacity: .65 };
      await open(project); await seek(4.3);
      const png = await image(`${kind}-pattern-preview.png`), output = path.join(results, `${kind}-pattern-reference.mp4`);
      await exportProject(project, { width: 320, height: 180, fps: 30, quality: 'high', encoder: 'cpu' }, output);
      const actual = await run(ffmpeg, ['-v','error','-i',png,'-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
      const expected = await run(ffmpeg, ['-v','error','-ss','4.3','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
      assert.equal(actual.length, expected.length); let error = 0;
      for (let i = 0; i < actual.length; i++) error += Math.abs(actual[i] - expected[i]);
      parity[kind] = error / actual.length; assert.ok(parity[kind] < 6, `${kind} oriented, translucent pattern: ${parity[kind]}`);
      const backend = await page.locator('.canvas-wrap canvas').getAttribute('data-transition-backend');
      if (backend === 'gpu') gpuAvailable = true;
      if (kind === 'dissolve') assert.equal(backend, 'canvas');
      else assert.ok(['gpu','worker'].includes(backend));
    }
    checks.push('patterned, transformed translucent layers match FFmpeg for canvas dissolve and GPU page effects');

    const videos = [];
    for (let i = 0; i < 2; i++) {
      const target = path.join(profile, `full-hd-${i}.mp4`);
      await run(ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30:duration=4','-vf',i ? 'hflip,hue=h=100' : 'null','-an','-c:v','libx264','-preset','ultrafast','-crf','22','-pix_fmt','yuv420p',target]);
      videos.push(await inspectMedia(target, path.join(profile, 'cache')));
    }
    const percentile = (values, q) => [...values].sort((a,b) => a-b)[Math.min(values.length - 1, Math.floor(values.length * q))];
    const scenarios = ['0.5','0.25'].flatMap(quality => ['dissolve','pageTurn','pagePeel'].map(kind => ({ quality, kind, direction: 1 })));
    scenarios.push({ quality: '0.5', kind: 'pagePeel', direction: -1 });
    scenarios.push({ quality: '0.5', kind: 'pagePeel', direction: -1, delayed: true });
    for (const { quality, kind, direction, delayed } of scenarios) {
      if (delayed) await page.evaluate(() => {
        const prototype = HTMLMediaElement.prototype, until = new WeakMap();
        const time = Object.getOwnPropertyDescriptor(prototype, 'currentTime'), ready = Object.getOwnPropertyDescriptor(prototype, 'readyState'), seeking = Object.getOwnPropertyDescriptor(prototype, 'seeking');
        Object.defineProperty(prototype, 'currentTime', { ...time, set(value) {
          if (globalThis.__transitionProbe.active && globalThis.__transitionProbe.direction < 0) until.set(this, performance.now() + (this.dataset.clipId === 'smooth-0' ? value > 3.9 ? 1300 : 400 : 200));
          time.set.call(this, value);
        } });
        Object.defineProperty(prototype, 'readyState', { ...ready, get() { return performance.now() < (until.get(this) || 0) ? 1 : ready.get.call(this); } });
        Object.defineProperty(prototype, 'seeking', { ...seeking, get() { return performance.now() < (until.get(this) || 0) || seeking.get.call(this); } });
        globalThis.__restoreTransitionDelay = () => { Object.defineProperty(prototype, 'currentTime', time); Object.defineProperty(prototype, 'readyState', ready); Object.defineProperty(prototype, 'seeking', seeking); delete globalThis.__restoreTransitionDelay; };
      });
      const background = kind === 'pageTurn' && quality === '0.25';
      await page.getByLabel('プレビュー画質', { exact: true }).selectOption(quality);
      await open(fixture(videos, kind, 1920, 1080));
      await page.getByRole('button', { name: direction > 0 ? '先頭へ (Home)' : '末尾へ (End)', exact: true }).click();
      await page.waitForFunction(time => document.querySelector('.canvas-wrap canvas').dataset.previewTime === time, direction > 0 ? '0' : '8');
      await page.evaluate(direction => { Object.assign(globalThis.__transitionProbe, { frames: [], active: true, prewarmed: false, direction }); }, direction);
      if (background) await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.webContents.backgroundThrottling) throw Error('Playback must not throttle behind another window'); window.hide(); });
      await page.keyboard.press(direction > 0 ? 'l' : 'j');
      await page.waitForFunction(direction => {
        const c = document.querySelector('.canvas-wrap canvas');
        if (direction > 0 ? Number(c.dataset.previewTime) < 5.2 : Number(c.dataset.previewTime) > 2.8) return false;
        document.querySelector('.play-button').click(); globalThis.__transitionProbe.active = false; return true;
      }, direction, { timeout: 30000 });
      const observed = await page.evaluate(() => ({ frames: globalThis.__transitionProbe.frames, prewarmed: globalThis.__transitionProbe.prewarmed }));
      if (background) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
      await fs.writeFile(path.join(results, delayed ? 'transition-latency-samples.json' : 'transition-playback-samples.json'), JSON.stringify({ kind, quality, direction, delayed: !!delayed, ...observed }, null, 2));
      const frames = observed.frames, visible = frames.filter(frame => frame.visible), intervals = frames.slice(1).map((frame,i) => frame.wall - frames[i].wall);
      assert.ok(frames.length >= 6 && visible.length / frames.length >= .7, `${kind} ${quality}: transition remains visible through playback (${visible.length}/${frames.length})`);
      assert.ok(Math.abs(visible.at(-1).time - visible[0].time) > 1.3, 'effect progresses across the join');
      assert.ok(percentile(frames.map(frame => frame.elapsed), .95) < 150, `${kind}: no repeated long renderer stalls`);
      if (kind === 'dissolve') assert.ok(visible.every(frame => frame.backend === 'canvas'));
      const measurement = { kind, direction, background, quality: Number(quality), source: '1920x1080 H.264 30fps moving patterns', frames: frames.length, visibleFrames: visible.length, readyFrames: frames.filter(frame => frame.ready).length, prewarmed: observed.prewarmed,
        observedFps: +(1000 / (intervals.reduce((a,b) => a+b, 0) / intervals.length)).toFixed(1), drawP95Ms: +percentile(frames.map(frame => frame.elapsed), .95).toFixed(2), intervalP95Ms: +percentile(intervals, .95).toFixed(2), backends: [...new Set(frames.map(frame => frame.backend))] };
      if (delayed) {
        latencyRecovery = { ...measurement, passed: true, tailDelayMs: 1300, movingDelayMs: 400, nextClipDelayMs: 200 };
        await page.evaluate(() => globalThis.__restoreTransitionDelay());
        checks.push('reverse playback keeps frozen source edges and retains early frames under 1.3-second tail seeks');
      } else playback.push(measurement);
    }
    // Inject failures after collecting healthy playback timings.
    await page.getByLabel('プレビュー画質', { exact: true }).selectOption('1');
    await open(fixture(patterns, 'pagePeel', 320, 180)); await seek(4.3);
    // Loss of a GPU context while stopped must immediately recover the same frame.
    const lost = await page.evaluate(() => {
      const context = globalThis.__transitionProbe.contexts.at(-1), extension = context?.getExtension('WEBGL_lose_context');
      if (!extension || context.isContextLost()) return false;
      extension.loseContext(); return true;
    });
    if (lost) await page.waitForFunction(() => { const c = document.querySelector('.canvas-wrap canvas'); return c.dataset.transitionBackend === 'worker' && c.dataset.transitionsReady === 'true'; });
    checks.push(lost ? 'GPU context loss while stopped falls back without losing the paused frame' : 'GPU unavailable on this host; worker fallback exercised separately');

    await page.evaluate(() => { globalThis.__transitionProbe.smallGpu = true; });
    await open(fixture(patterns, 'pagePeel', 1920, 1080)); await seek(4.3);
    assert.equal(await page.locator('.canvas-wrap canvas').getAttribute('data-transition-backend'), 'worker');
    await page.getByLabel('プレビュー画質', { exact: true }).selectOption('0.25');
    await page.waitForFunction(required => { const c = document.querySelector('.canvas-wrap canvas'); return c.width === 480 && c.dataset.transitionsReady === 'true' && (!required || c.dataset.transitionBackend === 'gpu'); }, gpuAvailable);
    await page.evaluate(() => { globalThis.__transitionProbe.smallGpu = false; });
    await page.getByLabel('プレビュー画質', { exact: true }).selectOption('1');
    checks.push('GPU texture overflow uses the bounded worker and reducing quality retries the GPU without leaving the paused transition');

    await page.evaluate(() => { globalThis.__transitionProbe.noGpu = true; globalThis.__transitionProbe.workers = []; });
    await open(fixture(patterns, 'pagePeel', 1920, 1080)); await seek(4.3);
    assert.equal(await page.locator('.canvas-wrap canvas').getAttribute('data-transition-backend'), 'worker');
    const workers = await page.evaluate(() => globalThis.__transitionProbe.workers);
    assert.ok(workers.length && workers.every(frame => Math.max(frame.width, frame.height) <= 640));
    await image('pagePeel-fallback-preview.png');
    await page.evaluate(() => { globalThis.__transitionProbe.noGpu = false; });
    checks.push('WebGL unavailable uses a worker bounded to 640 pixels even for a full-HD sequence');

    checks.push('all three effects progress during first continuous full-HD playback at half and quarter quality with measured frame timings');
    await fs.writeFile(path.join(results, 'transition-preview-performance.json'), JSON.stringify({ passed: true, packaged: !!process.env.LUMA_VERIFY_EXE, parity, playback, latencyRecovery, contextLossTested: lost, textureLimitTested: true, textureRecoveryTested: gpuAvailable }, null, 2));
  } finally {
    await page.evaluate(() => { globalThis.__transitionProbe.active = false; globalThis.__restoreTransitionDelay?.(); globalThis.__restoreTransitionProbe(); });
  }
};
