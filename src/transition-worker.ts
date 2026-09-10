import { blendTransition } from '../shared/video-transitions.mjs';
type Frame = { key:string;kind:'dissolve'|'pageTurn'|'pagePeel';a:ImageBitmap;b:ImageBitmap;width:number;height:number;progress:number };
const scope=self as unknown as {onmessage:((event:MessageEvent<Frame>)=>void)|null;postMessage(value:unknown,transfer?:Transferable[]):void};
let a=new OffscreenCanvas(2,2),b=new OffscreenCanvas(2,2),out=new OffscreenCanvas(2,2);
const ac=a.getContext('2d',{willReadFrequently:true})!,bc=b.getContext('2d',{willReadFrequently:true})!,oc=out.getContext('2d')!;
let output:ImageData|undefined;
scope.onmessage=({data:frame})=>{
  try{
    if(a.width!==frame.width||a.height!==frame.height){for(const canvas of [a,b,out]){canvas.width=frame.width;canvas.height=frame.height;}output=undefined;}
    ac.clearRect(0,0,a.width,a.height);bc.clearRect(0,0,b.width,b.height);ac.drawImage(frame.a,0,0);bc.drawImage(frame.b,0,0);
    output ||= oc.createImageData(a.width,a.height);
    blendTransition(frame.kind,ac.getImageData(0,0,a.width,a.height).data,bc.getImageData(0,0,b.width,b.height).data,output.data,a.width,a.height,frame.progress);
    oc.putImageData(output,0,0);const bitmap=out.transferToImageBitmap();scope.postMessage({key:frame.key,bitmap},[bitmap]);
  }catch(error){scope.postMessage({error:(error as Error).message});}finally{frame.a.close();frame.b.close();}
};
