// Shared normalized page geometry. Inputs/outputs use straight RGBA.
export function blendTransition(kind, a, b, output, width, height, progress) {
  const p=Math.max(0,Math.min(1,progress));
  if(p===0){output.set(a);return;}if(p===1){output.set(b);return;}
  const edge=Math.cos(p*Math.PI/2), tilt=.2*Math.sin(p*Math.PI/2), fold=2*p, radius=.18*Math.sin(Math.PI*p);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4, nx=x/width, ny=y/height;
    if(kind==='dissolve'){const alphaA=a[i+3]*(1-p),alphaB=b[i+3]*p,alpha=alphaA+alphaB;for(let c=0;c<3;c++)output[i+c]=alpha>0?Math.floor((a[i+c]*alphaA+b[i+c]*alphaB)/alpha):0;output[i+3]=Math.floor(alpha);continue;}
    let source=b,index=i,shade=1,bias=0;
    if(kind==='pageTurn'){
      const u=nx/Math.max(.001,edge),v=(ny-.5)/(1-tilt*u)+.5;
      if(nx<edge&&v>=0&&v<1){source=a;index=(Math.floor(v*height)*width+Math.floor(u*width))*4;shade=.75+.25*edge;}
      else if(nx>=edge&&nx<edge+.04)shade=1-.3*(1-(nx-edge)/.04);
    }else{
      const q=2-nx-ny;
      if(q>fold+radius){source=a;}
      else if(q>=fold-radius){
        const angle=Math.acos(Math.max(-1,Math.min(1,(q-fold)/radius))),sourceQ=fold+radius-radius*angle;
        const sx=Math.floor((nx+(q-sourceQ)/2)*width),sy=Math.floor((ny+(q-sourceQ)/2)*height);
        if(sx>=0&&sx<width&&sy>=0&&sy<height){
          source=a;index=(sy*width+sx)*4;
          if(angle<=Math.PI/2)shade=.55+.45*Math.cos(angle);
          else{
            const grey=105+40*Math.sin(angle)+65*Math.pow(Math.max(0,Math.cos(angle-2.25)),24);
            output[i]=Math.floor(grey);output[i+1]=Math.floor(grey+3);output[i+2]=Math.floor(grey+8);output[i+3]=source[index+3];continue;
          }
        }
      }
      else if(fold-radius-q<.08)shade=1-.35*Math.pow(1-(fold-radius-q)/.08,2);
    }
    for(let c=0;c<3;c++)output[i+c]=Math.min(255,Math.floor(source[index+c]*shade+bias));output[i+3]=source[index+3];
  }
}
// FFmpeg xfade exposes P from 1 to 0; a0..a3 address GBR(A) input planes.
export function xfadeExpression(kind) {
  if(kind==='dissolve'){const alpha='(a3(X,Y)*P+b3(X,Y)*(1-P))';return `if(eq(PLANE,3),A*P+B*(1-P),if(gt(${alpha},0),(A*a3(X,Y)*P+B*b3(X,Y)*(1-P))/${alpha},0))`;}
  const sample=(x,y)=>[0,1,2].reduceRight((rest,c)=>`if(eq(PLANE,${c}),a${c}(${x},${y}),${rest})`,`a3(${x},${y})`);
  const shade=(value,gain,bias='0')=>`if(eq(PLANE,3),${value},min(255,(${value})*(${gain})+(${bias})))`;
  // xfade evaluates one expression on several workers: do not use mutable st/ld registers.
  const p='(1-P)',edge=`cos(${p}*PI/2)`,u=`(X/W/max(.001,${edge}))`,v=`((Y/H-.5)/(1-.2*sin(${p}*PI/2)*${u})+.5)`;
  let body;
  if(kind==='pageTurn'){
    const page=sample(`floor(${u}*W)`,`floor(${v}*H)`);
    body=`if(lt(X/W,${edge})*gte(${v},0)*lt(${v},1),${shade(page,`.75+.25*${edge}`)},${shade('B',`if(gte(X/W,${edge})*lt(X/W,${edge}+.04),1-.3*(1-(X/W-${edge})/.04),1)`)})`;
  }else{
    const fold=`(2*${p})`,q='(2-X/W-Y/H)',radius=`(.18*sin(PI*${p}))`;
    const angle=`acos(clip((${q}-${fold})/${radius},-1,1))`,sourceQ=`(${fold}+${radius}-${radius}*${angle})`;
    const sx=`floor((X/W+(${q}-${sourceQ})/2)*W)`,sy=`floor((Y/H+(${q}-${sourceQ})/2)*H)`,page=sample(sx,sy);
    const grey=`(105+40*sin(${angle})+65*pow(max(0,cos(${angle}-2.25)),24)+if(eq(PLANE,0),3,if(eq(PLANE,1),8,0)))`;
    const curled=`if(lte(${angle},PI/2),${shade(page,`.55+.45*cos(${angle})`)},if(eq(PLANE,3),${page},${grey}))`;
    const paper=`if(gte(${sx},0)*lt(${sx},W)*gte(${sy},0)*lt(${sy},H),${curled},B)`;
    body=`if(gt(${q},${fold}+${radius}),A,if(gte(${q},${fold}-${radius}),${paper},${shade('B',`if(lt(${fold}-${radius}-${q},.08),1-.35*pow(1-(${fold}-${radius}-${q})/.08,2),1)`)}))`;
  }
  return `if(lte(${p},0),A,if(gte(${p},1),B,${body}))`;
}

