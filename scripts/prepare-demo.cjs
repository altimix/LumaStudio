const fs = require('node:fs/promises');
const path = require('node:path');
const { ffmpeg, run } = require('../electron/media.cjs');
const dir = path.join(__dirname, '..', 'public', 'demo');
async function main() {
  await fs.mkdir(dir, { recursive: true });
  const source = path.join(dir, 'sintel-source.mp4');
  try { await fs.access(source); } catch {
    const r = await fetch('https://media.w3.org/2010/05/sintel/trailer.mp4');
    if (!r.ok) throw new Error(`Demo download: ${r.status}`);
    await fs.writeFile(source, Buffer.from(await r.arrayBuffer()));
  }
  const clips = [{ name: '01-journey', start: 12 }, { name: '02-encounter', start: 24 }, { name: '03-beyond', start: 37 }];
  for (const clip of clips) {
    const target = path.join(dir, clip.name + '.mp4');
    try { await fs.access(target); } catch {
      await run(ffmpeg, ['-y', '-ss', String(clip.start), '-i', source, '-t', '8', '-vf', 'scale=960:-2', '-c:v', 'libx264', '-crf', '21', '-preset', 'fast', '-c:a', 'aac', '-movflags', '+faststart', target]);
    }
    await run(ffmpeg, ['-y', '-ss', '1', '-i', target, '-frames:v', '1', '-vf', 'scale=480:-2', path.join(dir, clip.name + '.jpg')]);
  }
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'aevalsrc=0.055*sin(2*PI*130.81*t)+0.035*sin(2*PI*196*t)+0.025*sin(2*PI*261.63*t):s=48000:d=24', '-af', 'aecho=0.8:0.5:220|440:0.25|0.15,afade=t=in:d=2,afade=t=out:st=21:d=3', '-t', '24', '-ac', '2', '-c:a', 'pcm_s16le', path.join(dir, '04-atmosphere.wav')]);
  const { inspectMedia } = require('../electron/media.cjs');
  const assets = [];
  for (const name of [...clips.map(c => c.name + '.mp4'), '04-atmosphere.wav']) {
    const a = await inspectMedia(path.join(dir, name), path.join(__dirname, '..', '.local', 'demo-cache'));
    const { playbackPath, thumbnailPath, ...portable } = a;
    assets.push({ ...portable, path: name, url: './demo/' + name, thumbnail: a.kind === 'video' ? './demo/' + name.replace('.mp4', '.jpg') : '' });
  }
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(assets));
  // Only the trimmed, attributed demonstration clips are distributed.
  await fs.rm(source, { force: true });
  console.log('Demo ready:', assets.map(a => `${a.name} (${a.duration.toFixed(1)}s)`).join(', '));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
