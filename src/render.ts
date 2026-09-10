import type { Clip, Project } from './types';
import { fontStyle } from '../shared/text-style.mjs';
import { paintGraphic, graphicBounds } from '../shared/graphics.mjs';
import { textBoxLayout } from '../shared/text-box.mjs';
function textFont(c: Clip, size: number) { const f = fontStyle(c); return `${f.weight} ${size}px "${f.family}", sans-serif`; }
export function titleBounds(c: Clip, width: number, height: number) {
  if(c.graphic)return graphicBounds(c.graphic);
  if(c.textBox)return c.textBox;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  ctx.font = textFont(c, c.fontSize);
  const textWidth = Math.min(width * 0.9, Math.max(...c.text.split('\n').map(line => ctx.measureText(line).width)));
  const padding = c.textStyle === 'subtitle' ? c.fontSize : c.textStroke ? (c.strokeWidth ?? 3) * 2 : 8;
  const bounds = { width: Math.max(24, Math.min(width * 0.98, textWidth + padding)), height: Math.min(height, Math.max(c.fontSize, c.text.split('\n').length * c.fontSize * 1.22)) };
  canvas.width = canvas.height = 0; return bounds;
}
export function boxedTextLayout(c: Clip & { textBox: NonNullable<Clip['textBox']> }) {
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
  try { ctx.font=textFont(c,c.fontSize);return textBoxLayout(c,text=>ctx.measureText(text).width); }
  finally { canvas.width=canvas.height=0; }
}
export function initialTextBox(c: Clip, width: number, height: number) {
  if(c.textBox)return c.textBox;
  const bounds=titleBounds(c,width,height),padding=Math.max(8,c.fontSize*.13,c.strokeWidth??3);
  return {width:Math.max(32,Math.min(16000,bounds.width+padding*2)),height:Math.max(32,Math.min(16000,bounds.height+padding*2))};
}
export function titleCanvas(c: Clip, width: number, height: number, projectWidth = 1920): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!; const factor = width / projectWidth, size = c.fontSize * factor;
  if(c.graphic){ctx.translate(width/2+width*c.x/100,height/2+height*c.y/100);ctx.rotate(c.rotation*Math.PI/180);ctx.scale(c.scale,c.scale);ctx.translate(-width/2,-height/2);paintGraphic(ctx,c.graphic,c.color,width,height,factor);return canvas;}
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = c.color;
  ctx.font = textFont(c, size);
  ctx.shadowColor = c.textShadow === false ? 'transparent' : `${c.shadowColor || '#000000'}99`;
  ctx.shadowBlur = c.shadowBlur === undefined ? size * 0.22 : c.shadowBlur * factor;
  ctx.shadowOffsetY = c.shadowDistance === undefined ? size * 0.035 : c.shadowDistance * factor;
  ctx.strokeStyle = c.strokeColor || '#000000'; ctx.lineWidth = (c.strokeWidth ?? 3) * factor * 2; ctx.lineJoin = 'round';
  const layout=c.textBox?boxedTextLayout({...c,textBox:c.textBox}):undefined;
  const lines = layout?.lines ?? c.text.split('\n'); const lh = size * 1.22;
  ctx.save();
  if(c.textBox){ctx.beginPath();ctx.rect((width-c.textBox.width*factor)/2,(height-c.textBox.height*factor)/2,c.textBox.width*factor,c.textBox.height*factor);ctx.clip();}
  if (c.textStyle === 'subtitle') {
    const maxWidth = Math.max(...lines.map(t => ctx.measureText(t).width)); ctx.save(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.fillStyle = `rgba(0,0,0,${c.captionBackgroundOpacity ?? .65})`;
    if(c.textBox)ctx.fillRect((width-c.textBox.width*factor)/2,(height-c.textBox.height*factor)/2,c.textBox.width*factor,c.textBox.height*factor);
    else ctx.fillRect(Math.max(width * 0.04, (width - maxWidth) / 2 - size * 0.5), height / 2 - lines.length * lh / 2 - size * 0.13, Math.min(width * 0.92, maxWidth + size), lines.length * lh + size * 0.26); ctx.restore();
  }
  lines.forEach((line, i) => {
    const y = height / 2 + (i - (lines.length - 1) / 2) * lh;
    ctx.save();
    const maxWidth=layout?undefined:width*.9;
    if (c.textShadow !== false) ctx.fillText(line, width / 2, y, maxWidth);
    ctx.shadowColor = 'transparent';
    if (c.textStroke && (c.strokeWidth ?? 3) > 0) ctx.strokeText(line, width / 2, y, maxWidth);
    ctx.fillText(line, width / 2, y, maxWidth); ctx.restore();
  });
  ctx.restore();
  return canvas;
}
export function renderTitles(p: Project): Record<string, string> {
  const images: Record<string, string> = {};
  for (const c of p.clips) if (c.kind === 'title' && !p.tracks.find(t => t.id === c.trackId)?.hidden) {
    const canvas = titleCanvas(c, p.width, p.height, p.width);
    try { images[c.id] = canvas.toDataURL('image/png'); } finally { canvas.width = canvas.height = 0; }
  }
  return images;
}
export function fadeAt(c: Clip, time: number) {
  const elapsed = time - c.start;
  return Math.max(0, Math.min(1, c.fadeIn > 0 ? elapsed / c.fadeIn : 1, c.fadeOut > 0 ? (c.duration - elapsed) / c.fadeOut : 1));
}
