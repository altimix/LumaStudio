import { hasClipAudio, audioTargets, syncLinkedEdits, clipsLocked } from './clip-links.mjs';
import { volumeAt } from './volume-automation.mjs';
export const VIDEO_TRANSITIONS = { dissolve:'クロスディゾルブ', pageTurn:'ページターン', pagePeel:'ページピール' };
export const AUDIO_TRANSITIONS = { constantGain:'コンスタントゲイン', constantPower:'コンスタントパワー' };
const epsilon=1e-6;
export function maxTransitionDuration(from,to,fps){return Math.max(1,Math.floor(Math.min(60,from.duration/2,to.duration/2)*fps+epsilon))/fps;}
function context(p){
  const clips=new Map(p.clips.map(c=>[c.id,c])),lanes=new Map(p.tracks.map(t=>[t.id,[]])),positions=new Map(),assets=new Map(p.assets.map(a=>[a.id,a]));
  for(const c of p.clips)lanes.get(c.trackId)?.push(c);
  for(const lane of lanes.values()){lane.sort((a,b)=>a.start-b.start);lane.forEach((c,index)=>positions.set(c.id,index));}
  return {clips,lanes,positions,assets};
}
export function transitionPlan(p, strict=true){
  if(p.transitions===undefined)return [];
  if(!Array.isArray(p.transitions)||p.transitions.length>1999)throw new Error('トランジション一覧が不正です。');
  const {clips,lanes,positions,assets}=context(p),ids=new Set(),incoming=new Set(),outgoing=new Set(),result=[];
  for(const t of p.transitions){
    try{
      if(!t||typeof t.id!=='string'||ids.has(t.id)||(!t.video&&!t.audio)||(t.video&&!Object.hasOwn(VIDEO_TRANSITIONS,t.video))||(t.audio&&!Object.hasOwn(AUDIO_TRANSITIONS,t.audio)))throw Error();
      const from=clips.get(t.fromId),to=clips.get(t.toId),lane=lanes.get(from?.trackId);
      if(!from||!to||!lane||to.start<=from.start+epsilon||['video','audio'].some(kind=>t[kind]&&(incoming.has(`${to.id}:${kind}`)||outgoing.has(`${from.id}:${kind}`))))throw Error();
      if(t.video&&(from.trackId!==to.trackId||positions.get(to.id)!==positions.get(from.id)+1))throw Error();
      if(!t.video&&from.trackId===to.trackId&&positions.get(to.id)!==positions.get(from.id)+1)throw Error();
      if(t.mode!==undefined&&t.mode!=='fixed')throw Error();
      let start=to.start,end=from.start+from.duration,duration=end-start;
      if(t.mode==='fixed'){
        duration=t.duration;
        if(!Number.isFinite(duration)||Math.abs(duration*p.fps-Math.round(duration*p.fps))>epsilon||Math.abs(end-to.start)>epsilon)throw Error();
        start=to.start-Math.floor(duration*p.fps/2+epsilon)/p.fps;end=start+duration;
      }
      if(duration<1/p.fps-epsilon||duration>(t.mode==='fixed'?maxTransitionDuration(from,to,p.fps):Math.min(60,from.duration/2,to.duration/2))+epsilon||to.start+to.duration<end-epsilon)throw Error();
      if(t.video&&(!['video','image'].includes(from.kind)||!['video','image'].includes(to.kind)))throw Error();
      if(t.audio&&![from,to].every(c=>hasClipAudio(c,assets.get(c.assetId))))throw Error();
      ids.add(t.id);for(const kind of ['video','audio'])if(t[kind]){incoming.add(`${to.id}:${kind}`);outgoing.add(`${from.id}:${kind}`);}result.push({...t,from,to,start,end,duration});
    }catch{if(strict)throw new Error('トランジションの接続が不正です。隣り合うクリップのつなぎ目に設定してください。');}
  }
  return result;
}
export function validateTransitions(p){transitionPlan(p);}
export function pruneTransitions(p){
  if(!p.transitions)return p;const valid=new Set(transitionPlan(p,false).map(t=>t.id));return valid.size===p.transitions.length?p:{...p,transitions:p.transitions.filter(t=>valid.has(t.id))};
}
export function applyTransition(p,fromId,toId,options,id){
  const from=p.clips.find(c=>c.id===fromId),to=p.clips.find(c=>c.id===toId),track=p.tracks.find(t=>t.id===from?.trackId);
  if(!from||!to||from.trackId!==to.trackId||!track||track.locked)throw new Error('同じトラックの隣り合うクリップを選び、ロックを解除してください。');
  const lane=p.clips.filter(c=>c.trackId===track.id).sort((a,b)=>a.start-b.start);
  if(lane.indexOf(to)!==lane.indexOf(from)+1)throw new Error('間に別のクリップがあります。隣り合う2つのクリップを選んでください。');
  if(to.start>from.start+from.duration+epsilon)throw new Error('クリップの間の隙間を詰めてからトランジションを追加してください。');
  if(!Number.isFinite(options.duration)||options.duration<=0)throw new Error('トランジションの長さを入力してください。');
  const maximum=maxTransitionDuration(from,to,p.fps);
  if(maximum<1/p.fps)throw new Error('トランジションを追加するにはクリップを長くしてください。');
  const duration=Math.max(1/p.fps,Math.min(maximum,Math.round(options.duration*p.fps)/p.fps));
  // Existing overlaps remain as authored. New adjacent cuts use handles without
  // changing any clip timing, including linked audio and subsequent tracks.
  const timing=Math.abs(from.start+from.duration-to.start)<=epsilon?{mode:'fixed',duration}:{};
  const existing=p.transitions?.find(t=>t.fromId===fromId&&t.toId===toId),video=options.video||existing?.video;
  const fromAudio=audioTargets(p,[fromId])[0],toAudio=audioTargets(p,[toId])[0];
  const oldAudio=p.transitions?.find(t=>t.fromId===fromAudio?.id&&t.toId===toAudio?.id&&t.audio);
  const audio=options.audio||oldAudio?.audio||(options.autoAudio&&fromAudio&&toAudio?'constantPower':undefined);
  if(audio&&(!fromAudio||!toAudio))throw Error('音声付きのクリップが必要です。分離済みの場合は音声をリンクしてください。');
  if(audio&&clipsLocked(p,[fromAudio.id,toAudio.id]))throw Error('音声トラックのロックを解除してください。');
  const combined=audio&&fromAudio.id===fromId&&toAudio.id===toId;
  const added=[...(video||combined?[{id,fromId,toId,...timing,...(video?{video}:{}),...(combined?{audio}:{})}]:[]),...(audio&&!combined?[{id:video?`${id}-audio`:id,fromId:fromAudio.id,toId:toAudio.id,...timing,audio}]:[])];
  const replaced=new Set([existing?.id,oldAudio?.id]);
  const next=syncLinkedEdits(p,{...p,transitions:[...(p.transitions||[]).filter(t=>!replaced.has(t.id)),...added]},()=>`${id}-link`);
  validateTransitions(next);return next;
}
export function audioEnvelopes(p){
  const map=new Map(),plans=transitionPlan(p),assets=new Map(p.assets.map(a=>[a.id,a]));
  for(const t of plans)if(t.audio){
    let start=t.start,end=t.end;
    if(t.mode==='fixed'){
      const from=mediaWindow(t.from,assets.get(t.from.assetId),plans,'audio'),to=mediaWindow(t.to,assets.get(t.to.assetId),plans,'audio');
      start=Math.max(start,to.start);end=Math.min(end,from.end);
    }
    for(const [clip,direction]of [[t.from,'out'],[t.to,'in']]){
      // Audio has no freeze-frame equivalent. With no usable overlap, fade to
      // the cut and from the cut; never loop a sample or move dialogue in time.
      const range=end-start>epsilon?{start,end}:direction==='out'?{start:t.start,end:t.to.start}:{start:t.to.start,end:t.end};
      if(range.end-range.start>epsilon){const list=map.get(clip.id)||[];list.push({...range,curve:t.audio,direction});map.set(clip.id,list);}
    }
  }
  // A hard edit between unrelated samples clicks even with exact scheduling.
  // Use a tiny edge ramp only at discontinuous adjacent cuts. A simple split
  // of continuous source audio stays sample-identical, without a volume dip.
  for(const track of p.tracks){
    const lane=p.clips.filter(c=>c.trackId===track.id&&hasClipAudio(c,assets.get(c.assetId))).sort((a,b)=>a.start-b.start);
    for(let i=1;i<lane.length;i++){
      const from=lane[i-1],to=lane[i];
      if(Math.abs(from.start+from.duration-to.start)>epsilon||plans.some(t=>t.audio&&t.fromId===from.id&&t.toId===to.id))continue;
      const fromGain=from.audioMuted||from.fadeOut?0:from.volume*volumeAt(from.volumeKeyframes,from.duration);
      const toGain=to.audioMuted||to.fadeIn?0:to.volume*volumeAt(to.volumeKeyframes,0);
      const continuous=from.assetId===to.assetId&&Math.abs(from.in+from.duration*from.speed-to.in)<epsilon&&from.speed===to.speed&&Math.abs(fromGain-toGain)<epsilon&&from.audioTreatment===to.audioTreatment;
      if(continuous)continue;
      for(const [clip,direction]of [[from,'out'],[to,'in']]){
        // A cross-track transition owns only its participating edge. Do not
        // truncate its handles, but still soften the unrelated hard-cut side.
        if(plans.some(t=>t.audio&&(direction==='out'?t.fromId===clip.id:t.toId===clip.id)))continue;
        const duration=Math.min(.003,clip.duration/2),edge=to.start;
        const list=map.get(clip.id)||[];
        list.push({start:direction==='out'?edge-duration:edge,end:direction==='out'?edge:edge+duration,curve:'constantGain',direction});map.set(clip.id,list);
      }
    }
  }
  return map;
}
export function mediaWindow(c,asset,plans,kind){
  let start=c.start,end=c.start+c.duration;
  for(const t of plans)if(t.mode==='fixed'&&t[kind]){
    if(t.toId===c.id)start=Math.min(start,t.start);
    if(t.fromId===c.id)end=Math.max(end,t.end);
  }
  const sourceLimited=asset&&asset.kind!=='image';
  if(kind==='audio'&&sourceLimited){start=Math.max(start,c.start-c.in/c.speed);end=Math.min(end,c.start+(asset.duration-c.in)/c.speed);}
  const rawIn=c.in+(start-c.start)*c.speed,rawEnd=c.in+(end-c.start)*c.speed;
  const sourceIn=sourceLimited?Math.max(0,rawIn):0,sourceEnd=sourceLimited?Math.min(asset.duration,rawEnd):(end-start)*c.speed;
  return {start,end,duration:end-start,sourceIn,sourceDuration:Math.max(0,sourceEnd-sourceIn),padBefore:sourceLimited?Math.max(0,-rawIn)/c.speed:0,padAfter:sourceLimited?Math.max(0,rawEnd-asset.duration)/c.speed:0};
}
export function visualSourceTime(c,asset,time){return Math.max(0,Math.min(Math.max(0,asset.duration-1/(asset.fps||120)),c.in+(time-c.start)*c.speed));}
export function crossfadeGain(envelopes,time){
  let gain=1;for(const e of envelopes||[]){let p=Math.max(0,Math.min(1,(time-e.start)/(e.end-e.start)));if(e.direction==='out')p=1-p;gain*=e.curve==='constantPower'?Math.sin(p*Math.PI/2):p;}return gain;
}
