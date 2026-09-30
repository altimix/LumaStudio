const assert=require('node:assert/strict');

module.exports=async function checkClipEdges(page,save,zoom,checks){
  const original=await save();
  let expanded=false;
  const compactGripHeights=new Map();
  const cursorAt=point=>page.evaluate(({x,y})=>getComputedStyle(document.elementFromPoint(x,y)).cursor,point);
  const clip=kind=>page.locator(`.timeline-clip.${kind}`);
  const checkWaveformGrips=async kind=>{
    const item=clip(kind);
    await item.scrollIntoViewIfNeeded();
    const bounds=await item.boundingBox();
    await item.click({position:{x:bounds.width/2,y:10}});
    assert.ok((await item.getAttribute('class')).split(' ').includes('selected'));
    assert.equal(await item.locator('.clip-waveform canvas').count(),1,`${kind} fixture has an actual waveform`);
    await item.locator('.clip-waveform canvas[data-waveform-detail="ready"]').waitFor({timeout:30000});
    const waveformBefore=await item.locator('.clip-waveform canvas').evaluate(el=>el.toDataURL());
    const geometry=await item.evaluate(el=>{
      const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
      return {clip:rect(el),name:rect(el.querySelector('.clip-name')),wave:rect(el.querySelector('.clip-waveform')),edges:[...el.querySelectorAll('.trim-handle')].map(handle=>{
        const r=rect(handle),style=getComputedStyle(handle,'::after');
        return {side:handle.classList.contains('left')?'left':'right',handle:r,content:style.content,top:r.top+parseFloat(style.top),height:parseFloat(style.height),width:parseFloat(style.width)};
      })};
    });
    assert.equal(geometry.edges.length,2);
    for(const grip of geometry.edges){
      assert.notEqual(grip.content,'none',`${kind} ${grip.side} selection grip is visible`);
      assert.notEqual(grip.content,'normal',`${kind} ${grip.side} selection grip is visible`);
      assert.ok(grip.top>=geometry.name.top&&grip.top+grip.height<=geometry.name.bottom,`${kind} ${grip.side} grip stays inside the name band`);
      assert.ok(grip.top+grip.height<=geometry.wave.top,`${kind} ${grip.side} grip does not look like a waveform peak`);
      assert.ok(grip.height>0&&grip.width>0);
      assert.ok(Math.abs(grip.handle.height-(geometry.clip.height-2))<1,`${kind} ${grip.side} hit target still spans the clip interior`);
      assert.ok(grip.handle.width>=12,`${kind} ${grip.side} hit target keeps its usable width`);
      const key=`${kind}:${grip.side}`;
      if(expanded)assert.equal(grip.height,compactGripHeights.get(key),`${kind} ${grip.side} visual grip does not grow with the waveform`);
      else compactGripHeights.set(key,grip.height);
    }
    const lane=item.locator('..'),laneBounds=await lane.boundingBox();
    await page.mouse.click(laneBounds.x+8,laneBounds.y+laneBounds.height/2);
    assert.ok(!(await item.getAttribute('class')).split(' ').includes('selected'));
    assert.ok(await item.locator('.trim-handle').evaluateAll(handles=>handles.every(handle=>['none','normal'].includes(getComputedStyle(handle,'::after').content))),'unselected clips have no selection grip');
    assert.equal(await item.locator('.clip-waveform canvas').evaluate(el=>el.toDataURL()),waveformBefore,'selection changes controls without changing the waveform pixels');
  };
  const pointAt=async(kind,edge)=>{
    await clip(kind).scrollIntoViewIfNeeded();
    const r=await clip(kind).boundingBox();
    return {x:edge==='left'?r.x+4:r.x+r.width-4,y:r.y+(expanded?r.height*.4:3)};
  };
  const drag=async(point,delta,expected,cancel=false)=>{
    await page.mouse.move(point.x,point.y);await page.mouse.down();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.timelineGesture),expected);
    await page.mouse.move(point.x+delta*zoom,point.y,{steps:6});
    if(cancel)await page.keyboard.press('Escape');
    await page.mouse.up();assert.equal(await page.evaluate(()=>document.documentElement.dataset.timelineGesture),undefined);
  };
  await clip('video').focus();await page.keyboard.press('v');
  assert.equal(await clip('video').evaluate(el=>getComputedStyle(el).cursor),'default');
  for(const tall of [false,true]){
    expanded=tall;
    if(tall){
      const height=page.getByRole('button',{name:'トラックの高さ（末尾の丸）',exact:true});
      for(let step=0;step<8;step++)await height.press('ArrowUp');
    }
    const rowHeight=await page.locator('.track-lane').first().evaluate(el=>el.getBoundingClientRect().height);
    assert.ok(tall?rowHeight>95:rowHeight===48,'cover both minimum and expanded row heights');
    for(const kind of ['video','audio']){
      await checkWaveformGrips(kind);
      for(const edge of ['left','right']){
        const point=await pointAt(kind,edge);
        assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('trim-handle'),point),true,`${kind} ${edge} trim is reachable in ${expanded?'expanded':'compact'} rows`);
        assert.match(await cursorAt(point),/url\(.+ew-resize/);
        await drag(point,edge==='left'?.5:-.5,'trim');
        const changed=(await save()).clips.find(c=>c.kind===kind),before=original.clips.find(c=>c.kind===kind);
        assert.equal(changed.duration,3.5);assert.equal(changed.speed,1);assert.equal(changed.start,edge==='left'?2.5:2);assert.equal(changed.in,edge==='left'?1.5:1);
        await page.keyboard.press('Control+z');assert.deepEqual((await save()).clips,original.clips);
        await page.keyboard.press('Control+Shift+z');assert.deepEqual((await save()).clips.find(c=>c.id===before.id),changed);
        await page.keyboard.press('Control+z');await save();
      }
    }
  }
  checks.push('clip edges: selected waveform grips stay in the name band without overlapping audio/video waveforms; deselection keeps waveform pixels, full-height targets and fixed grip size survive taller rows');
  const thumb=page.locator('.timeline-navigation.vertical .timeline-navigation-thumb'),bounds=await thumb.boundingBox();
  await thumb.dblclick({position:{x:bounds.width/2,y:bounds.height/2}});expanded=false;
  assert.equal(await page.locator('.track-lane').first().evaluate(el=>el.getBoundingClientRect().height),48);
  await drag(await pointAt('audio','right'),-.5,'trim',true);assert.deepEqual((await save()).clips,original.clips);
  checks.push('clip edges: video/audio left/right trim in minimum and expanded rows, full-height edges, cursors, Undo/Redo and Esc');
  await clip('video').scrollIntoViewIfNeeded();const body=await clip('video').boundingBox(),bodyPoint={x:body.x+body.width/2,y:body.y+10};
  await drag(bodyPoint,.5,'move',true);assert.deepEqual((await save()).clips,original.clips);
  await page.keyboard.down('Alt');await drag(bodyPoint,.5,'copy',true);await page.keyboard.up('Alt');assert.deepEqual((await save()).clips,original.clips);
  checks.push('clip edges: V arrow changes to grabbing/copy during gestures and restores after cancel');
  await clip('audio').click({position:{x:30,y:10}});
  const node=clip('audio').locator('.volume-node').first();
  const center=await node.evaluate(el=>{const svg=el.ownerSVGElement,r=svg.getBoundingClientRect(),v=svg.viewBox.baseVal;return {x:r.left+el.cx.baseVal.value*r.width/v.width,y:r.top+el.cy.baseVal.value*r.height/v.height};});
  assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('volume-node'),center),true,'accurate gain endpoint remains reachable above trim handle');
  await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x,center.y-6,{steps:4});await page.mouse.up();
  assert.equal((await save()).clips.find(c=>c.kind==='audio').duration,4);assert.notDeepEqual((await save()).clips,original.clips);
  await page.keyboard.press('Control+z');assert.deepEqual((await save()).clips,original.clips);
  await clip('audio').focus();await page.keyboard.press('c');
  const edge=await pointAt('audio','left');assert.match(await cursorAt(edge),/url\(.+16 8, crosshair/);
  await page.mouse.click(edge.x,edge.y);let cut=await save();assert.equal(cut.clips.filter(c=>c.kind==='audio').length,2);assert.equal(cut.clips.filter(c=>c.kind==='audio').reduce((sum,c)=>sum+c.duration,0),4);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.timelineGesture),undefined);
  await page.keyboard.press('Control+z');assert.deepEqual((await save()).clips,original.clips);
  const line=clip('audio').locator('.volume-line-hit');
  const middle=await line.evaluate(el=>{const point=el.getPointAtLength(el.getTotalLength()/2),matrix=el.getScreenCTM();return {x:matrix.a*point.x+matrix.e,y:matrix.d*point.y+matrix.f};});
  const rect=await clip('audio').boundingBox(),source=original.clips.find(c=>c.kind==='audio');
  const expectedCut=Math.round((source.start+(middle.x-rect.x)/zoom)*original.fps)/original.fps;
  await page.mouse.click(middle.x,middle.y);cut=await save();assert.equal(cut.clips.filter(c=>c.kind==='audio').length,2);
  assert.equal(cut.clips.filter(c=>c.kind==='audio').sort((a,b)=>a.start-b.start)[1].start,expectedCut,'vertical scissors hotspot cuts at the pointed timeline frame');
  await page.keyboard.press('Control+z');assert.deepEqual((await save()).clips,original.clips);
  checks.push('clip edges: exact gain endpoint stays draggable; C scissors cuts on edges and volume lines without trimming');
  await page.getByRole('button',{name:'レート調整ツール（長さで再生速度を変更）',exact:true}).click();
  const ratePoint=await pointAt('audio','right');const rateCursor=await cursorAt(ratePoint);assert.match(rateCursor,/url\(.+ew-resize/);
  await drag(ratePoint,-1,'rate');const rated=(await save()).clips.find(c=>c.kind==='audio');assert.equal(rated.duration,3);assert.ok(Math.abs(rated.duration*rated.speed-4)<1e-9);
  await page.keyboard.press('Control+z');assert.deepEqual((await save()).clips,original.clips);
  checks.push('clip edges: rate tool bypasses audio gain targets and retains source interval');
};
