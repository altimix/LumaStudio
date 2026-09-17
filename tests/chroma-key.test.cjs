const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyChromaPixel, averageSampleColor, DEFAULT_CHROMA_KEY, ffmpegChromaFilter, parseChromaColor, validateChromaKey } = require('../shared/chroma-key.mjs');

const clip = patch => ({ kind: 'video', ...patch });

test('validates bounded chroma settings only on visual media', () => {
  assert.doesNotThrow(() => validateChromaKey(clip({ chromaKey: { ...DEFAULT_CHROMA_KEY } })));
  assert.doesNotThrow(() => validateChromaKey(clip({})));
  for (const chromaKey of [null, { ...DEFAULT_CHROMA_KEY, color: 'green' }, { ...DEFAULT_CHROMA_KEY, tolerance: .51 }, { ...DEFAULT_CHROMA_KEY, softness: NaN }, { ...DEFAULT_CHROMA_KEY, greenSpill: -1 }, { ...DEFAULT_CHROMA_KEY, matte: 'yes' }]) {
    assert.throws(() => validateChromaKey(clip({ chromaKey })), /クロマキー|色かぶり/);
  }
  assert.throws(() => validateChromaKey({ kind: 'audio', chromaKey: { ...DEFAULT_CHROMA_KEY } }), /映像または画像/);
});

test('averages the raw 5 by 5 sample with source alpha weighting', () => {
  const pixels = new Uint8ClampedArray(25 * 4);
  for (let index = 0; index < 25; index++) pixels.set(index === 12 ? [0, 200, 100, 255] : [0, 100, 50, 128], index * 4);
  const total = 24 * (128 / 255) + 1;
  assert.equal(averageSampleColor(pixels), `#00${Math.round((24 * 100 * (128 / 255) + 200) / total).toString(16).padStart(2, '0')}${Math.round((24 * 50 * (128 / 255) + 100) / total).toString(16).padStart(2, '0')}`);
  assert.throws(() => averageSampleColor(new Uint8ClampedArray(4)), /透明/);
  assert.deepEqual(parseChromaColor('#12aBf0'), [18, 171, 240]);
});

test('keys matching chroma, smooths the boundary, preserves source alpha and suppresses spill', () => {
  const key = { ...DEFAULT_CHROMA_KEY, color: '#00ff00', tolerance: .02, softness: .2, greenSpill: 1, blueSpill: 0 };
  const removed = applyChromaPixel(0, 255, 0, 173, key); assert.equal(removed.alpha, 0); assert.ok(removed.green < 255);
  const foreground = applyChromaPixel(255, 0, 0, 173, key); assert.equal(foreground.alpha, 173); assert.equal(foreground.red, 255);
  const edge = applyChromaPixel(0, 180, 0, 200, key); assert.ok(edge.alpha > 0 && edge.alpha < 200); assert.ok(edge.green < 180);
});

test('builds a bounded FFmpeg filter and never exports the diagnostic matte view', () => {
  const filter = ffmpegChromaFilter(clip({ chromaKey: { ...DEFAULT_CHROMA_KEY, color: '#12abef', matte: true } }));
  assert.match(filter, /^geq=/); assert.match(filter, /alpha\(X,Y\)/); assert.match(filter, /0\.168736/); assert.doesNotMatch(filter, /NaN|Infinity|matte/);
  assert.equal(ffmpegChromaFilter(clip({})), '');
});
