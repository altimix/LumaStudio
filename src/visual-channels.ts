import type { Clip, Project } from './types';
import { visualKeys, visualSnapshot } from '../shared/visual-keyframes.mjs';
import { MIN_BEZIER_COORD, MAX_BEZIER_COORD } from '../shared/video-mask.mjs';

export interface VisualChannel { path: string; label: string; min?: number; max?: number; step?: number; factor?: number; offset?: number; suffix?: string }
export function resolveVisualChannel(channels: VisualChannel[], selected: string): VisualChannel {
  return channels.find(channel => channel.path === selected) ?? channels.find(channel => channel.path === 'opacity')!;
}
export function channelValue(clip: Clip, path: string): unknown {
  return path.split('.').reduce<unknown>((value, field) => value && typeof value === 'object' ? (value as Record<string, unknown>)[field] : undefined, visualSnapshot(clip));
}
export function channelPatch(clip: Clip, path: string, value: number): Partial<Clip> {
  const [field, ...rest] = path.split('.');
  if (!rest.length) return { [field]: value };
  const original = visualSnapshot(clip)[field as keyof ReturnType<typeof visualSnapshot>];
  if (!original || typeof original !== 'object') return {};
  const copy = structuredClone(original) as unknown as Record<string, unknown>;
  let object = copy;
  for (const part of rest.slice(0, -1)) {object = object[part] as Record<string, unknown>;if(!object||typeof object!=='object')return {};}
  if(field==='crop'){
    const opposite:Record<string,string>={left:'right',right:'left',top:'bottom',bottom:'top'};
    value=Math.min(value,.99-Number(copy[opposite[rest[0]]]??0));
  }
  object[rest.at(-1)!] = value;
  return { [field]: copy } as Partial<Clip>;
}
export function channelText(clip: Clip, channel: VisualChannel) {
  const value = channelValue(clip, channel.path);
  if (typeof value === 'number') return `${Number((value * (channel.factor ?? 1) + (channel.offset ?? 0)).toFixed(2))}${channel.suffix ?? ''}`;
  if (typeof value === 'boolean') return value ? 'オン' : 'オフ';
  if (typeof value === 'string') return ({hero:'シネマタイトル',minimal:'ミニマル',subtitle:'字幕'} as Record<string,string>)[value]??value;
  if(channel.path==='videoMask'&&clip.videoMask)return {rectangle:'長方形',ellipse:'楕円',bezier:'ベジェペン'}[clip.videoMask.type];
  return value ? '有効' : '無効';
}
export function visualChannels(clip: Clip, project: Pick<Project, 'width' | 'height'>): VisualChannel[] {
  const channels: VisualChannel[] = [
    { path: 'x', label: '位置 X', min: -200, max: 200, step: 100 / project.width, factor: project.width / 100, offset: project.width / 2, suffix: ' px' },
    { path: 'y', label: '位置 Y', min: -200, max: 200, step: 100 / project.height, factor: project.height / 100, offset: project.height / 2, suffix: ' px' },
    { path: 'scale', label: 'スケール', min: .1, max: 3, step: .01, factor: 100, suffix: '%' },
    { path: 'rotation', label: '回転', min: -180, max: 180, step: 1, suffix: '°' },
    { path: 'opacity', label: '不透明度', min: 0, max: 1, step: .01, factor: 100, suffix: '%' },
  ];
  if (clip.kind === 'title' && !clip.graphic) channels.push(
    { path: 'fontSize', label: '文字サイズ', min: 16, max: 240, step: 1, suffix: ' px' },
    ...[['color', '文字色'], ['fontFamily', 'フォント'], ['fontWeight', '文字の太さ'], ['textStyle', 'スタイル'], ['textShadow', '影'], ['shadowColor', '影の色'], ['textStroke', '縁取り'], ['strokeColor', '縁取りの色']].map(([path, label]) => ({ path, label })),
    { path: 'shadowBlur', label: '影のぼかし', min: 0, max: 100, step: 1, suffix: ' px' },
    { path: 'shadowDistance', label: '影の距離', min: 0, max: 100, step: 1, suffix: ' px' },
    { path: 'strokeWidth', label: '縁取りの幅', min: 0, max: 20, step: 1, suffix: ' px' },
    { path: 'captionBackgroundOpacity', label: '字幕背景の不透明度', min: 0, max: 1, step: .01, factor: 100, suffix: '%' },
    { path: 'textBox.width', label: 'テキスト枠の幅', min: 32, max: 16000, step: 1, suffix: ' px' },
    { path: 'textBox.height', label: 'テキスト枠の高さ', min: 32, max: 16000, step: 1, suffix: ' px' },
  );
  if (clip.graphic) channels.push(
    { path: 'color', label: '線の色' }, { path: 'graphic.fill', label: '塗りつぶし' }, { path: 'graphic.fillColor', label: '塗りつぶしの色' },
    { path: 'graphic.width', label: '図形の幅', min: 4, max: 16000, step: 1, suffix: ' px' },
    { path: 'graphic.height', label: '図形の高さ', min: 4, max: 16000, step: 1, suffix: ' px' },
    { path: 'graphic.lineWidth', label: '線の太さ', min: 1, max: 80, step: 1, suffix: ' px' },
  );
  if (clip.kind === 'video' || clip.kind === 'image') {
    channels.push(
      { path: 'exposure', label: '露出', min: -2, max: 2, step: .01 },
      { path: 'contrast', label: 'コントラスト', min: 0, max: 2, step: .01, factor: 100, suffix: '%' },
      { path: 'saturation', label: '彩度', min: 0, max: 2, step: .01, factor: 100, suffix: '%' },
      ...[['top', '上'], ['right', '右'], ['bottom', '下'], ['left', '左']].map(([edge, label]) => ({ path: `crop.${edge}`, label: `クロップ / ${label}`, min: 0, max: .99, step: .001, factor: 100, suffix: '%' })),
      { path: 'videoMask', label: 'マスクの種類' },
      ...[['x', '位置 X'], ['y', '位置 Y'], ['width', '幅'], ['height', '高さ'], ['feather', '境界ぼかし']].map(([field, label]) => ({ path: `videoMask.${field}`, label: `マスク / ${label}`, min: ['width', 'height'].includes(field) ? .01 : 0, max: field === 'feather' ? .5 : 1, step: .001, factor: 100, suffix: '%' })),
      { path: 'videoMask.inverted', label: 'マスクの反転' }, { path: 'chromaKey', label: 'クロマキー' }, { path: 'chromaKey.color', label: 'クロマキーの色' },
      ...[['tolerance', '許容範囲'], ['softness', '境界のなめらかさ'], ['greenSpill', '緑の色かぶり除去'], ['blueSpill', '青の色かぶり除去']].map(([field, label]) => ({ path: `chromaKey.${field}`, label, min: 0, max: ['tolerance', 'softness'].includes(field) ? .5 : 1, step: .001, factor: 100, suffix: '%' })),
    );
    const masks = [clip.videoMask, ...visualKeys(clip).map(key => key.values.videoMask)];
    const count = Math.max(0, ...masks.map(mask => mask?.type === 'bezier' ? mask.points.length : 0));
    for (let index = 0; index < count; index++) for (const [field, label] of [['x', 'X'], ['y', 'Y'], ['inX', '入力ハンドル X'], ['inY', '入力ハンドル Y'], ['outX', '出力ハンドル X'], ['outY', '出力ハンドル Y']]) {
      channels.push({ path: `videoMask.points.${index}.${field}`, label: `マスク / 点${index + 1} / ${label}`, min: MIN_BEZIER_COORD, max: MAX_BEZIER_COORD, step: .001, factor: 100, suffix: '%' });
    }
  }
  return channels;
}
