import { transitionShader } from '../shared/video-transitions.mjs';

/** Two texture samples per pixel; no CPU pixel readback or worker round-trip. */
export class GpuTransition {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private textures: WebGLTexture[] = [];
  private textureWidth = 0;
  private textureHeight = 0;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  get lost() { return this.gl.isContextLost(); }
  constructor() {
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const shaders: WebGLShader[] = [];
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error('Shader unavailable');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
      return shader;
    };
    try {
    const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}');
    const fragment = compile(gl.FRAGMENT_SHADER, transitionShader());
    const program = gl.createProgram();
    if (!program) throw new Error('Program unavailable');
    this.program = program; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Transition shader link failed');
    gl.useProgram(program);
    for (const name of ['resolution','progress','kind']) this.uniforms[name] = gl.getUniformLocation(program,name);
    for (const unit of [0,1]) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Texture unavailable');
      this.textures.push(texture); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(program, unit ? 'rightImage' : 'leftImage'), unit);
    }
    } catch (error) { this.dispose(); throw error; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
  }
  render(kind: 'pageTurn' | 'pagePeel', a: HTMLCanvasElement, b: HTMLCanvasElement, progress: number): boolean {
    const gl = this.gl;
    if (gl.isContextLost()) return false;
    const resize = this.textureWidth !== a.width || this.textureHeight !== a.height;
    if (resize) {
      const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
      if (a.width > Math.min(limit, viewport[0]) || a.height > Math.min(limit, viewport[1])) return false;
    }
    if (this.canvas.width !== a.width || this.canvas.height !== a.height) { this.canvas.width = a.width; this.canvas.height = a.height; }
    gl.viewport(0,0,a.width,a.height); gl.useProgram(this.program!);
    for (const [unit, source] of [a,b].entries()) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D,this.textures[unit]);
      if (resize) gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source);
    }
    this.textureWidth = a.width; this.textureHeight = a.height;
    if (resize && gl.getError() !== gl.NO_ERROR) return false;
    gl.uniform2f(this.uniforms.resolution,a.width,a.height);
    gl.uniform1f(this.uniforms.progress,Math.max(0,Math.min(1,progress)));
    gl.uniform1i(this.uniforms.kind,kind==='pageTurn'?1:2);
    gl.drawArrays(gl.TRIANGLES,0,3);
    return !gl.isContextLost();
  }
  dispose() {
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    if (this.program) this.gl.deleteProgram(this.program); this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.width = this.canvas.height = 0;
  }
  reset() {
    const gl=this.gl;
    for(const [unit,texture]of this.textures.entries()){
      gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    }
    this.canvas.width=this.canvas.height=2;
    this.textureWidth=this.textureHeight=0;
  }
}

/** Reuse compiled programs between joins; keep context churn and memory bounded. */
export class GpuTransitionPool {
  private idle:GpuTransition[]=[];private leased=new Set<GpuTransition>();private closed=false;
  constructor(private create=()=>new GpuTransition()){}
  take(){
    if(this.closed||this.leased.size>=4)throw Error('Transition GPU pool unavailable');
    let gpu=this.idle.pop();
    if(gpu?.lost){gpu.dispose();gpu=undefined;}
    gpu ||= this.create();this.leased.add(gpu);return gpu;
  }
  release(gpu:GpuTransition){
    if(!this.leased.delete(gpu))return;
    if(this.closed||gpu.lost||this.idle.length>=2)gpu.dispose();
    else{gpu.reset();this.idle.push(gpu);}
  }
  dispose(){this.closed=true;for(const gpu of [...this.idle,...this.leased])gpu.dispose();this.idle=[];this.leased.clear();}
}
