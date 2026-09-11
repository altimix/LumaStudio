const { number } = require('./audio-render.cjs');
const { xfadeExpression } = require('../shared/video-transitions.mjs');
function compositeVisuals(filters,visuals,plans,fps) {
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
    const endFrame=Math.max(1,Math.ceil(end*fps-1e-7));
    // Keep a nonempty slot when a sub-frame clip rounds past its own end.
    const startFrame=Math.min(Math.round(item.clip.start*fps),endFrame-1);
    filters.push(`[${label}]settb=1/${fps},setpts=PTS+${startFrame}[${shifted}]`);
    const x=item.full?'0':`(W-w)/2+W*${number((item.clip.graphic?0:item.clip.x)/100)}`,y=item.full?'0':`(H-h)/2+H*${number((item.clip.graphic?0:item.clip.y)/100)}`;
    filters.push(`[${base}][${shifted}]overlay=x=${x}:y=${y}:eof_action=repeat:repeatlast=1:enable='gte(t,${number((startFrame-.5)/fps)})*lt(t,${number((endFrame-.5)/fps)})'[${out}]`);base=out;
  }
  return base;
}
module.exports={compositeVisuals};
