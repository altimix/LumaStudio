const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const { setVisualKey } = require('../shared/visual-keyframes.mjs');
const root = path.join(__dirname, '..');

(async () => {
  const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});const file=path.join(results,'数値ドラッグ検証.luma'),mediaFile=path.join(results,'数値ドラッグ素材.mp4');
  await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=0x285ca8:s=640x360:r=30:d=3','-f','lavfi','-i','anullsrc=r=48000:cl=stereo:d=3','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',mediaFile]);const asset=await inspectMedia(mediaFile,path.join(root,'.local','number-scrub-cache'));
  const video={id:'clip',assetId:asset.id,trackId:'v1',linkId:'linked-av',name:asset.name,kind:'video',start:0,in:0,duration:3,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:0,fadeIn:.4,fadeOut:.6,text:'',fontSize:94,color:'#ffffff',textStyle:'hero',audioDetached:true};
  const audio={...video,id:'audio',trackId:'a1',kind:'audio',name:`${asset.name}（音声）`,audioDetached:undefined,volume:1,volumeKeyframes:[{time:.5,value:.4},{time:2.5,value:.9}]};
  const next={...video,id:'next',linkId:undefined,start:3,name:`${asset.name} 2`,audioDetached:undefined,audioMuted:true,fadeIn:0,fadeOut:0};
  const fixture={version:1,id:'number-scrub',name:'数値ドラッグ検証',width:640,height:360,fps:30,assets:[asset],markers:[],tracks:[{id:'v1',name:'Video1',kind:'video',muted:false,hidden:false,locked:false,solo:false},{id:'a1',name:'Audio1',kind:'audio',muted:false,hidden:false,locked:false,solo:false}],clips:[video,audio,next],transitions:[{id:'number-transition',fromId:'clip',toId:'next',mode:'fixed',duration:1,video:'dissolve'}]};await fs.writeFile(file,JSON.stringify(fixture));
  const profile=await fs.mkdtemp(path.join(root,'.local','number-scrub-')),env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.LUMA_DEMO_FIXTURE;delete env.LUMA_TEST_FIXTURES;
  const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
  const page=await app.firstWindow(),checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  const save=async()=>{
    await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());
    const before=(await fs.stat(file).catch(()=>null))?.mtimeMs;await page.keyboard.press('Control+s');const deadline=Date.now()+20000;
    while((await fs.stat(file).catch(()=>null))?.mtimeMs===before){if(Date.now()>deadline)throw Error('数値ドラッグ後の保存が完了しませんでした。');await new Promise(resolve=>setTimeout(resolve,25));}
    await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));await page.getByRole('dialog',{name:'プロジェクトを保存しています',exact:true}).waitFor({state:'hidden'});return JSON.parse(await fs.readFile(file,'utf8'));
  };
  const scrub=async(locator,dx,cancel)=>{
    await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();assert.ok(box,'scrubbable number input');const x=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:Math.max(2,Math.ceil(Math.abs(dx)/2))});
    if(cancel==='escape')await page.keyboard.press('Escape');
    if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    if(cancel==='pointer')await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));
    await page.mouse.up();
  };
  const scrubRoundTrip=async(locator,dx)=>{
    await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();assert.ok(box,'round-trip scrubbable number input');const x=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:4});await page.mouse.move(x,y,{steps:4});await page.mouse.up();
  };
  const value=(project,id,key)=>project.clips.find(clip=>clip.id===id)[key];
  try{
    await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await page.keyboard.press('Control+o');await page.getByRole('button',{name:fixture.name,exact:true}).waitFor({timeout:60000});
    let project=JSON.parse(await fs.readFile(file,'utf8')),clip=project.clips.find(item=>item.kind==='video');assert.ok(clip,'video clip');
    await page.locator(`.media-drag-target[data-media-clip-id="${clip.id}"]`).click();const rotation=page.locator('#prop-rotation');await rotation.waitFor();
    const initial=value(project,clip.id,'rotation');assert.equal(await page.getByRole('button',{name:/^元に戻す \(/,exact:true}).isDisabled(),true);
    assert.equal(await page.locator('.inspector-content').getByRole('slider').count(),0,'property sliders start collapsed');
    const rotationToggle=page.getByRole('button',{name:'回転のスライダー',exact:true}),rotationSlider=page.getByRole('slider',{name:'回転スライダー',exact:true});
    assert.equal(await rotationToggle.getAttribute('aria-expanded'),'false');
    await rotationToggle.focus();await rotationToggle.press('Enter');await rotationSlider.waitFor();
    assert.equal(await rotationToggle.getAttribute('aria-expanded'),'true');
    await rotationToggle.press('Space');await rotationSlider.waitFor({state:'hidden'});assert.equal(await rotationSlider.count(),0);
    await rotationToggle.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.id),'prop-opacity','Tab skips the collapsed slider');
    assert.equal(await rotation.isVisible(),true);assert.equal(await page.locator('.unsaved-dot').count(),0);
    assert.equal(await page.getByRole('button',{name:/^元に戻す \(/,exact:true}).isDisabled(),true);
    checks.push('sliders toggle with Enter/Space while numeric inputs stay visible, with no dirty state or history');
    await scrub(rotation,2);project=await save();assert.equal(value(project,clip.id,'rotation'),initial);assert.equal(await page.getByRole('button',{name:/^元に戻す \(/,exact:true}).isDisabled(),true);
    await rotation.click();await rotation.press('Control+a');await rotation.fill('7');await rotation.press('Enter');project=await save();assert.equal(value(project,clip.id,'rotation'),7);
    await page.keyboard.press('Control+z');assert.equal(value(await save(),clip.id,'rotation'),initial);await page.keyboard.press('Control+Shift+z');assert.equal(value(await save(),clip.id,'rotation'),7);
    checks.push('a click remains a normal number edit and sub-threshold movement creates no history');

    await rotation.click();await scrub(rotation,20);project=await save();assert.equal(value(project,clip.id,'rotation'),7);assert.equal(await page.getByRole('button',{name:/^元に戻す \(/,exact:true}).isDisabled(),false);
    checks.push('dragging an already focused input remains native text selection instead of scrubbing');

    await scrub(rotation,20);project=await save();assert.equal(value(project,clip.id,'rotation'),17);await page.keyboard.press('Control+z');assert.equal(value(await save(),clip.id,'rotation'),7);await page.keyboard.press('Control+Shift+z');assert.equal(value(await save(),clip.id,'rotation'),17);
    await scrub(rotation,-10);project=await save();assert.equal(value(project,clip.id,'rotation'),12);await page.keyboard.press('Control+z');assert.equal(value(await save(),clip.id,'rotation'),17);await page.keyboard.press('Control+Shift+z');assert.equal(value(await save(),clip.id,'rotation'),12);
    checks.push('right raises and left lowers by step with one Undo and Redo per scrub');

    await page.evaluate(()=>{window.__numberScrubEscapePrevented=null;window.addEventListener('keydown',event=>{if(event.key==='Escape')window.__numberScrubEscapePrevented=event.defaultPrevented;},{capture:true,once:true});});await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.__numberScrubEscapePrevented),false);
    checks.push('completed scrubs remove their capture-phase Escape listener');

    for(const cancellation of ['escape','blur','pointer']){await scrub(rotation,24,cancellation);assert.equal(value(await save(),clip.id,'rotation'),12);}
    await page.keyboard.press('Control+z');assert.equal(value(await save(),clip.id,'rotation'),17);await page.keyboard.press('Control+Shift+z');assert.equal(value(await save(),clip.id,'rotation'),12);
    checks.push('Escape, focus loss and pointer cancellation restore both value and history');

    await rotationToggle.click();await rotationSlider.focus();await rotationSlider.press('ArrowRight');project=await save();assert.equal(value(project,clip.id,'rotation'),13);
    await page.keyboard.press('Control+z');assert.equal(value(await save(),clip.id,'rotation'),12);
    await page.keyboard.press('Control+Shift+z');assert.equal(value(await save(),clip.id,'rotation'),13);
    await page.keyboard.press('Control+z');await save();await rotationToggle.click();
    checks.push('an expanded slider remains keyboard-editable with Undo/Redo');

    const opacity=page.locator('#prop-opacity');await opacity.click();await opacity.press('Control+a');await opacity.fill('99');await opacity.press('Enter');assert.ok(Math.abs(value(await save(),clip.id,'opacity')-.99)<1e-9);
    await scrub(opacity,20);assert.equal(value(await save(),clip.id,'opacity'),1);await page.keyboard.press('Control+z');assert.ok(Math.abs(value(await save(),clip.id,'opacity')-.99)<1e-9);await page.keyboard.press('Control+Shift+z');assert.equal(value(await save(),clip.id,'opacity'),1);
    await scrub(opacity,20);assert.equal(value(await save(),clip.id,'opacity'),1);await page.keyboard.press('Control+z');assert.ok(Math.abs(value(await save(),clip.id,'opacity')-.99)<1e-9);await page.keyboard.press('Control+Shift+z');await save();
    checks.push('limits are clamped and a no-op drag at the limit creates no Undo entry');

    const positionX=page.locator('#prop-x');assert.equal(Number(await positionX.inputValue()),320);
    await scrub(positionX,20);project=await save();assert.equal(Number(await positionX.inputValue()),330);assert.equal(value(project,clip.id,'x'),1.5625);
    await page.keyboard.press('Control+z');project=await save();assert.equal(value(project,clip.id,'x'),0);assert.equal(Number(await positionX.inputValue()),320);
    await page.keyboard.press('Control+Shift+z');await save();assert.equal(Number(await positionX.inputValue()),330);
    await scrub(positionX,20,'escape');await save();assert.equal(Number(await positionX.inputValue()),330);
    checks.push('center position scrubs in sequence pixels with a single Undo/Redo and Escape cancellation');

    const start=page.locator('#prop-start');await scrub(start,20);project=await save();const linkedVideo=project.clips.find(item=>item.id===clip.id),linkedAudio=project.clips.find(item=>item.id==='audio');assert.ok(linkedVideo.start>.25,`linked video start ${linkedVideo.start}`);assert.ok(Math.abs(linkedVideo.start-linkedAudio.start)<1e-9,`linked timing ${linkedVideo.start} / ${linkedAudio.start}`);
    await page.keyboard.press('Control+z');project=await save();assert.equal(project.clips.find(item=>item.id===clip.id).start,0);assert.equal(project.clips.find(item=>item.id==='audio').start,0);await page.keyboard.press('Control+Shift+z');project=await save();assert.ok(Math.abs(project.clips.find(item=>item.id===clip.id).start-project.clips.find(item=>item.id==='audio').start)<1e-9);
    checks.push('every intermediate timing scrub keeps linked video and audio synchronized');

    const duration=page.locator('#prop-duration');await scrub(duration,20);assert.equal(Number(await duration.inputValue()),3);project=await save();assert.equal(value(project,clip.id,'duration'),3);assert.equal(value(project,'audio','duration'),3);
    checks.push('the input reconciles to the normalized accepted duration when the source limit rejects a requested value');

    const roundTripBefore={video:project.clips.find(item=>item.id===clip.id),audio:project.clips.find(item=>item.id==='audio'),transitions:project.transitions};await scrubRoundTrip(duration,-200);project=await save();assert.deepEqual(project.clips.find(item=>item.id===clip.id),roundTripBefore.video);assert.deepEqual(project.clips.find(item=>item.id==='audio'),roundTripBefore.audio);assert.deepEqual(project.transitions,roundTripBefore.transitions);
    checks.push('a duration round trip restores fades, volume automation, linked timing and transitions from the gesture snapshot');

    await page.locator('.inspector-section').filter({ has: page.locator('summary').filter({hasText:'クロップ'}) }).locator('summary').click();
    const cropBottom=page.locator('input[id^="effect-"][id$="-下"]');await scrub(cropBottom,20);project=await save();assert.ok(Math.abs(project.clips.find(item=>item.id===clip.id).crop.bottom-.01)<1e-9);
    await page.locator('.inspector-section').filter({ has: page.locator('#video-mask-type') }).locator('summary').click();
    await page.locator('#video-mask-type').selectOption('ellipse');const maskX=page.locator('input[id^="effect-"][id$="-位置-X"]');await scrub(maskX,20);project=await save();assert.ok(Math.abs(project.clips.find(item=>item.id===clip.id).videoMask.x-.51)<1e-9);
    await page.keyboard.press('Control+z');assert.equal(value(await save(),clip.id,'videoMask').x,.5);await page.keyboard.press('Control+Shift+z');await save();
    checks.push('crop and mask fields use the same persisted scrub gesture');

    const regionFields=[['中心 X','x'],['中心 Y','y'],['幅','width'],['高さ','height']];
    const verifyRegion=async(effect,property,fields)=>{
      await page.locator('.inspector-section').filter({has:page.locator('summary').filter({hasText:effect})}).locator('summary').click();
      await page.getByRole('checkbox',{name:`${effect}を適用`,exact:true}).check();
      for(const [label,key] of [...regionFields,...fields]){
        const input=page.getByRole('spinbutton',{name:`${effect}の${label}`,exact:true});
        assert.match(await input.getAttribute('class'),/scrubbable-number/,`${effect} ${label} uses the shared input`);
        const before=(await save()).clips.find(item=>item.id===clip.id)[property][key];
        await scrub(input,20);const increased=(await save()).clips.find(item=>item.id===clip.id)[property][key];
        assert.ok(Math.abs(increased-before-.01)<1e-9,`${effect} ${label} increases by 1%`);
        await page.keyboard.press('Control+z');assert.ok(Math.abs((await save()).clips.find(item=>item.id===clip.id)[property][key]-before)<1e-9);
        await page.keyboard.press('Control+Shift+z');assert.ok(Math.abs((await save()).clips.find(item=>item.id===clip.id)[property][key]-increased)<1e-9);
        await page.keyboard.press('Control+z');await save();
      }
    };
    await verifyRegion('モザイク','mosaic',[['粗さ','blockSize']]);
    await verifyRegion('ガウスぼかし','gaussianBlur',[['強さ','sigma']]);
    const roughness=page.getByRole('spinbutton',{name:'モザイクの粗さ',exact:true}),strength=page.getByRole('spinbutton',{name:'ガウスぼかしの強さ',exact:true});
    const typedBefore=await save();await roughness.click();await roughness.fill('3.3');await roughness.press('Enter');
    assert.equal((await save()).clips.find(item=>item.id===clip.id).mosaic.blockSize,.033);
    await page.keyboard.press('Control+z');assert.deepEqual(await save(),typedBefore);
    await roughness.click();await roughness.fill('4.2');await roughness.press('Escape');assert.deepEqual(await save(),typedBefore);
    await roughness.focus();await roughness.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement?.id),`region-${clip.id}-mosaic-blockSize`);
    checks.push('mosaic numeric input keeps direct typing, Escape cancellation and Tab navigation');
    const beforeRegions=await save(),undoLabel=await page.getByRole('button',{name:/^元に戻す \(/,exact:true}).textContent();
    await scrubRoundTrip(roughness,40);assert.deepEqual(await save(),beforeRegions);assert.equal(await page.getByRole('button',{name:/^元に戻す \(/,exact:true}).textContent(),undoLabel);
    for(const [input,cancel] of [[roughness,'escape'],[strength,'pointer'],[strength,'blur']]){await scrub(input,24,cancel);assert.deepEqual(await save(),beforeRegions);}
    await scrub(roughness,200);assert.equal((await save()).clips.find(item=>item.id===clip.id).mosaic.blockSize,.1);await page.keyboard.press('Control+z');await save();
    await scrub(strength,-200);assert.equal((await save()).clips.find(item=>item.id===clip.id).gaussianBlur.sigma,.001);await page.keyboard.press('Control+z');await save();
    checks.push('all ten mosaic and Gaussian fields scrub, undo and redo once, preserve round trips and cancellations, and respect strength limits');

    const keySection=page.locator('.inspector-section').filter({has:page.locator('.visual-keyframes-panel')});if(await keySection.getAttribute('open')===null)await keySection.locator('summary').click();
    await page.getByRole('button',{name:'再生ヘッドにキーフレームを追加',exact:true}).click();const beforeFocus=await save();
    const channels=[['上','crop.top'],['右','crop.right'],['下','crop.bottom'],['左','crop.left'],['位置 X','videoMask.x'],['位置 Y','videoMask.y'],['幅','videoMask.width'],['高さ','videoMask.height'],['境界のぼかし','videoMask.feather'],['色の許容範囲','chromaKey.tolerance'],['境界のなめらかさ','chromaKey.softness'],['緑の色かぶり除去','chromaKey.greenSpill'],['青の色かぶり除去','chromaKey.blueSpill']];
    const focusChannels=async fields=>{for(const [label,channel] of fields){
      const field=page.locator(`input[id^="effect-"][id$="-${label.replace(/\s/g,'-')}"]`);await field.focus();
      assert.equal(await page.locator('select[aria-label="キーフレームの表示項目"]').inputValue(),channel);
    }};
    await focusChannels(channels.slice(0,9));assert.deepEqual(await save(),beforeFocus);
    await page.locator('.inspector-tabs button').nth(1).click();await page.getByRole('button',{name:'クロマキーを有効にする',exact:true}).click();const beforeColorFocus=await save();
    await focusChannels(channels.slice(9));assert.deepEqual(await save(),beforeColorFocus);await page.locator('.inspector-tabs button').first().click();
    checks.push('all 13 crop, mask and chroma number fields select their own keyframe graph without changing project data');

    const focusDuringPlayback=async field=>{
      await field.scrollIntoViewIfNeeded();await page.locator('.timeline-content').focus();await page.keyboard.press('Home');
      for(let i=0;i<3;i++)await page.keyboard.press('Shift+ArrowRight');
      const before=await page.locator('.ruler-label .timecode').textContent();await page.keyboard.press('l');
      await page.waitForFunction(before=>document.querySelector('.ruler-label .timecode').textContent!==before,before);
      await field.focus();assert.equal(await page.getByRole('status',{name:'シャトル状態'}).textContent(),'停止','focusing a numeric field stops playback');
      const held=await page.locator('.ruler-label .timecode').textContent();await page.waitForTimeout(250);
      assert.equal(await page.locator('.ruler-label .timecode').textContent(),held,'the edit position stays fixed while entering a value');
      const [h,m,s,f]=held.split(':').map(Number);return (h*60+m)*60+s+f/fixture.fps;
    };
    const beforeTimingFocus=await save(),graphBefore=await page.locator('select[aria-label="キーフレームの表示項目"]').inputValue();
    for(const property of ['start','duration','in','fadeIn','fadeOut'])await focusDuringPlayback(page.locator(`#prop-${property}`));
    assert.deepEqual(await save(),beforeTimingFocus);assert.equal(await page.locator('select[aria-label="キーフレームの表示項目"]').inputValue(),graphBefore);
    checks.push('timing and fade inputs stop playback on focus without changing the project, history or visual graph');

    const audioClip=page.locator('.timeline-clip[data-clip-id="audio"]');await audioClip.focus();await audioClip.press('Enter');
    await page.locator('.inspector-tabs').getByRole('button',{name:'オーディオ',exact:true}).click();
    const beforeVolumeFocus=await save(),volume=page.locator('#prop-volume'),heldTime=await focusDuringPlayback(volume);
    await volume.fill('65');await page.waitForTimeout(250);await volume.press('Enter');
    const afterVolumeFocus=await save(),oldAudio=beforeVolumeFocus.clips.find(c=>c.id==='audio'),newAudio=afterVolumeFocus.clips.find(c=>c.id==='audio');
    const keyTime=Math.round((heldTime-oldAudio.start)*fixture.fps)/fixture.fps,editedKey=newAudio.volumeKeyframes.find(k=>Math.abs(k.time-keyTime)<1e-7);
    assert.ok(editedKey,'typing edits the point where the input received focus');assert.ok(Math.abs(editedKey.value*newAudio.volume-.65)<1e-9);
    assert.deepEqual(newAudio.volumeKeyframes.filter(k=>Math.abs(k.time-keyTime)>=1e-7),oldAudio.volumeKeyframes);
    await page.keyboard.press('Control+z');assert.deepEqual(await save(),beforeVolumeFocus);
    await page.keyboard.press('Control+Shift+z');assert.deepEqual(await save(),afterVolumeFocus);
    await page.keyboard.press('Control+z');assert.deepEqual(await save(),beforeVolumeFocus);
    await page.locator(`.timeline-clip[data-clip-id="${clip.id}"]`).focus();await page.keyboard.press('Enter');await page.locator('.inspector-tabs button').first().click();
    checks.push('audio volume editing during playback writes at the held frame and preserves other points through Undo/Redo');

    await rotation.click();await rotation.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'prop-rotation');
    const track=project.tracks.find(item=>item.id===clip.trackId);await page.getByRole('button',{name:`${track.name} ロック`,exact:true}).click();await save();assert.equal(await rotation.isDisabled(),true);
    assert.equal(await roughness.isDisabled(),true);assert.equal(await strength.isDisabled(),true);
    checks.push('Tab navigation remains available and locked tracks disable scrubbing, including mosaic and Gaussian fields');
    for(const kind of ['graphic','textBox']){
      const shape={shape:'rectangle',width:160,height:80,lineWidth:8,fill:true,fillColor:'#ffcc33'},box={width:160,height:80};
      const base={...video,id:'round-trip',assetId:undefined,linkId:undefined,kind:'title',name:'往復ドラッグ',text:'テキスト',fontSize:32,textStyle:'minimal',textShadow:false,fadeIn:0,fadeOut:0,audioDetached:undefined,[kind]:kind==='graphic'?shape:box};
      const keyed=setVisualKey(setVisualKey(base,0),2,{[kind]:{...(kind==='graphic'?shape:box),width:240,height:120},rotation:20});
      const example={...fixture,id:`round-trip-${kind}`,name:`往復ドラッグ ${kind}`,assets:[],clips:[keyed],transitions:[]};
      await fs.writeFile(file,JSON.stringify(example));await page.keyboard.press('Control+o');await page.getByRole('button',{name:example.name,exact:true}).waitFor();
      await page.locator('.timeline-clip').first().focus();await page.keyboard.press('Enter');await page.keyboard.press('Home');
      for(let i=0;i<3;i++)await page.keyboard.press('Shift+ArrowRight');
      assert.equal(await page.locator('.ruler-label .timecode').textContent(),'00:00:01:00');
      const initialProject=await save(),undo=page.getByRole('button',{name:/^元に戻す \(/,exact:true}),redo=page.getByRole('button',{name:/^やり直す \(/,exact:true});
      const prefix=kind==='graphic'?'図形':'テキスト枠';
      for(const label of [`${prefix}の幅`,`${prefix}の高さ`,'回転']){
        const field=page.getByRole('spinbutton',{name:label,exact:true});
        await scrubRoundTrip(field,40);assert.deepEqual(await save(),initialProject,`${label}: returning to the initial value removes the temporary key`);
        assert.equal(await undo.isDisabled(),true,`${label}: a round trip adds no Undo entry`);
        await scrub(field,40);const edited=await save();assert.equal(edited.clips[0].visualKeyframes.length,3);
        assert.equal(edited.clips[0].visualKeyframes[1].time,1);await page.keyboard.press('Control+z');assert.deepEqual(await save(),initialProject);
        assert.equal(await undo.isDisabled(),true,`${label}: a completed scrub adds exactly one Undo entry`);
        await scrubRoundTrip(field,40);assert.deepEqual(await save(),initialProject);assert.equal(await redo.isDisabled(),false,`${label}: a no-op preserves the Redo stack`);
        await page.keyboard.press('Control+Shift+z');assert.deepEqual(await save(),edited);await page.keyboard.press('Control+z');assert.deepEqual(await save(),initialProject);
        await scrub(field,40,'escape');assert.deepEqual(await save(),initialProject);assert.equal(await undo.isDisabled(),true);assert.equal(await redo.isDisabled(),false);
      }
      checks.push(`${kind} width, height and rotation scrubs between keys preserve the original points and Undo/Redo on round trips and cancellation`);
    }
    assert.deepEqual(errors,[]);await page.screenshot({path:path.join(results,'number-scrub.png')});await fs.writeFile(path.join(results,'number-scrub-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,errors},null,2));
    console.log('Number input scrubbing verified:',checks.length,'checks.');
  }catch(error){await page.screenshot({path:path.join(results,'number-scrub-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
