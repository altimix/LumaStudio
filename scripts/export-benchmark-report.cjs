function median(values) {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('計測値が不正です。');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(samples) {
  const totals = samples.map(sample => sample.totalSeconds);
  const center = median(totals);
  return {
    medianSeconds: center,
    minSeconds: Math.min(...totals),
    maxSeconds: Math.max(...totals),
    medianAbsoluteDeviationSeconds: median(totals.map(value => Math.abs(value - center))),
    medianFfmpegSeconds: median(samples.map(sample => sample.ffmpegSeconds)),
  };
}

function compareReports(baseline, candidate) {
  const key = report => JSON.stringify({
    schema: report.schema, platform: report.platform, arch: report.arch,
    osRelease: report.osRelease, cpuModel: report.cpuModel, logicalCpus: report.logicalCpus,
    nodeVersion: report.nodeVersion, ffmpegVersion: report.ffmpegVersion,
    ffmpegSha256: report.ffmpegSha256, ffprobeSha256: report.ffprobeSha256,
    benchmarkScriptSha256: report.benchmarkScriptSha256,
    sourceSha256: report.sourceSha256, settings: report.settings, iterations: report.iterations,
    scenarios: report.scenarios.map(item => `${item.name}:${item.definitionHash}`).sort(),
  });
  if (baseline?.schema !== 3 || key(baseline) !== key(candidate)) throw new Error('比較条件が異なります。OS・CPU・FFmpeg・素材・設定・測定回数・ケースを揃えてください。');
  const candidateByName = new Map(candidate.scenarios.map(item => [item.name, item]));
  return baseline.scenarios.map(original => {
    const next = candidateByName.get(original.name);
    if (!original.samples.length || !next.samples.length) throw new Error(`計測値がありません: ${original.name}`);
    const sameVideo = original.videoHash === next.videoHash && original.frames === next.frames;
    const sameAudio = original.audioHash === next.audioHash;
    const sameDuration = Math.abs(original.duration - next.duration) <= .001;
    const oldTime = summarize(original.samples), newTime = summarize(next.samples);
    return {
      name: original.name,
      baseline: oldTime,
      candidate: newTime,
      changePercent: Math.round((newTime.medianSeconds / oldTime.medianSeconds - 1) * 1000) / 10,
      sameVideo, sameAudio, sameDuration,
      qualityMatch: sameVideo && sameAudio && sameDuration,
    };
  });
}

module.exports = { median, summarize, compareReports };
