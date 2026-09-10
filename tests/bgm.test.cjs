const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {createHash}=require('node:crypto');
const {createBgmLibrary}=require('../electron/bgm.cjs');
async function setup(t){const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'luma-bgm-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function inspected(file){const stat=await fs.stat(file);return {id:createHash('sha256').update(file+stat.size+stat.mtimeMs).digest('hex').slice(0,24),kind:'audio',path:file};}
const info={format:{duration:'123.45'},streams:[{codec_type:'audio'}]};
test('BGM discovery supports Japanese names, nested files and errors without publishing paths as IDs',async t=>{
  const dir=await setup(t),folder=path.join(dir,'bgm');await fs.mkdir(path.join(folder,'場面別'),{recursive:true});for(const name of ['のんびり.mp3','場面別/英雄.wav','壊れた.mp3','説明.txt'])await fs.writeFile(path.join(folder,name),'test');
  const library=createBgmLibrary({configFile:path.join(dir,'settings.json'),candidates:[folder],probe:async file=>{if(file.includes('壊れた'))throw Error();return info;},inspect:inspected,present:a=>({...a,url:'registered'})});
  const result=await library.list();assert.equal(result.tracks.length,2);assert.equal(result.errors.length,1);assert.equal(result.tracks[0].duration,123.45);assert.match(result.tracks[0].id,/^[a-f0-9]{24}$/);assert.equal((await library.load(result.tracks[0].id)).url,'registered');await assert.rejects(library.load(path.join(folder,'のんびり.mp3')));await assert.rejects(library.load(null));
});
test('selected BGM folders persist and refresh detects added songs, while invalid folders do not replace configuration',async t=>{
  const dir=await setup(t),a=path.join(dir,'first'),b=path.join(dir,'second'),configFile=path.join(dir,'config.json');await fs.mkdir(a);await fs.mkdir(b);await fs.writeFile(path.join(b,'学び.mp3'),'test');const options={configFile,candidates:[a],probe:async()=>info,inspect:async()=>({kind:'audio'}),present:a=>a};
  const library=createBgmLibrary(options);assert.equal((await library.list()).tracks.length,0);assert.equal((await library.list(b)).tracks.length,1);await fs.writeFile(path.join(b,'追加.mp3'),'test');assert.equal((await library.list()).tracks.length,2);assert.equal((await createBgmLibrary(options).list()).folder,b);await assert.rejects(library.list(path.join(dir,'absent')));assert.equal(JSON.parse(await fs.readFile(configFile,'utf8')).folder,b);
});
test('empty BGM defaults and video-disguised-as-audio are handled explicitly',async t=>{
  const dir=await setup(t),configFile=path.join(dir,'config.json'),base={configFile,candidates:[],probe:async()=>info,inspect:async()=>({kind:'video'}),present:a=>a};assert.deepEqual(await createBgmLibrary(base).list(),{folder:null,tracks:[],errors:[],truncated:false});
  await fs.writeFile(path.join(dir,'image.mp3'),'x');const library=createBgmLibrary({...base,candidates:[dir]});const result=await library.list();await assert.rejects(library.load(result.tracks[0].id),/音楽/);
  const filtered=await createBgmLibrary({...base,candidates:[dir],probe:async()=>({...info,streams:[...info.streams,{codec_type:'video'}]})}).list();assert.equal(filtered.tracks.length,0);assert.equal(filtered.errors.length,1);
});
test('folder junctions are not traversed outside the chosen BGM folder',async t=>{
  const dir=await setup(t),folder=path.join(dir,'bgm'),outside=path.join(dir,'private');await fs.mkdir(folder);await fs.mkdir(outside);await fs.writeFile(path.join(outside,'hidden.mp3'),'x');await fs.symlink(outside,path.join(folder,'linked'),'junction');
  const library=createBgmLibrary({configFile:path.join(dir,'config.json'),candidates:[folder],probe:async()=>info,inspect:async()=>({}),present:a=>a});assert.equal((await library.list()).tracks.length,0);
});
test('rapidly repeated song requests share one media preparation and can retry after failure',async t=>{
  const dir=await setup(t),file=path.join(dir,'曲.opus');await fs.writeFile(file,'x');let calls=0,finish,ready;
  let started=new Promise(r=>ready=r);const library=createBgmLibrary({configFile:path.join(dir,'config.json'),candidates:[dir],probe:async()=>info,inspect:async()=>{calls++;return new Promise((resolve,reject)=>{finish={resolve,reject};ready();});},present:a=>a});
  const {tracks}=await library.list();const first=library.load(tracks[0].id),second=library.load(tracks[0].id);await started;assert.equal(calls,1);const rejected=[assert.rejects(first),assert.rejects(second)];finish.reject(Error('decode'));await Promise.all(rejected);
  started=new Promise(r=>ready=r);const retry=library.load(tracks[0].id);await started;assert.equal(calls,2);finish.resolve(await inspected(file));assert.equal((await retry).kind,'audio');
});
test('stale BGM IDs and replaced parent junctions are rejected before inspection or publication',async t=>{
  const dir=await setup(t),folder=path.join(dir,'bgm'),sub=path.join(folder,'sub'),outside=path.join(dir,'outside'),file=path.join(sub,'曲.mp3');await fs.mkdir(sub,{recursive:true});await fs.mkdir(outside);await fs.writeFile(file,'original');await fs.writeFile(path.join(outside,'曲.mp3'),'private');let reads=0,published=0;
  const library=createBgmLibrary({configFile:path.join(dir,'config.json'),candidates:[folder],probe:async()=>info,inspect:async f=>{reads++;return inspected(f);},present:a=>{published++;return a;}});
  let {tracks}=await library.list();await fs.writeFile(file,'updated song');await assert.rejects(library.load(tracks[0].id),/更新/);assert.equal(reads,0);({tracks}=await library.list());
  await fs.unlink(file);await fs.rmdir(sub);await fs.symlink(outside,sub,'junction');await assert.rejects(library.load(tracks[0].id),/更新/);assert.equal(reads,0);assert.equal(published,0);
});
test('a file changed during media preparation is revalidated before media registration',async t=>{
  const dir=await setup(t),file=path.join(dir,'曲.mp3');await fs.writeFile(file,'approved');let published=0;
  const library=createBgmLibrary({configFile:path.join(dir,'config.json'),candidates:[dir],probe:async()=>info,inspect:async f=>{const asset=await inspected(f);await fs.writeFile(f,'replaced after inspection');return asset;},present:a=>{published++;return a;}});
  const {tracks}=await library.list();await assert.rejects(library.load(tracks[0].id),/更新/);assert.equal(published,0);
});
for (const [label,root] of [['drive',path.parse(process.cwd()).root],['UNC','\\\\music-server\\songs\\']]) {
  test(`a selected ${label} root includes music in subfolders`,{skip:label==='UNC' && process.platform!=='win32'},async t=>{
    const dir=await setup(t),fixture=path.join(dir,'fixture'),nested=path.join(fixture,'Music');await fs.mkdir(nested,{recursive:true});await fs.writeFile(path.join(nested,'曲.mp3'),'song');
    const realpath=fs.realpath.bind(fs),lstat=fs.lstat.bind(fs),stat=fs.stat.bind(fs),readdir=fs.readdir.bind(fs);
    const virtualNested=path.join(root,'Music'),virtualFile=path.join(virtualNested,'曲.mp3');
    const folders=new Set([root,virtualNested]),files=new Set([...folders,virtualFile]);
    const dirStat=await fs.lstat(fixture),fileStat=await fs.lstat(path.join(nested,'曲.mp3'));
    const rootEntries=await fs.readdir(fixture,{withFileTypes:true}),nestedEntries=await fs.readdir(nested,{withFileTypes:true});
    t.mock.method(fs,'realpath',async file=>files.has(file)?file:realpath(file));
    t.mock.method(fs,'lstat',async file=>folders.has(file)?dirStat:file===virtualFile?fileStat:lstat(file));
    t.mock.method(fs,'stat',async file=>folders.has(file)?dirStat:file===virtualFile?fileStat:stat(file));
    t.mock.method(fs,'readdir',async(file,options)=>file===root?rootEntries:file===virtualNested?nestedEntries:readdir(file,options));
    const probed=[],library=createBgmLibrary({configFile:path.join(dir,'config.json'),candidates:[root],probe:async file=>{probed.push(file);return info;},inspect:inspected,present:a=>a});
    const result=await library.list();assert.equal(result.folder,root);assert.equal(result.tracks.length,1);assert.equal(result.tracks[0].relativePath,path.join('Music','曲.mp3'));assert.deepEqual(result.errors,[]);assert.deepEqual(probed,[virtualFile]);assert.equal((await library.load(result.tracks[0].id)).path,virtualFile);
  });
}
test('a directory replaced after readdir cannot send an outside file to the BGM probe',async t=>{
  const dir=await setup(t),folder=path.join(dir,'bgm'),sub=path.join(folder,'sub'),outside=path.join(dir,'outside');await fs.mkdir(sub,{recursive:true});await fs.mkdir(outside);await fs.writeFile(path.join(sub,'曲.mp3'),'approved');await fs.writeFile(path.join(outside,'曲.mp3'),'private');
  const readdir=fs.readdir.bind(fs);let probes=0;
  t.mock.method(fs,'readdir',async(file,options)=>{const entries=await readdir(file,options);if(file===sub){await fs.unlink(path.join(sub,'曲.mp3'));await fs.rmdir(sub);await fs.symlink(outside,sub,'junction');}return entries;});
  const library=createBgmLibrary({configFile:path.join(dir,'config.json'),candidates:[folder],probe:async()=>{probes++;return info;},inspect:inspected,present:a=>a});
  const result=await library.list();assert.equal(probes,0);assert.equal(result.tracks.length,0);assert.equal(result.errors.length,1);
});
test('a song changed during probing is excluded until the list is refreshed',async t=>{
  const dir=await setup(t),file=path.join(dir,'曲.mp3');await fs.writeFile(file,'original');let changed=false;
  const library=createBgmLibrary({configFile:path.join(dir,'config.json'),candidates:[dir],probe:async f=>{if(!changed){changed=true;await fs.writeFile(f,'different song');}return info;},inspect:inspected,present:a=>a});
  const result=await library.list();assert.equal(result.tracks.length,0);assert.equal(result.errors.length,1);const refreshed=await library.list();assert.equal(refreshed.tracks.length,1);assert.equal((await library.load(refreshed.tracks[0].id)).kind,'audio');
});
test('returning to the BGM panel shares an ongoing folder scan and can refresh afterward',async t=>{
  const dir=await setup(t),file=path.join(dir,'曲.mp3');await fs.writeFile(file,'song');let finish,ready,probes=0;
  const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>finish=resolve);
  const library=createBgmLibrary({configFile:path.join(dir,'config.json'),candidates:[dir],probe:async()=>{probes++;ready();await gate;return info;},inspect:inspected,present:a=>a});
  const abandonedPanel=library.list();await started;const returnedPanel=library.list();await assert.rejects(library.list(path.join(dir,'different')),/読み込み中/);finish();
  const [first,current]=await Promise.all([abandonedPanel,returnedPanel]);assert.equal(current,first);assert.equal(current.tracks.length,1);assert.equal(probes,1);assert.equal((await library.load(current.tracks[0].id)).kind,'audio');
  const refreshed=await library.list();assert.equal(refreshed.tracks.length,1);assert.equal(probes,2);
});
test('all waiting BGM panels receive a scan failure and the next refresh can recover',async t=>{
  const dir=await setup(t),folder=path.join(dir,'bgm');await fs.mkdir(folder);const readdir=fs.readdir.bind(fs);let finish,ready;
  const started=new Promise(resolve=>ready=resolve),gate=new Promise((resolve,reject)=>finish=reject);
  t.mock.method(fs,'readdir',async(file,options)=>{if(file===folder){ready();await gate;}return readdir(file,options);});
  const library=createBgmLibrary({configFile:path.join(dir,'config.json'),candidates:[folder],probe:async()=>info,inspect:inspected,present:a=>a});
  const first=library.list();await started;const second=library.list();const rejected=Promise.all([assert.rejects(first,/読み込めません/),assert.rejects(second,/読み込めません/)]);finish(Error('disconnected'));await rejected;
  t.mock.restoreAll();assert.equal((await library.list()).tracks.length,0);
});
