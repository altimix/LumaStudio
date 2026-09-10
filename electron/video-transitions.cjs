const { number } = require('./audio-render.cjs');
const { xfadeExpression } = require('../shared/video-transitions.mjs');
function compositeVisuals(filters,visuals,plans) {
  const outgoing=new Map(plans.filter(t=>t.video).map(t=>[t.fromId,t])), seen=new Set();
  let base='base',serial=0;
  for(const item of visuals){
    if(seen.has(item.clip.id))continue;
    let current=item,label=item.label,end=item.clip.start+item.clip.duration;seen.add(item.clip.id);
    while(outgoing.has(current.clip.id)){
      const t=outgoing.get(current.clip.id),next=visuals.find(v=>v.clip.id===t.toId);if(!next)break;
      const out=`transition${serial++}`;
      filters.push(`[${label}][${next.label}]xfade=transition=custom:duration=${number(t.duration)}:offset=${number(t.start-item.clip.start)}:expr='${xfadeExpression(t.video)}'[${out}]`);
      label=out;current=next;end=current.clip.start+current.clip.duration;seen.add(current.clip.id);
    }
    const shifted=`shifted${serial++}`,out=`composite${serial++}`;
    filters.push(`[${label}]setpts=PTS+${number(item.clip.start)}/TB[${shifted}]`);
    const x=item.full?'0':`(W-w)/2+W*${number((item.clip.graphic?0:item.clip.x)/100)}`,y=item.full?'0':`(H-h)/2+H*${number((item.clip.graphic?0:item.clip.y)/100)}`;
    filters.push(`[${base}][${shifted}]overlay=x=${x}:y=${y}:eof_action=pass:repeatlast=0:enable='gte(t,${number(item.clip.start)})*lt(t,${number(end)})'[${out}]`);base=out;
  }
  return base;
}
module.exports={compositeVisuals};
