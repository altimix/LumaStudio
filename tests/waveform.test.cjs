const { test, before, after } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { inspectMedia, run, ffmpeg } = require('../electron/media.cjs');
const { createWaveformReader, ensureWaveform } = require('../electron/waveform.cjs');
let directory, cache, asset, reader;
const url = 'media://local/asset/waveform';
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-waveform-')); cache = path.join(directory, 'cache');
  const source = path.join(directory, '長い音楽とナレーション.wav');
  const expression = 'if(lt(mod(t,0.2),0.02),0.8*sin(2*PI*1000*t),0)';
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expression}|-${expression}':s=48000:d=72`, '-c:a', 'pcm_s16le', source]);
  asset = await inspectMedia(source, cache); reader = createWaveformReader(() => cache); reader.register(url, asset);
});
after(async () => { reader?.close(); if (directory) await fs.rm(directory, { recursive: true, force: true }); });
test('a long anti-phase stereo source retains 20 ms transients and silence after the first minute', async () => {
  assert.ok(asset.duration >= 72); assert.equal(asset.waveform.length, 2048);
  const values = await reader.read(url, 65, 66, 1000);
  for (let pulse = 0; pulse < 5; pulse++) {
    assert.ok(Math.min(...values.slice(pulse * 200 + 2, pulse * 200 + 18)) > .98);
    assert.ok(Math.max(...values.slice(pulse * 200 + 23, pulse * 200 + 195)) < .002);
  }
  assert.equal(values.length, 1000);
});
test('fine zoom decodes the real sample shape, keeps global scale, and agrees with cached peaks', async () => {
  const fine = await reader.read(url, 65, 65.2, 2000), normal = await reader.read(url, 65, 65.2, 200);
  assert.ok(new Set(Array.from(fine.slice(0, 200), value => Math.round(value * 100))).size > 2, 'sub-millisecond data must not stretch a single overview peak');
  assert.ok(Math.max(...fine.slice(210)) < .002);
  for (let i = 2; i < 18; i++) assert.ok(Math.abs(Math.max(...fine.slice(i * 10, (i + 1) * 10)) - normal[i]) < .002);
  const silent = await reader.read(url, 65.05, 65.15, 200);
  assert.ok(Math.max(...silent) < .002, 'zooming into silence must not amplify numerical noise');
});
test('different timeline speeds and source in points select exactly the requested source region', async () => {
  const slow = await reader.read(url, 65.01, 65.11, 400), fast = await reader.read(url, 65.01, 65.81, 400);
  assert.ok(Math.max(...slow.slice(0, 36)) > .9); assert.ok(Math.max(...slow.slice(45)) < .002);
  for (const index of [95, 195, 295, 395]) assert.ok(Math.max(...fast.slice(index + 1, Math.min(index + 5, 400))) > .9);
});
test('overview and detail survive cache reload and corrupt cache regeneration without editing the source', async () => {
  const before = await fs.readFile(asset.path), initial = await reader.read(url, 70, 71, 1000);
  await fs.writeFile(path.join(cache, `${asset.id}.wave-v4-0.bin`), 'incomplete');
  const restored = await inspectMedia(asset.path, cache); assert.deepEqual(restored.waveform, asset.waveform);
  const fresh = createWaveformReader(() => cache); fresh.register(url, restored);
  try { assert.deepEqual(await fresh.read(url, 70, 71, 1000), initial); } finally { fresh.close(); }
  assert.deepEqual(await fs.readFile(asset.path), before);
});
test('waveform IPC rejects unknown media and unbounded, invalid, or stale requests', async () => {
  for (const args of [['file:///etc/passwd', 0, 1, 100], [url, -1, 1, 100], [url, 0, Infinity, 100], [url, 0, 73, 100], [url, 1, 1, 100], [url, 0, 1, 9000], [url, 0, 1, 2.5]]) await assert.rejects(reader.read(...args));
  const stale = createWaveformReader(() => cache); stale.register(url, { ...asset, revision: '0'.repeat(24) });
  try { await assert.rejects(stale.read(url, 0, 1, 100), /変更/); } finally { stale.close(); }
  const closed = createWaveformReader(() => cache); closed.register(url, asset); closed.close(); await assert.rejects(closed.read(url, 0, 1, 100));
});
test('floating-point audio retains over-range peak ratios in overview, cached detail, fine zoom and reload', async () => {
  for (const scale of [1, .00001]) {
  const file = path.join(directory, `浮動小数点の音声-${scale}.wav`);
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='if(lt(t,0.5),${scale},${scale * 2})*sin(2*PI*1000*t)':s=48000:d=1`, '-c:a', 'pcm_f32le', file]);
  const floatAsset = await inspectMedia(file, cache);
  assert.ok(Math.abs(Math.max(...floatAsset.waveform.slice(0, 900)) - .5) < .001);
  assert.ok(Math.abs(Math.max(...floatAsset.waveform.slice(1100)) - 1) < .001);
  const fresh = createWaveformReader(() => cache); fresh.register('float', floatAsset);
  try {
    for (const bins of [100, 2000]) {
      const low = await fresh.read('float', .125, .25, bins), high = await fresh.read('float', .625, .75, bins);
      assert.ok(Math.abs(Math.max(...low) - .5) < .001);
      assert.ok(Math.abs(Math.max(...high) - 1) < .001);
    }
    assert.deepEqual((await inspectMedia(file, cache)).waveform, floatAsset.waveform);
  } finally { fresh.close(); }
  }
});

test('absolute peaks preserve source gain and read processed visible ranges independently of the legacy cache', async()=>{
  const quiet=path.join(directory,'processed.wav');
  await run(ffmpeg,['-v','error','-y','-i',asset.path,'-af','volume=0.25','-ac','2','-c:a','pcm_f32le',quiet]);
  let preparations=0;
  const processed=createWaveformReader(()=>cache,async()=>{preparations++;return quiet;});processed.register(url,asset);
  try{
    const original=await processed.read(url,65,66,1000,{absolute:true});
    const after=await processed.read(url,65,66,1000,{absolute:true,treatment:'normalize'});
    assert.ok(Math.abs(Math.max(...original)-.8)<.001);assert.ok(Math.abs(Math.max(...after)-.2)<.001);
    assert.deepEqual(await processed.read(url,65,66,1000,{absolute:true,treatment:'normalize'}),after);assert.equal(preparations,1);
    assert.ok(Math.max(...await processed.read(url,65,66,1000))>.99);
    const overview=await processed.read(url,0,72,720,{absolute:true,treatment:'normalize'});
    assert.ok(Math.abs(Math.max(...overview)-.2)<.001);
    const processedStat=await fs.stat(quiet),id=require('node:crypto').createHash('sha256').update(path.resolve(quiet)+processedStat.size+processedStat.mtimeMs).digest('hex').slice(0,24);
    const indexFile=path.join(cache,`${id}.wave-v4.json`),stamp=(await fs.stat(indexFile)).mtimeMs;
    assert.equal(JSON.parse(await fs.readFile(indexFile,'utf8')).channels,2);
    await processed.read(url,0,60,600,{absolute:true,treatment:'normalize'});
    assert.equal((await fs.stat(indexFile)).mtimeMs,stamp,'changing the overview viewport reuses the processed peak pyramid');

    for(const options of [null,[],{absolute:1},{treatment:'invalid'},{path:quiet}])await assert.rejects(processed.read(url,65,66,1000,options));
  }finally{processed.close();}
});

test('cold treatment preparation outlives the visible waveform scan deadline', async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const cold=createWaveformReader(()=>cache,async(_file,_treatment,signal)=>{
    t.mock.timers.tick(31000);assert.equal(signal.aborted,false);
    t.mock.timers.reset();return asset.path;
  });cold.register(url,asset);
  try{assert.equal((await cold.read(url,65,66,1000,{absolute:true,treatment:'speech'})).length,1000);}
  finally{t.mock.timers.reset();cold.close();}
});

test('index cancellation stops the last consumer while preserving other readers and allowing retry',async()=>{
  const cancelledCache=path.join(directory,'cancelled-index'),id='123456789012345678901234';
  const first=new AbortController(),second=new AbortController();
  const one=ensureWaveform(asset.path,cancelledCache,id,asset.duration,2,first.signal);
  const rejected=assert.rejects(one,{name:'AbortError'});
  const two=ensureWaveform(asset.path,cancelledCache,id,asset.duration,2,second.signal);
  first.abort();await rejected;assert.ok((await two).frames>0,'remaining consumer completes the shared build');
  const abandoned=path.join(directory,'abandoned-index'),last=new AbortController();
  const work=ensureWaveform(asset.path,abandoned,id,asset.duration,2,last.signal),stopped=assert.rejects(work,{name:'AbortError'});
  const deadline=Date.now()+5000;let writing=false;
  while(!writing){
    try{for(const name of await fs.readdir(abandoned)){if(name.endsWith('.tmp')&&(await fs.stat(path.join(abandoned,name))).size>0){writing=true;break;}}}catch{}
    assert.ok(Date.now()<deadline,'index build should start streaming before cancellation');
    if(!writing)await new Promise(resolve=>setTimeout(resolve,2));
  }
  last.abort();await stopped;
  while((await fs.readdir(abandoned)).some(name=>name.endsWith('.tmp'))){assert.ok(Date.now()<deadline,'cancelled build should clean its temporary files');await new Promise(resolve=>setTimeout(resolve,5));}
  await assert.rejects(fs.stat(path.join(abandoned,`${id}.wave-v4.json`)),{code:'ENOENT'});
  const retry=await ensureWaveform(asset.path,abandoned,id,asset.duration,2);assert.ok(retry.frames>0);
});

test('last reader cancellation aborts preparation, keeps shared consumers and releases slots',async()=>{
  const preparing=[];
  const cancellable=createWaveformReader(()=>cache,(_file,_treatment,signal)=>new Promise((resolve,reject)=>{
    const entry={signal,resolve};preparing.push(entry);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  }));cancellable.register(url,asset);
  const wait=async count=>{const deadline=Date.now()+3000;while(preparing.length<count){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}};
  const a=new AbortController(),b=new AbortController();
  try{
    const first=cancellable.read(url,0,1,100,{treatment:'speech'},a.signal),rejected=assert.rejects(first,{name:'AbortError'});
    const shared=cancellable.read(url,0,1,100,{treatment:'speech'},b.signal);
    await wait(1);a.abort();await rejected;assert.equal(preparing[0].signal.aborted,false);
    const sharedRejected=assert.rejects(shared,{name:'AbortError'});b.abort();await sharedRejected;assert.equal(preparing[0].signal.aborted,true);
    const retry=cancellable.read(url,0,1,100,{treatment:'speech'});await wait(2);preparing[1].resolve(asset.path);assert.equal((await retry).length,100);
    const activeA=new AbortController(),activeB=new AbortController();
    const one=cancellable.read(url,2,3,100,{treatment:'speech'},activeA.signal),two=cancellable.read(url,4,5,100,{treatment:'speech'},activeB.signal);
    const oneRejected=assert.rejects(one,{name:'AbortError'}),twoRejected=assert.rejects(two,{name:'AbortError'});await wait(4);
    const queued=cancellable.read(url,6,7,100,{treatment:'speech'});
    activeA.abort();activeB.abort();await Promise.all([oneRejected,twoRejected]);await wait(5);preparing[4].resolve(asset.path);assert.equal((await queued).length,100);
  }finally{cancellable.close();}
});
