const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transcribeWindows } = require('../electron/transcription-windows.cjs');
const { validateYoutube, subtitleFile } = require('../shared/youtube.mjs');
const { timedTranscript } = require('../electron/transcript-alignment.cjs');
const mismatch = () => Object.assign(new Error('照合'), { code: 'TRANSCRIPT_ALIGNMENT' });
test('only failing windows are subdivided; offsets, progress and final fallback remain bounded', async () => {
  const calls=[], progress=[];
  const result=await transcribeWindows(125,async w=>{
    calls.push(w);
    if(w.start<60 && !w.allowTimingFallback)throw mismatch();
    return { words:[{word:`区間${w.start}。`,start:w.start-w.from+.1,end:w.start-w.from+.9}], alignment:{textModel:w.allowTimingFallback?'whisper-1':'gpt-transcribe'} };
  },undefined,p=>progress.push(p.progress));
  assert.equal(calls.length,17);assert.equal(result.transcriptionStats.retries,7);assert.equal(result.transcriptionStats.timingFallbacks,9);
  assert.equal(result.cues.length,10);assert.equal(result.cues.at(-1).start,120.1);
  assert.ok(calls.every(w=>w.to-w.from<=62));assert.ok(progress.every((p,i)=>p>=(progress[i-1]||0)));assert.equal(progress.at(-1),1);
});
test('multi-day recordings retain absolute times and do not hit old 12-hour, 24-hour or 6000-cue caps', async () => {
  let calls=0;
  const duration=3*86400+10;
  const {cues}=await transcribeWindows(duration,async w=>{calls++;return {words:[{word:'前半の発話。',start:1,end:2},{word:'後半の発話。',start:4,end:5}]};});
  assert.equal(calls,4321);assert.equal(cues.length,8642);assert.ok(cues.at(-1).end>3*86400);
  const y={sourceKey:'long',cues,titles:[],description:'',chapters:[],keywords:[],thumbnailPrompt:''};validateYoutube(JSON.parse(JSON.stringify(y)));
  assert.match(subtitleFile(cues),/72:00:03,000 --> 72:00:04,000/);
});
test('API failures are not retried as alignment failures and cancellation stops subdivision', async () => {
  let calls=0;await assert.rejects(transcribeWindows(600,async()=>{calls++;throw new Error('HTTP 401');}),/401/);assert.equal(calls,1);
  const abort=new AbortController();calls=0;
  await assert.rejects(transcribeWindows(600,async()=>{calls++;abort.abort();throw mismatch();},abort.signal),{name:'AbortError'});assert.equal(calls,1);
  calls=0;await assert.rejects(transcribeWindows(60,async()=>{calls++;throw mismatch();}),{code:'TRANSCRIPT_ALIGNMENT'});assert.equal(calls,4);
});
test('timed fallback excludes silent segment hallucinations and rejects invalid timestamps', () => {
  const silent={text:'ご視聴ありがとうございました。',start:5,end:7,no_speech_prob:.95,avg_logprob:-1.5};
  const result=timedTranscript({segments:[{text:'聞こえた言葉。',start:.2,end:2},silent]});
  assert.equal(result.text,'聞こえた言葉。');assert.equal(result.words.at(-1).end,2);
  assert.throws(()=>timedTranscript({words:[{word:'不正',start:-1,end:2}]}),{code:'TRANSCRIPT_ALIGNMENT'});
  assert.throws(()=>timedTranscript({segments:[{...silent,start:NaN}]}),{code:'TRANSCRIPT_ALIGNMENT'});
  assert.throws(()=>timedTranscript({words:{},segments:[silent]}),{code:'TRANSCRIPT_ALIGNMENT'});
  assert.equal(timedTranscript({words:[{word:'Luma',start:0,end:1},{word:'Studio',start:1,end:2}]}).text,'Luma Studio');
});

test('production word+segment fallback excludes words inside rejected silence segments', () => {
  const words=[{word:'聞こえた言葉。',start:.2,end:2},{word:'ご視聴ありがとうございました。',start:5.2,end:7}];
  const segments=[{text:'聞こえた言葉。',start:0,end:3,no_speech_prob:.01,avg_logprob:-.1},{text:'ご視聴ありがとうございました。',start:5,end:8,no_speech_prob:.95,avg_logprob:-1.5}];
  const result=timedTranscript({words,segments});assert.equal(result.text,'聞こえた言葉。');assert.equal(result.words.at(-1).end,2);
  assert.deepEqual(timedTranscript({words:[words[1]],segments:[segments[1]]}).words,[]);
  assert.throws(()=>timedTranscript({words:[{...words[1],start:NaN}],segments}),{code:'TRANSCRIPT_ALIGNMENT'});
  assert.throws(()=>timedTranscript({words,segments:[{...segments[1],start:NaN}]}),{code:'TRANSCRIPT_ALIGNMENT'});
});
