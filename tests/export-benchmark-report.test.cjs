const { test } = require('node:test');
const assert = require('node:assert/strict');
const { median, summarize, compareReports } = require('../scripts/export-benchmark-report.cjs');

const report = (seconds, videoHash = 'video') => ({
  schema: 1, platform: 'darwin', arch: 'arm64', osRelease: 'test',
  cpuModel: 'test CPU', ffmpegVersion: 'ffmpeg test', sourceSha256: 'source',
  settings: { width: 960, height: 540, fps: 24, encoder: 'cpu' },
  scenarios: [{ name: 'plain', frames: 48, duration: 2, videoHash, audioHash: 'audio',
    samples: seconds.map(totalSeconds => ({ totalSeconds, ffmpegSeconds: totalSeconds / 2 })) }],
});

test('median and spread describe repeated total export time', () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.deepEqual(summarize([1, 2, 3].map(totalSeconds => ({ totalSeconds, ffmpegSeconds: totalSeconds / 2 }))), {
    medianSeconds: 2, minSeconds: 1, maxSeconds: 3,
    medianAbsoluteDeviationSeconds: 1, medianFfmpegSeconds: 1,
  });
  assert.throws(() => median([]), /計測値/);
});

test('comparison checks source and machine before reporting a speed change', () => {
  const faster = compareReports(report([2, 3, 4]), report([1, 1.5, 2]));
  assert.equal(faster[0].changePercent, -50);
  assert.equal(faster[0].qualityMatch, true);
  const changed = compareReports(report([2, 3, 4]), report([1, 1.5, 2], 'changed'));
  assert.equal(changed[0].sameVideo, false);
  assert.equal(changed[0].qualityMatch, false);
  assert.throws(() => compareReports(report([2]), { ...report([1]), sourceSha256:'other' }), /比較条件/);
  assert.throws(() => compareReports(report([2]), { ...report([1]), cpuModel:'other' }), /比較条件/);
});
