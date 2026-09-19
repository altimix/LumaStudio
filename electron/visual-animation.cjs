const { visualExpression, visualClipAt, visualKeys } = require('../shared/visual-keyframes.mjs');
const { DEFAULT_CHROMA_KEY } = require('../shared/chroma-key.mjs');
const { hasVideoMask, maskAlphaAt, rasterizeBezierMask } = require('../shared/video-mask.mjs');

function animatedColorFilter(clip, offset) {
  const ex=field=>`(${visualExpression(clip,field,'T',offset)})`,gain=`pow(2,${ex('exposure')})`,contrast=ex('contrast'),saturation=ex('saturation');
  const adjusted=channel=>`clip((clip(${channel}(X,Y)*${gain},0,255)-127.5)*${contrast}+127.5,0,255)`;
  const prefix=['r','g','b'].map((channel,index)=>`st(${index},${adjusted(channel)});`).join('')+'st(3,0.213*ld(0)+0.715*ld(1)+0.072*ld(2));';
  return `geq=${['r','g','b'].map((channel,index)=>`${channel}='${prefix}clip(ld(${index})*${saturation}+ld(3)*(1-${saturation}),0,255)'`).join(':')}:a='alpha(X,Y)'`;
}

function animatedChromaFilter(clip, offset) {
  const ex=(field,fallback=0)=>`(${visualExpression(clip,`chromaKey.${field}`,'T',offset,fallback)})`;
  const red=ex('color.r'),green=ex('color.g',255),blue=ex('color.b');
  const cb=`(-.168736*${red}-.331264*${green}+.5*${blue})/255`,cr=`(.5*${red}-.418688*${green}-.081312*${blue})/255`;
  const tolerance=ex('tolerance',DEFAULT_CHROMA_KEY.tolerance),softness=ex('softness',DEFAULT_CHROMA_KEY.softness),enabled=ex('enabled');
  const distance=`sqrt(pow((-.168736*r(X,Y)-.331264*g(X,Y)+.5*b(X,Y))/255-(${cb}),2)+pow((.5*r(X,Y)-.418688*g(X,Y)-.081312*b(X,Y))/255-(${cr}),2))`;
  const prefix=`st(0,${distance});st(1,if(gt(${softness},0.00000001),clip((ld(0)-${tolerance})/max(.00000001,${softness}),0,1),gt(ld(0),${tolerance})));st(2,(1-clip(ld(0)/max(.01,${tolerance}+${softness}+.15),0,1))*${enabled});`;
  return `geq=r='r(X,Y)':g='${prefix}g(X,Y)-max(0,g(X,Y)-max(r(X,Y),b(X,Y)))*${ex('greenSpill',.7)}*ld(2)':b='${prefix}b(X,Y)-max(0,b(X,Y)-max(r(X,Y),g(X,Y)))*${ex('blueSpill',.7)}*ld(2)':a='${prefix}alpha(X,Y)*(1-${enabled}+${enabled}*ld(1)*ld(1)*(3-2*ld(1)))'`;
}

// Fixed output dimensions avoid filter reinitialization when scale or rotation
// changes. Inverse sampling preserves the clip center and transparent bounds.
function animatedTransformFilter(clip, offset) {
  const ex=field=>`(${visualExpression(clip,field,'T',offset)})`,opacity=ex('opacity');
  if(clip.graphic)return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${opacity}'`;
  const prefix=`st(2,${ex('rotation')}*PI/180);st(3,${ex('scale')});st(4,X-W/2-W*${ex('x')}/100);st(5,Y-H/2-H*${ex('y')}/100);st(0,(ld(4)*cos(ld(2))+ld(5)*sin(ld(2)))/ld(3)+W/2);st(1,(-ld(4)*sin(ld(2))+ld(5)*cos(ld(2)))/ld(3)+H/2);`;
  const inside='between(ld(0),0,W-1)*between(ld(1),0,H-1)';
  return `geq=${['r','g','b'].map(channel=>`${channel}='${prefix}if(${inside},${channel}(ld(0),ld(1)),0)'`).join(':')}:a='${prefix}if(${inside},alpha(ld(0),ld(1))*${opacity},0)':interpolation=bilinear`;
}

const keyedClips=clip=>[visualClipAt(clip,0),...visualKeys(clip).map(key=>visualClipAt(clip,key.time))];
const usesAnimatedMask=clip=>!!clip.visualKeyframes?.length&&keyedClips(clip).some(hasVideoMask);
const usesAnimatedChroma=clip=>!!clip.visualKeyframes?.length&&keyedClips(clip).some(item=>item.chromaKey);
function maskFrame(clip,time,width,height) {
  const current=visualClipAt(clip,time);
  let pixels;
  if(current.videoMask?.type==='bezier')pixels=rasterizeBezierMask(current,width,height);
  else {pixels=new Uint8Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[y*width+x]=Math.round(maskAlphaAt(current,(x+.5)/width,(y+.5)/height)*255);}
  return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`),Buffer.from(pixels)]);
}
module.exports={animatedColorFilter,animatedChromaFilter,animatedTransformFilter,usesAnimatedMask,usesAnimatedChroma,maskFrame};
