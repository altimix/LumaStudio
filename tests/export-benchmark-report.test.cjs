const { test } = require('node:test');
const assert = require('node:assert/strict');
const { median, summarize, compareReports } = require('../scripts/export-benchmark-report.cjs');
const { projects, definitionHash } = require('../scripts/benchmark-export-suite.cjs');

const report = (seconds, videoHash = 'video') => ({
  schema: 3, platform: 'darwin', arch: 'arm64', osRelease: 'test',
  cpuModel: 'test CPU', logicalCpus: 10, nodeVersion: 'v22', ffmpegVersion: 'ffmpeg test',
  ffmpegSha256: 'ffmpeg', ffprobeSha256: 'ffprobe', benchmarkScriptSha256: 'script',
  sourceSha256: 'source', iterations: 3,
  settings: { width: 960, height: 540, fps: 24, encoder: 'cpu' },
  scenarios: [{ name: 'plain', definitionHash: 'same-workload', frames: 48, duration: 2, videoHash, audioHash: 'audio',
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
  assert.throws(() => compareReports(report([2]), { ...report([1]), logicalCpus:8 }), /比較条件/);
  assert.throws(() => compareReports(report([2]), { ...report([1]), ffmpegSha256:'other-build' }), /比較条件/);
  assert.throws(() => compareReports(report([2]), { ...report([1]), ffprobeSha256:'other-probe' }), /比較条件/);
  assert.throws(() => compareReports(report([2]), { ...report([1]), iterations:5 }), /比較条件/);
  assert.throws(() => compareReports(report([2]), { ...report([1]), benchmarkScriptSha256:'other-script' }), /比較条件/);
  const changedWorkload = report([1]); changedWorkload.scenarios[0].definitionHash = 'other-workload';
  assert.throws(() => compareReports(report([2]), changedWorkload), /比較条件/);
});

test('workload identity ignores imported asset IDs but detects changed cuts', () => {
  const first = projects({ id:'first-import' }).continuousCuts;
  const second = projects({ id:'second-import' }).continuousCuts;
  assert.equal(definitionHash(first), definitionHash(second));
  second.clips.pop();
  assert.notEqual(definitionHash(first), definitionHash(second));
});
