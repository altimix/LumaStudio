const number = n => Number(n.toFixed(6)).toString();
const { volumeExpression } = require('../shared/volume-automation.mjs');
function tempo(speed) {
  const pieces = [];
  while (speed < 0.5) { pieces.push('atempo=0.5'); speed /= 0.5; }
  while (speed > 2) { pieces.push('atempo=2'); speed /= 2; }
  return [...pieces, `atempo=${number(speed)}`].join(',');
}
function clipAudioFilter(c, index, envelopes = [], window={start:c.start,duration:c.duration}) {
  const offset=c.start-window.start;
  const f = [`[${index}:a]asetpts=PTS-STARTPTS`, tempo(c.speed), `atrim=duration=${number(window.duration)}`, `volume=${number(c.volume)}`];
  // Match the stereo mix before evaluating each channel. With mono AAC, aeval's
  // negotiated stereo output can otherwise read a nonexistent input channel.
  if (c.volumeKeyframes?.length) f.push('aformat=channel_layouts=stereo', `aeval=exprs='val(ch)*(${volumeExpression(c.volumeKeyframes, offset)})':c=same`);
  if (c.fadeIn) f.push(`afade=t=in:st=${number(offset)}:d=${number(c.fadeIn)}`);
  if (c.fadeOut) f.push(`afade=t=out:st=${number(offset+c.duration - c.fadeOut)}:d=${number(c.fadeOut)}`);
  for(const e of envelopes) f.push(`afade=t=${e.direction}:st=${number(e.start-window.start)}:d=${number(e.end-e.start)}:curve=${e.curve==='constantPower'?'qsin':'tri'}`);
  f.push(`adelay=${Math.round(window.start * 1000)}:all=1[a${index}]`); return f.join(',');
}
const mixAudioFilter = audios => `${audios.join('')}amix=inputs=${audios.length}:duration=first:normalize=0:dropout_transition=0,alimiter=limit=0.98:level=0:latency=1[afinal]`;
module.exports = { number, tempo, clipAudioFilter, mixAudioFilter };
