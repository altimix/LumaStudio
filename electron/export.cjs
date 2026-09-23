const { hasClipAudio, validateClipLinks } = require('../shared/clip-links.mjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { ffmpeg, run, probe } = require('./media.cjs');
const { validateOpacityKeys, opacityExpression } = require('../shared/opacity.mjs');
const { validateVisualKeys, visualClipAt, visualKeys, visualExpression, needsTitleFrames } = require('../shared/visual-keyframes.mjs');
const { animatedColorFilter, animatedChromaFilter, animatedTransformFilter, usesAnimatedMask, usesAnimatedChroma, maskFrame } = require('./visual-animation.cjs');
const { writeFrameSequence } = require('./frame-sequence.cjs');
const { validateVolumeKeys } = require('../shared/volume-automation.mjs');
const { writeFilterScript } = require('./filter-script.cjs');
const { validateYoutube } = require('../shared/youtube.mjs');
const { number, clipAudioFilter, mixAudioFilter } = require('./audio-render.cjs');
const { MAX_MEDIA_SECONDS, MAX_MARKERS } = require('../shared/time.mjs');
const { validateTextStyle } = require('../shared/text-style.mjs');
const { validateTextBox } = require('../shared/text-box.mjs');
const { validateGraphic } = require('../shared/graphics.mjs');
const { validateTreatment } = require('../shared/audio-treatment.mjs');
const { ffmpegMaskExpression, hasBezierMask, hasVideoMask, rasterizeBezierMask, validateVideoMask } = require('../shared/video-mask.mjs');
const { ffmpegChromaFilter, hasChromaKey, validateChromaKey } = require('../shared/chroma-key.mjs');
const { ffmpegMosaicFilter, hasMosaic, mosaicBlurSigma, validateMosaic } = require('../shared/mosaic.mjs');
const { ffmpegRegionBlend, hasGaussianBlur, validateGaussianBlur } = require('../shared/gaussian-blur.mjs');
const { encodingArgs, exportEncoders, validateEncoder, ENCODERS } = require('./encoders.cjs');

const { validateTransitions, transitionPlan, audioEnvelopes, mediaWindow } = require('../shared/transitions.mjs');
const { compositeVisuals } = require('./video-transitions.cjs');
const finite = (x, lo, hi, label) => { if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${label}が範囲外です。`); return x; };
const validId = id => typeof id === 'string' && !!id.trim() && /^[\p{L}\p{N}_ -]+$/u.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
function validateProject(p, { allowForeignPaths = false } = {}) {
  if (!p || p.version !== 1 || !validId(p.id) || typeof p.name !== 'string' || p.name.length > 256 || !Array.isArray(p.assets) || !Array.isArray(p.tracks) || !Array.isArray(p.clips) || !Array.isArray(p.markers)) throw new Error('対応していないプロジェクト形式です。');
  if (p.clips.length > 2000 || p.assets.length > 2000 || p.tracks.length > 24) throw new Error('プロジェクトが大きすぎます。');
  if (p.markers.length > MAX_MARKERS) throw new Error(`マーカーは${MAX_MARKERS}個までです。`);
  finite(p.width, 128, 7680, '幅'); finite(p.height, 128, 4320, '高さ'); finite(p.fps, 1, 120, 'フレームレート');
  if(!Number.isInteger(p.fps)||!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width%2||p.height%2) throw new Error('フレームサイズは偶数、FPSは整数で指定してください。');
  const ids = new Set();
  for (const t of p.tracks) {
    if (!t || !validId(t.id) || !['video', 'audio'].includes(t.kind) || ids.has(t.id)) throw new Error('トラックが不正です。');
    if (t.audioSourceTrackId !== undefined && !validId(t.audioSourceTrackId)) throw new Error('音声トラックの分離元IDが不正です。');
    // Older/minimal projects may omit optional display/flag fields. Missing
    // flags retain their false behavior; explicitly malformed values are errors.
    if (t.name !== undefined && (typeof t.name !== 'string' || t.name.length > 256)) throw new Error('トラック名が不正です。');
    for (const [field, label] of Object.entries({ muted: 'ミュート', hidden: '非表示', locked: 'ロック', solo: 'ソロ', autoName: '自動番号' })) {
      if (t[field] !== undefined && typeof t[field] !== 'boolean') throw new Error(`トラックの${label}は真偽値で指定してください。`);
    }
    ids.add(t.id);
  }
  const assetIds = new Set();
  for (const a of p.assets) {
    if (!a || !validId(a.id) || !/^[A-Za-z0-9_-]+$/.test(a.id)) throw new Error('素材IDが不正です。英数字・ハイフン・アンダースコアを使用してください。');
    if (typeof a.name !== 'string' || a.name.length > 1024 || typeof a.path !== 'string' || !(path.isAbsolute(a.path) || ((allowForeignPaths || a.offline === true) && path.win32.isAbsolute(a.path))) || !['video', 'image', 'audio'].includes(a.kind) || assetIds.has(a.id)) throw new Error('素材が不正です。ローカルファイルの絶対パスが必要です。');
    if (typeof a.hasAudio !== 'boolean' || typeof a.codec !== 'string') throw new Error('素材のメタデータが不正です。');
    if (!Array.isArray(a.waveform) || a.waveform.length > 4096 || a.waveform.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('素材の波形データが不正です。');
    finite(a.width, 0, 65536, '素材の幅'); finite(a.height, 0, 65536, '素材の高さ');
    finite(a.fps, 0, 1000, '素材のFPS'); finite(a.size, 0, Number.MAX_SAFE_INTEGER, '素材のサイズ');
    if (a.previewProxy !== undefined && (typeof a.previewProxy !== 'boolean' || a.kind !== 'video')) throw new Error('プレビュー用プロキシの指定が不正です。');
    assetIds.add(a.id); finite(a.duration, 0.001, MAX_MEDIA_SECONDS, '素材の長さ');
  }
  const clipIds = new Set();
  for (const c of p.clips) {
    if (!c || !validId(c.id) || typeof c.name !== 'string' || c.name.length > 1024 || clipIds.has(c.id) || !ids.has(c.trackId) || !['video', 'audio', 'image', 'title'].includes(c.kind)) throw new Error('クリップが不正です。');
    if (c.kind === 'title' && assetIds.has(c.id)) throw new Error('テロップIDと素材IDが重複しています。');
    clipIds.add(c.id);
    finite(c.start, 0, MAX_MEDIA_SECONDS, '開始時間'); finite(c.duration, 1 / p.fps - 0.000001, MAX_MEDIA_SECONDS, '長さ'); finite(c.in, 0, MAX_MEDIA_SECONDS, '素材の開始時間');
    finite(c.speed, 0.25, 4, '速度'); finite(c.scale, 0.1, 3, '拡大率'); finite(c.x, -200, 200, 'X座標'); finite(c.y, -200, 200, 'Y座標'); finite(c.rotation, -180, 180, '回転');
    finite(c.opacity, 0, 1, '不透明度'); finite(c.volume, 0, 2, '音量'); finite(c.exposure, -2, 2, '露出'); finite(c.contrast, 0, 2, 'コントラスト'); finite(c.saturation, 0, 2, '彩度'); finite(c.fadeIn, 0, c.duration, 'フェードイン'); finite(c.fadeOut, 0, c.duration, 'フェードアウト');
    validateOpacityKeys(c);
    validateVisualKeys(c);
    validateVolumeKeys(c);
    if (c.volumeKeyframes !== undefined && !hasClipAudio(c, p.assets.find(a => a.id === c.assetId))) throw new Error('音声のないクリップには音量ポイントを設定できません。');
    validateGraphic(c);
    validateTextBox(c);
    validateTreatment(c.audioTreatment);
    validateVideoMask(c);
    validateChromaKey(c);
    validateMosaic(c);
    validateGaussianBlur(c);
    if (c.audioTreatment && (!hasClipAudio(c, p.assets.find(a => a.id === c.assetId)))) throw new Error('音声のないクリップには自動調整を適用できません。');
    if (c.subtitle !== undefined && (typeof c.subtitle !== 'boolean' || c.kind !== 'title')) throw new Error('字幕クリップが不正です。');
    if (c.fadeIn + c.fadeOut > c.duration + 0.00001) throw new Error('フェードの合計がクリップの長さを超えています。');
    if (c.kind === 'title') { validateTextStyle(c); if (typeof c.text !== 'string' || c.text.length > 4000 || !/^#[\da-f]{6}$/i.test(c.color)) throw new Error('テロップが不正です。'); finite(c.fontSize, 16, 240, '文字サイズ'); }
    else {
      const a = p.assets.find(a => a.id === c.assetId);
      if (!a || (a.kind !== c.kind && !(c.kind === 'audio' && a.kind === 'video' && a.hasAudio))) throw new Error('素材が見つからないか種類が一致しません。');
      if (a.kind !== 'image' && c.in + c.duration * c.speed > a.duration + 0.06) throw new Error('クリップが素材の長さを超えています。');
    }
  }
  const markerIds = new Set();
  for (const m of p.markers) { if (!m || !validId(m.id) || markerIds.has(m.id) || typeof m.label !== 'string' || m.label.length > 1024) throw new Error('マーカーが不正です。'); markerIds.add(m.id); finite(m.time, 0, MAX_MEDIA_SECONDS, 'マーカー位置'); }
  validateClipLinks(p); validateYoutube(p.youtube); validateTransitions(p);
  return p;
}
function isEncoderFailure(error){
  const message=String(error?.message||'');
  if(/no space left|permission denied|read-only file system|input\/output error|broken pipe|error submitting a packet to the muxer|error writing (?:trailer|packet)/i.test(message))return false;
  // Per-output-stream vost diagnostics can describe muxing or I/O, not the encoder.
  return /\[h264_(?:nvenc|qsv|amf|videotoolbox)[^\]\r\n]*\][^\r\n]*(?:error|fail|cannot|could not|unavailable|unsupported|not support|no capable|no nvenc)/i.test(message);
}
function colorFilter(c) {
  const gain = 2 ** c.exposure; const contrast = c.contrast; const s = c.saturation;
  const lut = `clip((clip(val*${number(gain)},0,255)-127.5)*${number(contrast)}+127.5,0,255)`;
  const matrix = [0.213, 0.715, 0.072].map((w, j) => [0, 1, 2].map(i => (i === j ? s : 0) + w * (1 - s)));
  return `lutrgb=r='${lut}':g='${lut}':b='${lut}',colorchannelmixer=rr=${number(matrix[0][0])}:rg=${number(matrix[1][0])}:rb=${number(matrix[2][0])}:gr=${number(matrix[0][1])}:gg=${number(matrix[1][1])}:gb=${number(matrix[2][1])}:br=${number(matrix[0][2])}:bg=${number(matrix[1][2])}:bb=${number(matrix[2][2])}`;
}
function addRegionBlur(filters, chain, index, effect, sigma, region, prepare = '') {
  const suffix=`${effect}${index}`;
  filters.push(chain.join(',')+`[preblur${suffix}]`);
  filters.push(`[preblur${suffix}]split=2[blurbase${suffix}][blurinput${suffix}]`);
  filters.push(`[blurinput${suffix}]${prepare ? prepare+',' : ''}gblur=sigma=${number(sigma)}[blurred${suffix}]`);
  filters.push(`[blurbase${suffix}][blurred${suffix}]${ffmpegRegionBlend(region)}[postblur${suffix}]`);
  chain.length=0;chain.push(`[postblur${suffix}]null`);
}
function exportAssets(p) {
  const anySolo = p.tracks.some(t => t.solo), ids = new Set();
  for (const c of p.clips) {
    const track = p.tracks.find(t => t.id === c.trackId), asset = p.assets.find(a => a.id === c.assetId);
    if (!track || !asset) continue;
    const visual = c.kind !== 'audio' && !track.hidden;
    const audio = hasClipAudio(c, asset) && !c.audioMuted && !track.muted && (!anySolo || track.solo) && c.volume > 0;
    if (visual || audio) ids.add(asset.id);
  }
  return p.assets.filter(a => ids.has(a.id));
}
function buildExport(p, settings, sourcePaths, output, audioPaths = {}, maskPaths = {}, decodedDimensions = {}) {
  validateProject(p);
  if (settings.target === 'shorts' && p.width * 16 !== p.height * 9) throw new Error('Shortsは縦型9:16のシーケンスで書き出してください。シーケンス設定を確認してください。');
  if (settings.target === 'shorts' && (settings.width !== 1080 || settings.height !== 1920 || Math.max(0, ...p.clips.map(c => c.start + c.duration)) > 180 + 0.000001)) throw new Error('Shortsは1080×1920・3分以内にしてください。タイムラインで必要な範囲に編集してください。');
  const width = finite(settings.width, 128, 7680, '書き出し幅'); const height = finite(settings.height, 128, 4320, '書き出し高さ');
  if (width % 2 || height % 2) throw new Error('書き出しサイズは偶数で指定してください。');
  const fps = finite(settings.fps, 1, 120, '書き出しFPS');
  const authoredDuration = Math.max(0, ...p.clips.map(c => c.start + c.duration));
  if (!authoredDuration) throw new Error('書き出すクリップがありません。');
  // Keep the final partial output frame so short trailing audio is not lost.
  // Ignore only floating-point noise at an already exact frame boundary.
  const duration = Math.max(1,Math.ceil(authoredDuration*fps-1e-7))/fps;
  const args = ['-hide_banner', '-y', '-filter_complex_threads', '2', '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${number(duration)}`, '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${number(duration)}`];
  const visible = p.clips.filter(c => c.kind !== 'audio' && !p.tracks.find(t => t.id === c.trackId)?.hidden);
  const only = visible.length === 1 ? visible[0] : null, onlyAsset = p.assets.find(a => a.id === only?.assetId);
  const directVideo = onlyAsset?.codec === 'h264' && only?.kind === 'video' && only.start === 0 && only.duration === duration && only.scale === 1 && only.x === 0 && only.y === 0 && only.rotation === 0 && only.opacity === 1 && !only.opacityKeyframes?.length && !only.visualKeyframes?.length && !only.fadeIn && !only.fadeOut && only.exposure === 0 && only.contrast === 1 && only.saturation === 1 && !hasVideoMask(only) && !hasChromaKey(only) && !hasMosaic(only) && !hasGaussianBlur(only) && !p.transitions?.length && onlyAsset?.width * height === onlyAsset?.height * width;
  const filters = directVideo ? [] : ['[0:v]format=rgba[base]'];
  let base = 'base'; const audios = ['[1:a]']; let input = 2;
  const envelopes=audioEnvelopes(p), plans=transitionPlan(p), transitionClips=new Set(plans.filter(t=>t.video).flatMap(t=>[t.fromId,t.toId])), visuals=[];
  const anySolo = p.tracks.some(t => t.solo);
  // Bottom track is composited first. Later clips within a track are on top.
  const sorted = [...p.tracks].reverse().flatMap(t => p.clips.filter(c => c.trackId === t.id).sort((a,b) => a.start - b.start));
  for (const rawClip of sorted) {
    const c=visualClipAt(rawClip,0),animated=!!c.visualKeyframes?.length;
    const values=animated?visualKeys(rawClip).map(key=>visualClipAt(rawClip,key.time)):[c];
    const moving=animated&&!c.graphic&&values.some(value=>['x','y','scale','rotation'].some(field=>value[field]!==c[field]));
    const colorChanges=animated&&values.some(value=>['exposure','contrast','saturation'].some(field=>value[field]!==c[field]));
    const track = p.tracks.find(t => t.id === c.trackId);
    const asset = p.assets.find(a => a.id === c.assetId);
    const visual = c.kind !== 'audio' && !track.hidden;
    const audio = hasClipAudio(c,asset) && !c.audioMuted && !track.muted && (!anySolo || track.solo) && c.volume > 0;
    if (!visual && !audio) continue;
    if (asset?.offline) throw new Error(`素材がオフラインです。再リンクしてください: ${asset.name}`);
    const source = sourcePaths[c.kind === 'title' ? c.id : c.assetId];
    if (!source) throw new Error(`素材が見つかりません: ${c.name}`);
    const videoWindow=mediaWindow(c,asset,plans,'video'),audioWindow=mediaWindow(c,asset,plans,'audio');
    const window=visual?videoWindow:audioWindow;
    if (visual) {
      const sequence=typeof source==='object',offset=c.start-videoWindow.start,animatedMask=usesAnimatedMask(rawClip);
      if (!sequence&&(c.kind === 'image' || c.kind === 'title')) args.push('-loop', '1', '-framerate', String(fps));
      else args.push('-ss', number(window.sourceIn));
      args.push('-t', number(window.sourceDuration), '-i', sequence?source.path:source);
      const index = input++;
      let maskIndex;
      if (hasBezierMask(c)||animatedMask) {
        const maskPath = maskPaths[c.id];
        if (!maskPath) throw new Error(`ベジェマスクを準備できませんでした: ${c.name}`);
        if(typeof maskPath==='string')args.push('-loop','1','-framerate',String(fps));
        args.push('-i',typeof maskPath==='string'?maskPath:maskPath.path);
        maskIndex = input++;
      }
      // Keep enough source detail for the largest animated zoom. Transform on
      // this fixed grid, then crop the output viewport without downsampling it.
      const sourceScale = moving && c.kind !== 'title' ? Math.max(1, Math.ceil(Math.max(c.scale, ...values.map(value => value.scale)))) : 1;
      const fitScale = moving ? sourceScale : c.graphic ? 1 : c.scale;
      const fitW = Math.max(2, Math.round(width * fitScale / 2) * 2); const fitH = Math.max(2, Math.round(height * fitScale / 2) * 2);
      const f = [`[${index}:v]setpts=(PTS-STARTPTS)/${number(sequence?1:c.speed)}`, `fps=${fps}:eof_action=pass`];
      f.push(`tpad=start_mode=clone:start_duration=${number(videoWindow.padBefore)}:stop_mode=clone:stop_duration=${number(videoWindow.padAfter+1/fps)}`,`trim=duration=${number(videoWindow.duration)}`,'setpts=PTS-STARTPTS');
      // Match the preview: calculate the key from decoded source pixels before
      // clip scaling can blend background color into fine foreground edges.
      if (usesAnimatedChroma(rawClip)) f.push('format=rgba',animatedChromaFilter(rawClip,offset));
      else if (hasChromaKey(c)) f.push('format=rgba', ffmpegChromaFilter(c));
      f.push(`scale=${fitW}:${fitH}:force_original_aspect_ratio=decrease:force_divisible_by=2`, 'setsar=1', ...(directVideo ? [`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`] : ['format=rgba']));
      const sourceSize=decodedDimensions[c.assetId] || asset;
      const scaledWidth=sourceSize?.width&&sourceSize?.height?Math.max(2,Math.floor(Math.min(fitW/sourceSize.width,fitH/sourceSize.height)*sourceSize.width/2)*2):fitW;
      if (hasGaussianBlur(c)) {
        addRegionBlur(filters,f,index,'gaussian',Math.max(.5,scaledWidth*c.gaussianBlur.sigma),c.gaussianBlur);
      }
      if (hasMosaic(c)) addRegionBlur(filters,f,index,'mosaic',mosaicBlurSigma(c.mosaic,scaledWidth),c.mosaic,ffmpegMosaicFilter(c,true));
      if(c.kind!=='title'&&colorChanges)f.push(animatedColorFilter(rawClip,offset));
      else if (c.kind !== 'title' && (c.exposure !== 0 || c.contrast !== 1 || c.saturation !== 1)) f.push(colorFilter(c));
      if (hasBezierMask(c)||animatedMask) {
        filters.push(f.join(',') + `[premask${index}]`);
        filters.push(`[${maskIndex}:v]format=gray[maskraw${index}]`);
        // In the bundled FFmpeg scale2ref, iw/ih are the dimensions of the
        // second (reference) input. This also follows decoded autorotation,
        // unlike dimensions calculated from container metadata in JavaScript.
        filters.push(`[maskraw${index}][premask${index}]scale2ref=w=iw:h=ih[maskscaled${index}][maskref${index}]`);
        filters.push(`[maskref${index}]split=2[maskcolor${index}][maskalpha${index}]`);
        filters.push(`[maskalpha${index}]alphaextract[originalalpha${index}]`);
        filters.push(`[maskscaled${index}]format=gray[maskgray${index}]`);
        filters.push(`[originalalpha${index}][maskgray${index}]lut2=c0='x*y/255'[combinedalpha${index}]`);
        filters.push(`[maskcolor${index}][combinedalpha${index}]alphamerge[masked${index}]`);
        f.length = 0; f.push(`[masked${index}]null`);
      } else if (hasVideoMask(c)) f.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${ffmpegMaskExpression(c)})'`);
      if(moving){
        f.push(`pad=${width*sourceScale}:${height*sourceScale}:(ow-iw)/2:(oh-ih)/2:color=black@0`,animatedTransformFilter(rawClip,offset,sourceScale));
        if(sourceScale>1)f.push(`crop=${width}:${height}:(iw-ow)/2:(ih-oh)/2`);
      }
      else {
        if (c.rotation&&!c.graphic) { const angle = number(c.rotation * Math.PI / 180); f.push(`rotate=${angle}:ow=rotw(${angle}):oh=roth(${angle}):c=none`); }
        if(animated&&values.some(value=>value.opacity!==c.opacity))f.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${visualExpression(rawClip,'opacity','T',offset)})'`);
        else if (c.opacityKeyframes?.length) f.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${opacityExpression(c.opacityKeyframes)})'`);
        else if (c.opacity !== 1) f.push(`colorchannelmixer=aa=${number(c.opacity)}`);
      }
      if (c.fadeIn) f.push(`fade=t=in:st=${number(c.start-videoWindow.start)}:d=${number(c.fadeIn)}:alpha=1`);
      if (c.fadeOut) f.push(`fade=t=out:st=${number(c.start-videoWindow.start+c.duration - c.fadeOut)}:d=${number(c.fadeOut)}:alpha=1`);
      f.push('settb=AVTB');filters.push(f.join(',')+'[v'+index+']');
      let label='v'+index;
      if(transitionClips.has(c.id)&&!moving){
        filters.push(`color=c=black@0:s=${width}x${height}:r=${fps}:d=${number(videoWindow.duration)},format=rgba[blank${index}]`);
        filters.push(`[blank${index}][v${index}]overlay=x=(W-w)/2+W*${number(c.x/100)}:y=(H-h)/2+H*${number(c.y/100)}:format=auto:shortest=1,format=gbrap,settb=AVTB[layer${index}]`);label='layer'+index;
      }
      visuals.push({clip:{...c,start:videoWindow.start,duration:videoWindow.duration},label,full:moving||transitionClips.has(c.id)});
    }
    if (audio) {
      if (c.audioTreatment&&!audioPaths[c.id]) throw new Error('自動調整した音声を準備できませんでした。');
      // Warm up compressed audio before each cut, matching preview decoding.
      // Keep this input independent of the video seek and discard the pre-roll.
      const sourceTrim=Math.min(1,audioWindow.sourceIn),seek=audioWindow.sourceIn-sourceTrim;
      args.push('-ss', number(seek), '-t', number(audioWindow.sourceDuration+sourceTrim), '-i', c.audioTreatment?audioPaths[c.id]:source);
      const audioIndex=input++;
      filters.push(clipAudioFilter(c, audioIndex, envelopes.get(c.id),audioWindow,sourceTrim)); audios.push(`[a${audioIndex}]`);
    }
  }
  base=directVideo ? visuals[0].label : compositeVisuals(filters,visuals,plans,fps);
  filters.push(`[${base}]format=yuv420p[vfinal]`);
  filters.push(mixAudioFilter(audios));
  args.push('-filter_complex', filters.join(';'), '-map', '[vfinal]', '-map', '[afinal]', '-t', number(duration), '-r', String(fps), ...encodingArgs(settings.encoder ?? 'cpu', settings.quality), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output);
  return { args, duration };
}
async function exportProject(p, settings, output, { titleImages = {}, titleFrameProvider, audioPaths = {}, onProgress = () => {}, signal, encoders = exportEncoders, spawnProcess = spawn } = {}) {
  validateProject(p);
  finite(settings?.fps,1,120,'書き出しFPS');finite(settings?.width,128,7680,'書き出し幅');finite(settings?.height,128,4320,'書き出し高さ');
  if(!Number.isInteger(settings.fps)||settings.width%2||settings.height%2)throw new Error('書き出しサイズは偶数、FPSは整数で指定してください。');
  const requested=validateEncoder(settings?.encoder);
  if(signal?.aborted)throw new Error('書き出しをキャンセルしました。');
  const resolveEncoder=()=>new Promise((resolve,reject)=>{
    const abort=()=>reject(new Error('書き出しをキャンセルしました。'));
    signal?.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>encoders.resolve(requested)).then(resolve,reject).finally(()=>signal?.removeEventListener('abort',abort));
  });
  let encoder=await resolveEncoder(),warning;
  if(signal?.aborted)throw new Error('書き出しをキャンセルしました。');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-render-'));
  const partial = path.join(path.dirname(output), `.luma-${randomUUID()}.mp4`);
  try {
    const sources = Object.fromEntries(p.assets.map(a => [a.id, a.path]));
    // Still images use their first frame in both preview and export, including GIF/APNG/WebP.
    for (const a of exportAssets(p).filter(a => a.kind === 'image')) {
      const file = path.join(tempDir, `${randomUUID()}.png`);
      await run(ffmpeg, ['-v', 'error', '-i', a.path, '-frames:v', '1', file], { signal });
      sources[a.id] = file;
    }
    // Probe the actual decoded input for each blurred asset. Still images have
    // already become autorotated PNGs; video display rotation is applied by
    // FFmpeg before the scale filter. Older projects only store encoded size.
    const blurredIds=new Set(p.clips.filter(c=>['video','image'].includes(c.kind)&&!p.tracks.find(t=>t.id===c.trackId)?.hidden&&(hasGaussianBlur(visualClipAt(c,0))||hasMosaic(visualClipAt(c,0)))).map(c=>c.assetId));
    const decodedDimensions={};
    for(const id of blurredIds){
      const asset=p.assets.find(a=>a.id===id),stream=(await probe(sources[id],{signal})).streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
      if(!stream?.width||!stream?.height)throw new Error(`素材の映像サイズを取得できません: ${asset.name}`);
      const angle=asset.kind==='image'?0:Number(stream.side_data_list?.find(s=>Number.isFinite(s.rotation))?.rotation??stream.tags?.rotate??0);
      const turn=Math.abs(angle%180);
      if(Math.abs(turn-90)<.01)decodedDimensions[id]={width:stream.height,height:stream.width};
      else if(turn<.01||Math.abs(turn-180)<.01)decodedDimensions[id]={width:stream.width,height:stream.height};
      else{
        const radians=angle*Math.PI/180,cos=Math.abs(Math.cos(radians)),sin=Math.abs(Math.sin(radians));
        decodedDimensions[id]={width:Math.ceil(stream.width*cos+stream.height*sin),height:Math.ceil(stream.width*sin+stream.height*cos)};
      }
    }
    for (const c of p.clips.filter(c => c.kind === 'title' && !p.tracks.find(t => t.id === c.trackId)?.hidden)) {
      if(needsTitleFrames(c)){
        if(typeof titleFrameProvider!=='function')throw new Error('テキストのキーフレーム画像を準備できませんでした。');
        const file=path.join(tempDir,`${randomUUID()}.mov`);
        await writeFrameSequence(file,{fps:settings.fps,frames:Math.max(1,Math.ceil(c.duration*settings.fps-1e-7)),signal,frame:time=>titleFrameProvider(c,time,p.width,p.height),onFrame:progress=>onProgress({status:'preparing',progress,output})});
        sources[c.id]={path:file};continue;
      }
      const data = titleImages[c.id];
      if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length > 24 * 1024 * 1024) throw new Error('テロップ画像を作成できませんでした。');
      const file = path.join(tempDir, `${randomUUID()}.png`);
      await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64')); sources[c.id] = file;
    }
    const masks = {};
    for (const c of p.clips.filter(c => (hasBezierMask(visualClipAt(c,0))||usesAnimatedMask(c)) && c.kind !== 'audio' && !p.tracks.find(t => t.id === c.trackId)?.hidden)) {
      const asset = p.assets.find(a => a.id === c.assetId);
      const sourceWidth = Math.max(1, Math.round(asset?.width || p.width)), sourceHeight = Math.max(1, Math.round(asset?.height || p.height));
      const scale = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale));
      if(usesAnimatedMask(c)){
        const window=mediaWindow(c,asset,transitionPlan(p),'video'),file=path.join(tempDir,`${randomUUID()}.mkv`);
        await writeFrameSequence(file,{fps:settings.fps,frames:Math.max(1,Math.ceil(window.duration*settings.fps-1e-7)),format:'pgm',signal,frame:time=>maskFrame(c,time+window.start-c.start,width,height),onFrame:progress=>onProgress({status:'preparing',progress,output})});
        masks[c.id]={path:file};continue;
      }
      const file = path.join(tempDir, `${randomUUID()}.pgm`), alpha = rasterizeBezierMask(visualClipAt(c,0), width, height);
      await fs.writeFile(file, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), Buffer.from(alpha)]));
      masks[c.id] = file;
    }
    const encode = async () => {
    const { args, duration } = buildExport(p, { ...settings, encoder: encoder.id }, sources, partial, audioPaths, masks, decodedDimensions);
    const processArgs = await writeFilterScript(args, tempDir);
    if (signal?.aborted) throw new Error('書き出しをキャンセルしました。');
    onProgress({ status: 'rendering', progress: 0, output, encoder: encoder.id, encoderLabel: encoder.label, warning });
    if (signal?.aborted) throw new Error('書き出しをキャンセルしました。');
    await new Promise((resolve, reject) => {
      const child = spawnProcess(ffmpeg, processArgs, { windowsHide: true }); let stderr = ''; let pending = '';
      const cancel = () => child.kill(); signal?.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', b => {
        pending += b.toString(); const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) if (line.startsWith('out_time_us=')) {
          const seconds = Number(line.slice(12)) / 1e6;
          if (Number.isFinite(seconds)) onProgress({ status: 'rendering', progress: Math.min(0.99, seconds / duration), output, encoder: encoder.id, encoderLabel: encoder.label, warning });
        }
      });
      child.stderr.on('data', b => { stderr = (stderr + b).slice(-16000); });
      child.on('error', error => { signal?.removeEventListener('abort', cancel); reject(error); });
      child.on('close', code => {
        signal?.removeEventListener('abort', cancel);
        if (signal?.aborted) reject(new Error('書き出しをキャンセルしました。'));
        else if (code === 0) resolve(); else reject(new Error(stderr || `FFmpeg exited: ${code}`));
      });
    });
    };
    try { await encode(); } catch(error) {
      if(requested!=='auto'||encoder.id==='cpu'||signal?.aborted||!isEncoderFailure(error))throw error;
      encoder=ENCODERS.find(e=>e.id==='cpu');warning='GPUでの書き出しを続けられなかったため、CPUで最初から書き出しています。';
      await encode();
    }
    if (signal?.aborted) throw new Error('書き出しをキャンセルしました。');
    await fs.rename(partial, output);
    onProgress({ status: 'complete', progress: 1, output, encoder: encoder.id, encoderLabel: encoder.label, warning }); return output;
  } finally {
    await fs.rm(partial, { force: true }).catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
module.exports = { validateProject, buildExport, exportProject, exportAssets, isEncoderFailure };
