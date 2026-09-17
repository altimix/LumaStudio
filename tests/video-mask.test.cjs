const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_VIDEO_MASK, ffmpegMaskExpression, hasVideoMask, maskAlphaAt, validateVideoMask } = require('../shared/video-mask.mjs');

const clip = patch => ({ kind: 'video', ...patch });
test('validates backward-compatible crop and shape mask metadata', () => {
  assert.doesNotThrow(() => validateVideoMask(clip({})));
  assert.doesNotThrow(() => validateVideoMask(clip({ crop: { top: .1, right: .2, bottom: .3, left: .1 }, videoMask: { ...DEFAULT_VIDEO_MASK } })));
  for (const crop of [null, { top: 0, right: 0, bottom: 0, left: NaN }, { top: 0, right: .5, bottom: 0, left: .5 }]) assert.throws(() => validateVideoMask(clip({ crop })), /クロップ/);
  for (const videoMask of [null, { ...DEFAULT_VIDEO_MASK, type: 'path' }, { ...DEFAULT_VIDEO_MASK, width: 0 }, { ...DEFAULT_VIDEO_MASK, inverted: 'yes' }]) assert.throws(() => validateVideoMask(clip({ videoMask })), /マスク/);
  assert.throws(() => validateVideoMask({ kind: 'audio', crop: { top: 0, right: 0, bottom: 0, left: 0 } }), /クロップ/);
});

test('calculates rectangle, ellipse, feather, inversion and crop alpha', () => {
  assert.equal(maskAlphaAt(clip({}), .1, .1), 1);
  const cropped = clip({ crop: { top: .1, right: .2, bottom: .3, left: .1 } });
  assert.equal(maskAlphaAt(cropped, .05, .5), 0); assert.equal(maskAlphaAt(cropped, .5, .5), 1);
  const rectangle = clip({ videoMask: { ...DEFAULT_VIDEO_MASK, width: .4, height: .6 } });
  assert.equal(maskAlphaAt(rectangle, .5, .5), 1); assert.equal(maskAlphaAt(rectangle, .1, .5), 0);
  const ellipse = clip({ videoMask: { ...DEFAULT_VIDEO_MASK, type: 'ellipse', width: .4, height: .4 } });
  assert.equal(maskAlphaAt(ellipse, .5, .5), 1); assert.equal(maskAlphaAt(ellipse, .65, .65), 0);
  const feather = clip({ videoMask: { ...DEFAULT_VIDEO_MASK, width: .4, height: .4, feather: .5 } });
  assert.ok(Math.abs(maskAlphaAt(feather, .65, .5) - .5) < 1e-8);
  assert.ok(Math.abs(maskAlphaAt(clip({ videoMask: { ...feather.videoMask, inverted: true } }), .65, .5) - .5) < 1e-8);
});

test('builds bounded FFmpeg expressions only when an effect is active', () => {
  assert.equal(hasVideoMask(clip({})), false); assert.equal(ffmpegMaskExpression(clip({})), '1');
  const effect = clip({ crop: { top: .1, right: 0, bottom: 0, left: .2 }, videoMask: { ...DEFAULT_VIDEO_MASK, type: 'ellipse', feather: .2, inverted: true } });
  assert.equal(hasVideoMask(effect), true);
  assert.match(ffmpegMaskExpression(effect), /between/); assert.match(ffmpegMaskExpression(effect), /sqrt/); assert.match(ffmpegMaskExpression(effect), /clip/);
  assert.doesNotMatch(ffmpegMaskExpression(effect), /NaN|Infinity/);
});
