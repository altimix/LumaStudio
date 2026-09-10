// Accurate transcription and timestamp extraction have different API contracts.
// Align their text locally; never replace the accurate text with the timing pass.
const lexical = text => [...text.normalize('NFKC').toLowerCase()].filter(c => /[\p{L}\p{N}]/u.test(c)).map(c => /[ァ-ヶ]/u.test(c) ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c);
const failure = () => new Error('文字起こし本文と音声の時刻を十分に照合できませんでした。用語ヒントを調整するか、短い区間に分けて再実行してください。既存の字幕は保持されます。');
function alignTranscript(text, timing) {
  if (typeof text !== 'string' || text.length > 20000) throw failure();
  if (!text.trim()) return { text: '', words: [] };
  const tokens = [];
  for (const item of new Intl.Segmenter('ja', { granularity: 'word' }).segment(text.trim())) {
    if (!lexical(item.segment).length && tokens.length) tokens.at(-1).text += item.segment;
    else tokens.push({ text: item.segment });
  }
  const accurate = tokens.flatMap((token, index) => lexical(token.text).map(char => ({ char, token: index })));
  const timed = []; let previous = 0, filteredSilence = 0;
  // Some timing responses provide only segments. Keep that coarser fallback,
  // but never hide malformed nonempty word data behind a valid segment array.
  if (timing?.words !== undefined && !Array.isArray(timing.words)) throw failure();
  const timingGranularity = timing?.words?.length ? 'word' : 'segment';
  const units = timingGranularity === 'word' ? timing.words : timing?.segments;
  if (!Array.isArray(units) || units.length > 7000) throw failure();
  for (const unit of units) {
    if (!unit || typeof unit !== 'object') throw failure();
    const word = timingGranularity === 'word' ? unit : { ...unit, word: unit.text };
    if (typeof word.word !== 'string' || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end < word.start || word.start < previous - 0.05 || word.end > 310) throw failure();
    previous = word.end;
    if (timingGranularity === 'segment' && word.no_speech_prob > 0.6 && word.avg_logprob < -1) { filteredSilence++; continue; }
    const chars = lexical(word.word);
    if (timed.length + chars.length > 7000) throw failure();
    chars.forEach((char, i) => timed.push({ char, start: word.start + (word.end - word.start) * i / chars.length, end: word.start + (word.end - word.start) * (i + 1) / chars.length }));
  }
  if (filteredSilence === units.length && filteredSilence > 0) return { text: '', words: [] };
  const n = accurate.length, m = timed.length, columns = m + 1;
  // Bound provider-controlled memory and CPU for a five-minute request.
  if (!n || !m || n > 7000 || m > 7000 || (n + 1) * columns > 25000000) throw failure();
  const costs = new Uint16Array((n + 1) * columns);
  for (let i = 0; i <= n; i++) costs[i * columns] = i;
  for (let j = 0; j <= m; j++) costs[j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const at = i * columns + j;
    costs[at] = Math.min(costs[at - columns - 1] + (accurate[i - 1].char === timed[j - 1].char ? 0 : 1), costs[at - columns] + 1, costs[at - 1] + 1);
  }
  const mapping = Array(n).fill(null), exact = Array(n).fill(false), timedExact = Array(m).fill(false); let matches = 0, i = n, j = m;
  while (i || j) {
    const at = i * columns + j;
    if (i && j && costs[at] === costs[at - columns - 1] + (accurate[i - 1].char === timed[j - 1].char ? 0 : 1)) {
      mapping[i - 1] = timed[j - 1]; if (accurate[i - 1].char === timed[j - 1].char) { exact[i - 1] = true; timedExact[j - 1] = true; matches++; } i--; j--;
    } else if (i && costs[at] === costs[at - columns] + 1) i--; else j--;
  }
  if (matches / Math.max(n, m) < 0.55) throw failure();
  // After removing low-confidence speech, do not interpolate accurate-side
  // additions that may be the same hallucination over silence.
  if (filteredSilence && exact.some(matched => !matched)) throw failure();
  // A diagonal substitution has a time but is not evidence that the phrase was
  // spoken. Permit short spelling corrections (e.g. Luma Studio), not unrelated
  // passages hidden by a high overall matching ratio.
  for (const side of [exact, timedExact]) {
    let mismatchRun = 0;
    for (const matched of side) {
      mismatchRun = matched ? 0 : mismatchRun + 1;
      if (mismatchRun > Math.max(12, Math.min(30, side.length * 0.2))) throw failure();
    }
  }
  // Fill corrected/inserted characters only between measured neighbours.
  // A missing long phrase, prefix or suffix is an error, not guessed full-clip timing.
  for (let from = 0; from < n;) {
    if (mapping[from]) { from++; continue; }
    let to = from; while (to < n && !mapping[to]) to++;
    if (to - from > Math.max(6, Math.min(30, n * 0.2))) throw failure();
    const left = mapping[from - 1], right = mapping[to];
    const start = left?.end ?? right.start, end = Math.max(start, right?.start ?? left.end);
    for (let k = from; k < to; k++) mapping[k] = { start: start + (end - start) * (k - from) / (to - from), end: start + (end - start) * (k + 1 - from) / (to - from) };
    from = to;
  }
  accurate.forEach((unit, index) => {
    const token = tokens[unit.token], time = mapping[index];
    token.start = token.start === undefined ? time.start : Math.min(token.start, time.start);
    token.end = Math.max(token.end ?? 0, time.end);
  });
  // Zero-duration recognition tokens attach to a neighbour, preserving every character.
  const words = []; let prefix = '';
  for (const token of tokens) {
    if (token.start === undefined || token.end <= token.start) {
      if (words.length) words.at(-1).word += token.text; else prefix += token.text;
      continue;
    }
    const start = Math.max(words.at(-1)?.end ?? 0, token.start);
    if (token.end <= start) { if (words.length) words.at(-1).word += token.text; else prefix += token.text; continue; }
    words.push({ word: prefix + token.text, start, end: token.end }); prefix = '';
  }
  if (!words.length) throw failure();
  if (prefix) words.at(-1).word += prefix;
  return { text: text.trim(), words, alignment: { matchedRatio: matches / Math.max(n, m), timingModel: 'whisper-1', timingGranularity } };
}
module.exports = { alignTranscript };
