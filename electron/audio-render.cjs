const number = n => Number(n.toFixed(6)).toString();
const { volumeExpression } = require('../shared/volume-automation.mjs');
function tempo(speed) {
  const pieces = [];
  while (speed < 0.5) { pieces.push('atempo=0.5'); speed /= 0.5; }
  while (speed > 2) { pieces.push('atempo=2'); speed /= 2; }
  return [...pieces, `atempo=${number(speed)}`].join(',');
}
function clipAudioFilter(c, index, envelopes = [], window={start:c.start,duration:c.duration}, sourceTrim=0) {
  const offset=c.start-window.start;
  const f = [`[${index}:a]aresample=48000:async=1:first_pts=0`, 'aformat=channel_layouts=stereo', `atrim=start_sample=${Math.round(sourceTrim*48000)}`, 'asetpts=PTS-STARTPTS', ...(c.speed===1?[]:[tempo(c.speed)]), `atrim=end_sample=${Math.round(window.duration*48000)}`, `volume=${number(c.volume)}`];
  // Match the stereo mix before evaluating each channel. With mono AAC, aeval's
  // negotiated stereo output can otherwise read a nonexistent input channel.
  if (c.volumeKeyframes?.length) f.push('aformat=channel_layouts=stereo', `aeval=exprs='val(ch)*(${volumeExpression(c.volumeKeyframes, offset)})':c=same`);
  const fade = (direction, start, duration, curve='tri') => {
    if (start >= 0) { f.push(`afade=t=${direction}:st=${number(start)}:d=${number(duration)}:curve=${curve}`); return; }
    // A transcription window may start part-way through a fade. afade rejects
    // negative start times; evaluate its remaining curve at each sample instead.
    const ramp = `clip((t-(${number(start)}))/${number(duration)},0,1)`;
    const gain = direction === 'in' ? ramp : `(1-${ramp})`;
    f.push(`aeval=exprs='val(ch)*(${curve==='qsin' ? `sin(PI/2*${gain})` : gain})':c=same`);
  };
  if (c.fadeIn) fade('in', offset, c.fadeIn);
  if (c.fadeOut) fade('out', offset+c.duration-c.fadeOut, c.fadeOut);
  for(const e of envelopes) fade(e.direction,e.start-window.start,e.end-e.start,e.curve==='constantPower'?'qsin':'tri');
  f.push(`adelay=${Math.round(window.start * 48000)}S:all=1[a${index}]`); return f.join(',');
}
const mixAudioFilter = audios => `${audios.join('')}amix=inputs=${audios.length}:duration=first:normalize=0:dropout_transition=0,alimiter=limit=0.98:level=0:latency=1[afinal]`;
module.exports = { number, tempo, clipAudioFilter, mixAudioFilter };
