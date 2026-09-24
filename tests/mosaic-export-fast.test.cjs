const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectMedia, run, ffmpeg } = require('../electron/media.cjs');
const { buildExport } = require('../electron/export.cjs');
const { mosaicBounds } = require('../shared/mosaic.mjs');
const { DEFAULT_CHROMA_KEY } = require('../shared/chroma-key.mjs');

let asset;
before(async () => { asset = await inspectMedia(path.resolve('public/demo/01-journey.mp4'), path.resolve('test-results/mosaic-fast-asset-cache')); });
const settings = { width: 1280, height: 720, fps: 30, quality: 'standard', encoder: 'cpu' };
function project(mosaic) {
  const clip = { id: 'clip', assetId: asset.id, trackId: 'video', kind: 'video', name: 'モザイク検証', start: 0, in: 0, duration: 2, speed: 1, scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 0, exposure: 0, contrast: 1, saturation: 1, fadeIn: 0, fadeOut: 0, audioMuted: true, mosaic };
  return { version: 1, id: 'fast-mosaic', name: '高速モザイク', width: 1280, height: 720, fps: 30, assets: [asset], tracks: [{ id: 'video', kind: 'video', name: 'Video' }], markers: [], clips: [clip] };
}
function exportArgs(project, dimensions) {
  return buildExport(project, settings, { [asset.id]: asset.path }, 'unused.mp4', {}, {}, dimensions).args;
}
async function firstFrame(args) {
  const cut = args.indexOf('-map');
  return run(ffmpeg, [...args.slice(0, cut), '-map', '[vfinal]', '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1', '-map', '[afinal]', '-f', 'null', '-']);
}

test('small H.264 mosaic uses a cropped filter; unknown geometry keeps the original filter', () => {
  const p = project({ x: .5, y: .5, width: .3, height: .3, blockSize: .02 });
  const fast = exportArgs(p, { [asset.id]: { width: 960, height: 540, rotation: 0 } });
  const old = exportArgs(p, {});
  assert.match(fast[fast.indexOf('-filter_complex') + 1], /\[mosaicCrop2\]crop=/);
  assert.match(old[old.indexOf('-filter_complex') + 1], /geq=r='if\(/);
  const mismatched = exportArgs(p, { [asset.id]: { width: 960, height: 600, rotation: 0 } });
  assert.doesNotMatch(mismatched[mismatched.indexOf('-filter_complex') + 1], /\[mosaicCrop2\]crop=/);
  const rotated = exportArgs(p, { [asset.id]: { width: 960, height: 540, rotation: 180 } });
  assert.doesNotMatch(rotated[rotated.indexOf('-filter_complex') + 1], /\[mosaicCrop2\]crop=/);
  const keyed = project(p.clips[0].mosaic);
  keyed.clips[0].chromaKey = { ...DEFAULT_CHROMA_KEY };
  const transparent = exportArgs(keyed, { [asset.id]: { width: 960, height: 540, rotation: 0 } });
  assert.doesNotMatch(transparent[transparent.indexOf('-filter_complex') + 1], /\[mosaicCrop2\]crop=/);
});

test('cropped mosaic keeps block samples and region boundaries on real H.264 frames', async () => {
  for (const mosaic of [
    { x: .5, y: .5, width: .3, height: .3, blockSize: .02 },
    { x: .85, y: .5, width: .3, height: .3, blockSize: .025 },
    { x: .9, y: .9, width: .2, height: .2, blockSize: .04 },
    { x: .5, y: .5, width: .01, height: .01, blockSize: .005 },
  ]) {
    const p = project(mosaic), baseline = await firstFrame(exportArgs(p, {}));
    const optimized = await firstFrame(exportArgs(p, { [asset.id]: { width: 960, height: 540, rotation: 0 } }));
    assert.equal(baseline.length, settings.width * settings.height * 4);
    assert.equal(optimized.length, baseline.length);
    const { left, top, right, bottom } = mosaicBounds(mosaic, settings.width, settings.height);
    let inside = 0, outside = 0, outsideMax = 0;
    for (let pixel = 0; pixel < settings.width * settings.height; pixel++) {
      const x = pixel % settings.width, y = Math.floor(pixel / settings.width);
      for (let channel = 0; channel < 4; channel++) {
        const difference = Math.abs(baseline[pixel * 4 + channel] - optimized[pixel * 4 + channel]);
        if (!difference) continue;
        if (x >= left && x < right && y >= top && y < bottom) inside++;
        else {
          outside++;
          outsideMax = Math.max(outsideMax, difference);
          // The legacy full-frame geq sampler slightly changes the rightmost
          // image edge even though it is outside the selected rectangle.
          assert.ok(x >= settings.width - 2, `unexpected change outside mosaic at ${x},${y}`);
        }
      }
    }
    assert.equal(inside, 0, `mosaic changed inside ${JSON.stringify(mosaic)}`);
    assert.ok(outsideMax <= 8, `outside mosaic differed by ${outsideMax}`);
    assert.ok(outside < settings.height * 4, 'outside difference is limited to the old image-edge sampling');
  }
});
