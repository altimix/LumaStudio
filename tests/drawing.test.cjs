const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {soundWave,SOUNDS,soundDurationForFps}=require('../shared/sounds.mjs');const {soundFile}=require('../electron/sounds.cjs');const {validateGraphic}=require('../shared/graphics.mjs');const {probe,run,ffmpeg}=require('../electron/media.cjs');
test('original synthesized cues are bounded, decodable stereo PCM with clean endings and stable persistent files',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'luma-cues-'));try{
    const fingerprints=new Set();
    for(const sound of SOUNDS){const bytes=soundWave(sound.id),file=await soundFile(folder,sound.id),info=await probe(file);assert.equal(info.streams[0].channels,2);assert.equal(info.streams[0].sample_rate,'48000');assert.ok(Math.abs(Number(info.format.duration)-sound.duration)<.001);assert.equal(await soundFile(folder,sound.id),file);assert.deepEqual(await fs.readFile(file),Buffer.from(bytes));
      const pcm=await run(ffmpeg,['-v','error','-i',file,'-ac','1','-f','f32le','pipe:1']);let energy=0,peak=0;for(let i=0;i<pcm.length;i+=4){const x=pcm.readFloatLE(i);energy+=x*x;peak=Math.max(peak,Math.abs(x));}assert.ok(Math.sqrt(energy/(pcm.length/4))>.01);assert.ok(peak<.7);assert.ok(Math.abs(pcm.readFloatLE(pcm.length-4))<.001);fingerprints.add(require('node:crypto').createHash('sha256').update(bytes).digest('hex'));}
    assert.equal(fingerprints.size,3);await assert.rejects(soundFile(folder,'../../arbitrary'),/効果音/);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
test('graphic metadata rejects unsupported shapes, wrong clip kinds and unbounded dimensions',()=>{
  const c={kind:'title',graphic:{shape:'rectangle',width:400,height:200,lineWidth:8,fill:false,fillColor:'#ffffff'}};assert.doesNotThrow(()=>validateGraphic(c));
  for(const graphic of [null,{...c.graphic,shape:'script'},{...c.graphic,width:Infinity},{...c.graphic,height:16001},{...c.graphic,lineWidth:0},{...c.graphic,fillColor:'red'},{...c.graphic,flipX:1}])assert.throws(()=>validateGraphic({...c,graphic}),/図形/);
  assert.throws(()=>validateGraphic({...c,kind:'audio'}),/図形/);
});


test('short cues pad with silence to one frame at low FPS without changing their audible samples',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'luma-short-cues-'));try{
    const original=Buffer.from(soundWave('ping'));
    for(const fps of [1,2,3]){const file=await soundFile(folder,'ping',1/fps),asset=await require('../electron/media.cjs').inspectMedia(file,path.join(folder,'cache')),bytes=await fs.readFile(file);assert.ok(asset.duration>=1/fps-1e-6);assert.deepEqual(bytes.subarray(44,original.length),original.subarray(44));assert.ok(bytes.subarray(original.length).every(b=>b===0));
      const p={version:1,id:'low-fps',name:'Low FPS',width:320,height:180,fps,assets:[asset],markers:[],tracks:[{id:'a',name:'audio',kind:'audio',muted:false,hidden:false,locked:false,solo:false}],clips:[{id:'cue',assetId:asset.id,trackId:'a',name:'ping',kind:'audio',start:0,in:0,duration:1/fps,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:.65,fadeIn:0,fadeOut:0,text:'',fontSize:94,color:'#ffffff',textStyle:'hero'}]};assert.doesNotThrow(()=>require('../electron/export.cjs').validateProject(p));
    }
    for(const invalid of [-1,Infinity,2,null])await assert.rejects(soundFile(folder,'ping',invalid),/効果音/);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

test('revised cues preserve legacy files and the unchanged chime',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'luma-cue-versions-'));
  try{
    const legacy=path.join(folder,'original-sounds-v1');await fs.mkdir(legacy);
    const oldBytes=Buffer.from(soundWave('chime'));
    assert.equal(require('node:crypto').createHash('sha256').update(oldBytes).digest('hex'),'9f95e5f0b27df901bf431931414378e888f35f20f9cccf0fd5f668cd5b17a9c2');
    for(const name of ['pop.wav','jingle.wav','jingle-48000.wav'])await fs.writeFile(path.join(legacy,name),oldBytes);
    for(const id of ['ping','jingle']){
      const file=await soundFile(folder,id);assert.notEqual(path.dirname(file),legacy);
      assert.notDeepEqual(await fs.readFile(file),oldBytes);
    }
    assert.equal(await soundFile(folder,'chime'),path.join(legacy,'chime.wav'));
    for(const name of ['pop.wav','jingle.wav','jingle-48000.wav'])assert.deepEqual(await fs.readFile(path.join(legacy,name)),oldBytes);
    await assert.rejects(soundFile(folder,'pop'),/効果音/);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

test('frame padding stays bounded and supports the full jingle in one-FPS projects',async()=>{
  for(const fps of [0,121,NaN,null,1.5])assert.throws(()=>soundDurationForFps('ping',fps),/フレームレート/);
  assert.throws(()=>soundDurationForFps('pop',30),/効果音/);
  const original=Buffer.from(soundWave('jingle')),padded=Buffer.from(soundWave('jingle',soundDurationForFps('jingle',1)));
  assert.equal((padded.length-44)/4/48000,2);
  assert.deepEqual(padded.subarray(44,original.length),original.subarray(44));assert.ok(padded.subarray(original.length).every(b=>b===0));
  assert.throws(()=>soundWave('jingle',2.01),/効果音/);
});
