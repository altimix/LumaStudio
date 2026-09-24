const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ffprobe, run, assertMediaRevision } = require('./media.cjs');
const { assertDestination } = require('./persistence.cjs');

const near = (left, right, tolerance = 1e-6) => Number.isFinite(left) && Math.abs(left - right) <= tolerance;
const noKeys = value => !value?.length;
const ratio = value => {
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  return numerator > 0 && denominator > 0 ? numerator / denominator : NaN;
};

// The first copy route deliberately covers an untouched, full-length movie.
// Audio and video then come from the same MP4, so no timeline processing is lost.
function directCopyClip(project, settings) {
  if (settings.encoder !== 'auto' || settings.target || settings.quality !== 'standard' ||
      ![1, 2].includes(project.clips.length) || project.transitions?.length ||
      project.width !== settings.width || project.height !== settings.height || project.fps !== settings.fps ||
      project.tracks.some(track => track.solo)) return null;
  const clip = project.clips.find(item => item.kind === 'video');
  if (!clip) return null;
  const asset = project.assets.find(item => item.id === clip.assetId);
  const track = project.tracks.find(item => item.id === clip.trackId);
  if (clip.kind !== 'video' || !asset || asset.kind !== 'video' || asset.offline || asset.codec !== 'h264' ||
      !asset.hasAudio || !/^.+\.mp4$/i.test(asset.path) || !track || track.kind !== 'video' || track.hidden || track.muted ||
      !near(clip.start, 0) || !near(clip.in, 0) || !near(clip.duration, asset.duration) ||
      clip.duration > 3600 || clip.speed !== 1 || clip.x !== 0 || clip.y !== 0 || clip.scale !== 1 ||
      clip.rotation !== 0 || clip.opacity !== 1 || clip.exposure !== 0 || clip.contrast !== 1 ||
      clip.saturation !== 1 || clip.volume !== 1 || clip.fadeIn !== 0 || clip.fadeOut !== 0 ||
      clip.audioMuted || clip.audioTreatment || clip.crop || clip.videoMask ||
      clip.chromaKey || clip.mosaic || clip.gaussianBlur || clip.graphic ||
      !noKeys(clip.visualKeyframes) || !noKeys(clip.opacityKeyframes) || !noKeys(clip.volumeKeyframes)) return null;
  if (project.clips.length === 1) {
    if (clip.audioDetached || clip.linkId) return null;
  } else {
    const audio = project.clips.find(item => item.kind === 'audio');
    const audioTrack = project.tracks.find(item => item.id === audio?.trackId);
    if (!audio || !clip.audioDetached || !clip.linkId || audio.linkId !== clip.linkId ||
        audio.assetId !== asset.id || !audioTrack || audioTrack.kind !== 'audio' || audioTrack.muted ||
        !near(audio.start, clip.start) || !near(audio.in, clip.in) ||
        !near(audio.duration, clip.duration) || audio.speed !== 1 ||
        audio.volume !== 1 || audio.fadeIn !== 0 || audio.fadeOut !== 0 ||
        audio.audioMuted || audio.audioTreatment || !noKeys(audio.volumeKeyframes)) return null;
  }
  return { clip, asset };
}

