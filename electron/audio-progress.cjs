// FFmpeg writes newline-delimited key=value records, ending in progress=...
// Pipe chunks need not line up with either a line or a complete record.
function progressReader(onProgress) {
  let buffer = '', record = {};
  return chunk => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      const equals = line.indexOf('='); if (equals < 1) continue;
      const key = line.slice(0, equals), value = line.slice(equals + 1); record[key] = value;
      if (key !== 'progress') continue;
      const micros = Number(record.out_time_us ?? record.out_time_ms);
      if (Number.isFinite(micros) && micros >= 0) onProgress({ seconds: micros / 1e6, done: value === 'end' });
      record = {};
    }
    // Ignore malformed output without retaining an unbounded line.
    if (buffer.length > 8192) buffer = '';
  };
}

const PHASES = { preparing: [0, 0], speech: [0, .8], refining: [.8, .96], analysis: [0, .6], processing: [.6, .96], correction: [.96, .995], saving: [.995, .999], cached: [1, 1], complete: [1, 1] };
function audioProgress(duration, publish) {
  let last = 0;
  return (phase, seconds = 0, done = false) => {
    const [from, to] = PHASES[phase];
    const fraction = done ? 1 : duration > 0 ? Math.min(1, Math.max(0, seconds / duration)) : 0;
    last = Math.max(last, from + (to - from) * fraction);
    publish({ phase, progress: last, processedSeconds: Math.max(0, seconds), durationSeconds: duration || null });
  };
}
module.exports = { progressReader, audioProgress };
