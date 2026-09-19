const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { collectProject, resolveProjectMedia, serializeAt, relinkFolder } = require('../electron/portable-project.cjs');
async function fixture(dir) {
  const file = path.join(dir, '日本語 &素材..png'); await fs.writeFile(file, 'original media bytes');
  const stat = await fs.stat(file), id = createHash('sha256').update(path.resolve(file) + stat.size + stat.mtimeMs).digest('hex').slice(0,24);
  const asset = { id, path:file, name:'表示名', kind:'image', duration:5, width:100, height:100, fps:0, hasAudio:false, codec:'png', waveform:[], size:stat.size };
  const clip = { id:'c', assetId:id,trackId:'v',name:'image',kind:'image',start:0,in:0,duration:3,speed:1,scale:1,x:0,y:0,rotation:0,opacity:1,volume:1,exposure:0,contrast:1,saturation:1,fadeIn:0,fadeOut:0 };
  return { version:1,id:'p',name:'持ち運び',width:1280,height:720,fps:30,assets:[asset],tracks:[{id:'v',kind:'video'}],markers:[],clips:[clip] };
}
test('collected projects survive moving their folder and save-as recalculates relative references',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-portable-'));
  try {
    const p=await fixture(dir);p.assets.push({...p.assets[0],id:'unused',path:path.join(dir,'not-present.png')});
    const file=await collectProject(p,dir), moved=path.join(dir,'移動後');await fs.rename(path.dirname(file),moved);
    const destination=path.join(moved,'project.luma'), saved=JSON.parse(await fs.readFile(destination,'utf8'));
    assert.equal(saved.assets.length,1);const resolved=resolveProjectMedia(saved,destination);
    assert.equal(await fs.readFile(resolved.assets[0].path,'utf8'),'original media bytes');
    assert.deepEqual(resolved.clips,p.clips);assert.equal(JSON.parse(serializeAt(resolved,destination)).assets[0].relativePath,saved.assets[0].relativePath);
    assert.equal(JSON.parse(serializeAt(resolved,path.join(dir,'different.luma'))).assets[0].relativePath,undefined);
    assert.equal(await fs.readFile(p.assets[0].path,'utf8'),'original media bytes');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('failed collection removes only its temporary folder and never replaces original files',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-portable-'));
  try {const p=await fixture(dir);await fs.writeFile(p.assets[0].path,'changed');await assert.rejects(collectProject(p,dir),/変更/);assert.deepEqual(await fs.readdir(dir),['日本語 &素材..png']);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('malformed asset entries have a concrete Japanese error',()=>{
 for(const asset of [null,undefined,1,'file',[]])assert.throws(()=>resolveProjectMedia({assets:[asset]},'/tmp/project.luma'),/素材の形式が不正/);
});
test('portable references reject traversal, nested paths and absolute paths',()=>{
  for(const relativePath of ['../secret','media/.','media/..','media/../../secret','/tmp/media/a','media/a/b','media/a\\b','media/a\0b'])assert.throws(()=>resolveProjectMedia({assets:[{relativePath}]},'/tmp/project.luma'),/相対パス/);
});
test('batch relink preserves IDs and returns incompatible or missing assets as unresolved',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-portable-'));
  try {
    const p=await fixture(dir), original={...p.assets[0]};p.assets[0].offline=true;p.assets[0].path='C:\\old\\日本語 &素材..png';
    let result=await relinkFolder(p,dir,async()=>({...original,id:'fresh'}));assert.equal(result.assets[0].id,original.id);assert.equal(result.assets[0].name,original.name);assert.equal(result.unresolved.length,0);
    result=await relinkFolder(p,dir,async()=>({...original,id:'fresh',width:101}));assert.equal(result.assets.length,0);assert.match(result.unresolved[0],/一致/);
    for (const patch of [{duration:6},{hasAudio:true}]) { result=await relinkFolder(p,dir,async()=>({...original,id:'fresh',...patch}));assert.equal(result.assets.length,0);assert.match(result.unresolved[0],/長さまたは音声/); }
    await fs.rm(original.path);result=await relinkFolder(p,dir,async()=>{throw Error('unexpected');});assert.equal(result.unresolved.length,1);assert.equal(p.assets[0].offline,true);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('POSIX relinking preserves backslashes inside media filenames', {skip:process.platform==='win32'}, async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-portable-'));
 try {
  const p=await fixture(dir), original={...p.assets[0]}, filename='take\\final.png';
  await fs.rename(original.path,path.join(dir,filename));p.assets[0].offline=true;p.assets[0].path='/old/'+filename;
  const result=await relinkFolder(p,dir,async file=>{assert.equal(path.basename(file),filename);return {...original,id:'fresh',path:file};});
  assert.equal(result.assets.length,1);assert.deepEqual(result.unresolved,[]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
