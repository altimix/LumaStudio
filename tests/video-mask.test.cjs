const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clampCropEdge, DEFAULT_VIDEO_MASK, ffmpegMaskExpression, flattenBezierMask, hasVideoMask, maskAlphaAt, MAX_BEZIER_MASK_POINTS, moveBezierAnchor, moveBezierHandle, rasterizeBezierMask, resizeMaskAxis, validateVideoMask } = require('../shared/video-mask.mjs');

const clip = patch => ({ kind: 'video', ...patch });
test('validates backward-compatible crop and shape mask metadata', () => {
  assert.doesNotThrow(() => validateVideoMask(clip({})));
  assert.doesNotThrow(() => validateVideoMask(clip({ crop: { top: .1, right: .2, bottom: .3, left: .1 }, videoMask: { ...DEFAULT_VIDEO_MASK } })));
  for (const crop of [null, { top: 0, right: 0, bottom: 0, left: NaN }, { top: 0, right: .5, bottom: 0, left: .5 }]) assert.throws(() => validateVideoMask(clip({ crop })), /クロップ/);
  for (const videoMask of [null, { ...DEFAULT_VIDEO_MASK, type: 'path' }, { ...DEFAULT_VIDEO_MASK, width: 0 }, { ...DEFAULT_VIDEO_MASK, inverted: 'yes' }]) assert.throws(() => validateVideoMask(clip({ videoMask })), /マスク/);
  assert.throws(() => validateVideoMask({ kind: 'audio', crop: { top: 0, right: 0, bottom: 0, left: 0 } }), /クロップ/);
});

test('calculates rectangle, ellipse, feather, inversion and crop alpha', () => {
  assert.equal(maskAlphaAt(clip({}), .1, .1), 1);
  const cropped = clip({ crop: { top: .1, right: .2, bottom: .3, left: .1 } });
  assert.equal(maskAlphaAt(cropped, .05, .5), 0); assert.equal(maskAlphaAt(cropped, .5, .5), 1);
  const rectangle = clip({ videoMask: { ...DEFAULT_VIDEO_MASK, width: .4, height: .6 } });
  assert.equal(maskAlphaAt(rectangle, .5, .5), 1); assert.equal(maskAlphaAt(rectangle, .1, .5), 0);
  const ellipse = clip({ videoMask: { ...DEFAULT_VIDEO_MASK, type: 'ellipse', width: .4, height: .4 } });
  assert.equal(maskAlphaAt(ellipse, .5, .5), 1); assert.equal(maskAlphaAt(ellipse, .65, .65), 0);
  const feather = clip({ videoMask: { ...DEFAULT_VIDEO_MASK, width: .4, height: .4, feather: .5 } });
  assert.ok(Math.abs(maskAlphaAt(feather, .65, .5) - .5) < 1e-8);
  assert.ok(Math.abs(maskAlphaAt(clip({ videoMask: { ...feather.videoMask, inverted: true } }), .65, .5) - .5) < 1e-8);
});

test('keeps corner resize results valid when the opposite edge is outside the source', () => {
  assert.deepEqual(resizeMaskAxis(-.5, 2, 1), { center: 0, size: 1 });
  assert.deepEqual(resizeMaskAxis(1.5, -1, -1), { center: 1, size: 1 });
  assert.deepEqual(resizeMaskAxis(.2, 2, 1), { center: .7, size: 1 });
  assert.ok(Math.abs(resizeMaskAxis(.8, -1, -1).center - .3) < 1e-12);
  for (const [opposite,direction] of [[-.5,1],[.2,1],[.8,-1],[1.5,-1]]) for (const desired of [-2, 0, .5, 1, 3]) {
    const result = resizeMaskAxis(opposite, desired, direction);
    assert.ok(result.center >= 0 && result.center <= 1); assert.ok(result.size >= .01 && result.size <= 1);
  }
});

test('keeps percentage slider endpoints within the persisted crop limit', () => {
  const crop = { top: 0, right: 0, bottom: .001, left: 0 };
  crop.top = clampCropEdge(crop, 'top', 98.9 / 100);
  assert.equal(crop.top, .99 - crop.bottom);
  assert.ok(crop.top + crop.bottom <= .99);
  assert.doesNotThrow(() => validateVideoMask(clip({ crop })));
});

test('validates bounded editable and closed Bezier point lists', () => {
  const point=(x,y,kind='line')=>({x,y,inX:x,inY:y,outX:x,outY:y,kind});
  const open={type:'bezier',points:[point(.2,.2),point(.8,.2)],closed:false,feather:0,inverted:false};
  assert.doesNotThrow(()=>validateVideoMask(clip({videoMask:open})));
  assert.throws(()=>validateVideoMask(clip({videoMask:{...open,closed:true}})),/点列/);
  const closed={...open,points:[...open.points,point(.5,.8,'curve')],closed:true};
  assert.doesNotThrow(()=>validateVideoMask(clip({videoMask:closed})));
  assert.throws(()=>validateVideoMask(clip({videoMask:{...closed,points:Array.from({length:MAX_BEZIER_MASK_POINTS+1},()=>point(.5,.5))}})),/点列/);
  for(const bad of [{...point(.5,.5),x:NaN},{...point(.5,.5),outX:3},{...point(.5,.5),kind:'other'}])assert.throws(()=>validateVideoMask(clip({videoMask:{...closed,points:[point(.2,.2),point(.8,.2),bad]}})),/ベジェマスク/);
});

