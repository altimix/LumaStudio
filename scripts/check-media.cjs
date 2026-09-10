const { execFileSync } = require('node:child_process');
const { ffmpeg, ffprobe } = require('../electron/media-binaries.cjs');
for (const binary of [ffmpeg, ffprobe]) {
  const version = execFileSync(binary, ['-version'], { encoding: 'utf8' });
  if (version.includes('--enable-nonfree') || !version.includes('--enable-gpl')) throw new Error('Unexpected media binary license configuration');
}
console.log('FFmpeg / FFprobe: GPL build, no nonfree components.');
