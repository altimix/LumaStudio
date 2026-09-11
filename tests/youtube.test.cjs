const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readEnvKey, createCredentials, createOpenAI } = require('../electron/openai.cjs');
const { buildTimelineAudio, runAudio, transcribeTimeline, generateMetadata } = require('../electron/youtube.cjs');
const { timelineKey } = require('../shared/youtube.mjs');
const { buildExport } = require('../electron/export.cjs');
const KEY = 'sk-fake-key-for-isolated-tests-only';
const secure = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(Buffer.from(text).toString('base64')), decryptString: value => Buffer.from(value.toString(), 'base64').toString() };
async function temporary(work) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-youtube-test-')); try { await work(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); } }
function fixture(file, duration = 2) {
  return { version: 1, id: 'test', name: '日本語字幕', width: 1920, height: 1080, fps: 30, assets: [{ id: 'a', name: 'voice.wav', path: file, kind: 'audio', duration: duration + 1, width: 0, height: 0, fps: 0, hasAudio: true, waveform: [], size: 1, codec: 'pcm' }], tracks: [{ id: 't', kind: 'audio', muted: false, solo: false }], markers: [], clips: [{ id: 'c', assetId: 'a', trackId: 't', name: '音声', kind: 'audio', start: 1, in: 0.5, duration, speed: 1, scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 0.5, fadeIn: 0.2, fadeOut: 0.2, exposure: 0, contrast: 1, saturation: 1 }] };
}
test('env loader supports quotes, comments, BOM and last assignment without evaluating code', async () => temporary(async dir => { const file = path.join(dir, '.env'); await fs.writeFile(file, `\ufeffOTHER=ignored\nOPENAI_API_KEY=sk-old-invalid-test-key\nexport OPENAI_API_KEY="${KEY}" # comment\n`); assert.equal(await readEnvKey(file), KEY); await fs.writeFile(file, 'OPENAI_API_KEY=$(printenv)'); await assert.rejects(readEnvKey(file), /形式/); }));
test('credentials persist encrypted values, never return keys, and clear prevents env resurrection', async () => temporary(async dir => { const file = path.join(dir, 'key.bin'); let config = createCredentials(file, secure, [], KEY); assert.equal((await config.status()).configured, true); await config.set(KEY); assert.ok(!(await fs.readFile(file, 'utf8')).includes(KEY)); config = createCredentials(file, secure, [], KEY); assert.equal(await config.get(), KEY); assert.ok(!JSON.stringify(await config.status()).includes(KEY)); await config.set(''); const cleared = createCredentials(file, secure, [], KEY); assert.equal((await cleared.status()).configured, false); }));
test('API auth, quota, permissions, network and cancellation errors do not disclose provider bodies or keys', async () => { for (const status of [401, 403, 404, 429, 500]) { const client = createOpenAI(async () => KEY, async () => new Response(KEY, { status })); await assert.rejects(client.metadata({}, undefined), e => e.message.includes(`HTTP ${status}`) && !e.message.includes(KEY)); } const client = createOpenAI(async () => KEY, async () => { throw new Error(KEY); }); await assert.rejects(client.image('テスト', false), e => !e.message.includes(KEY)); const abort = new AbortController(); abort.abort(); await assert.rejects(client.metadata({}, abort.signal)); });
test('API requests use fixed origin, strict JSON, no storage and explicit image size', async () => { const calls = []; const client = createOpenAI(async () => KEY, async (url, options) => { const data = JSON.parse(options.body); calls.push({ url, options, data }); return Response.json(url.endsWith('responses') ? { status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] } : { data: [{ b64_json: Buffer.from([255,216,255,217]).toString('base64') }] }); }); assert.deepEqual(await client.metadata({ transcript: '字幕' }), { ok: true }); await client.image('画像', true); assert.equal(calls[0].url, 'https://api.openai.com/v1/responses'); assert.equal(calls[0].data.model, 'gpt-6-astra'); assert.deepEqual(calls[0].data.reasoning, { effort: 'low' }); assert.equal(calls[0].data.store, false); assert.equal(calls[0].data.text.format.strict, true); assert.deepEqual(calls[0].data.text.format.schema.properties.hashtags, { type:'array', items:{type:'string'}, minItems:3, maxItems:3 }); assert.ok(calls[0].data.text.format.schema.required.includes('hashtags')); assert.match(calls[0].data.instructions, /本文にはハッシュタグを書かない/); assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[1].data.size, '864x1536'); assert.ok(!JSON.stringify(calls[0].data).includes(KEY)); });
test('latest transcription and independent timing use supported parameters and retain accurate text', async () => temporary(async dir => {
  const file=path.join(dir,'audio.wav'); await fs.writeFile(file,'RIFF-data'); const calls=[];
  const client=createOpenAI(async()=>KEY,async(_url,options)=>{const data=options.body; calls.push(data); return Response.json(data.get('model')==='gpt-transcribe'?{text:'日本語の動画を編集します。'}:{words:[{word:'日本語の動画を編集します。',start:0.2,end:3}]});});
  const result=await client.transcribe(file,'Luma Studio、動画編集'); assert.equal(result.text,'日本語の動画を編集します。'); assert.equal(calls.length,2);
  assert.equal(calls[0].get('model'),'gpt-transcribe'); assert.deepEqual(calls[0].getAll('languages[]'),['ja']); assert.equal(calls[0].get('language'),null); assert.equal(calls[0].get('response_format'),null); assert.deepEqual(calls[0].getAll('keywords[]'),['Luma Studio','動画編集']);
  assert.equal(calls[1].get('model'),'whisper-1'); assert.equal(calls[1].get('language'),'ja'); assert.deepEqual(calls[1].getAll('timestamp_granularities[]'),['word','segment']); assert.equal(calls[1].get('prompt'),'Luma Studio、動画編集');
  assert.equal(calls[0].get('file').name,'timeline.wav'); assert.equal(await calls[0].get('file').text(),await calls[1].get('file').text());
  await assert.rejects(client.transcribe(file,'<invalid>'),/用語ヒント/);
}));
test('empty transcription avoids timing call and cancellation stops before second request', async()=>temporary(async dir=>{
  const file=path.join(dir,'audio.wav');await fs.writeFile(file,'RIFF'); let calls=0;const abort=new AbortController();
  const silent=createOpenAI(async()=>KEY,async()=>{calls++;return Response.json({text:''});}); assert.deepEqual(await silent.transcribe(file,''),{text:'',words:[]});assert.equal(calls,1);
  const client=createOpenAI(async()=>KEY,async()=>{abort.abort();return Response.json({text:'日本語の発話です。'});});await assert.rejects(client.transcribe(file,'',abort.signal));
}));

