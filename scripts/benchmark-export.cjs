const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { performance } = require('node:perf_hooks');
const { inspectMedia, probe } = require('../electron/media.cjs');
const { exportProject } = require('../electron/export.cjs');
const { exportEncoders } = require('../electron/encoders.cjs');
(async () => {
 const folder = path.resolve(process.argv[2] || 'test-results/export-benchmark'); await fs.mkdir(folder, { recursive: true });
 const asset = await inspectMedia(path.resolve('public/demo/01-journey.mp4'), path.join(folder, 'cache'));
 const clip = {id:'clip',assetId:asset.id,trackId:'video',kind:'video',name:'実写相当のデモ映像',start:0,in:0,duration:8,speed:1,scale:1,x:0,y:0,rotation:0,opacity:1,volume:1,exposure:0,contrast:1,saturation:1,fadeIn:0,fadeOut:0};
 const p = {version:1,id:'benchmark',name:'書き出し速度比較',width:1920,height:1080,fps:30,assets:[asset],tracks:[{id:'video',kind:'video',name:'映像'}],markers:[],clips:[clip]};
 const capabilities = await exportEncoders.detect(), results = [];
 for (const [width,height] of [[1920,1080],[3840,2160]]) {
  for (const encoder of ['cpu',...capabilities.encoders.filter(e=>e.available&&e.id!=='cpu').map(e=>e.id)]) {
   const output = path.join(folder, `${height}-${encoder}.mp4`), started = performance.now();
   await exportProject(p,{width,height,fps:30,quality:'standard',encoder},output);
   const seconds = (performance.now()-started)/1000, info=await probe(output), bytes=(await fs.stat(output)).size;
   const result={width,height,encoder,seconds,bytes,duration:Number(info.format.duration)}; results.push(result); console.log(JSON.stringify(result));
  }
 }
 await fs.writeFile(path.join(folder,'results.json'),JSON.stringify({platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,source:'public/demo/01-journey.mp4',quality:'standard (encoder-specific quality controls; not identical bitrates)',results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
