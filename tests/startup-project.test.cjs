const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {readStartupProject}=require('../electron/startup-project.cjs');
const {bundleStartupProject,hash}=require('../scripts/bundle-startup-project.cjs');
const {timelineKey}=require('../shared/youtube.mjs');
const {rebaseStartupYoutube}=require('../electron/startup-project.cjs');
const {ffmpeg,run,inspectMedia}=require('../electron/media.cjs');
async function fixture(file,color='blue'){await run(ffmpeg,['-v','error','-y','-f','lavfi','-i',`color=${color}:s=320x180`,'-frames:v','1','-update','1',file]);}
test('a bundled template relocates, verifies its media and preserves editable YouTube data as stale',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'luma-template-'));
  try{
    const media=path.join(root,'素材.png'),source=path.join(root,'source.luma');await fixture(media);
    const asset=await inspectMedia(media,path.join(root,'cache'));
    const project={version:1,id:'original',name:'template',width:320,height:180,fps:30,tracks:[],clips:[],markers:[],assets:[asset]};
    project.youtube={sourceKey:timelineKey(project),cues:[],titles:['保存したタイトル'],description:'概要欄',chapters:[],keywords:[],thumbnailPrompt:'',thumbnailAssetId:asset.id};
    await fs.writeFile(source,JSON.stringify(project));const before=await hash(source);
    const directory=path.join(root,'bundle'),manifest=await bundleStartupProject(source,directory);assert.equal(manifest.sourceProjectSha256,before);assert.equal(await hash(source),before);
    const moved=path.join(root,'moved');await fs.rename(directory,moved);await fs.unlink(media);
    const loaded=await readStartupProject(moved);assert.notEqual(loaded.id,project.id);assert.notEqual(loaded.assets[0].id,asset.id);assert.notEqual((await readStartupProject(moved)).assets[0].id,loaded.assets[0].id);
    assert.equal(await hash(loaded.assets[0].path),manifest.files[1].sha256);assert.equal(loaded.assets[0].url,undefined);
    assert.equal(loaded.youtube.thumbnailAssetId,loaded.assets[0].id);assert.notEqual(loaded.youtube.sourceKey,timelineKey(loaded));assert.deepEqual(loaded.youtube.titles,project.youtube.titles);
    assert.equal(await readStartupProject(path.join(root,'missing')),null);
    const incomplete=path.join(root,'incomplete');await fs.mkdir(incomplete);await assert.rejects(readStartupProject(incomplete),/すべて展開/);
    const originalBytes=await fs.readFile(loaded.assets[0].path);await fs.unlink(loaded.assets[0].path);await assert.rejects(readStartupProject(moved),/すべて再展開/);
    await fixture(loaded.assets[0].path,'red');await assert.rejects(readStartupProject(moved),/初期素材が変更/);await fs.writeFile(loaded.assets[0].path,originalBytes);
    await fs.rename(path.join(moved,'manifest.json'),path.join(moved,'manifest.saved'));
    const unverified=await readStartupProject(moved);assert.notEqual(unverified.youtube.sourceKey,timelineKey(unverified));
    await fs.rename(path.join(moved,'manifest.saved'),path.join(moved,'manifest.json'));
    const file=path.join(moved,'初期プロジェクト.luma'),saved=JSON.parse(await fs.readFile(file,'utf8'));
    for(const value of ['../source.luma',source,'media/../../source.luma']){await fs.writeFile(file,JSON.stringify({...saved,assets:[{...saved.assets[0],path:value}]}));await assert.rejects(readStartupProject(moved),/相対パス|フォルダの外/);}
    await assert.rejects(bundleStartupProject(source,moved),/exist/i);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('copy rebasing follows audio paths and revisions but preserves previously stale YouTube data',()=>{
  const original={id:'original',fps:30,tracks:[{id:'a'}],assets:[{id:'sound',path:'C:/old.wav',size:10,duration:2,hasAudio:true}],clips:[{id:'c',assetId:'sound',trackId:'a',kind:'audio',start:0,in:0,duration:2,speed:1,volume:1,fadeIn:0,fadeOut:0}]};
  original.youtube={sourceKey:timelineKey(original),cues:[{id:'cue',start:0,end:1,text:'字幕'}]};
  const copy={...original,id:'new',assets:[{...original.assets[0],path:'C:/bundle/new.wav',revision:'new-revision'}]};
  const current=rebaseStartupYoutube(original,copy);assert.equal(current.youtube.sourceKey,timelineKey(copy));assert.deepEqual(current.youtube.cues,original.youtube.cues);
  original.youtube.sourceKey='stale';assert.equal(rebaseStartupYoutube(original,copy).youtube.sourceKey,'stale');
});

test('invalid source projects fail before creating a completed or partial bundle',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'luma-invalid-template-'));
  try{
    const base={version:1,id:'original',name:'template',width:320,height:180,fps:30,tracks:[],clips:[],markers:[],assets:[]};
    for(const [index,project] of [{...base,version:999},{...base,width:-1},{...base,clips:[{id:'missing',assetId:'unknown'}]}].entries()){
      const source=path.join(root,`${index}.luma`),output=path.join(root,`bundle-${index}`);await fs.writeFile(source,JSON.stringify(project));
      await assert.rejects(bundleStartupProject(source,output));await assert.rejects(fs.stat(output),{code:'ENOENT'});
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('a failed media copy leaves no published folder and can be retried at the same destination',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'luma-atomic-template-'));
  try{
    const source=path.join(root,'source.luma'),media=path.join(root,'missing.png'),output=path.join(root,'bundle');
    const project={version:1,id:'original',name:'template',width:320,height:180,fps:30,tracks:[],clips:[],markers:[],assets:[{id:'image',name:'fixture',kind:'image',path:media,width:320,height:180,fps:0,size:7,duration:5,codec:'png',hasAudio:false,waveform:[]}]};
    await fs.writeFile(source,JSON.stringify(project));await assert.rejects(bundleStartupProject(source,output));
    await assert.rejects(fs.stat(output),{code:'ENOENT'});assert.ok(!(await fs.readdir(root)).some(name=>name.includes('.staging-')));
    await fixture(media);await bundleStartupProject(source,output);assert.ok(await fs.stat(path.join(output,'manifest.json')));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('malformed startup objects and asset entries return concrete format errors',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'luma-format-template-'));
  try{
    for(const value of ['null','[]','1','{"assets":[null]}','{"assets":[[]]}','{']){
      await fs.writeFile(path.join(root,'初期プロジェクト.luma'),value);
      await assert.rejects(readStartupProject(root),/初期プロジェクト.*不正/);
    }
    await fs.writeFile(path.join(root,'初期プロジェクト.luma'),JSON.stringify({assets:[]}));
    for(const value of ['null','{','{"version":1,"files":[null]}']){
      await fs.writeFile(path.join(root,'manifest.json'),value);
      await assert.rejects(readStartupProject(root),/初期素材の検証情報/);
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('corrupt, changed-kind and shortened sources cannot produce a completed bundle',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'luma-media-validation-'));
  try{
    const media=path.join(root,'source.png'),source=path.join(root,'source.luma');await fixture(media);
    const asset=await inspectMedia(media,path.join(root,'cache'));
    const base={version:1,id:'p',name:'template',width:320,height:180,fps:30,tracks:[],clips:[],markers:[],assets:[asset]};
    for(const [i,patch] of [{duration:6},{kind:'audio',hasAudio:true}].entries()){
      await fs.writeFile(source,JSON.stringify({...base,assets:[{...asset,...patch}]}));const output=path.join(root,`invalid-${i}`);
      await assert.rejects(bundleStartupProject(source,output));await assert.rejects(fs.stat(output),{code:'ENOENT'});
    }
    await fs.writeFile(source,JSON.stringify(base));await fs.writeFile(media,'corrupt');const output=path.join(root,'corrupt');
    await assert.rejects(bundleStartupProject(source,output),/同梱する素材/);await assert.rejects(fs.stat(output),{code:'ENOENT'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