test('keeps dragged Bezier anchors and mirrored handles inside persisted bounds', () => {
  const point={x:.9,y:.1,inX:-.9,inY:.1,outX:1.9,outY:.1,kind:'curve'};
  const anchor=moveBezierAnchor(point,1,-1);assert.equal(anchor.x,1);assert.equal(anchor.y,0);assert.equal(anchor.inX,-.8);assert.equal(anchor.outX,2);
  const outgoing=moveBezierHandle(anchor,'out',5,-5);assert.ok(outgoing.outX<=2&&outgoing.outY>=-1);assert.ok(outgoing.inX>=-1&&outgoing.inY<=2);
  assert.ok(Math.abs((outgoing.outX-outgoing.x)+(outgoing.inX-outgoing.x))<1e-10);assert.ok(Math.abs((outgoing.outY-outgoing.y)+(outgoing.inY-outgoing.y))<1e-10);
});

test('flattens curves and rasterizes the same closed path with crop, feather and inversion', () => {
  const points=[
    {x:.2,y:.2,inX:.2,inY:.2,outX:.35,outY:.05,kind:'curve'},
    {x:.8,y:.2,inX:.65,inY:.05,outX:.8,outY:.2,kind:'curve'},
    {x:.8,y:.8,inX:.8,inY:.8,outX:.8,outY:.8,kind:'line'},
    {x:.2,y:.8,inX:.2,inY:.8,outX:.2,outY:.8,kind:'line'},
  ],videoMask={type:'bezier',points,closed:true,feather:.1,inverted:false},effect=clip({crop:{top:0,right:.1,bottom:0,left:0},videoMask});
  assert.ok(flattenBezierMask(videoMask).length>points.length);
  assert.ok(maskAlphaAt(effect,.5,.5)>.9);assert.equal(maskAlphaAt(effect,.05,.5),0);assert.equal(maskAlphaAt(effect,.95,.5),0);
  const raster=rasterizeBezierMask(effect,100,100);assert.equal(raster.length,10000);assert.ok(raster[50*100+50]>230);assert.equal(raster[50*100+5],0);assert.equal(raster[50*100+95],0);
  const inverted=rasterizeBezierMask(clip({videoMask:{...videoMask,inverted:true,feather:0}}),100,100);assert.equal(inverted[50*100+50],0);assert.equal(inverted[5*100+5],255);
  const open=rasterizeBezierMask(clip({videoMask:{...videoMask,closed:false,inverted:true}}),16,9);assert.ok(open.every(value=>value===255));
  assert.throws(()=>rasterizeBezierMask(effect,5000,100),/画像サイズ/);
});

test('feathers paths at the raster boundary without fading paths outside the frame', () => {
  const point=(x,y)=>({x,y,inX:x,inY:y,outX:x,outY:y,kind:'line'});
  const mask=points=>clip({videoMask:{type:'bezier',points,closed:true,feather:.1,inverted:false}});
  const fullFrame=mask([point(0,0),point(1,0),point(1,1),point(0,1)]),fullRaster=rasterizeBezierMask(fullFrame,100,100);
  const expected=Math.round(maskAlphaAt(fullFrame,.005,.505)*255);
  assert.ok(expected>0&&expected<255);assert.ok(Math.abs(fullRaster[50*100]-expected)<=1);assert.equal(fullRaster[50*100+10],255);
  const outside=mask([point(-.2,-.2),point(1.2,-.2),point(1.2,1.2),point(-.2,1.2)]),outsideRaster=rasterizeBezierMask(outside,100,100);
  assert.equal(maskAlphaAt(outside,.005,.505),1);assert.equal(outsideRaster[50*100],255);
});

test('builds bounded FFmpeg expressions only when an effect is active', () => {
  assert.equal(hasVideoMask(clip({})), false); assert.equal(ffmpegMaskExpression(clip({})), '1');
  const effect = clip({ crop: { top: .1, right: 0, bottom: 0, left: .2 }, videoMask: { ...DEFAULT_VIDEO_MASK, type: 'ellipse', feather: .2, inverted: true } });
  assert.equal(hasVideoMask(effect), true);
  assert.match(ffmpegMaskExpression(effect), /between/); assert.match(ffmpegMaskExpression(effect), /sqrt/); assert.match(ffmpegMaskExpression(effect), /clip/);
  assert.doesNotMatch(ffmpegMaskExpression(effect), /NaN|Infinity/);
});
