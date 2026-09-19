const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { ffmpeg } = require('./media.cjs');
const canceled=()=>new Error('書き出しをキャンセルしました。');

function pngFrame(data,width,height) {
  if(typeof data!=='string'||data.length>64*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))throw new Error('テキストのフレーム画像が不正です。');
  const bytes=Buffer.from(data.slice('data:image/png;base64,'.length),'base64');
  if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(12,16).toString()!=='IHDR'||bytes.readUInt32BE(16)!==width||bytes.readUInt32BE(20)!==height)throw new Error('テキストのフレーム画像のサイズが不正です。');
  return bytes;
}

// One bounded request at a time. Only its random ID can complete it; renderers
// cannot choose a filesystem path or create work outside the active export.
function createTitleFrameBroker(send,{timeoutMs=30000}={}) {
  let pending;
  return {
    request(clip,time,width,height,projectWidth,signal) {
      if(pending)return Promise.reject(new Error('テキストのフレーム作成が重複しました。'));
      if(signal?.aborted)return Promise.reject(canceled());
      return new Promise((resolve,reject)=>{
        const id=randomUUID();
        const finish=(error,data)=>{if(pending?.id!==id)return;clearTimeout(timer);signal?.removeEventListener('abort',abort);pending=undefined;error?reject(error):resolve(data);};
        const abort=()=>finish(canceled()),timer=setTimeout(()=>finish(new Error('テキストのフレーム作成がタイムアウトしました。')),timeoutMs);
        pending={id,finish,width,height};signal?.addEventListener('abort',abort,{once:true});
        try{send({id,clip,time,width,height,projectWidth});}catch(error){finish(error);}
      });
    },
    finish(id,data,error) {
      if(!pending||id!==pending.id)return false;
      try { if(error)throw new Error(typeof error==='string'?error.slice(0,500):'テキスト画像を作成できませんでした。');pending.finish(null,pngFrame(data,pending.width,pending.height)); }
      catch(failure){pending.finish(failure);}
      return true;
    },
  };
}

async function writeFrameSequence(file,{fps,frames,format='png',frame,signal,onFrame=()=>{},spawnProcess=spawn}) {
  if(signal?.aborted)throw canceled();
  const args=['-v','error','-y','-f','image2pipe','-framerate',String(fps),'-vcodec',format,'-i','pipe:0','-an','-c:v',format==='png'?'qtrle':'ffv1','-pix_fmt',format==='png'?'argb':'gray',file];
  const child=spawnProcess(ffmpeg,args,{windowsHide:true,stdio:['pipe','ignore','pipe']});
  let stderr='',failure;
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4000);});
  child.stdin.on('error',error=>{failure=error;});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>signal?.aborted?reject(canceled()):code===0?resolve():reject(new Error(stderr||`フレーム動画を作成できませんでした (${code})。`)));});
  done.catch(()=>{});
  const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
  const early=done.then(()=>{throw new Error('フレーム動画の作成が途中で終了しました。');});early.catch(()=>{});
  try {
    for(let index=0;index<frames;index++){
      if(signal?.aborted)throw canceled();if(failure)throw failure;
      const bytes=await Promise.race([Promise.resolve().then(()=>frame(index/fps,index)),early]);
      if(!Buffer.isBuffer(bytes)||bytes.length>64*1024*1024)throw new Error('フレーム画像が不正です。');
      await Promise.race([new Promise((resolve,reject)=>child.stdin.write(bytes,error=>error?reject(error):resolve())),early]);
      onFrame((index+1)/frames);
    }
    child.stdin.end();await done;
  }finally{signal?.removeEventListener('abort',abort);child.stdin.destroy();if(child.exitCode===null)child.kill();await done.catch(()=>{});}
}
module.exports={pngFrame,createTitleFrameBroker,writeFrameSequence};