function compatibleStreams(info, settings, duration) {
  if (info.chapters?.length || info.streams?.length !== 2 ||
      !['isom', 'mp41', 'mp42', 'avc1'].includes(info.format?.tags?.major_brand) ||
      !near(Number(info.format?.duration), duration)) return null;
  const video = info.streams.find(stream => stream.codec_type === 'video');
  const audio = info.streams.find(stream => stream.codec_type === 'audio');
  if (!video || !audio || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' ||
      video.width !== settings.width || video.height !== settings.height || video.sample_aspect_ratio !== '1:1' ||
      !near(ratio(video.avg_frame_rate), settings.fps) || !near(ratio(video.r_frame_rate), settings.fps) ||
      !near(Number(video.start_time), 0) || !near(Number(video.duration), duration) ||
      Number(video.nb_frames) !== Math.round(duration * settings.fps) ||
      video.tags?.rotate && !near(Number(video.tags.rotate), 0) ||
      video.side_data_list?.some(item => item.rotation !== undefined && !near(Number(item.rotation), 0)) ||
      audio.codec_name !== 'aac' || Number(audio.sample_rate) !== 48000 ||
      audio.channels !== 2 || audio.channel_layout !== 'stereo' ||
      !near(Number(audio.start_time), 0) ||
      !near(Number(audio.duration), duration, 1024 / 48000 + 1e-6)) return null;
  const timebase = ratio(video.time_base);
  return Number.isFinite(timebase) ? { frames: Number(video.nb_frames), timebase } : null;
}

async function constantFramePackets(source, fps, expected, signal) {
  const output = (await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'packet=pts,duration', '-of', 'csv=p=0', source], { signal })).toString().trim();
  const packets = output ? output.split(/\r?\n/) : [];
  if (packets.length !== expected.frames) return false;
  const starts = [];
  const tolerance = Math.max(expected.timebase / 2 + 1e-8, 1e-6);
  for (const packet of packets) {
    const [pts, duration] = packet.split(',').map(Number);
    if (!Number.isSafeInteger(pts) || !Number.isSafeInteger(duration) ||
        !near(duration * expected.timebase, 1 / fps, tolerance)) return false;
    starts.push(pts * expected.timebase);
  }
  starts.sort((a, b) => a - b);
  return starts.every((start, index) => near(start, index / fps, tolerance));
}

async function directCopySource(project, settings, signal) {
  const candidate = directCopyClip(project, settings);
  if (!candidate) return null;
  signal?.throwIfAborted();
  const { asset, clip } = candidate;
  await assertMediaRevision(asset);
  const info = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_format', '-show_streams',
    '-show_chapters', '-of', 'json', asset.path], { signal })).toString());
  const expected = compatibleStreams(info, settings, clip.duration);
  if (!expected || !await constantFramePackets(asset.path, settings.fps, expected, signal)) return null;
  signal?.throwIfAborted();
  return asset;
}

async function copyUnchangedMovie(asset, output, { signal, onProgress = () => {} } = {}) {
  await assertDestination(output, '.mp4', [asset.path]);
  await assertMediaRevision(asset);
  signal?.throwIfAborted();
  const size = (await fs.stat(asset.path)).size;
  const partial = path.join(path.dirname(output), `.luma-${randomUUID()}.mp4`);
  let lastProgress = -1, lastUpdate = 0;
  const update = progress => {
    const now = Date.now();
    if (progress > 0 && progress < .99 && progress - lastProgress < .01 && now - lastUpdate < 100) return;
    lastProgress = progress; lastUpdate = now;
    onProgress({ status: 'rendering', progress, output,
      encoderLabel: '再圧縮なし（元動画を複製）' });
  };
  try {
    update(0);
    let bytes = 0;
    const input = createReadStream(asset.path, { highWaterMark: 1024 * 1024, signal });
    const progress = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length; update(Math.min(.99, bytes / size)); callback(null, chunk);
    } });
    await pipeline(input, progress, createWriteStream(partial, { flags: 'wx' }), { signal });
    await assertMediaRevision(asset);
    signal?.throwIfAborted();
    if ((await fs.stat(partial)).size !== size) throw new Error('動画の複製が完了しませんでした。');
    await fs.rename(partial, output);
    onProgress({ status: 'complete', progress: 1, output, encoderLabel: '再圧縮なし（元動画を複製）' });
    return output;
  } catch (error) {
    if (signal?.aborted) throw new Error('書き出しをキャンセルしました。');
    throw error;
  } finally {
    await fs.rm(partial, { force: true }).catch(() => {});
  }
}

module.exports = { directCopyClip, compatibleStreams, constantFramePackets, directCopySource, copyUnchangedMovie };
