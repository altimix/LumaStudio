const words = new Intl.Segmenter('ja', { granularity: 'word' });
const characters = new Intl.Segmenter('ja', { granularity: 'grapheme' });
export function validateTextBox(c) {
  if (c.textBox === undefined) return;
  const box = c.textBox;
  if (c.kind !== 'title' || c.graphic || !box || typeof box !== 'object' || Array.isArray(box)
    || ![box.width, box.height].every(n => Number.isFinite(n) && n >= 32 && n <= 16000)) throw new Error('テキスト枠の幅と高さは32〜16000pxで指定してください。');
}
export function wrapTextBox(text, width, measure) {
  const lines = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const { segment: word } of words.segment(paragraph)) {
      if (line && measure(line + word) > width) { lines.push(line.trimEnd()); line = ''; }
      if (!line && /^\s+$/.test(word)) continue;
      if (measure(word) <= width) line += word;
      else for (const { segment: char } of characters.segment(word)) {
        if (line && measure(line + char) > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export function textBoxLayout(c, measure) {
  const box = c.textBox, padding = Math.max(8, c.fontSize * .13, c.textStroke ? (c.strokeWidth ?? 3) : 0);
  const innerWidth = Math.max(1, box.width - padding * 2);
  const lines = wrapTextBox(c.text, innerWidth, measure), lineHeight = c.fontSize * 1.22;
  const requiredHeight = lines.length * lineHeight + padding * 2;
  return { lines, lineHeight, padding, innerWidth, requiredHeight, overflow: requiredHeight > box.height + .01 || lines.some(line => measure(line) > innerWidth + .01) };
}
export function resizeTextBox(c, box, project, handle, dx, dy) {
  const angle = c.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const localX = (dx * cos + dy * sin) / c.scale, localY = (-dx * sin + dy * cos) / c.scale;
  const width = Math.max(32, Math.min(16000, box.width + handle.x * localX));
  const height = Math.max(32, Math.min(16000, box.height + handle.y * localY));
  const shiftX = handle.x * (width - box.width) / 2, shiftY = handle.y * (height - box.height) / 2;
  return { textBox: { width, height }, x: Math.max(-200, Math.min(200, c.x + (shiftX * cos - shiftY * sin) * c.scale / project.width * 100)), y: Math.max(-200, Math.min(200, c.y + (shiftX * sin + shiftY * cos) * c.scale / project.height * 100)) };
}
