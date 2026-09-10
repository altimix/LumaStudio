import { GpuTransition } from './gpu-transition';
import type { GpuTransitionPool } from './gpu-transition';
export type TransitionFrameStamp = { time:number;revision:number;width:number;height:number;kind:string };

/** Direct composition normally; bounded, single-flight CPU work as fallback. */
export class TransitionPreview {
  private worker?: Worker;
  private pending=false;private disposed=false;private failed=false;private gpuUnavailable=false;
  private gpu?:GpuTransition;private dissolve?:HTMLCanvasElement;
  private kind?:string;private revision=0;private workerRevision=0;
  private inputWidth=0;private inputHeight=0;
  private projectRevision?:number;
  private workerStamp?:TransitionFrameStamp;
  frameStamp?:TransitionFrameStamp;
  bitmap:ImageBitmap|HTMLCanvasElement|undefined;key:string|undefined;
  backend:'canvas'|'gpu'|'worker'='worker';
  get hasFrame(){return !!this.bitmap&&!(this.backend==='gpu'&&this.gpu?.lost);}
  constructor(private onError:(message:string)=>void,private pool?:GpuTransitionPool){}
  private releaseGpu(){if(this.gpu){if(this.pool)this.pool.release(this.gpu);else this.gpu.dispose();this.gpu=undefined;}}
  private present(bitmap:ImageBitmap|HTMLCanvasElement,key:string,stamp?:TransitionFrameStamp){
    if(this.bitmap!==bitmap&&this.bitmap instanceof ImageBitmap)this.bitmap.close();
    this.bitmap=bitmap;this.key=key;this.frameStamp=stamp;
  }
  private fail(message:string){if(this.disposed||this.failed)return;this.failed=true;this.pending=false;this.onError('トランジションのプレビューを準備できません。'+message);}
  request(key:string,kind:'dissolve'|'pageTurn'|'pagePeel',a:HTMLCanvasElement,b:HTMLCanvasElement,progress:number,stamp?:TransitionFrameStamp){
    if(this.disposed||this.failed)return;
    const resized=this.inputWidth!==a.width||this.inputHeight!==a.height;
    if(resized){this.inputWidth=a.width;this.inputHeight=a.height;this.gpuUnavailable=false;}
    if(this.kind!==kind||this.projectRevision!==stamp?.revision||resized){this.kind=kind;this.projectRevision=stamp?.revision;this.revision++;}
    if(this.key===key&&!(this.backend==='gpu'&&this.gpu?.lost))return;
    if(kind==='dissolve'){
      const canvas=this.dissolve ||= document.createElement('canvas');
      if(canvas.width!==a.width||canvas.height!==a.height){canvas.width=a.width;canvas.height=a.height;}
      const context=canvas.getContext('2d')!,p=Math.max(0,Math.min(1,progress));
      context.clearRect(0,0,canvas.width,canvas.height);
      context.globalCompositeOperation='source-over';context.globalAlpha=1-p;context.drawImage(a,0,0);
      context.globalCompositeOperation='lighter';context.globalAlpha=p;context.drawImage(b,0,0);
      context.globalCompositeOperation='source-over';context.globalAlpha=1;
      this.backend='canvas';this.present(canvas,key,stamp);return;
    }
    if(!this.gpuUnavailable){
      try{this.gpu ||= this.pool?this.pool.take():new GpuTransition();if(this.gpu.render(kind,a,b,progress)){this.backend='gpu';this.present(this.gpu.canvas,key,stamp);return;}}
      catch{/* Keep editing on systems without a usable GPU context. */}
      if(this.bitmap===this.gpu?.canvas){this.bitmap=undefined;this.key=undefined;this.frameStamp=undefined;}
      this.releaseGpu();this.gpuUnavailable=true;
    }
    this.backend='worker';
    if(this.pending)return;this.pending=true;
    if(!this.worker){
      try{this.worker=new Worker(new URL('./transition-worker.ts',import.meta.url),{type:'module'});}
      catch(error){this.fail((error as Error).message);return;}
      this.worker.onmessage=({data}:{data:{key:string;bitmap?:ImageBitmap;error?:string}})=>{
        this.pending=false;if(this.disposed||this.workerRevision!==this.revision){data.bitmap?.close();return;}
        if(data.error){this.fail(data.error);return;}if(data.bitmap)this.present(data.bitmap,data.key,this.workerStamp);
      };
      this.worker.onerror=event=>{
        event.preventDefault();this.worker?.terminate();this.worker=undefined;this.pending=false;
        if(this.workerRevision===this.revision)this.fail(event.message);
      };
    }
    const revision=this.revision;this.workerRevision=revision;this.workerStamp=stamp;
    const ratio=Math.min(1,640/Math.max(a.width,a.height)),width=Math.max(2,Math.round(a.width*ratio)),height=Math.max(2,Math.round(a.height*ratio));
    void Promise.allSettled([createImageBitmap(a,{resizeWidth:width,resizeHeight:height}),createImageBitmap(b,{resizeWidth:width,resizeHeight:height})]).then(results=>{
      const bitmaps=results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]),failed=results.find(result=>result.status==='rejected');
      if(this.disposed||revision!==this.revision||failed){for(const bitmap of bitmaps)bitmap.close();this.pending=false;if(revision===this.revision&&failed?.status==='rejected')this.fail(String(failed.reason));return;}
      const [left,right]=bitmaps;
      try{this.worker!.postMessage({key,kind,a:left,b:right,width,height,progress},[left,right]);}catch(error){left.close();right.close();this.fail((error as Error).message);}
    }).catch(error=>this.fail((error as Error).message));
  }
  dispose(){this.disposed=true;this.worker?.terminate();if(this.bitmap instanceof ImageBitmap)this.bitmap.close();this.bitmap=undefined;this.releaseGpu();if(this.dissolve)this.dissolve.width=this.dissolve.height=0;}
}
