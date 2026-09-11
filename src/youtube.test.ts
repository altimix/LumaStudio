import { numberTracks } from './track-names';
import { describe, expect, it } from 'vitest';
import { emptyProject, makeClip, makeTrack } from './model';
import { useEditor } from './store';
import { applySubtitles, emptyYoutube } from './youtube';
import { chapterTime, cuesFromTranscription, descriptionWithChapters, parseHashtags, subtitleFile, subtitleTime, timelineKey, validChapters, validateYoutube, wrapJapanese, youtubeText } from '../shared/youtube.mjs';
const fixture = () => { const p = emptyProject(); p.clips = [{ ...makeClip(p.tracks[0].id, 0), duration: 40, text: '元のタイトル' }]; p.youtube = { ...emptyYoutube(p), cues: [{ start: 1, end: 3, text: '日本語の字幕です。' }, { start: 5, end: 7, text: '編集して保存します。' }] }; return p; };
describe('YouTube timing and Japanese captions', () => {
  it('puts hashtags last in long and short descriptions, including saved posting text', () => {
    const y = { ...emptyYoutube(fixture()), description: ' 動画の説明 ', hashtags: ['#日本語字幕', '#動画編集', '#YouTube制作'], chapters: [{ time: 0, label: '開始' }, { time: 10, label: '編集' }, { time: 20, label: '完成' }] };
    const tags = '#日本語字幕 #動画編集 #YouTube制作';
    expect(descriptionWithChapters(y, 30)).toBe('動画の説明\n\n【チャプター】\n00:00 開始\n00:10 編集\n00:20 完成\n\n' + tags);
    expect(descriptionWithChapters(y, 20)).toBe('動画の説明\n\n' + tags);
    expect(youtubeText(y, 30)).toContain(tags + '\n\n【検索ワード】');
    expect(descriptionWithChapters({ ...y, hashtags: undefined }, 20)).toBe('動画の説明');
  });
  it('accepts Japanese tags and missing legacy data, but rejects malformed, duplicated or excessive tags', () => {
    const y = fixture().youtube!;
    expect(parseHashtags(' ＃日本語，動画編集、YouTube_制作 ')).toEqual(['#日本語', '#動画編集', '#YouTube_制作']);
    expect(() => validateYoutube(y)).not.toThrow();
    expect(() => validateYoutube({ ...y, hashtags: parseHashtags('日本語 e\u0301 2026_夏') })).not.toThrow();
    for (const hashtags of [['#空 白'], ['#'], ['#<script>'], ['#a', '#A'], ['#Ａ', '#A'], ['#1', '#2', '#3', '#4'], ['#' + 'あ'.repeat(81)]]) expect(() => validateYoutube({ ...y, hashtags })).toThrow('ハッシュタグ');
  });
  it('counts footer and separating blank lines at the 5000 character limit', () => {
    const y = { ...fixture().youtube!, description: 'あ'.repeat(4996), hashtags: ['#あ'] };
    expect(descriptionWithChapters(y, 30)).toHaveLength(5000); expect(() => validateYoutube(y)).not.toThrow();
    expect(() => validateYoutube({ ...y, description: y.description + 'あ' })).toThrow('5000');
  });
  it('carries milliseconds and formats chapter hours without frame suffixes', () => { expect(subtitleTime(59.9999)).toBe('00:01:00,000'); expect(subtitleTime(3600.001, true)).toBe('01:00:00.001'); expect(chapterTime(65)).toBe('01:05'); expect(chapterTime(3661)).toBe('01:01:01'); });
  it('keeps Japanese punctuation with the preceding line and Unicode characters intact', () => { const text = 'これは日本語の字幕、読みやすさを確認します。👨‍👩‍👧'; const lines = wrapJapanese(text, 10).split('\n'); expect(lines.join('')).toBe(text); expect(lines.some(l => /^[、。]/.test(l))).toBe(false); expect(lines.at(-1)).toContain('👨‍👩‍👧'); });
  it('uses word timing, groups phrases and offsets chunk times', () => { const cues = cuesFromTranscription({ words: [{ start: 0.2, end: 1, word: '動画を' }, { start: 1, end: 2, word: '編集します。' }, { start: 4, end: 5, word: '保存します。' }] }, 300, 6, 14); expect(cues).toEqual([{ start: 300.2, end: 302, text: '動画を編集します。' }, { start: 304, end: 305, text: '保存します。' }]); });
  it('exports SRT and VTT with real cue times and rejects overlap', () => { const p = fixture(); expect(subtitleFile(p.youtube!.cues)).toContain('1\n00:00:01,000 --> 00:00:03,000\n日本語の字幕です。'); expect(subtitleFile(p.youtube!.cues, 'vtt')).toMatch(/^WEBVTT\n\n00:00:01.000/); expect(() => subtitleFile([{ start: 0, end: 2, text: 'a' }, { start: 1, end: 3, text: 'b' }])).toThrow('重ならない'); });
  it('rejects blank cue lines instead of emitting orphaned SRT or VTT blocks', () => {
    for (const text of ['一行目\n\n三行目', '一行目\r\n \t\r\n三行目', '\n先頭', '末尾\n', '一行目\r\r三行目']) {
      const p = fixture(); p.youtube!.cues[0].text = text;
      expect(() => validateYoutube(p.youtube)).toThrow('空行'); expect(() => applySubtitles(p)).toThrow('空行');
      for (const format of ['srt', 'vtt'] as const) expect(() => subtitleFile(p.youtube!.cues, format)).toThrow('空行');
    }
  });
  it('only appends eligible chapters, including the final ten seconds', () => { const y = { ...emptyYoutube(fixture()), description: '動画の説明', chapters: [{ time: 0, label: 'はじめに' }, { time: 10, label: '編集' }, { time: 20, label: '完成' }] }; expect(validChapters(y.chapters, 30)).toBe(true); expect(validChapters(y.chapters, 29.9)).toBe(false); expect(descriptionWithChapters(y, 30)).toContain('00:00 はじめに'); expect(descriptionWithChapters(y, 29)).toBe('動画の説明'); });
  it('validates persisted metadata and old projects without YouTube data', () => { expect(() => validateYoutube(undefined)).not.toThrow(); const y = fixture().youtube!; expect(() => validateYoutube({ ...y, keywords: ['語,句'] })).toThrow('検索ワード'); expect(() => validateYoutube({ ...y, chapters: [{ time: NaN, label: '' }] })).toThrow('チャプター'); });
});
describe('subtitle timeline application', () => {
  it('reuses a renamed caption track before a same-name track even at the track limit', () => {
    const p = applySubtitles(fixture()), captionTrack = p.tracks[0]; captionTrack.name = '話者Aの字幕'; captionTrack.autoName = false;
    p.tracks.unshift(makeTrack('video', '日本語字幕'));
    while (p.tracks.length < 24) p.tracks.push(makeTrack('video', '別のトラック'));
    p.youtube!.cues[0].text = '字幕を更新します。';
    const next = applySubtitles(p);
    expect(next.tracks).toEqual(numberTracks(p).tracks); expect(next.tracks).toHaveLength(24);
    expect(next.clips.filter(c => c.subtitle).every(c => c.trackId === captionTrack.id)).toBe(true);
    expect(next.clips.find(c => c.subtitle)!.text).toBe('字幕を更新します。');
    p.tracks = p.tracks.filter(t => t.name !== '日本語字幕'); p.tracks.push(makeTrack('video', '最後のトラック'));
    expect(applySubtitles(p).tracks).toEqual(numberTracks(p).tracks);
  });
  it('adds and updates only automatic captions and can undo atomically', () => { const p = fixture(); useEditor.getState().load(p); const next = applySubtitles(p); expect(next.clips.filter(c => c.subtitle)).toHaveLength(2); expect(next.clips.filter(c=>c.subtitle).every(c=>c.textShadow===false&&c.textStroke===true&&c.strokeColor==='#0064ff')).toBe(true); expect(next.clips[0].text).toBe('元のタイトル'); expect(next.tracks[0].name).toBe('Video3'); expect(applySubtitles(next).clips).toHaveLength(3); useEditor.getState().commit(next); useEditor.getState().undo(); expect(useEditor.getState().project).toEqual(p); });
  it('protects locked subtitle tracks and clip/track limits', () => { const p = applySubtitles(fixture()); p.tracks[0].locked = true; expect(() => applySubtitles(p)).toThrow('ロック'); const q = fixture(); q.tracks = Array.from({ length: 24 }, () => makeTrack('video', 'トラック')); q.clips[0].trackId = q.tracks[0].id; expect(() => applySubtitles(q)).toThrow('トラック'); });
  it('uses portrait-safe typography while keeping sequence times', () => { const p = fixture(); p.width = 1080; p.height = 1920; const next = applySubtitles(p); const c = next.clips.find(c => c.subtitle)!; expect(c.start).toBe(1); expect(c.duration).toBe(2); expect(c.fontSize).toBe(64); expect(c.y).toBeCloseTo(39.533333,5); });
  it('preserves manual cue line breaks in subtitles and burned-in text for both formats', () => {
    const text = '日本語の字幕を\n読みやすく作成します。';
    for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      const p = fixture(); p.width = width; p.height = height; p.youtube!.cues[0].text = text;
      expect(applySubtitles(p).clips.find(c => c.subtitle)!.text).toBe(text);
      expect(subtitleFile(p.youtube!.cues)).toContain(text); expect(subtitleFile(p.youtube!.cues, 'vtt')).toContain(text);
    }
    expect(wrapJapanese('短い行\r\nあいうえおかきくけこ', 5)).toBe('短い行\nあいうえお\nかきくけこ');
  });
  it('marks changed audio stale, but ignores added subtitles and unused assets', () => { const p = fixture(); const a = { id: 'a', path: 'C:/voice.wav', url: '', thumbnail: '', name: 'voice', kind: 'audio' as const, duration: 40, width: 0, height: 0, fps: 0, hasAudio: true, waveform: [], size: 100, codec: 'pcm' }; p.assets = [a]; p.clips.push({ ...makeClip(p.tracks[2].id, 0, a), duration: 40 }); p.youtube!.sourceKey = timelineKey(p); expect(timelineKey(applySubtitles(p))).toBe(timelineKey(p)); p.clips[1].in = 1; expect(() => applySubtitles(p)).toThrow('再実行'); });
});

