const {_electron:electron}=require('playwright');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const {ffmpeg,run,probe}=require('../electron/media.cjs');const root=path.join(__dirname,'..');
const {exportProject}=require('../electron/export.cjs');
async function verify(){
  const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'.local','transitions-profile-')),env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const inputs=[];for(const [color,hz]of [['red',440],['blue',880]]){const file=path.join(results,color+'-transition.mp4');await run(ffmpeg,['-v','error','-y','-f','lavfi','-i',`color=${color}:s=320x180:r=30:d=3`,'-f','lavfi','-i',`sine=frequency=${hz}:sample_rate=48000:duration=3`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);inputs.push(file);}
  const changing=path.join(results,'time-varying-transition.mp4');await run(ffmpeg,['-v','error','-y','-i',inputs[0],'-i',inputs[1],'-filter_complex','[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]','-map','[v]','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',changing]);inputs.push(changing);
  const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000}),page=await app.firstWindow(),checks=[],errors=[],pixelErrors={},seekPixelErrors={};page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.locator('.media-card').first().waitFor({timeout:60000});const file=path.join(results,'トランジション.luma');
    await app.evaluate(({dialog},data)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:data.inputs});dialog.showSaveDialog=async()=>({canceled:false,filePath:data.file});},{inputs,file});
    await page.getByRole('button',{name:'読み込み',exact:true}).click();await page.getByRole('button',{name:'time-varying-transition.mp4 を追加',exact:true}).waitFor({timeout:60000});
    const save=async()=>{
      const before=(await fs.stat(file).catch(()=>null))?.mtimeMs;
      await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
      // An already-clean project has no dirty dot to await. Wait for the atomic
      // save to finish before a test replaces this file with its next fixture.
      const deadline=Date.now()+10000;
      while((await fs.stat(file).catch(()=>null))?.mtimeMs===before){assert.ok(Date.now()<deadline,'native project save completed');await new Promise(resolve=>setTimeout(resolve,25));}
      return JSON.parse(await fs.readFile(file,'utf8'));
    };
    const demo=await save(),v=demo.clips.find(c=>c.kind==='video');const p={...demo,name:'つなぎ目の検証',width:320,height:180,markers:[],clips:inputs.slice(0,2).map((input,i)=>({...v,id:'v'+i,assetId:demo.assets.find(a=>a.path===input).id,name:i?'切り替え先':'切り替え元',start:i*3,in:0,duration:3,speed:1,volume:1,fadeIn:0,fadeOut:0,scale:1,rotation:0,x:0,y:0,opacity:1,exposure:0,contrast:1,saturation:1}))};
    await fs.writeFile(file,JSON.stringify(p));await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.keyboard.press('Control+o');await page.getByRole('button',{name:p.name,exact:true}).waitFor();
    const incoming=page.locator('.timeline-clip[data-clip-id="v1"]');
    await page.locator('.timeline-clip[data-clip-id="v0"]').focus();await page.keyboard.press('Enter');await page.getByRole('tab',{name:'エフェクト',exact:true}).click();await page.getByLabel('トランジションの長さ',{exact:true}).fill('1');
    await page.getByRole('button',{name:'クロスディゾルブ 2つの映像をなめらかに重ねる',exact:true}).click();
    await page.getByText('前のクリップがありません。切り替え先のクリップ、または隣り合う2つのクリップを選択してください。',{exact:true}).waitFor();
    const firstUnchanged=await save();assert.deepEqual(firstUnchanged.clips.map(c=>c.start),[0,3]);assert.equal(firstUnchanged.transitions?.length||0,0);assert.ok(await page.getByRole('button',{name:'元に戻す (Ctrl+Z)',exact:true}).isDisabled());checks.push('a single first-clip selection is rejected without moving later clips or creating history');
    await incoming.focus();await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'クロスディゾルブ 2つの映像をなめらかに重ねる',exact:true}).click();await page.locator('.timeline-transition').waitFor();let saved=await save();assert.equal(saved.clips[1].start,3);assert.equal(saved.transitions[0].video,'dissolve');assert.equal(saved.transitions[0].audio,'constantPower');assert.equal(saved.clips[1].in,0);assert.equal(saved.clips[1].duration,3);
    await page.keyboard.press('Control+z');await page.locator('.timeline-transition').waitFor({state:'hidden'});assert.equal((await save()).clips[1].start,3);await page.keyboard.press('Control+Shift+z');await page.locator('.timeline-transition').waitFor();checks.push('one selection applies video/audio effects without changing cut positions, with one Undo');
    await require('./verify-transition-delete.cjs')({app,page,save,file,baseline:await save(),checks,results});
    await page.evaluate(()=>{CanvasRenderingContext2D.prototype.getImageData=function(){throw new Error('Transition preview must not read pixels on the UI thread');};});
    await page.getByLabel('プレビュー画質',{exact:true}).selectOption('1');const zoom=Number(await page.getByRole('slider',{name:'タイムラインのズーム',exact:true}).inputValue());
    for(const [kind,name]of [['dissolve','クロスディゾルブ'],['pageTurn','ページターン'],['pagePeel','ページピール']]){
      if(kind!=='dissolve')await page.locator('.transition-list button').filter({hasText:name}).click();
      await page.locator('.timeline-ruler').click({position:{x:2.8*zoom,y:25}});await page.waitForFunction(()=>{const c=document.querySelector('.canvas-wrap canvas');return c.dataset.previewTime==='2.8'&&c.dataset.transitionsReady==='true';});
      assert.equal(await page.locator('video[data-clip-id="v1"]').evaluate(v=>v.currentTime),0,'missing incoming handle freezes the first source frame');
      await page.locator('.timeline-ruler').click({position:{x:3.2*zoom,y:25}});
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.media-elements video')).length===2&&Array.from(document.querySelectorAll('.media-elements video')).every(v=>!v.seeking&&v.readyState>=2));
      await page.waitForFunction(kind=>{const c=document.querySelector('.canvas-wrap canvas');return c.dataset.previewTime==='3.2'&&c.dataset.transitionKind===kind&&c.dataset.transitionsReady==='true';},kind);
      assert.ok(Math.abs(await page.locator('video[data-clip-id="v0"]').evaluate(v=>v.currentTime)-(3-1/30))<.001,'missing outgoing handle freezes the last source frame');
      const expected=path.join(results,kind+'-preview.png');await fs.writeFile(expected,Buffer.from(await page.locator('.canvas-wrap canvas').evaluate(async c=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return c.toDataURL('image/png').split(',')[1];}),'base64'));await save();if(kind==='pagePeel')await page.screenshot({path:path.join(results,'transitions-editor.png')});
      const output=path.join(results,kind+'-native.mp4');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('品質',{exact:true}).selectOption('high');await page.getByLabel('書き出し方式',{exact:true}).selectOption('cpu');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();await page.getByText('書き出しが完了しました',{exact:true}).waitFor({timeout:180000});assert.ok(Math.abs(Number((await probe(output)).format.duration)-6)<.06);
      const ref=await run(ffmpeg,['-v','error','-i',expected,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']),actual=await run(ffmpeg,['-v','error','-ss','3.2','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.equal(actual.length,ref.length);let diff=0;for(let i=0;i<ref.length;i++)diff+=Math.abs(actual[i]-ref[i]);pixelErrors[kind]=diff/ref.length;assert.ok(pixelErrors[kind]<4,`${kind}: ${pixelErrors[kind]}`);await page.locator('.statusbar').getByText('編集の準備ができています',{exact:true}).waitFor({state:'attached'});const exportDialog=page.getByRole('dialog',{name:'動画を書き出す',exact:true});await exportDialog.getByRole('button',{name:'閉じる',exact:true}).click();await exportDialog.waitFor({state:'hidden'});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await incoming.focus();await page.keyboard.press('Enter');
    }checks.push('all three native video transitions match exported MP4 pixels with main-thread pixel readback forbidden');
    await page.locator('.transition-list button').filter({hasText:'コンスタントゲイン'}).click();saved=await save();assert.equal(saved.transitions[0].video,'pagePeel');assert.equal(saved.transitions[0].audio,'constantGain');for(const name of ['クロスディゾルブ','ページピール']){await page.locator('.transition-list button').filter({hasText:name}).click();assert.equal((await save()).transitions[0].audio,'constantGain','video-only changes retain the chosen gain curve');}await page.keyboard.press('Control+o');await page.waitForFunction(()=>document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]').disabled);await incoming.focus();await page.keyboard.press('Enter');assert.equal((await save()).transitions[0].audio,'constantGain');assert.equal(await page.locator('.timeline-clip.offline').count(),0);assert.equal(await page.locator('.media-card.offline').count(),0);
    const track=p.tracks.find(t=>t.id===v.trackId);await page.getByRole('button',{name:track.name+' ロック',exact:true}).click();await page.getByRole('button',{name:'効果を解除',exact:true}).click();assert.equal((await save()).transitions.length,1);await page.getByRole('button',{name:track.name+' ロック解除',exact:true}).click();await page.getByRole('button',{name:'効果を解除',exact:true}).click();saved=await save();assert.equal(saved.transitions.length,0);assert.equal(saved.clips[1].start,3);checks.push('audio curve changes retain video, saved transitions reload, locks protect removal, removal retains placement');
    await page.keyboard.press('Control+z');await page.locator('.timeline-transition').waitFor();await page.getByRole('button',{name:'効果を解除',exact:true}).click();
    const target=await page.locator('[data-track-id="'+v.trackId+'"]').boundingBox(),data=await page.evaluateHandle(()=>{const d=new DataTransfer();d.setData('application/x-luma-transition',JSON.stringify({duration:.5,video:'dissolve'}));return d;});await page.locator('[data-track-id="'+v.trackId+'"]').dispatchEvent('drop',{dataTransfer:data,clientX:target.x+3*zoom,clientY:target.y+30});await page.locator('.timeline-transition').waitFor();assert.equal((await save()).clips[1].start,3);checks.push('dropping an effect changes its duration without changing the joint');
    const baseline=await save();
    await page.evaluate(()=>{
      const ready=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'readyState'),post=Worker.prototype.postMessage;
      Object.defineProperty(HTMLMediaElement.prototype,'readyState',{configurable:true,get(){return globalThis.__holdIncoming&&this.dataset.clipId?.startsWith('waiting-to-')?0:ready.get.call(this);}});
      Worker.prototype.postMessage=function(...args){if(globalThis.__holdIncoming&&['dissolve','pageTurn','pagePeel'].includes(args[0]?.kind))globalThis.__emptyBlendRequests++;return post.apply(this,args);};
    });
    for(const kind of ['dissolve','pageTurn','pagePeel']){
      const fromId='waiting-from-'+kind,toId='waiting-to-'+kind;
      const delayed={...baseline,id:'waiting-'+kind,name:'初回読み込み '+kind,clips:baseline.clips.map((c,i)=>({...c,id:i?toId:fromId,start:i?1.5:0,duration:3})),transitions:[{...baseline.transitions[0],id:'wait-pair-'+kind,fromId,toId,mode:undefined,duration:1.5,video:kind}]};
      await page.evaluate(()=>{globalThis.__holdIncoming=true;globalThis.__emptyBlendRequests=0;});await fs.writeFile(file,JSON.stringify(delayed));await page.keyboard.press('Control+o');await page.getByRole('button',{name:delayed.name,exact:true}).waitFor();await page.getByRole('button',{name:'先頭へ (Home)',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.canvas-wrap canvas').dataset.previewTime==='0');
      await page.waitForFunction(id=>{const v=document.querySelector('video[data-clip-id="'+id+'"]');return v&&!v.seeking&&v.readyState>=2;},fromId);await page.evaluate(()=>{globalThis.__emptyBlendRequests=0;});await page.keyboard.press('l');
      // Freeze in the observed frame; a separate native IPC round trip can pass
      // the end of this short overlap on a loaded Windows test runner.
      await page.waitForFunction(kind=>{const c=document.querySelector('.canvas-wrap canvas'),t=Number(c.dataset.previewTime);if(c.dataset.transitionKind!==kind||t<=1.7||t>=2.9)return false;document.querySelector('.play-button').click();return true;},kind);
      await page.waitForFunction(()=>document.querySelector('.shuttle-status').textContent==='停止');
      const held=await page.locator('.canvas-wrap canvas').evaluate(c=>({ready:c.dataset.transitionsReady,kind:c.dataset.transitionKind,png:c.toDataURL('image/png').split(',')[1]}));assert.equal(held.kind,kind);assert.equal(held.ready,'false');assert.equal(await page.evaluate(()=>globalThis.__emptyBlendRequests),0,'no worker request may blend an undecoded incoming frame');
      const heldFile=path.join(results,kind+'-waiting-source.png');await fs.writeFile(heldFile,Buffer.from(held.png,'base64'));const rgb=await run(ffmpeg,['-v','error','-i',heldFile,'-vf','crop=2:2:158:88,scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.ok(rgb[0]>230&&rgb[1]<30&&rgb[2]<30,kind+' must retain the outgoing red frame: '+[...rgb]);
      await page.evaluate(()=>{globalThis.__holdIncoming=false;});await page.waitForFunction(()=>document.querySelector('.canvas-wrap canvas').dataset.transitionsReady==='true');
      const readyFile=path.join(results,kind+'-ready-source.png');await fs.writeFile(readyFile,Buffer.from(await page.locator('.canvas-wrap canvas').evaluate(c=>c.toDataURL('image/png').split(',')[1]),'base64'));const mixed=await run(ffmpeg,['-v','error','-i',readyFile,'-pix_fmt','rgb24','-f','rawvideo','pipe:1']);let incomingPixels=0;for(let i=0;i<mixed.length;i+=3)if(mixed[i+2]>20)incomingPixels++;assert.ok(incomingPixels>50,kind+' shows the incoming picture after decoding');
    }checks.push('first continuous playback holds the outgoing picture until the incoming decoder is ready for all three effects');
    await page.evaluate(()=>{
      const seeking=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'seeking'),currentTime=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime'),post=Worker.prototype.postMessage;
      Object.defineProperty(HTMLMediaElement.prototype,'seeking',{configurable:true,get(){return globalThis.__holdSeek&&this.dataset.clipId?.startsWith('seek-to-')?true:seeking.get.call(this);}});
      Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...currentTime,set(value){if(globalThis.__holdSeek&&this.dataset.clipId?.startsWith('seek-to-'))globalThis.__repeatSeekWrites=(globalThis.__repeatSeekWrites||0)+1;currentTime.set.call(this,value);}});
      Worker.prototype.postMessage=function(...args){if(globalThis.__holdSeek&&['dissolve','pageTurn','pagePeel'].includes(args[0]?.kind))globalThis.__staleBlendRequests++;return post.apply(this,args);};
    });
    for(const kind of ['dissolve','pageTurn','pagePeel']){
      const fromId='seek-from-'+kind,toId='seek-to-'+kind,seekProject={...baseline,id:'seek-'+kind,name:'シークの映像時刻 '+kind,clips:[{...baseline.clips[0],id:fromId,start:0,in:0,duration:2},{...baseline.clips[1],id:toId,assetId:demo.assets.find(a=>a.path===changing).id,start:1,in:2.5,duration:2}],transitions:[{id:'seek-pair-'+kind,fromId,toId,video:kind}]};
      await fs.writeFile(file,JSON.stringify(seekProject));await page.keyboard.press('Control+o');await page.getByRole('button',{name:seekProject.name,exact:true}).waitFor();
      // Retain the incoming element after showing its later blue source frame.
      await page.getByRole('button',{name:'先頭へ (Home)',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.canvas-wrap canvas').dataset.previewTime==='0');
      await page.locator('.timeline-ruler').click({position:{x:2.5*zoom,y:25}});
      await page.waitForFunction(id=>{const v=document.querySelector('video[data-clip-id="'+id+'"]');return v&&!v.seeking&&v.readyState>=2&&v.currentTime>3.5;},toId);
      await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));globalThis.__holdSeek=true;globalThis.__staleBlendRequests=0;});
      await page.locator('.timeline-ruler').click({position:{x:1.2*zoom,y:25}});
      await page.waitForFunction(id=>{const v=document.querySelector('video[data-clip-id="'+id+'"]');return document.querySelector('.canvas-wrap canvas').dataset.previewTime==='1.2'&&v&&!v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-1.2)<.01;},fromId);
      await page.evaluate(async()=>{for(let i=0;i<5;i++)await new Promise(requestAnimationFrame);});
      assert.equal(await page.locator('.canvas-wrap canvas').getAttribute('data-transitions-ready'),'false');assert.equal(await page.evaluate(()=>globalThis.__staleBlendRequests),0,'no blend may use a retained frame from the wrong source time');
      const writes=await page.evaluate(()=>globalThis.__repeatSeekWrites||0);
      // The existing playhead handle covers this ruler position. Click its
      // exact center (the same sequence frame) through the real scrub handler.
      await page.locator('.playhead-handle').click({position:{x:6,y:5}});
      await page.waitForFunction(previous=>(globalThis.__repeatSeekWrites||0)>previous,writes);
      assert.equal(await page.locator('.canvas-wrap canvas').getAttribute('data-preview-time'),'1.2','retrying the same frame replaces an outstanding seek without moving the playhead');
      await page.evaluate(()=>{globalThis.__holdSeek=false;});await page.waitForFunction(()=>document.querySelector('.canvas-wrap canvas').dataset.transitionsReady==='true');
      const readyFile=path.join(results,kind+'-seek-ready.png');await fs.writeFile(readyFile,Buffer.from(await page.locator('.canvas-wrap canvas').evaluate(c=>c.toDataURL('image/png').split(',')[1]),'base64'));
      const output=path.join(results,kind+'-seek-reference.mp4');await exportProject(seekProject,{width:320,height:180,fps:seekProject.fps,quality:'high',encoder:'cpu'},output);
      const actual=await run(ffmpeg,['-v','error','-i',readyFile,'-pix_fmt','rgb24','-f','rawvideo','pipe:1']),reference=await run(ffmpeg,['-v','error','-ss','1.2','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.equal(actual.length,reference.length);let error=0;for(let i=0;i<actual.length;i++)error+=Math.abs(actual[i]-reference[i]);seekPixelErrors[kind]=error/actual.length;assert.ok(seekPixelErrors[kind]<4,kind+' seek pixels match exported source time: '+seekPixelErrors[kind]);
      assert.ok(Math.abs(await page.locator('video[data-clip-id="'+toId+'"]').evaluate(v=>v.currentTime)-2.7)<.01);
    }checks.push('seeking into each transition rejects stale frames and repeating the same ruler position retries the outstanding seek');
    const ordered={...baseline,id:'original-order',name:'隣接しない選択の検証',transitions:[],clips:[0,1,2].map(i=>({...baseline.clips[i===2?1:0],id:'ordered-'+i,start:[0,6,8][i],duration:i===1?2:10,speed:i===1?1:.25,in:0}))};
    await fs.writeFile(file,JSON.stringify(ordered));await page.keyboard.press('Control+o');await page.getByRole('button',{name:ordered.name,exact:true}).waitFor();
    await page.locator('.timeline-clip[data-clip-id="ordered-0"]').click({position:{x:30,y:20}});await page.locator('.timeline-clip[data-clip-id="ordered-2"]').click({position:{x:3*zoom,y:20},modifiers:['Shift']});
    await page.getByLabel('トランジションの長さ',{exact:true}).fill('5');await page.getByRole('button',{name:'クロスディゾルブ 2つの映像をなめらかに重ねる',exact:true}).click();
    await page.getByText('間に別のクリップがあります。隣り合う2つのクリップを選んでください。',{exact:true}).waitFor();
    const unchanged=await save();assert.deepEqual(unchanged.clips.map(c=>c.start),[0,6,8]);assert.equal(unchanged.transitions.length,0);assert.ok(await page.getByRole('button',{name:'元に戻す (Ctrl+Z)',exact:true}).isDisabled());checks.push('nonadjacent selected clips are rejected without changing the original order or editing history');
    const fpsFixture={...baseline,id:'fps-effects',name:'FPS変更と接続',transitions:baseline.transitions.map(t=>({...t,mode:'fixed',duration:23/30}))};
    await fs.writeFile(file,JSON.stringify(fpsFixture));await page.keyboard.press('Control+o');await page.getByRole('button',{name:fpsFixture.name,exact:true}).waitFor();
    await page.getByRole('button',{name:fpsFixture.name,exact:true}).click();await page.getByLabel('シーケンスのフレームレート',{exact:true}).selectOption('24');await page.getByRole('button',{name:'設定を適用',exact:true}).click();
    const changedFps=await save();assert.equal(changedFps.fps,24);assert.equal(changedFps.transitions.length,fpsFixture.transitions.length);assert.equal(changedFps.transitions[0].duration,18/24);assert.equal(changedFps.clips[0].start+changedFps.clips[0].duration,changedFps.clips[1].start);
    await page.keyboard.press('Control+z');assert.equal((await save()).fps,30);await page.keyboard.press('Control+Shift+z');assert.equal((await save()).transitions.length,fpsFixture.transitions.length);checks.push('sequence FPS changes retain frame-aligned fixed effects and common cuts through Undo/Redo');
    await require('./verify-transition-preview.cjs')({app,page,file,baseline,results,profile,checks});
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(results,'transitions-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,pixelErrors,seekPixelErrors,consoleErrors:errors},null,2));console.log('Video transitions and audio crossfades verified.');
  }catch(error){console.error('Transition failure status:',await page.locator('.statusbar').textContent().catch(()=>null));await page.screenshot({path:path.join(results,'transitions-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
}verify().catch(error=>{console.error(error);process.exitCode=1;});
