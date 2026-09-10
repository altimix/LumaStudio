import fonts from './japanese-fonts.json' with { type: 'json' };
import { validateTextBox } from './text-box.mjs';
export { fonts };
export const DEFAULT_FONT = 'Noto Sans JP';
export function fontStyle(c) {
  return { family: c.fontFamily === undefined ? DEFAULT_FONT : c.fontFamily, weight: c.fontWeight === undefined ? (c.textStyle === 'hero' ? 700 : 500) : c.fontWeight };
}
export function fontEntry(family) { return fonts.find(font => font.family === family); }
export function validateTextStyle(c) {
  validateTextBox(c);
  const { family, weight } = fontStyle(c), entry = fontEntry(family);
  if (!entry || !Number.isInteger(weight) || (entry.variable ? weight < entry.weights[0] || weight > entry.weights.at(-1) : !entry.weights.includes(weight))) throw new Error('日本語フォントまたは太さが不正です。');
  for (const key of ['textShadow', 'textStroke']) if (c[key] !== undefined && typeof c[key] !== 'boolean') throw new Error('テキスト効果の設定が不正です。');
  for (const key of ['shadowColor', 'strokeColor']) if (c[key] !== undefined && (typeof c[key] !== 'string' || !/^#[\da-f]{6}$/i.test(c[key]))) throw new Error('テキスト効果の色が不正です。');
  for (const [key, max] of [['shadowBlur', 100], ['shadowDistance', 100], ['strokeWidth', 20]]) if (c[key] !== undefined && (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > max)) throw new Error('テキスト効果の大きさが不正です。');
  if (c.captionBackgroundOpacity !== undefined && (!Number.isFinite(c.captionBackgroundOpacity) || c.captionBackgroundOpacity < 0 || c.captionBackgroundOpacity > 1)) throw new Error('字幕の背景の濃さは0〜100%で指定してください。');
  if (c.captionAutoPosition !== undefined && typeof c.captionAutoPosition !== 'boolean') throw new Error('字幕の自動配置設定が不正です。');
}