it('reuses prior caption lanes through repeated rounded overlapping replacements even at capacity',()=>{
  let p=fixture();p.youtube!.cues=[{start:0,end:1.0169,text:'先の字幕'},{start:1.0162,end:2,text:'後の字幕'}];
  p=applySubtitles(p);expect(new Set(p.clips.filter(c=>c.subtitle).map(c=>c.trackId)).size).toBe(2);
  while(p.tracks.length<24)p.tracks.push(makeTrack('video','既存の空トラック'));
  p=numberTracks(p);const tracks=p.tracks,placements=p.clips.filter(c=>c.subtitle).map(c=>[c.text,c.trackId]);
  for(let i=0;i<30;i++){
    p=applySubtitles(p);expect(p.tracks).toEqual(tracks);
    expect(p.clips.filter(c=>c.subtitle).map(c=>[c.text,c.trackId])).toEqual(placements);
  }
});

it('keeps short leading captions on their previous lane across rounded overlap replacements',()=>{
  let p=fixture();p.youtube!.cues=[{start:0,end:.2,text:'短い導入'},{start:.2,end:1.0169,text:'先の字幕'},{start:1.0162,end:2,text:'後の字幕'}];
  p=applySubtitles(p);const placements=p.clips.filter(c=>c.subtitle).map(c=>[c.text,c.trackId]);
  for(let i=0;i<10;i++){p=applySubtitles(p);expect(p.clips.filter(c=>c.subtitle).map(c=>[c.text,c.trackId])).toEqual(placements);}
});
