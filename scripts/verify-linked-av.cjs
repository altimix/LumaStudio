const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ffmpeg, run, probe } = require('../electron/media.cjs');
const { exportProject } = require('../electron/export.cjs');
const { validateClipLinks } = require('../shared/clip-links.mjs');
const root = path.join(__dirname, '..');
async function verify() {
  const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});
  const source=path.join(results,'分離する映像.mp4');
  await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=blue:s=320x180:r=30:d=6','-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
  const profile=await fs.mkdtemp(path.join(root,'.local','linked-av-profile-')),env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
  const page=await app.firstWindow(),errors=[],checks=[],file=path.join(results,'リンク編集.luma');page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.locator('.media-card').first().waitFor({timeout:60000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1200,850));
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    const save=async()=>{
      const before=(await fs.stat(file).catch(()=>null))?.mtimeMs;
      await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
      // A clean project has no dirty dot before its first asynchronous save.
      // Await the atomic file replacement before reading or rewriting fixtures.
      const deadline=Date.now()+10000;
      while((await fs.stat(file).catch(()=>null))?.mtimeMs===before){assert.ok(Date.now()<deadline,'native project save completed');await new Promise(resolve=>setTimeout(resolve,25));}
      return JSON.parse(await fs.readFile(file,'utf8'));
    };
    const demo=await save(),empty={...demo,name:'リンク編集の検証',width:320,height:180,clips:[],assets:[],markers:[]};
    const open=async p=>{await fs.writeFile(file,JSON.stringify(p));await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.keyboard.press('Control+o');await page.waitForFunction(()=>document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]').disabled);};
    await open(empty);await app.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});},source);
    await page.getByRole('button',{name:'読み込み',exact:true}).click();await page.getByRole('button',{name:'分離する映像.mp4 を追加',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'分離する映像.mp4 を追加',exact:true}).click();
    let p=await save();validateClipLinks(p);assert.equal(p.clips.length,2);assert.equal(await page.locator('.timeline-clip.video .clip-waveform').count(),0);assert.equal(await page.locator('.timeline-clip.audio .waveform').count(),1);assert.equal(await page.locator('.clip-link-icon').count(),2);
    await page.keyboard.press('Control+z');assert.equal(await page.locator('.timeline-clip').count(),0);await page.keyboard.press('Control+Shift+z');checks.push('new AV placement has separate filmstrip/waveform and a linked pair in one Undo');
    const video=page.locator('.timeline-clip.video'),audio=page.locator('.timeline-clip.audio');
    const menu=async(clip=video)=>{await clip.click({button:'right'});await page.getByRole('menu',{name:'クリップの編集'}).waitFor();};
    const action=async id=>page.locator(`[role="menu"] [data-action="${id}"]`).click();
    const head=()=>page.locator('.ruler-label .timecode').textContent();
    await page.keyboard.press('Home');for(let i=0;i<9;i++)await page.keyboard.press('Shift+ArrowRight');assert.equal(await head(),'00:00:03:00');
    await page.keyboard.press('q');assert.equal(await head(),'00:00:00:00');await page.keyboard.press('Control+z');assert.equal(await head(),'00:00:03:00');await page.keyboard.press('Control+Shift+z');assert.equal(await head(),'00:00:00:00');await page.keyboard.press('Control+z');assert.equal(await head(),'00:00:03:00');checks.push('Q Undo returns to the editing position and Redo returns to the cut position');
    await video.focus();await page.keyboard.press('Shift+F10');await page.getByRole('menu').waitFor();await page.keyboard.press('End');assert.equal(await head(),'00:00:03:00');await page.keyboard.press('z');assert.equal(await page.locator('.timeline-clip').count(),2);
    const bounds=await page.getByRole('menu').boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height);
    await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.locator('.timeline-audio-job').filter({hasText:'適用しました'}).waitFor({timeout:120000});p=await save();assert.equal(p.clips.find(c=>c.kind==='audio').audioTreatment,'normalize');assert.equal(p.clips.find(c=>c.kind==='video').audioTreatment,undefined);await page.keyboard.press('Control+z');assert.ok((await save()).clips.every(c=>!c.audioTreatment));checks.push('keyboard menu stays inside viewport, blocks Z/Home/End editing, and Enter normalizes actual audio in one Undo');
    await menu();await action('speech');await page.locator('.timeline-audio-job').filter({hasText:'適用しました'}).waitFor({timeout:120000});assert.equal((await save()).clips.find(c=>c.kind==='audio').audioTreatment,'speech');await menu();await action('reset-audio');assert.ok((await save()).clips.every(c=>!c.audioTreatment));checks.push('right-click speech processing runs immediately and can be removed');
    await menu();await action('speed-2');p=await save();assert.ok(p.clips.every(c=>c.speed===2&&c.duration===3));await page.keyboard.press('Control+z');
    if(await page.getByRole('button',{name:'スナップ (N)',exact:true}).getAttribute('aria-pressed')==='true')await page.getByRole('button',{name:'スナップ (N)',exact:true}).click();
    const zoom=Number(await page.getByRole('slider',{name:'タイムラインのズーム',exact:true}).inputValue());
    const move=async(clip,seconds)=>{
      const id=await clip.getAttribute('data-clip-id');
      await clip.evaluate(el=>{const view=el.closest('.timeline-scroll');view.scrollTop+=el.getBoundingClientRect().top-view.getBoundingClientRect().top-40;});
      const r=await clip.locator('.clip-name').boundingBox(),point={x:r.x+24,y:r.y+r.height/2};
      assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.timeline-clip')?.getAttribute('data-clip-id'),point),id,'drag starts on the visible clip, not the sticky ruler');
      await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+seconds*zoom,point.y,{steps:6});await page.mouse.up();
    };
    await move(video,1);p=await save();assert.ok(p.clips.every(c=>c.start===1));await page.keyboard.press('Control+z');checks.push('right-click speed and mouse movement keep linked source intervals synchronized');
    await menu();await action('unlink');p=await save();assert.ok(p.clips.every(c=>!c.linkId));await move(audio,1);p=await save();assert.equal(p.clips.find(c=>c.kind==='video').start,0);assert.equal(p.clips.find(c=>c.kind==='audio').start,1);await page.keyboard.press('Control+z');
    await video.click({position:{x:30,y:20}});await audio.click({position:{x:30,y:20},modifiers:['Shift']});await menu();await action('relink');p=await save();validateClipLinks(p);assert.ok(p.clips.every(c=>c.linkId));checks.push('unlink enables audio-only movement and matching selections can relink');
    const videoTrack=p.tracks.find(t=>t.id===p.clips.find(c=>c.kind==='video').trackId);await page.getByRole('button',{name:videoTrack.name+' ロック',exact:true}).click();
    assert.equal(await audio.evaluate(el=>getComputedStyle(el).cursor),'not-allowed');assert.equal(await audio.locator('.trim-handle').count(),0);
    const gainNode=audio.locator('.volume-node').first();assert.equal(await gainNode.getAttribute('aria-disabled'),'false');assert.equal(await gainNode.evaluate(el=>getComputedStyle(el).cursor),'move');
    await page.getByRole('button',{name:videoTrack.name+' ロック解除',exact:true}).click();checks.push('linked track lock blocks trim/move cursors while independent unlocked audio gain remains available');
    const audioTrack=p.tracks.find(t=>t.id===p.clips.find(c=>c.kind==='audio').trackId);await page.getByRole('button',{name:audioTrack.name+' ロック',exact:true}).click();await menu();assert.ok(await page.locator('[data-action="speed-2"]').isDisabled());assert.ok(await page.locator('[data-action="normalize"]').isDisabled());await page.keyboard.press('Escape');await move(video,1);assert.ok((await save()).clips.every(c=>c.start===0));await page.getByRole('button',{name:audioTrack.name+' ロック解除',exact:true}).click();checks.push('a locked audio partner protects menu operations and linked gestures');
    await video.focus();await page.keyboard.press('Enter');await page.keyboard.press('Home');for(let i=0;i<9;i++)await page.keyboard.press('Shift+ArrowRight');await menu();await action('split');p=await save();assert.equal(p.clips.length,4);validateClipLinks(p);await page.keyboard.press('Control+z');p=await save();await open(p);assert.equal(await page.locator('.clip-link-icon').count(),2);assert.equal(await page.locator('.timeline-clip.offline').count(),0);checks.push('context split creates two linked pairs and save/reopen preserves valid source-sharing links');
    await video.focus();await page.keyboard.press('Enter');await page.keyboard.press('l');await page.waitForFunction(()=>document.querySelector('.meter-reading').textContent!=='−∞ dB');await page.keyboard.press('k');await page.keyboard.press('l');await page.waitForFunction(()=>document.querySelector('.meter-reading').textContent!=='−∞ dB');await page.keyboard.press('k');await page.keyboard.press('End');await page.keyboard.press('j');await page.waitForFunction(()=>document.querySelector('.meter-reading').textContent!=='−∞ dB');await page.keyboard.press('k');checks.push('separated audio remains audible through L/K/L restart and J reverse shuttle');
    await page.keyboard.press('Home');await menu();await page.screenshot({path:path.join(results,'linked-av-context-menu.png')});await page.keyboard.press('Escape');p=await save();
    const output=path.join(results,'リンクした映像と音声.mp4');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('品質',{exact:true}).selectOption('draft');await page.getByLabel('書き出し方式',{exact:true}).selectOption('cpu');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();await page.getByText('書き出しが完了しました',{exact:true}).waitFor({timeout:120000});
    const v=p.clips.find(c=>c.kind==='video'),baseline={...p,clips:[{...v,linkId:undefined,audioDetached:undefined}]},reference=path.join(results,'分離前の基準.mp4');await exportProject(baseline,{width:320,height:180,fps:30,quality:'draft',encoder:'cpu'},reference);
    const rms=async file=>{const b=await run(ffmpeg,['-v','error','-i',file,'-vn','-ac','1','-ar','16000','-f','f32le','pipe:1']);let sum=0;for(let i=0;i<b.length;i+=4)sum+=b.readFloatLE(i)**2;return Math.sqrt(sum/(b.length/4));};const levels=[await rms(reference),await rms(output)];assert.ok(Math.abs(levels[0]-levels[1])<.0001);assert.ok(levels[1]>.02);assert.ok(Math.abs(Number((await probe(output)).format.duration)-6)<.06);checks.push('packaged MP4 matches the original single soundtrack loudness without double audio');
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(results,'linked-av-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,levels,consoleErrors:errors},null,2));console.log('Linked AV, context editing and ripple Undo verified.');
  } catch(error) {await page.screenshot({path:path.join(results,'linked-av-failure.png')}).catch(()=>{});throw error;} finally {await app.close();}
}
verify().catch(e=>{console.error(e);process.exitCode=1;});
