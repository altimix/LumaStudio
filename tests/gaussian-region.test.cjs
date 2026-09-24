const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const { exportProject, buildExport } = require('../electron/export.cjs');
const { gaussianRegionFilters } = require('../electron/gaussian-region.cjs');
const { ffmpegGaussianBlend } = require('../shared/gaussian-blur.mjs');

async function rgba(graph, input) {
  return run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=0.1',
    '-f', 'lavfi', '-i', input,
    '-filter_complex', graph, '-map', '[out]', '-frames:v', '1',
    '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']);
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let folder, asset;
before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-gaussian-region-'));
  const source = path.join(folder, '変化する映像.mp4');
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    'testsrc2=size=640x360:rate=24:duration=0.5', '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p', source]);
  asset = await inspectMedia(source, path.join(folder, 'cache'));
});
after(async () => { if (folder) await fs.rm(folder, { recursive: true, force: true }); });

function project(gaussianBlur, codec = 'h264') {
  const input = { ...asset, codec };
  const clip = { id:'clip', assetId:input.id, trackId:'video', kind:'video', name:'clip',
    start:0, in:0, duration:.5, speed:1, scale:1, x:0, y:0, rotation:0,
    opacity:1, volume:0, exposure:0, contrast:1, saturation:1,
    fadeIn:0, fadeOut:0, audioMuted:true, gaussianBlur };
  return { version:1, id:'gaussian-region', name:'ガウスぼかしの画素比較', width:640,
    height:360, fps:24, assets:[input], tracks:[{id:'video',kind:'video',name:'映像'}],
    markers:[], clips:[clip] };
}
const settings = { width:640, height:360, fps:24, quality:'draft', encoder:'cpu' };

test('real H.264 export matches the original complete-frame blend at every pixel', async () => {
  for (const [index, gaussianBlur] of [
    { x:.5, y:.5, width:.3, height:.3, sigma:.01 },
    { x:.3, y:.38, width:.2, height:.3, sigma:.03 },
    { x:.72, y:.7, width:.28, height:.24, sigma:.001 },
  ].entries()) {
    const fast = project(gaussianBlur), old = project(gaussianBlur, 'other');
    const built = buildExport(fast, settings, { [asset.id]:asset.path }, path.join(folder, 'graph.mp4'));
    assert.match(built.args[built.args.indexOf('-filter_complex')+1], /hstack=inputs=3/);
    const fastFile = path.join(folder, `fast-${index}.mp4`), oldFile = path.join(folder, `old-${index}.mp4`);
    await exportProject(old, settings, oldFile);
    await exportProject(fast, settings, fastFile);
    const pixels = file => run(ffmpeg, ['-v','error','-i',file,'-map','0:v:0','-pix_fmt','rgba','-f','rawvideo','pipe:1']);
    const original = await pixels(oldFile), result = await pixels(fastFile);
    assert.equal(result.length, 12 * 640 * 360 * 4);
    assert.equal(hash(result), hash(original), JSON.stringify(gaussianBlur));
  }
});

test('opaque region assembly exactly matches the full-frame Gaussian blend', async () => {
  const input = 'testsrc2=size=640x360:rate=30:duration=0.1';
  for (const gaussianBlur of [
    { x: .5, y: .5, width: .3, height: .3, sigma: .01 },
    { x: .3, y: .38, width: .2, height: .3, sigma: .03 },
    { x: .72, y: .7, width: .28, height: .24, sigma: .001 },
  ]) {
    const clip = { gaussianBlur }, sigma = Math.max(.5, 640 * gaussianBlur.sigma);
    const region = gaussianRegionFilters(clip, 2, sigma, 640, 360, true);
    assert.ok(region, 'interior effect should use region assembly');
    const prefix = '[0:v]format=rgba[base];[1:v]setpts=PTS-STARTPTS,fps=30,' +
      'tpad=stop_mode=clone:stop_duration=0.033333,trim=duration=0.1,setpts=PTS-STARTPTS,' +
      'scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=rgba[preblur2]';
    const oldGraph = `${prefix};[preblur2]format=yuva420p[reference];[reference]split=2[blurbase2][blurinput2];` +
      `[blurinput2]gblur=sigma=${sigma}[blurred2];` +
      `[blurbase2][blurred2]${ffmpegGaussianBlend(clip)}[postblur2]`;
    const newGraph = `${prefix};${region.join(';')}`;
    const composite = ";[postblur2]settb=AVTB,setpts=PTS-STARTPTS[clip];" +
      "[clip]settb=1/30,setpts=PTS[shifted];" +
      "[base][shifted]overlay=x=0:y=0:format=auto:shortest=1[composite];" +
      "[composite]format=yuv420p[out]";
    const oldFrame = await rgba(oldGraph + composite, input), newFrame = await rgba(newGraph + composite, input);
    assert.equal(newFrame.length, oldFrame.length);
    let differences = 0, max = 0, first = null;
    for (let i = 0; i < oldFrame.length; i++) if (oldFrame[i] !== newFrame[i]) {
      differences++; max = Math.max(max, Math.abs(oldFrame[i] - newFrame[i]));
      first ??= { x: Math.floor(i / 4) % 640, y: Math.floor(i / 4 / 640), channel: i % 4,
        original: oldFrame[i], actual: newFrame[i] };
    }
    assert.equal(hash(newFrame), hash(oldFrame), JSON.stringify({ gaussianBlur, differences, max, first }));
  }
});

test('border and very small regions retain the full-frame blend', () => {
  for (const gaussianBlur of [
    { x: .5, y: .5, width: 1, height: 1, sigma: .02 },
    { x: .1, y: .5, width: .2, height: .3, sigma: .02 },
    { x: .5, y: .5, width: .01, height: .01, sigma: .02 },
  ]) assert.equal(gaussianRegionFilters({ gaussianBlur }, 2, 6, 64, 64, true), null);
  assert.equal(gaussianRegionFilters({ gaussianBlur: { x:.5,y:.5,width:.3,height:.3,sigma:.01 } }, 2, 6, 640, 360, false), null);
});

test('nonopaque and aspect-mismatched sources keep the original filter', () => {
  const blur = { x:.5, y:.5, width:.3, height:.3, sigma:.01 };
  const graph = (p, decoded = {}) => {
    const {args} = buildExport(p, settings, { [asset.id]:asset.path }, path.join(folder, 'fallback.mp4'), {}, {}, decoded);
    return args[args.indexOf('-filter_complex')+1];
  };
  assert.ok(!graph(project(blur, 'other')).includes('hstack=inputs=3'));
  const keyed = project(blur);
  keyed.clips[0].chromaKey = { color:'#00ff00', tolerance:.1, softness:.1,
    greenSpill:0, blueSpill:0, matte:false };
  assert.ok(!graph(keyed).includes('hstack=inputs=3'));
  const letterboxed = project(blur);
  letterboxed.assets[0] = { ...letterboxed.assets[0], width:800 };
  assert.ok(!graph(letterboxed).includes('hstack=inputs=3'));
  assert.ok(!graph(project(blur), { [asset.id]:{width:640,height:360,squarePixels:false} }).includes('hstack=inputs=3'));
  assert.ok(!graph(project(blur), { [asset.id]:{width:640,height:360,squarePixels:true,eightBit:false} }).includes('hstack=inputs=3'));
  assert.ok(!graph(project({ x:.5, y:.5, width:1, height:1, sigma:.01 })).includes('hstack=inputs=3'));
});
