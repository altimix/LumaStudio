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
