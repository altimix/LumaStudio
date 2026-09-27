// Share line placement between previews and exported title frames.
const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });
export const TEXT_ALIGNMENTS = ['left', 'center', 'right', 'justify'];
export function textLineLayout(text, width, alignment = 'center', measure, constrain = true) {
  if (!text) return { align: 'center', runs: [] };
  const whole = align => ({ align, runs: [{ text, x: align === 'left' ? 0 : align === 'right' ? width : width / 2, maxWidth: constrain ? width : undefined }] });
  if (alignment !== 'justify') return whole(alignment);
  const parts = Array.from(graphemes.segment(text), item => item.segment);
  if (parts.length < 2) return whole('center');
  const widths = parts.map(measure), total = widths.reduce((sum, value) => sum + value, 0);
  // Do not squeeze already overflowing boxed text or change natural shaping when
  // the line cannot be expanded. Canvas retains the existing maxWidth behavior.
  if (total >= width) return whole('center');
  const gap = (width - total) / (parts.length - 1);
  let x = 0;
  return { align: 'left', runs: parts.map((text, index) => {
    const run = { text, x, maxWidth: undefined };
    x += widths[index] + gap;
    return run;
  }) };
}
