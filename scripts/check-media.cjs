const { execFileSync } = require('node:child_process');
const { ffmpeg, ffprobe } = require('../electron/media-binaries.cjs');
for (const binary of [ffmpeg, ffprobe]) {
  const version = execFileSync(binary, ['-version'], { encoding: 'utf8' });
  if (version.includes('--enable-nonfree') || !version.includes('--enable-gpl')) throw new Error('Unexpected media binary license configuration');
}
console.log('FFmpeg / FFprobe: GPL build, no nonfree components.');

if (process.argv.includes('--hardware')) {
  const encoders = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  const required = process.platform === 'darwin' ? ['h264_videotoolbox'] : ['h264_nvenc', 'h264_qsv', 'h264_amf'];
  for (const encoder of required) if (!encoders.includes(encoder)) throw new Error('Missing hardware encoder: ' + encoder);
  console.log('Compiled hardware encoders:', required.join(', '));
}
