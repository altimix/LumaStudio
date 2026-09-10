import { expect, it } from 'vitest';
import { cuesFromTranscription, validateCues } from '../shared/youtube.mjs';
import { wrapCaption } from '../shared/captions.mjs';
import { captionStyle } from './caption-style';

const count=(text:string)=>[...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text.replace(/\s/g,''))].length;
const plain=(text:string)=>text.replace(/\s/g,'');
function timed(parts:string[],spacing=.55){return {words:parts.map((word,i)=>({word,start:i*spacing,end:(i+1)*spacing}))};}
it('prefers sentence and comma boundaries around 20 to 30 characters with exact word times',()=>{
  const input=timed(['この動画では','初心者にも','分かりやすい','編集の方法を','紹介します。','動画を','読み込んだら、','不要な部分を','短くして','見やすく整えます。']);
  const cues=cuesFromTranscription(input,300,10,24);validateCues(cues);
  expect(cues.map(c=>count(c.text)).every(n=>n>=20&&n<=30)).toBe(true);
  expect(cues[0].text.endsWith('。')).toBe(true);expect(cues[0].start).toBe(300);expect(cues[0].end).toBe(302.75);
  expect(plain(cues.map(c=>c.text).join(''))).toBe(plain(input.words.map(w=>w.word).join('')));
  for(const c of cues){expect(input.words.some(w=>Math.abs(w.start+300-c.start)<1e-7)).toBe(true);expect(input.words.some(w=>Math.abs(w.end+300-c.end)<1e-7)).toBe(true);expect(c.text.split('\n').length).toBeLessThanOrEqual(2);}
});
it('does not bridge a speech pause, stretch a short utterance or lose sentence punctuation',()=>{
  const input={words:[{word:'はい。',start:.1,end:.5},{word:'次の作業です。',start:1.5,end:3},{word:'「完成です',start:3,end:4},{word:'。」',start:4,end:4.1}]};
  const cues=cuesFromTranscription(input,0,5,15);validateCues(cues);expect(cues[0]).toEqual({start:.1,end:.5,text:'はい。'});expect(cues[1].start).toBe(1.5);expect(cues.at(-1)?.end).toBe(4.1);expect(cues.some(c=>/^[。、」]/.test(c.text))).toBe(false);expect(plain(cues.map(c=>c.text).join(''))).toBe(plain(input.words.map(w=>w.word).join('')));
});
it('segment fallback retains every grapheme, bounds estimated times and creates at most two lines',()=>{
  const text='今日は動画の編集について、初めての方にも分かりやすく紹介します。大切なのは、文章の意味が分かる場所で字幕を区切ることです。👨‍👩‍👧';
  for(const width of [15,24]){const cues=cuesFromTranscription({segments:[{start:2,end:14,text}]},300,20,width);validateCues(cues);expect(cues[0].start).toBe(302);expect(cues.at(-1)?.end).toBe(314);expect(plain(cues.map(c=>c.text).join(''))).toBe(plain(text));expect(cues.every(c=>c.text.split('\n').length<=2)).toBe(true);}
});
it('wraps once at natural boundaries and does not split Latin words or grapheme clusters',()=>{
  for(const text of ['ここで確認、字幕を自然な位置で区切って読みやすくします。','Luma Studio supports Japanese captions.','家族👨‍👩‍👧と一緒に動画を作り、思い出を楽しく残します。']){
    const wrapped=wrapCaption(text,15);expect(wrapped.split('\n').length).toBeLessThanOrEqual(2);expect(plain(wrapped)).toBe(plain(text));expect(wrapped.split('\n').some(line=>/^[、。]/.test(line))).toBe(false);expect(wrapped).not.toMatch(/Ja\n|Japan\n/);
  }
});
it('keeps opening punctuation attached to long indivisible names with all text and supplied interval retained',()=>{
  const name='Supercalifragilisticexpialidocious',text=`「${name}」`;
  for(const input of [{words:[{word:text,start:1,end:5}]},{words:[{word:'「',start:1,end:1.1},{word:name,start:1.1,end:4.9},{word:'」',start:4.9,end:5}]}]){
    for(const width of [15,24]){const cues=cuesFromTranscription(input,300,6,width);validateCues(cues);expect(cues).toEqual([{start:301,end:305,text}]);}
  }
});
it('does not invent timing gaps at spaces inside a continuous estimated interval',()=>{
  const text='This continuous English sentence has enough words to produce several readable captions without artificial gaps.';
  for(const input of [{segments:[{text,start:0,end:10}]},{words:[{word:text,start:0,end:10}]}]){
    const cues=cuesFromTranscription(input,300,10,24);validateCues(cues);expect(cues.length).toBeGreaterThan(1);
    expect(cues[0].start).toBe(300);expect(cues.at(-1)?.end).toBe(310);expect(plain(cues.map(c=>c.text).join(''))).toBe(plain(text));
    for(let i=1;i<cues.length;i++)expect(cues[i].start).toBeCloseTo(cues[i-1].end,8);
  }
});
it('prefers Japanese phrase breaks over starting a caption or line with a dependent particle or auxiliary',()=>{
  const text='今日は、動画編集を始めたばかりの方に向けて、';
  expect(wrapCaption(text,15)).not.toContain('始め\nた');expect(plain(wrapCaption(text,15))).toBe(text);
  const sentence='文字数だけで機械的に切るよりも、話のまとまりや息継ぎに合わせると、自然で見やすい字幕になります。';
  const parts=[...new Intl.Segmenter('ja',{granularity:'word'}).segment(sentence)].map(v=>v.segment);
  const cues=cuesFromTranscription(timed(parts,.24),0,20,24);validateCues(cues);expect(plain(cues.map(c=>c.text).join(''))).toBe(sentence);
  expect(cues.some(c=>c.text.endsWith('や')||/^(や|た|を|が)/.test(c.text))).toBe(false);
});
it('uses format-specific bold white captions with an outline near the bottom and preserves manual line breaks',()=>{
  const horizontal=captionStyle({width:1920,height:1080},'見やすい字幕です。'),portrait=captionStyle({width:1080,height:1920},'見やすい字幕です。');
  expect(horizontal).toMatchObject({fontSize:72,fontWeight:700,color:'#ffffff',textShadow:false,textStroke:true,strokeColor:'#0064ff',strokeWidth:4});expect(portrait.fontSize).toBe(64);expect(portrait.y).toBeGreaterThan(25);expect(horizontal.y).toBeGreaterThan(33);
  const text='日本語の字幕を\n読みやすく作成します。';expect(captionStyle({width:1080,height:1920},text).text).toBe(text);
  expect(captionStyle({width:1920,height:1080},'字幕が自然につながり、分かりやすい映像を制作します。').text.split('\n').length).toBeLessThanOrEqual(2);
});

it.each([[1920,1080],[1080,1920],[640,360]])('keeps one and two caption lines inside the lower margin at %sx%s', (width,height)=>{
  for(const text of ['見やすい字幕です。','日本語の字幕を\n読みやすく作成します。']){
    const c=captionStyle({width,height},text),boxHeight=c.fontSize*(c.text.split('\n').length*1.22+.26);
    const bottom=height*(.5+c.y/100)+boxHeight/2;
    expect(bottom).toBeCloseTo(height*(height>width?.92:.96),4);
    expect(height*(.5+c.y/100)-boxHeight/2).toBeGreaterThan(0);
    expect(c).toMatchObject({strokeWidth:4,captionBackgroundOpacity:.25});
  }
});
