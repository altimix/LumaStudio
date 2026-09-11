const { ffmpeg, run } = require('./media.cjs');
const ENCODERS = [
  { id:'videotoolbox', codec:'h264_videotoolbox', label:'Apple ハードウェア（VideoToolbox）' },
  { id:'nvenc', codec:'h264_nvenc', label:'NVIDIA GPU（NVENC）' },
  { id:'qsv', codec:'h264_qsv', label:'Intel GPU（Quick Sync）' },
  { id:'amf', codec:'h264_amf', label:'AMD GPU（AMF）' },
  { id:'cpu', codec:'libx264', label:'CPU（ソフトウェア）' },
];
function validateEncoder(value = 'cpu') {
  if (value !== 'auto' && !ENCODERS.some(e=>e.id===value)) throw new Error('書き出し方式を選び直してください。');
  return value;
}
function encodingArgs(id, quality = 'standard') {
  validateEncoder(id); if(id==='auto') throw new Error('GPUの確認が完了していません。');
  if(!['draft','standard','high'].includes(quality))throw new Error('書き出し品質を選び直してください。');
  const q=quality==='high'?'18':quality==='draft'?'26':'21';
  if(id==='videotoolbox')return ['-c:v','h264_videotoolbox','-allow_sw','0','-q:v',quality==='high'?'75':quality==='draft'?'50':'65'];
  if(id==='nvenc')return ['-c:v','h264_nvenc','-preset',quality==='draft'?'p1':quality==='high'?'p6':'p4','-tune','hq','-rc','vbr','-cq',q,'-b:v','0'];
  if(id==='qsv')return ['-c:v','h264_qsv','-preset',quality==='draft'?'veryfast':quality==='high'?'slow':'medium','-global_quality:v',q];
  if(id==='amf')return ['-c:v','h264_amf','-usage','transcoding','-quality',quality==='draft'?'speed':quality==='high'?'quality':'balanced','-rc','cqp','-qp_i',q,'-qp_p',q,'-qp_b',q];
  return ['-c:v','libx264','-preset',quality==='draft'?'ultrafast':'medium','-crf',q,'-threads','4'];
}
function createEncoderDetector(probe = async id => {
  await run(ffmpeg,['-v','error','-f','lavfi','-i','color=s=320x180:r=30','-frames:v','3',...encodingArgs(id),'-pix_fmt','yuv420p','-f','null','-'],{signal:AbortSignal.timeout(8000)});
}) {
  let cached, expires=0, pending;
  async function detect(refresh = false) {
    if(pending)return pending;
    if(cached && !refresh && Date.now()<expires)return cached;
    pending=(async()=>{
      const encoders=await Promise.all(ENCODERS.map(async e=>{
        if(e.id==='cpu')return {...e,available:true};
        try{await probe(e.id);return {...e,available:true};}
        catch{return {...e,available:false,reason:'この方式は同梱FFmpegまたはこのPCでは利用できません。GPUドライバーと対応環境を確認するか、CPU方式をご利用ください。'};}
      }));
      cached={encoders,recommended:encoders.find(e=>e.available).id};expires=Date.now()+60000;return cached;
    })().finally(()=>{pending=undefined;});
    return pending;
  }
  return { detect, async resolve(value) {
    const id=validateEncoder(value);if(id==='cpu')return ENCODERS.find(e=>e.id==='cpu');
    const result=await detect(),chosen=result.encoders.find(e=>e.id===(id==='auto'?result.recommended:id));
    if(!chosen?.available)throw new Error(`${chosen?.label||'GPU'}を利用できません。「自動」または「CPU」を選んでください。`);
    return chosen;
  } };
}
const exportEncoders=createEncoderDetector();
module.exports={ENCODERS,validateEncoder,encodingArgs,createEncoderDetector,exportEncoders};
