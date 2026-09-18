const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {createBackupHistory}=require('../electron/backup-history.cjs');
const {createRecoveryStore}=require('../electron/recovery.cjs');
const project=(id='p',name='履歴')=>({version:1,id,name,width:1920,height:1080,fps:30,assets:[],tracks:[{id:'v',kind:'video'}],clips:[],markers:[]});
test('retains ten generations per project independently of singleton recovery clearing',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-history-'));try{
 const history=createBackupHistory(path.join(dir,'backups')),recovery=createRecoveryStore(path.join(dir,'autosave.luma'));
 for(let i=0;i<12;i++){const contents=JSON.stringify({savedAt:new Date(1700000000000+i*1000).toISOString(),project:project('a',`版${i}`)});await recovery.write(contents);await history.write(contents);}
 await history.write(JSON.stringify({savedAt:new Date().toISOString(),project:project('b','別の作品')}));
 await recovery.clear();const list=await history.list();assert.equal(list.length,11);assert.equal(list.filter(x=>x.projectId==='a').length,10);assert.equal(list[0].name,'別の作品');
 const latest=list.find(x=>x.projectId==='a');assert.equal(latest.name,'版11');assert.equal((await history.read(latest.id)).project.name,'版11');
 await assert.rejects(history.read('../autosave.luma'),/識別子/);
 await fs.writeFile(path.join(dir,'backups',latest.id),JSON.stringify({project:project('a'),savedAt:0}));assert.equal((await history.list()).length,10);await assert.rejects(history.read(latest.id),/日時/);
 await fs.writeFile(path.join(dir,'backups',latest.id),'broken json');assert.equal((await history.list()).length,10);
 await assert.rejects(history.read(latest.id));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('invalid snapshots do not evict valid backups and concurrent writes stay complete',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-history-'));try{
 const history=createBackupHistory(dir);const contents=JSON.stringify({savedAt:new Date().toISOString(),project:project()});await Promise.all([history.write(contents),history.write(contents)]);
 await assert.rejects(history.write(JSON.stringify({project:{id:'broken'}})));assert.equal((await history.list()).length,2);
 for(const entry of await history.list())assert.equal((await history.read(entry.id)).project.id,'p');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('foreign offline projects remain valid backups after serialization removes offline flags',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-history-'));try{
 const history=createBackupHistory(dir),p=project();p.assets=[{id:'foreign',name:'別PCの映像',path:process.platform==='win32'?'/Users/other/movie.mp4':String.raw`C:\Users\other\movie.mp4`,kind:'video',duration:5,width:1920,height:1080,fps:30,hasAudio:false,codec:'h264',waveform:[],size:100}];
 await history.write(JSON.stringify({savedAt:new Date().toISOString(),project:p}));const list=await history.list();assert.equal(list.length,1);assert.equal((await history.read(list[0].id)).project.assets[0].path,p.assets[0].path);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('corrupt snapshots do not evict healthy generations',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-history-'));try{
 const history=createBackupHistory(dir);for(let i=0;i<10;i++)await history.write(JSON.stringify({savedAt:new Date(1700000000000+i*1000).toISOString(),project:project('p',`版${i}`)}));
 const newest=(await history.list())[0];await fs.writeFile(path.join(dir,newest.id),'broken');await history.write(JSON.stringify({savedAt:new Date().toISOString(),project:project('p','最新版')}));
 const list=await history.list();assert.equal(list.length,10);assert.ok(list.some(entry=>entry.name==='版0'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('legacy recovery imports once, preserves its date and survives singleton clearing',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-history-'));try{
 const file=path.join(dir,'autosave.luma'),contents=JSON.stringify({savedAt:'2024-01-01T00:00:00.000Z',project:project('legacy','旧版')});await fs.writeFile(file,contents);
 const history=createBackupHistory(path.join(dir,'backups'));
 await Promise.all([history.write(contents,{deduplicate:true}),history.write(contents,{deduplicate:true})]);
 assert.equal((await history.list()).length,1);assert.equal(await fs.readFile(file,'utf8'),contents);
 await createRecoveryStore(file).clear();assert.deepEqual(await history.read((await history.list())[0].id),JSON.parse(contents));
 await history.write(JSON.stringify({...JSON.parse(contents),project:project('legacy','同じ日時の別版')}),{deduplicate:true});assert.equal((await history.list()).length,2);
 await assert.rejects(history.write(JSON.stringify({savedAt:'invalid',project:project()}),{deduplicate:true}),/日時/);assert.equal((await history.list()).length,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('importing older recovery never evicts the ten newer saved generations',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-history-'));try{
 const history=createBackupHistory(dir);for(let i=0;i<10;i++)await history.write(JSON.stringify({savedAt:new Date(1700000000000+i*1000).toISOString(),project:project('p',`版${i}`)}));
 await history.write(JSON.stringify({savedAt:'2020-01-01T00:00:00.000Z',project:project('p','古い復元候補')}),{deduplicate:true});
 const entries=await history.list();assert.equal(entries.length,10);assert.ok(entries.some(entry=>entry.name==='版0'));assert.ok(entries.every(entry=>entry.name!=='古い復元候補'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
