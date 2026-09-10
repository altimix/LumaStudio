const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });
const words = new Intl.Segmenter('ja', { granularity: 'word' });
const length = text => [...graphemes.segment(text)].length;
const join = (a,b) => a + (/[a-z0-9]$/i.test(a) && /^[a-z0-9]/i.test(b) ? ' ' : '') + b;
const sentenceEnd = text => /[。！？!?][」』）)"”]*$|(?<!\d)\.["”]*$/u.test(text);
const phraseEnd = text => /[、，,；;：:][」』）)]*$/u.test(text);
const closing = text => /^[、。，．！？!?」』）)\]】〕〉》]/u.test(text);
const opening = text => /[「『（(\[【〔〈《]$/u.test(text);
const dependentStarts = new Set(['は','が','を','に','へ','で','と','も','の','や','から','まで','より','ね','よ','た','だ','です','ます','ません','まし','でし','だっ','ない','なかっ','たい','れる','られる','せる','させる','て','ば','なら','ので','のに','けど','けれど']);
const connectingEnds = new Set(['や','とか','および','及び','または','あるいは']);
function grammarPenalty(left,right){
  const first=words.segment(right.trim())[Symbol.iterator]().next().value?.segment;
  const last=[...words.segment(left.trim())].at(-1)?.segment;
  return (dependentStarts.has(first)?30:0)+(connectingEnds.has(last)?20:0);
}

export function wrapCaption(text, width=24) {
  const chars=[...graphemes.segment(text)].map(v=>v.segment);
  if(chars.length<=width)return text;
  const wordEnds=new Set([...words.segment(text)].map(v=>length(text.slice(0,v.index+v.segment.length))));
  const target=Math.max(width,Math.ceil(chars.length/2)),candidates=[];
  for(let at=Math.max(1,chars.length-target-1);at<=Math.min(chars.length-1,target+1);at++){
    const left=chars.slice(0,at).join('').trim(),right=chars.slice(at).join('').trim();
    if(!left||!right||closing(right)||opening(left))continue;
    // Avoid breaking an English word or Japanese word if a measured word boundary is available.
    if(!wordEnds.has(at))continue;
    candidates.push({left,right,score:Math.abs(at-chars.length/2)-(sentenceEnd(left)?5:phraseEnd(left)?3:0)+grammarPenalty(left,right)});
  }
  const best=candidates.sort((a,b)=>a.score-b.score)[0];
  return best?`${best.left}\n${best.right}`:text;
}

function timedUnits(source, offset, duration) {
  const units=[];
  for(const s of source){
    if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<=s.start||typeof s.text!=='string')continue;
    const start=Math.max(offset,offset+s.start),end=Math.min(offset+duration,offset+s.end),text=s.text.replace(/\s+/g,' ').trim();
    if(end<=start||!text)continue;
    // Real word intervals are atomic. Oversized API words/segment-only input need finer text boundaries;
    // those boundaries are proportional estimates within the supplied interval, never across a pause.
    if(length(text)<=30){units.push({start,end,text});continue;}
    const fragments=[...words.segment(text)].map(v=>v.segment),total=length(text);let position=0;
    for(const fragment of fragments){const size=length(fragment),a=start+(end-start)*position/total,b=start+(end-start)*(position+size)/total;position+=size;
      if(fragment.trim())units.push({start:a,end:b,text:fragment});else if(units.length){units.at(-1).text+=fragment;units.at(-1).end=b;}
    }
  }
  return units;
}
function partition(units, format) {
  // Keep an opening mark with its following word even when that word alone exceeds the target.
  // This runs inside one speech block, so it never joins words across a measured pause.
  units=units.reduce((result,unit)=>{
    const previous=result.at(-1);
    if(previous&&opening(previous.text.trim()))result[result.length-1]={...previous,end:unit.end,text:join(previous.text,unit.text)};
    else result.push(unit);
    return result;
  },[]);
  const n=units.length,cost=Array(n+1).fill(Infinity),next=Array(n);cost[n]=0;
  // Short bounded lookahead balances the final caption as well as the first one.
  for(let i=n-1;i>=0;i--){let text='',internalStops=0;
    for(let j=i;j<n;j++){
      if(j>i&&sentenceEnd(text.trim()))internalStops++;
      text=join(text,units[j].text);const count=length(text.trim()),duration=units[j].end-units[i].start;
      if(j>i&&(count>30||duration>6))break;
      if(j+1<n&&(closing(units[j+1].text)||opening(text.trim())))continue;
      const shortPenalty=count<12?22:count<20?(20-count)*1.5:0;
      const boundary=sentenceEnd(text.trim())?-14:phraseEnd(text.trim())?-6:0;
      const grammar=j+1<n?grammarPenalty(text,units[j+1].text):0;
      const score=(count-26)**2*.035+shortPenalty+boundary+internalStops*18+(duration<.8?12:0)+grammar+cost[j+1];
      if(score<cost[i]){cost[i]=score;next[i]=j+1;}
    }
    if(next[i]===undefined){next[i]=i+1;cost[i]=100+cost[i+1];}
  }
  const cues=[];
  for(let i=0;i<n;){let end=next[i],text=units.slice(i,end).reduce((t,u)=>join(t,u.text),'').trim();
    // Attach closing punctuation even if it takes the caption slightly past the character target.
    while(end<n&&closing(units[end].text)){text=join(text,units[end].text);end++;}
    cues.push({start:units[i].start,end:units[end-1].end,text:format(text)});i=end;
  }
  return cues;
}
export function buildCaptionCues(data,offset,duration,format){
  const source=Array.isArray(data.words)&&data.words.length?data.words.map(w=>({start:w.start,end:w.end,text:w.word})):(data.segments||[]).filter(s=>!(s.no_speech_prob>.6&&s.avg_logprob< -1)).map(s=>({start:s.start,end:s.end,text:s.text}));
  const units=timedUnits(source,offset,duration),blocks=[];let block=[];
  for(const unit of units){if(block.length&&unit.start-block.at(-1).end>=.5){blocks.push(block);block=[];}block.push(unit);}if(block.length)blocks.push(block);
  return blocks.flatMap(group=>partition(group,format));
}
