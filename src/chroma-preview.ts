import { applyChromaPixel, averageSampleColor, chromaUniforms } from '../shared/chroma-key.mjs';
import type { ChromaKey } from './types';

const shader = `#version 300 es
precision highp float;
uniform sampler2D sourceImage;
uniform vec2 resolution;
uniform vec2 keyChroma;
uniform float tolerance;
uniform float softness;
uniform float greenSpill;
uniform float blueSpill;
uniform int showMatte;
out vec4 pixel;
void main(){
  vec2 uv=vec2(gl_FragCoord.x/resolution.x,1.0-gl_FragCoord.y/resolution.y);
  vec4 source=texture(sourceImage,uv);
  float cb=(-.168736*source.r-.331264*source.g+.5*source.b);
  float cr=(.5*source.r-.418688*source.g-.081312*source.b);
  float distance=length(vec2(cb,cr)-keyChroma);
  float linear=softness>.00000001?clamp((distance-tolerance)/softness,0.0,1.0):(distance>tolerance?1.0:0.0);
  float matte=linear*linear*(3.0-2.0*linear);
  float proximity=1.0-clamp(distance/max(.01,tolerance+softness+.15),0.0,1.0);
  float greenExcess=max(0.0,source.g-max(source.r,source.b));
  float blueExcess=max(0.0,source.b-max(source.r,source.g));
  vec3 color=vec3(source.r,source.g-greenExcess*greenSpill*proximity,source.b-blueExcess*blueSpill*proximity);
  float alpha=source.a*matte;
  pixel=showMatte==1?vec4(vec3(alpha),1.0):vec4(color,alpha);
}`;

export class GpuChromaPreview {
  readonly canvas = document.createElement('canvas');
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};
  get lost() { return this.gl.isContextLost(); }
  constructor() {
    const gl = this.canvas.getContext('webgl2', { alpha:true, premultipliedAlpha:false, antialias:false, preserveDrawingBuffer:true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const shaders:WebGLShader[]=[];
    const compile=(kind:number,source:string)=>{const item=gl.createShader(kind);if(!item)throw Error('Shader unavailable');shaders.push(item);gl.shaderSource(item,source);gl.compileShader(item);if(!gl.getShaderParameter(item,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(item)||'Shader compile failed');return item;};
    let program:WebGLProgram|undefined,texture:WebGLTexture|undefined;
    try {
      const vertex=compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}'),fragment=compile(gl.FRAGMENT_SHADER,shader);
      program=gl.createProgram()||undefined;if(!program)throw Error('Program unavailable');gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)||'Chroma shader link failed');
      gl.useProgram(program);for(const name of ['resolution','keyChroma','tolerance','softness','greenSpill','blueSpill','showMatte'])this.uniforms[name]=gl.getUniformLocation(program,name);
      texture=gl.createTexture()||undefined;if(!texture)throw Error('Texture unavailable');gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.uniform1i(gl.getUniformLocation(program,'sourceImage'),0);
    } catch(error) { if(texture)gl.deleteTexture(texture);if(program)gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();throw error; }
    finally { for(const item of shaders)gl.deleteShader(item); }
    this.program=program!;this.texture=texture!;
  }
  render(source:CanvasImageSource,width:number,height:number,key:ChromaKey){
    const gl=this.gl;if(gl.isContextLost())return false;
    const limit=Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    if(width>Math.min(limit,viewport[0])||height>Math.min(limit,viewport[1]))return false;
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    const values=chromaUniforms(key);gl.viewport(0,0,width,height);gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source as TexImageSource);}catch{return false;}
    if(gl.getError()!==gl.NO_ERROR)return false;
    gl.uniform2f(this.uniforms.resolution,width,height);gl.uniform2f(this.uniforms.keyChroma,values.cb,values.cr);gl.uniform1f(this.uniforms.tolerance,key.tolerance);gl.uniform1f(this.uniforms.softness,key.softness);gl.uniform1f(this.uniforms.greenSpill,key.greenSpill);gl.uniform1f(this.uniforms.blueSpill,key.blueSpill);gl.uniform1i(this.uniforms.showMatte,key.matte?1:0);gl.drawArrays(gl.TRIANGLES,0,3);
    return !gl.isContextLost()&&gl.getError()===gl.NO_ERROR;
  }
  dispose(){this.gl.deleteTexture(this.texture);this.gl.deleteProgram(this.program);this.gl.getExtension('WEBGL_lose_context')?.loseContext();this.canvas.width=this.canvas.height=0;}
}

/** Compatibility fallback for systems where Electron cannot create a WebGL2 context. */
export function paintChromaCpu(canvas:HTMLCanvasElement,source:CanvasImageSource,width:number,height:number,key:ChromaKey){
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const context=canvas.getContext('2d',{alpha:true,willReadFrequently:true})!;context.globalCompositeOperation='copy';context.globalAlpha=1;context.filter='none';context.drawImage(source,0,0,width,height);
  const image=context.getImageData(0,0,width,height),pixels=image.data;
  for(let index=0;index<pixels.length;index+=4){const result=applyChromaPixel(pixels[index],pixels[index+1],pixels[index+2],pixels[index+3],key);if(key.matte){pixels[index]=pixels[index+1]=pixels[index+2]=result.alpha;pixels[index+3]=255;}else{pixels[index]=result.red;pixels[index+1]=result.green;pixels[index+2]=result.blue;pixels[index+3]=result.alpha;}}
  context.putImageData(image,0,0);return canvas;
}

export function sampleSourceColor(source:CanvasImageSource,sourceWidth:number,sourceHeight:number,u:number,v:number,canvas=document.createElement('canvas')){
  if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1||sourceWidth<1||sourceHeight<1)throw Error('スポイトの位置が素材の範囲外です。');
  const width=Math.max(1,Math.round(sourceWidth)),height=Math.max(1,Math.round(sourceHeight)),sampleWidth=Math.min(5,width),sampleHeight=Math.min(5,height);
  const centerX=Math.max(0,Math.min(width-1,Math.floor(u*width))),centerY=Math.max(0,Math.min(height-1,Math.floor(v*height)));
  const left=Math.max(0,Math.min(width-sampleWidth,centerX-Math.floor(sampleWidth/2))),top=Math.max(0,Math.min(height-sampleHeight,centerY-Math.floor(sampleHeight/2)));
  if(canvas.width!==sampleWidth||canvas.height!==sampleHeight){canvas.width=sampleWidth;canvas.height=sampleHeight;}
  const context=canvas.getContext('2d',{alpha:true,willReadFrequently:true})!;context.globalCompositeOperation='copy';context.globalAlpha=1;context.filter='none';context.drawImage(source,left,top,sampleWidth,sampleHeight,0,0,sampleWidth,sampleHeight);
  return averageSampleColor(context.getImageData(0,0,sampleWidth,sampleHeight).data);
}