export function transitionShader() {
  return `#version 300 es
precision highp float;
uniform sampler2D leftImage;
uniform sampler2D rightImage;
uniform vec2 resolution;
uniform float progress;
uniform int kind;
out vec4 pixel;
const float PI=3.141592653589793;
vec4 leftAt(vec2 p){return texelFetch(leftImage,ivec2(floor(p*resolution)),0);}
void main(){
  vec2 xy=vec2(floor(gl_FragCoord.x),resolution.y-1.0-floor(gl_FragCoord.y));
  vec2 uv=xy/resolution;vec4 a=texelFetch(leftImage,ivec2(xy),0),b=texelFetch(rightImage,ivec2(xy),0);
  float p=clamp(progress,0.0,1.0);if(p<=0.0){pixel=a;return;}if(p>=1.0){pixel=b;return;}
  vec4 color=b;float shade=1.0;
  if(kind==1){
    float edge=cos(p*PI/2.0),u=uv.x/max(.001,edge),v=(uv.y-.5)/(1.0-.2*sin(p*PI/2.0)*u)+.5;
    if(uv.x<edge&&v>=0.0&&v<1.0){color=leftAt(vec2(u,v));shade=.75+.25*edge;}
    else if(uv.x>=edge&&uv.x<edge+.04)shade=1.0-.3*(1.0-(uv.x-edge)/.04);
  }else{
    float fold=2.0*p,radius=.18*sin(PI*p),q=2.0-uv.x-uv.y;
    if(q>fold+radius)color=a;
    else if(q>=fold-radius){
      float angle=acos(clamp((q-fold)/radius,-1.0,1.0)),sourceQ=fold+radius-radius*angle;
      vec2 source=uv+vec2((q-sourceQ)/2.0);
      if(all(greaterThanEqual(source,vec2(0.0)))&&all(lessThan(source,vec2(1.0)))){
        color=leftAt(source);
        if(angle<=PI/2.0)shade=.55+.45*cos(angle);
        else{float grey=105.0+40.0*sin(angle)+65.0*pow(max(0.0,cos(angle-2.25)),24.0);pixel=vec4(floor(vec3(grey,grey+3.0,grey+8.0))/255.0,color.a);return;}
      }
    }else if(fold-radius-q<.08)shade=1.0-.35*pow(1.0-(fold-radius-q)/.08,2.0);
  }
  pixel=vec4(floor(color.rgb*255.0*shade)/255.0,color.a);
}`;
}
