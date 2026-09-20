const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ffmpeg,run,inspectMedia}=require('../electron/media.cjs');
const {setVisualKey}=require('../shared/visual-keyframes.mjs');
const root=path.join(__dirname,'..');
async function verify(){
  const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'.local','visual-keys-')),env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000}),page=await app.firstWindow(),errors=[],checks=[];
  page.on('pageerror',error=>errors.push(error.message));
  const projectFile=path.join(results,'共通キーフレーム検証.luma');
  const clip={id:'title',trackId:'v',kind:'title',name:'文字の見た目',start:0,in:0,duration:2,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'日本語のアニメーション',fontSize:72,color:'#ffffff',textStyle:'minimal',textShadow:false};
  let serial=0;
  const base=()=>({version:1,id:`visual-${++serial}`,name:`キーフレームの検証 ${serial}`,width:640,height:360,fps:10,assets:[],markers:[],tracks:[{id:'v',name:'素材',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[{...clip}]});
  const open=async project=>{
    await fs.writeFile(projectFile,JSON.stringify(project));
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});},projectFile);
    await page.getByRole('button',{name:'ファイル',exact:true}).click();await page.getByRole('button',{name:/^プロジェクトを開く/}).click();await page.getByRole('button',{name:project.name,exact:true}).waitFor({timeout:60000});
    await page.locator('.timeline-clip').first().focus();await page.keyboard.press('Enter');
  };
  const save=async()=>{await page.getByRole('button',{name:/^プロジェクトを保存 \(/}).click();await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));return JSON.parse(await fs.readFile(projectFile,'utf8'));};
  const seek=async frames=>{await page.getByRole('button',{name:'先頭へ (Home)',exact:true}).click();for(let i=0;i<Math.floor(frames/10);i++)await page.keyboard.press('Shift+ArrowRight');for(let i=0;i<frames%10;i++)await page.keyboard.press('ArrowRight');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const input=async(label,value)=>{const field=page.getByRole('spinbutton',{name:label,exact:true});await field.fill(String(value));await field.press('Enter');};
  const color=async(id,value)=>page.locator(id).evaluate((element,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const undo=async()=>{await page.getByRole('button',{name:/^元に戻す \(/}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const timelineZoom=async value=>{
    await page.getByRole('slider',{name:'タイムラインのズーム',exact:true}).evaluate((element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,String(value));element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));},value);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  const alignment=async(start,duration)=>page.locator('.timeline-clip').first().evaluate((element,{start,duration})=>{
    const origin=document.querySelector('.timeline-content').getBoundingClientRect().left,zoom=Number(document.querySelector('.zoom-slider').value),graph=element.querySelector('.clip-visual-keys').getBoundingClientRect();
    const points=[...element.querySelectorAll('.clip-visual-key')].map(point=>{const box=point.getBoundingClientRect(),time=Number(point.dataset.keyTime),expected=origin+(start+time)*zoom;return {time,actual:box.left+box.width/2,expected,error:box.left+box.width/2-expected};});
    return {start,duration,zoom,scroll:document.querySelector('.timeline-scroll').scrollLeft,points,graphStartError:graph.left-(origin+start*zoom),graphEndError:graph.right-(origin+(start+duration)*zoom)};
  },{start,duration});
  const frame=async()=>{
    await page.getByLabel('プレビュー画質',{exact:true}).selectOption('1');await page.waitForFunction(()=>document.querySelector('.canvas-wrap canvas').width===640);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    return Buffer.from(await page.locator('.canvas-wrap canvas').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data).filter((_,i)=>i%4!==3)));
  };
  const exportAndCompare=async(name,samples)=>{
    const output=path.join(results,`${name}.mp4`),reference=[];
    for(const time of samples){await seek(Math.round(time*10));reference.push(await frame());}
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('品質',{exact:true}).selectOption('high');await page.getByLabel('書き出し方式',{exact:true}).selectOption('cpu');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.export-success')||document.querySelector('.export-error'),undefined,{timeout:180000});
    assert.ok(await page.getByText('書き出しが完了しました',{exact:true}).isVisible(),await page.locator('.export-error').allTextContents());
    const differences=[];
    for(let index=0;index<samples.length;index++){
      const actual=await run(ffmpeg,['-v','error','-ss',String(samples[index]),'-i',output,'-frames:v','1','-vf','scale=640:360','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.equal(actual.length,reference[index].length);
      let sum=0;for(let i=0;i<actual.length;i++)sum+=Math.abs(actual[i]-reference[index][i]);const mean=sum/actual.length;differences.push(mean);assert.ok(mean<8,`${name} at ${samples[index]}: mean error ${mean}`);
    }
    await page.getByRole('button',{name:'閉じる',exact:true}).click();return differences;
  };
  try{
    await page.locator('.app-titlebar').waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
    const geometry=[];
    for(const sample of [{start:0,duration:4,times:[0,.5,1,2,3,4]},{start:12.3,duration:4,times:[0,.5,1,2,3,4]},{start:3,duration:1/30,times:[0,1/30]}]){
      const project=base();project.fps=30;Object.assign(project.clips[0],{start:sample.start,duration:sample.duration,opacityKeyframes:sample.times.map(time=>({time,value:.5}))});await open(project);
      for(const zoom of [8,40,125.5,200]){
        await timelineZoom(zoom);
        for(const scroll of [0,Math.max(0,(sample.start+sample.duration*.4)*zoom-100)]){
          await page.locator('.timeline-scroll').evaluate((element,left)=>{element.scrollLeft=left;},scroll);
          geometry.push(await alignment(sample.start,sample.duration));
        }
      }
    }
    await fs.writeFile(path.join(results,'keyframe-alignment-geometry.json'),JSON.stringify(geometry,null,2));
    const maxAlignmentError=Math.max(...geometry.flatMap(sample=>[Math.abs(sample.graphStartError),Math.abs(sample.graphEndError),...sample.points.map(point=>Math.abs(point.error))]));
    console.log('Timeline keyframe maximum alignment error:',maxAlignmentError,'CSS px');
    assert.ok(maxAlignmentError<.05,`keyframes must match timeline time coordinates: ${maxAlignmentError} CSS px`);
    assert.ok(geometry.some(sample=>sample.scroll>0),'alignment checked after horizontal scrolling');
    checks.push('先頭・途中・末尾、非ゼロ開始、1フレーム素材の点と線が全倍率・横スクロール後も時刻に一致');
    const timed=base();timed.fps=30;Object.assign(timed.clips[0],{start:2,duration:4,opacityKeyframes:[0,1,4].map(time=>({time,value:.5}))});await open(timed);await timelineZoom(200);
    await page.getByRole('combobox',{name:'キーフレームの表示項目',exact:true}).selectOption('opacity');
    const atPoint=time=>page.locator(`.clip-visual-key[data-key-time="${time}"]`);
    const assertPlayheadAligned=async time=>{
      const position=await atPoint(time).evaluate(element=>{const box=element.getBoundingClientRect();return {delta:box.left+box.width/2-document.querySelector('.playhead').getBoundingClientRect().left,clipScroll:element.closest('.timeline-clip').scrollLeft};});
      assert.equal(position.clipScroll,0,'focusing an endpoint must not scroll inside the clip');
      assert.ok(Math.abs(position.delta)<.05,`point ${time} and playhead differ by ${position.delta} CSS px`);
    };
    for(const time of [0,1,4]){await atPoint(time).press('Enter');await assertPlayheadAligned(time);}
    for(const time of [0,4]){
      const point=atPoint(time);await point.scrollIntoViewIfNeeded();const box=await point.boundingBox();
      await page.mouse.click(box.x+box.width/2+(time===0?2:-2),box.y+box.height/2);
      assert.equal(await point.getAttribute('aria-pressed'),'true','clipped endpoint remains selectable');await assertPlayheadAligned(time);
    }
    const movedTime=31/30;
    const centerPoint=async()=>{
      const point=atPoint(1);await point.scrollIntoViewIfNeeded();const box=await point.boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2};
    };
    let center=await centerPoint();await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x+200/30,center.y,{steps:3});await page.mouse.up();
    let edited=await save();assert.equal(edited.clips[0].visualKeyframes[1].time,movedTime);assert.equal(edited.clips[0].visualKeyframes[1].values.opacity,.5);await assertPlayheadAligned(movedTime);
    await undo();await page.getByRole('button',{name:/^やり直す \(/}).click();assert.ok(await atPoint(movedTime).isVisible());await undo();
    center=await centerPoint();await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x+20,center.y);
    await page.locator('.timeline-scroll').evaluate(element=>{element.scrollLeft+=20;});await page.mouse.move(center.x+20,center.y);await page.mouse.up();
    edited=await save();assert.equal(edited.clips[0].visualKeyframes[1].time,1.2,'drag includes timeline scroll displacement');await assertPlayheadAligned(1.2);await undo();
    center=await centerPoint();await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x+20,center.y);await timelineZoom(100);await page.mouse.up();
    edited=await save();assert.equal(edited.clips[0].opacityKeyframes[1].time,1,'zoom change cancels the active keyframe drag');assert.equal(edited.clips[0].visualKeyframes,undefined);assert.equal(await page.getByRole('button',{name:/^やり直す \(/}).isEnabled(),true,'zoom cancellation preserves Redo');
    checks.push('端の点と再生ヘッドが一致・1フレームの移動・スクロール中の移動・倍率変更の取消とUndo/Redo');
    const graphBox=await page.locator('.clip-visual-keys').boundingBox();
    await page.mouse.dblclick(graphBox.x+.5*100,graphBox.y+graphBox.height*.5);
    edited=await save();assert.ok(edited.clips[0].visualKeyframes.some(key=>key.time===.5),'double click adds at the exact timeline frame');assert.equal(edited.clips[0].start,2);assert.equal(edited.clips[0].duration,4);await assertPlayheadAligned(.5);
    const trimReachable=await page.locator('.timeline-clip').first().evaluate(element=>{const box=element.getBoundingClientRect();return !!document.elementFromPoint(box.left+2,box.top+10)?.closest('.trim-handle.left');});assert.ok(trimReachable,'clip edge remains available outside graph points/lines');
    await page.locator('.timeline-panel').screenshot({path:path.join(results,'keyframe-timeline-alignment.png')});await undo();await save();checks.push('線のダブルクリック位置に正確に追加・素材の時間配置とトリミング操作を保持');
    const p=base();p.clips[0].opacityKeyframes=[{time:0,value:0},{time:1,value:1}];await open(p);
    await timelineZoom(40);
    assert.equal(await page.locator('.clip-visual-key').count(),2);assert.equal(await page.locator('.clip-keyframe-curve').count(),1);
    const channelSelect=page.getByRole('combobox',{name:'キーフレームの表示項目',exact:true});
    const highlighted=()=>page.locator('.property-field.line-active input[type="number"]').evaluateAll(elements=>elements.map(element=>element.id));
    await channelSelect.selectOption('opacity');assert.deepEqual(await highlighted(),['prop-opacity']);
    await channelSelect.selectOption('scale');assert.deepEqual(await highlighted(),['prop-scale']);
    await page.getByRole('spinbutton',{name:'文字サイズ',exact:true}).focus();assert.equal(await channelSelect.inputValue(),'fontSize');assert.deepEqual(await highlighted(),['prop-fontSize']);assert.match(await page.locator('.clip-keyframe-label').innerText(),/文字サイズ/);assert.match(await page.locator('.keyframe-readout strong').innerText(),/px$/);
    await page.getByRole('spinbutton',{name:'開始時間',exact:true}).focus();assert.equal(await channelSelect.inputValue(),'fontSize');assert.deepEqual(await highlighted(),['prop-fontSize']);
    await channelSelect.selectOption('color');assert.deepEqual(await highlighted(),[]);assert.match(await page.locator('.visual-channel-help').innerText(),/一定の高さ/);
    await channelSelect.selectOption('fontSize');await page.locator('.property-field.line-active').scrollIntoViewIfNeeded();await page.locator('.inspector-panel').screenshot({path:path.join(results,'keyframe-active-property.png')});
    checks.push('表示項目・数値欄のフォーカス・ラインの名前と単位が連動し、非数値の高さと時間配置の除外を説明');
    const colorBox=await page.locator('#text-color').boundingBox(),styleBox=await page.locator('#text-style').boundingBox();assert.ok(colorBox.y<styleBox.y);
    await page.getByText('影・縁取りを調整',{exact:true}).click();await page.getByLabel('文字に縁取りを付ける',{exact:true}).check();
    const dimensions=await page.locator('#text-color,#strokeColor').evaluateAll(elements=>elements.map(element=>({w:element.getBoundingClientRect().width,h:element.getBoundingClientRect().height})));assert.deepEqual(dimensions[0],dimensions[1]);await undo();checks.push('文字色はスタイルの上・縁取りと同じパレット');
    await seek(10);await input('不透明度',80);let saved=await save();assert.equal(saved.clips[0].opacityKeyframes,undefined);assert.equal(saved.clips[0].visualKeyframes[1].values.opacity,.8);
    await undo();assert.equal(await page.getByRole('spinbutton',{name:'不透明度',exact:true}).inputValue(),'100');
    await page.getByRole('button',{name:'現在のキーフレームを削除',exact:true}).click();assert.equal(await page.locator('.clip-visual-key').count(),1);await undo();assert.equal(await page.locator('.clip-visual-key').count(),2);checks.push('旧不透明度キーの読込・移行・削除・Undo');
    await page.getByRole('button',{name:'素材 ロック',exact:true}).click();assert.equal(await page.getByRole('spinbutton',{name:'不透明度',exact:true}).isDisabled(),true);assert.equal(await page.locator('.clip-visual-key').first().isDisabled(),true);await undo();
    await page.getByRole('combobox',{name:'キーフレームの表示項目',exact:true}).selectOption('opacity');
    const point=page.locator('.clip-visual-key').nth(1);await point.scrollIntoViewIfNeeded();let bounds=await point.boundingBox();const graph=await page.locator('.clip-visual-keys').boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+graph.width*.1,bounds.y+bounds.height/2,{steps:5});await page.mouse.up();saved=await save();assert.equal(saved.clips[0].visualKeyframes[1].time,1.2);await undo();
    bounds=await point.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+20,bounds.y+bounds.height/2+10,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();saved=await save();assert.equal(saved.clips[0].opacityKeyframes[1].time,1);checks.push('線でつながった点の移動・Escape取消・ロック保護');
    await seek(10);await input('文字サイズ',120);await color('#text-color','#ff0000');await seek(5);
    assert.equal(await page.getByRole('spinbutton',{name:'文字サイズ',exact:true}).inputValue(),'96');assert.equal(await page.locator('#text-color').inputValue(),'#ff8080');
    await page.getByRole('button',{name:'再生ヘッドにキーフレームを追加',exact:true}).click();assert.equal(await page.locator('.clip-visual-key').count(),3);await undo();
    saved=await save();assert.equal(saved.clips[0].text,clip.text);assert.equal(saved.clips[0].visualKeyframes.length,2);saved.id='reloaded-keys';saved.name='保存したキーフレーム';await open(saved);await seek(5);assert.equal(await page.getByRole('spinbutton',{name:'文字サイズ',exact:true}).inputValue(),'96');
    await page.screenshot({path:path.join(results,'visual-keyframes-text.png')});const textError=await exportAndCompare('文字の共通キーフレーム',[0,.5,1]);checks.push('文字サイズと色の補間・文章共通・保存再読込・実MP4一致');
    const source=path.join(results,'映像キーフレーム素材.mp4');await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=0x095bd8:s=640x360:r=10:d=2','-c:v','libx264','-pix_fmt','yuv420p',source]);
    const asset=await inspectMedia(source,path.join(profile,'cache')),video=base();video.assets=[asset];video.clips=[{...clip,id:'video',kind:'video',name:'動く映像',assetId:asset.id,x:-20,scale:.5}];video.clips[0]=setVisualKey(setVisualKey(video.clips[0],0),1,{x:20,rotation:25,opacity:.5,scale:.8,exposure:.4});await open(video);await seek(5);
    assert.equal(await channelSelect.inputValue(),'opacity');assert.deepEqual(await highlighted(),['prop-opacity']);
    await channelSelect.selectOption('crop.left');await page.locator('.inspector-section').filter({has:page.locator('summary').filter({hasText:'クロップ'})}).locator('summary').click();assert.equal(await page.locator('.property-field.line-active label').innerText(),'左');assert.match(await page.locator('.visual-channel-status').innerText(),/クロップ \/ 左/);
    checks.push('別素材で存在しない項目は不透明度へ揃え、入れ子のクロップ設定も対応欄を強調');
    assert.equal(await page.getByRole('spinbutton',{name:'位置 X',exact:true}).inputValue(),'320');await input('位置 X',300);saved=await save();assert.equal(saved.clips[0].visualKeyframes.length,3);assert.equal(saved.clips[0].visualKeyframes[1].values.x,-3.125);await undo();
    const target=page.locator('.media-drag-target');await target.waitFor();const box=await target.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+20,{steps:5});await page.mouse.up();saved=await save();assert.equal(saved.clips[0].visualKeyframes.length,3);await undo();
    const videoError=await exportAndCompare('映像の共通キーフレーム',[0,.5,1]);checks.push('映像の位置・サイズ・回転・不透明度・色・モニター操作・実MP4一致');
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(results,'keyframe-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,maxAlignmentError,alignmentScenarios:geometry.length,textError,videoError,consoleErrors:errors},null,2));console.log('Visual keyframes verified:',{checks,maxAlignmentError,textError,videoError});
  }catch(error){await page.screenshot({path:path.join(results,'keyframes-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
