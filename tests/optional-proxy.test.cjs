const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {ffmpeg,run,inspectMedia,probe}=require('../electron/media.cjs');const {hydrateProject,serializeProject}=require('../electron/project.cjs');
test('optional video proxies preserve original metadata, persist preferences and decode smaller frames',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-proxy-'));try{
 const file=path.join(dir,'原本.mp4');await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30:duration=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','aac','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',file]);
 const cache=path.join(dir,'cache'),original=await inspectMedia(file,cache),proxy=await inspectMedia(file,cache,{previewProxy:true});
 assert.equal(original.proxy,false);assert.equal(proxy.proxy,true);assert.equal(proxy.previewProxy,true);assert.equal(proxy.path,file);assert.equal(proxy.id,original.id);assert.equal(proxy.width,1920);assert.equal(proxy.duration,original.duration);
 const info=await probe(proxy.playbackPath);assert.equal(info.streams[0].width,1280);assert.equal(info.streams[0].height,720);
 const project={version:1,id:'p',name:'proxy',width:1920,height:1080,fps:30,assets:[proxy],clips:[],tracks:[{id:'v',kind:'video'}],markers:[]};const saved=JSON.parse(serializeProject(project));assert.equal(saved.assets[0].playbackPath,undefined);
 const hydrated=await hydrateProject(saved,(file,options)=>inspectMedia(file,cache,options),a=>a);assert.equal(hydrated.assets[0].previewProxy,true);assert.equal(hydrated.assets[0].playbackPath,proxy.playbackPath);
 const fallback=await hydrateProject(saved,async(file,options)=>{if(options.previewProxy)throw Error('disk full');return inspectMedia(file,path.join(dir,'cannot-write'),options);},a=>a);
 assert.ok(saved.assets[0].waveform.length>0);assert.deepEqual(fallback.assets[0].waveform,saved.assets[0].waveform);assert.equal(fallback.assets[0].offline,undefined);assert.equal(fallback.assets[0].playbackPath,file);assert.equal(fallback.assets[0].previewProxy,undefined);assert.match(fallback.assets[0].proxyWarning,/原本/);assert.equal(JSON.parse(serializeProject(fallback)).assets[0].proxyWarning,undefined);
 await assert.rejects(fs.access(path.join(dir,'cannot-write')));
 const disabled=await inspectMedia(file,cache);assert.equal(disabled.previewProxy,undefined);assert.equal(disabled.playbackPath,file);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('cancelling proxy generation removes temporary output and leaves original reusable',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-proxy-'));try{
 const file=path.join(dir,'原本.mp4'),cache=path.join(dir,'cache');await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=blue:size=640x360:rate=30:duration=1','-c:v','libx264',file]);
 const controller=new AbortController();await assert.rejects(inspectMedia(file,cache,{previewProxy:true,signal:controller.signal,onStage:stage=>{if(stage.includes('軽量'))controller.abort();}}));
 assert.equal((await fs.readdir(cache)).some(name=>name.includes('.tmp')||name.endsWith('-proxy.mp4')),false);assert.equal((await inspectMedia(file,cache)).path,file);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
