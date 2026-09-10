const { test } = require('node:test');
const assert = require('node:assert/strict');
const { alignTranscript } = require('../electron/transcript-alignment.cjs');
const { cuesFromTranscription } = require('../shared/youtube.mjs');
test('accurate Japanese text keeps brand spelling, punctuation and English word boundaries with measured pauses', () => {
  const raw = alignTranscript('今日はLuma Studioで動画を編集します。75秒の素材です。', {words:[
    {word:'今日は',start:0.3,end:1},{word:'ルマスタジオ',start:1,end:2},{word:'で動画を編集します。',start:2,end:4},
    {word:'七十五秒の素材です。',start:8,end:10}
  ]});
  assert.equal(raw.words.map(w=>w.word).join(''),raw.text);
  assert.ok(raw.words.every((w,i)=>w.end>w.start && w.start>=(raw.words[i-1]?.end||0)));
  const cues=cuesFromTranscription(raw,0,11); assert.equal(cues[0].start,0.3); assert.equal(cues.at(-1).end,10);
  assert.match(cues.map(c=>c.text).join(''),/Luma Studio/); assert.ok(cues.some(c=>c.start>=8));
});
test('missing beginning, unrelated timing, unordered or unbounded data are rejected without fabricating timing', () => {
  const text='今日は動画を編集します。75秒の素材を追加します。最後に動画を書き出します。';
  for(const words of [[{word:'最後に動画を書き出します。',start:12,end:16}],[{word:'猫と犬の散歩に行きます。',start:0,end:2}],[{word:text,start:NaN,end:1}],[{word:text,start:0,end:400}],[{word:text,start:0,end:4},{word:'追加',start:1,end:2}]]) assert.throws(()=>alignTranscript(text,{words}),/時刻.*照合/);
  assert.throws(()=>alignTranscript('あ'.repeat(7001),{words:[{word:'あ'.repeat(7001),start:0,end:3}]}),/照合/);
});
test('silent latest-model response yields no subtitles, zero-duration timing tokens retain every character', () => {
  assert.deepEqual(alignTranscript('',{}),{text:'',words:[]});
  const text='「今日は晴れです。」', result=alignTranscript(text,{words:[{word:'今日',start:0,end:0},{word:'は',start:0,end:1},{word:'晴れです',start:1,end:2}]});
  assert.equal(result.words.map(w=>w.word).join(''),text);
});
test('a matching majority does not assign timestamps to a long substituted passage', () => {
  const prefix = 'あ'.repeat(60), accurate = 'か'.repeat(40), unrelated = 'さ'.repeat(40);
  for (const [text, word] of [[prefix + accurate, prefix + unrelated], [accurate + prefix, unrelated + prefix], [prefix + accurate + prefix, prefix + unrelated + prefix]]) {
    assert.throws(() => alignTranscript(text, { words: [{ word, start: 0, end: 20 }] }), /照合/);
  }
});
test('long timing-only prefixes, suffixes and middle passages cannot disappear from captions', () => {
  const common = 'あ'.repeat(60), omitted = 'か'.repeat(40);
  for (const [text, word] of [[common, common + omitted], [common, omitted + common], [common + common, common + omitted + common]]) {
    assert.throws(() => alignTranscript(text, { words: [{ word, start: 0, end: 20 }] }), /照合/);
  }
});
test('segment-only timing keeps measured pauses and accurate text without hiding invalid word data', () => {
  const text = '今日は晴れです。明日は雨です。', segments = [{text:'今日は晴れです。',start:0.5,end:2},{text:'明日は雨です。',start:7,end:9}];
  for (const timing of [{segments}, {words:[],segments}]) {
    const raw = alignTranscript(text,timing), cues = cuesFromTranscription(raw,0,10);
    assert.equal(raw.words.map(w=>w.word).join(''),text); assert.equal(raw.alignment.timingGranularity,'segment');
    assert.equal(cues[0].start,0.5); assert.equal(cues.at(-1).end,9); assert.ok(cues.some(c=>c.start>=7));
  }
  for (const timing of [{}, {segments:[]}, {segments:{}}, {segments:[null]}, {segments:[{text,start:-1,end:9}]}, {words:{},segments}, {words:[{word:text,start:NaN,end:9}],segments}]) assert.throws(()=>alignTranscript(text,timing),/照合/);
});
test('segment fallback excludes hallucinations over silence before creating caption words', () => {
  const silent={text:'ご視聴ありがとうございました。',start:5,end:8,no_speech_prob:.95,avg_logprob:-1.5};
  assert.deepEqual(alignTranscript(silent.text,{segments:[silent]}),{text:'',words:[]});
  const clear={text:'今日は晴れです。',start:0,end:3,no_speech_prob:.01,avg_logprob:-.1};
  const result=alignTranscript(clear.text,{segments:[clear,silent]});
  assert.equal(result.text,clear.text);assert.ok(result.words.every(w=>w.end<=3));
  assert.throws(()=>alignTranscript(clear.text+silent.text,{segments:[clear,silent]}),/照合/);
});
