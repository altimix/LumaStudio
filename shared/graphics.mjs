export const SHAPES = ['arrow', 'rectangle', 'ellipse'];
export const SHAPE_NAMES = { arrow: '矢印', rectangle: '四角', ellipse: '丸' };
export function validateGraphic(c) {
  const g = c.graphic; if (g === undefined) return;
  if (!g || c.kind !== 'title' || !SHAPES.includes(g.shape)) throw new Error('図形の種類が不正です。');
  for (const [key, min, max] of [['width',4,16000],['height',4,16000],['lineWidth',1,80]]) if (!Number.isFinite(g[key]) || g[key] < min || g[key] > max) throw new Error('図形の大きさが不正です。');
  if (typeof g.fill !== 'boolean' || typeof g.fillColor !== 'string' || !/^#[\da-f]{6}$/i.test(g.fillColor)) throw new Error('図形の塗りつぶしが不正です。');
  for(const key of ['flipX','flipY'])if(g[key]!==undefined&&typeof g[key]!=='boolean')throw new Error('図形の向きが不正です。');
}
export function graphicFromPoints(shape, from, to, width, height, lineWidth = 8) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return { x: ((from.x + to.x) / 2 / width - 0.5) * 100, y: ((from.y + to.y) / 2 / height - 0.5) * 100,
    rotation: 0,
    graphic: { shape, width: Math.max(4,Math.abs(dx)), height:Math.max(4,Math.abs(dy)), flipX:dx<0,flipY:dy<0,lineWidth, fill:false, fillColor:'#ffcc33' } };
}
export function arrowPoints(g,factor=1){
  const w=g.width*factor,h=g.height*factor,line=g.lineWidth*factor,x=g.flipX?-w/2:w/2,y=g.flipY?-h/2:h/2,length=Math.hypot(w,h),ux=2*x/length,uy=2*y/length,head=Math.min(length*.45,Math.max(line*3.5,16*factor));
  return [[-x,-y],[x-ux*head-uy*head*.6,y-uy*head+ux*head*.6],[x,y],[x-ux*head+uy*head*.6,y-uy*head-ux*head*.6]];
}
export function graphicBounds(g){
  if(g.shape!=='arrow')return {width:g.width+g.lineWidth,height:g.height+g.lineWidth};
  const points=arrowPoints(g);return {width:2*Math.max(...points.map(p=>Math.abs(p[0])))+g.lineWidth,height:2*Math.max(...points.map(p=>Math.abs(p[1])))+g.lineWidth};
}
/** A project-pixel overlay shared by preview and the PNG used for export. */
export function paintGraphic(ctx, graphic, color, width, height, factor) {
  const g = graphic, w = g.width * factor, h = g.height * factor, line = g.lineWidth * factor;
  ctx.save();ctx.translate(width / 2,height / 2);ctx.strokeStyle=color;ctx.fillStyle=g.fillColor;ctx.lineWidth=line;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
  if(g.shape==='rectangle') ctx.rect(-w/2,-h/2,w,h);
  else if(g.shape==='ellipse') ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);
  else {const [tail,wing1,tip,wing2]=arrowPoints(g,factor);ctx.moveTo(...tail);ctx.lineTo(...tip);ctx.moveTo(...wing1);ctx.lineTo(...tip);ctx.lineTo(...wing2);}
  if(g.fill&&g.shape!=='arrow')ctx.fill();ctx.stroke();ctx.restore();
}