test('rendered timeline audio preserves delay, duration, gain and fades', async () => temporary(async dir => { const file = path.join(dir, '日本語 & voice.wav'); const { ffmpeg, run } = require('../electron/media.cjs'); await run(ffmpeg, ['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=4','-c:a','pcm_s16le',file]); const p = fixture(file); const target = path.join(dir, 'timeline.wav'); await runAudio(buildTimelineAudio(p, target)); const pcm = await run(ffmpeg, ['-v','error','-i',target,'-f','f32le','-ac','1','-ar','16000','pipe:1']); const rms = (from, to) => { let sum = 0; for (let i = from * 16000; i < to * 16000; i++) sum += pcm.readFloatLE(i * 4) ** 2; return Math.sqrt(sum / ((to - from) * 16000)); }; assert.equal(pcm.length / 4, 48000); assert.ok(rms(0,0.9) < 1e-6); assert.ok(rms(1.5,2) > 0.03); assert.ok(rms(1,1.05) < rms(1.5,2) / 2); p.tracks[0].muted = true; assert.throws(() => buildTimelineAudio(p,target), /音声がありません/); }));
test('long transcription windows keep sequence offsets and suppress overlap words', async () => temporary(async dir => { const file = path.join(dir,'voice.wav'); const { ffmpeg, run } = require('../electron/media.cjs'); await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=duration=65','-ar','16000',file]); const p = fixture(file, 62); let count = 0; const result = await transcribeTimeline(p, '', { transcribe: async () => ++count === 1 ? { words: [{ start: 1, end: 2, word: '開始' },{ start: 60.2,end: 60.8,word:'重複' }] } : { words: [{ start: 0,end:0.8,word:'重複' },{ start: 1.2,end:2,word:'続き' }] } }, undefined); assert.equal(count,2); assert.deepEqual(result.cues.map(c => c.text),['開始','続き']); assert.equal(result.cues[1].start,60.2); }));
test('metadata rejects stale edits and incorrect keyword cardinality', async () => { const p = fixture(path.resolve('unused.wav'),40); p.youtube = { sourceKey: timelineKey(p), cues:[{start:1,end:2,text:'動画編集です'}],titles:[],description:'',chapters:[],keywords:[],thumbnailPrompt:'' }; const raw = { titles:['a','b','c'], description:'説明', chapters:[], keywords:Array(10).fill('同じ'), hashtags:['#動画編集','#日本語字幕','#YouTube制作'],thumbnailPrompt:'画像' }; await assert.rejects(generateMetadata(p,{metadata:async()=>raw}), /形式/); p.clips[0].volume=1; await assert.rejects(generateMetadata(p,{metadata:async()=>raw}), /再実行/); });
test('metadata requires usable generated text and retains the previous data on rejection', async () => {
  const p = fixture(path.resolve('unused.wav'),40);
  p.youtube = { sourceKey:timelineKey(p), cues:[{start:1,end:2,text:'動画編集です'}], titles:['以前の案'], description:'以前の説明', chapters:[], keywords:[], thumbnailPrompt:'以前の画像指示' };
  const before = structuredClone(p.youtube), raw = { titles:['案1','案2','案3'], description:'説明', chapters:[{time:0,label:'開始'},{time:12,label:'編集'},{time:24,label:'完成'}], keywords:Array.from({length:10},(_,i)=>`検索語${i}`), hashtags:['#動画編集','#日本語字幕','#YouTube制作'],thumbnailPrompt:'画像の指示' };
  const valid = await generateMetadata(p,{metadata:async()=>raw}); assert.deepEqual(valid.titles,raw.titles);
  for (const patch of [{titles:['案1','　\n','案3']},{thumbnailPrompt:' \t\n'},{description:'　'},{chapters:raw.chapters.map((c,i)=>i===1?{...c,label:' '}:c)}]) {
    await assert.rejects(generateMetadata(p,{metadata:async()=>({...raw,...patch})}), /投稿文の形式.*再生成/);
    assert.deepEqual(p.youtube,before);
  }
});
test('generated hashtags are required, relevant-output fields remain separate, and failed responses preserve old metadata', async () => {
  const p = fixture(path.resolve('unused.wav'), 40);
  p.youtube = { sourceKey: timelineKey(p), cues: [{ start: 1, end: 2, text: '動画編集' }], titles: [], description: '', chapters: [], keywords: [], thumbnailPrompt: '' };
  const before = structuredClone(p.youtube);
  const raw = { titles: ['案1', '案2', '案3'], description: '説明', chapters: [], keywords: Array.from({ length: 10 }, (_, i) => `語${i}`), hashtags: ['#動画編集', '#字幕', '#YouTube制作'], thumbnailPrompt: '画像' };
  const result = await generateMetadata(p, { metadata: async () => raw });
  assert.deepEqual(result.hashtags, raw.hashtags); assert.deepEqual(result.keywords, raw.keywords);
  for (const hashtags of [undefined, [], ['#1'], ['#同じ', '#同じ', '#動画'], ['#空 白', '#字幕', '#編集']]) {
    await assert.rejects(generateMetadata(p, { metadata: async () => ({ ...raw, hashtags }) }), /ハッシュタグ/);
    assert.deepEqual(p.youtube, before);
  }
});
test('Shorts export refuses duration overflow rather than truncating', () => { const p = fixture(path.resolve('unused.wav'),181); p.width=1080; p.height=1920; assert.throws(() => buildExport(p,{width:1080,height:1920,fps:30,quality:'draft',target:'shorts'},{a:p.assets[0].path},'out.mp4'), /3分以内/); });
test('native Shorts validation rejects landscape input even with portrait output dimensions', () => { const p = fixture(path.resolve('unused.wav'),3), settings={width:1080,height:1920,fps:30,quality:'draft',target:'shorts'}; assert.throws(() => buildExport(p,settings,{a:p.assets[0].path},'out.mp4'), /縦型9:16/); p.width=1080; p.height=1920; assert.doesNotThrow(() => buildExport(p,settings,{a:p.assets[0].path},'out.mp4')); });
test('generated JPEGs produce decodable library thumbnails and rebuild empty cache entries', async () => temporary(async dir => {
  const { ffmpeg, run, probe, inspectMedia } = require('../electron/media.cjs');
  const file = path.join(dir, '生成サムネイル &.jpg'), cache = path.join(dir, 'cache');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=1536x864', '-frames:v', '1', file]);
  const asset = await inspectMedia(file, cache); assert.equal(asset.kind, 'image');
  const check = async () => { const info = await probe(asset.thumbnailPath); assert.equal(info.streams[0].width, 480); assert.equal(info.streams[0].height, 270); };
  await check(); await fs.writeFile(asset.thumbnailPath, ''); await inspectMedia(file, cache); await check();
}));

test('timing fallback is opt-in and keeps measured text and timestamps when models disagree', async()=>temporary(async dir=>{
  const file=path.join(dir,'audio.wav');await fs.writeFile(file,'RIFF');
  const client=createOpenAI(async()=>KEY,async(_url,{body})=>Response.json(body.get('model')==='gpt-transcribe'?{text:'専門用語の認識結果が異なります。'}:{words:[{word:'実際に時刻を取得した言葉です。',start:.4,end:3.2},{word:'ご視聴ありがとうございました。',start:4,end:5}],segments:[{text:'実際に時刻を取得した言葉です。',start:0,end:3.3,no_speech_prob:.01,avg_logprob:-.1},{text:'ご視聴ありがとうございました。',start:3.5,end:6,no_speech_prob:.95,avg_logprob:-1.5}]}));
  await assert.rejects(client.transcribe(file,''),{code:'TRANSCRIPT_ALIGNMENT'});
  const result=await client.transcribe(file,'',undefined,{allowTimingFallback:true});
  assert.equal(result.text,'実際に時刻を取得した言葉です。');assert.equal(result.alignment.textModel,'whisper-1');
  assert.equal(result.words[0].start,.4);assert.equal(result.words.at(-1).end,3.2);
}));

test('transcription rejects overflowing sequence duration before starting an RF64 render', () => {
  const {MAX_MEDIA_SECONDS}=require('../shared/time.mjs');
  const p=fixture(path.resolve('unused.wav'));p.clips[0].start=MAX_MEDIA_SECONDS;
  assert.throws(()=>buildTimelineAudio(p,path.resolve('unused-output.wav')),/音声の長さが不正/);
});

test('RF64 preparation audio can be seeked into a small ordinary WAV upload', async()=>temporary(async dir=>{
  const {ffmpeg,run}=require('../electron/media.cjs');
  const source=path.join(dir,'large-format.wav'),chunk=path.join(dir,'upload.wav');
  await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=3','-ar','16000','-ac','1','-c:a','pcm_s16le','-rf64','always',source]);
  assert.equal((await fs.readFile(source)).subarray(0,4).toString(),'RF64');
  await runAudio(['-y','-v','error','-ss','1','-i',source,'-t','1','-ar','16000','-ac','1','-c:a','pcm_s16le',chunk]);
  assert.equal((await fs.readFile(chunk)).subarray(0,4).toString(),'RIFF');
  const pcm=await run(ffmpeg,['-v','error','-i',chunk,'-f','s16le','pipe:1']);assert.equal(pcm.length,32000);assert.ok(pcm.some(v=>v));
}));

test('large transcripts fit the actual persisted project before replacing old captions', () => {
  const {finalizeTranscription}=require('../electron/youtube.cjs');
  const {serializeProject}=require('../electron/project.cjs');
  const {validateYoutube}=require('../shared/youtube.mjs');
  const p=fixture(path.resolve('unused.wav'),60000),text='長い日本語の字幕です。'.repeat(2);
  const makeCues=n=>Array.from({length:n},(_,i)=>({start:i,end:i+.5,text}));
  const old={sourceKey:timelineKey(p),cues:makeCues(1),titles:[],description:'以前の説明',chapters:[],keywords:[],thumbnailPrompt:''};p.youtube=old;
  assert.throws(()=>finalizeTranscription(p,makeCues(100000),{retries:0,timingFallbacks:0}),/大きすぎます/);
  assert.equal(p.youtube,old);
  // This transcript fits its own allowance but not this already-large project.
  p.clips.push(...Array.from({length:1999},(_,i)=>({...p.clips[0],id:`title-${i}`,assetId:undefined,kind:'title',start:0,duration:1,text:'あ'.repeat(1800),fontSize:58,color:'#ffffff',textStyle:'subtitle'})));
  serializeProject(p);
  const cues=makeCues(50000);validateYoutube({...old,cues});
  assert.throws(()=>finalizeTranscription(p,cues,{retries:0,timingFallbacks:0}),/15 MiB/);
  assert.equal(p.youtube,old);
  const small=fixture(path.resolve('unused.wav'),60000);
  const result=finalizeTranscription(small,makeCues(8000),{retries:0,timingFallbacks:0});
  assert.equal(JSON.parse(serializeProject({...small,youtube:result})).youtube.cues.length,8000);
});
