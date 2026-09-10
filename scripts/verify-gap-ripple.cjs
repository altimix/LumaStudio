const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ffmpeg, run, inspectMedia, probe } = require('../electron/media.cjs');
const { validateClipLinks } = require('../shared/clip-links.mjs');
const { validateTransitions } = require('../shared/transitions.mjs');
const root = path.join(__dirname, '..');
async function verify() {
  const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'.local','gap-profile-')),source=path.join(profile,'空白を詰める映像.mp4');
  await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=red:s=320x180:r=30:d=2','-f','lavfi','-i','color=yellow:s=320x180:r=30:d=2','-f','lavfi','-i','color=blue:s=320x180:r=30:d=4','-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=8','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-map','3:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
  const asset=await inspectMedia(source,path.join(profile,'cache'));
  const tracks=[['titles','video','字幕'],['video','video','メイン映像'],['voice','audio','メイン音声'],['music','audio','ミュージック'],['empty','audio','空のトラック']].map(([id,kind,name])=>({id,kind,name,muted:false,hidden:false,locked:false,solo:false}));
  const base={id:'before',assetId:asset.id,trackId:'video',kind:'video',name:'先頭の映像',start:0,in:0,duration:2,speed:1,volume:.7,fadeIn:0,fadeOut:0,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,text:'',fontSize:30,color:'#ffffff',textStyle:'minimal'};
  const clips=[0,4,6].flatMap((start,i)=>{
    const c={...base,id:['before','after','last'][i],start,in:start,name:['先頭の映像','後ろの映像','最後の映像'][i],linkId:'pair-'+i};
    return [{...c,audioDetached:true},{...c,id:c.id+'-audio',trackId:'voice',kind:'audio',name:c.name+'の音声'}];
  });
  clips.push({...base,id:'music',trackId:'music',kind:'audio',name:'区間をまたぐBGM',duration:8,volume:.1,volumeKeyframes:[{time:0,value:.5},{time:2,value:1},{time:4,value:.5},{time:8,value:1}]});
  clips.push({...base,id:'caption',assetId:undefined,trackId:'titles',kind:'title',name:'字幕',text:'空白をまとめて詰める',start:1,duration:5,opacityKeyframes:[{time:0,value:.5},{time:5,value:1}]});
  const baseline={version:1,id:'gap-main',name:'空白のリップル削除',width:320,height:180,fps:30,assets:[asset],tracks,clips:JSON.parse(JSON.stringify(clips)),markers:[{id:'later',time:7,label:'後半'}],transitions:[{id:'later-join',fromId:'after',toId:'last',mode:'fixed',duration:.5,video:'dissolve'}]};
  const file=path.join(results,'空白のリップル削除.luma');await fs.writeFile(file,JSON.stringify(baseline));
  const env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.LUMA_VERIFY_EXE,app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
  const page=await app.firstWindow(),checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.locator('.media-card').first().waitFor({timeout:60000});
    await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:file});BrowserWindow.getAllWindows()[0].setSize(1200,850);},file);
    await page.keyboard.press('Control+o');await page.getByRole('button',{name:baseline.name,exact:true}).waitFor();
    const save=async()=>{const before=(await fs.stat(file)).mtimeMs;await page.getByRole('button',{name:'プロジェクトを保存 (Ctrl+S)',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));const deadline=Date.now()+10000;while((await fs.stat(file)).mtimeMs===before){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,25));}return JSON.parse(await fs.readFile(file,'utf8'));};
    const open=async p=>{await save();await fs.writeFile(file,JSON.stringify(p));await page.keyboard.press('Control+o');await page.getByRole('button',{name:p.name,exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]').disabled);};
    const lane=id=>page.locator('.track-lane[data-track-id="'+id+'"]'),clip=id=>page.locator('.timeline-clip[data-clip-id="'+id+'"]');
    const menu=()=>page.getByRole('menu',{name:'空白の編集',exact:true}),action=()=>menu().getByRole('menuitem',{name:'空白をリップル削除',exact:true});
    const head=()=>page.locator('.ruler-label .timecode').textContent();
    const zoom=async value=>page.getByRole('slider',{name:'タイムラインのズーム',exact:true}).evaluate((el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},String(value));
    const rightGap=async(track,time)=>{await lane(track).evaluate(el=>{const scroller=el.closest('.timeline-scroll'),r=el.getBoundingClientRect(),view=scroller.getBoundingClientRect(),top=view.top+scroller.querySelector('.timeline-ruler').getBoundingClientRect().height;if(r.bottom>view.bottom-20)scroller.scrollTop+=r.bottom-view.bottom+20;else if(r.top<top)scroller.scrollTop+=r.top-top;});const z=Number(await page.getByRole('slider',{name:'タイムラインのズーム',exact:true}).inputValue());const r=await lane(track).boundingBox();await page.mouse.click(r.x+time*z,r.y+20,{button:'right'});await menu().waitFor();};
    await zoom(48);await clip('before').focus();await page.keyboard.press('Enter');await page.keyboard.press('End');assert.equal(await head(),'00:00:08:00');
    await rightGap('video',3);assert.equal(await head(),'00:00:08:00');assert.match(await menu().textContent(),/2.00秒/);assert.equal(await page.locator('.timeline-gap-highlight').count(),tracks.length);
    const box=await menu().boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height);
    await page.screenshot({path:path.join(results,'timeline-gap-ripple.png')});
    for(const key of ['z','Delete','Home','End'])await page.keyboard.press(key);assert.equal(await head(),'00:00:08:00');assert.equal(await page.locator('.timeline-clip').count(),clips.length);
    await page.keyboard.press('Escape');await menu().waitFor({state:'hidden'});assert.equal(await clip('before').getAttribute('aria-pressed'),'true');
    await rightGap('video',3);await action().click();assert.equal(await head(),'00:00:06:00');let edited=await save();
    assert.equal(edited.clips.find(c=>c.id==='after').start,2);assert.equal(edited.clips.find(c=>c.id==='before').duration,2);assert.equal(edited.clips.find(c=>c.id==='last-audio').start,4);
    assert.deepEqual(edited.clips.filter(c=>c.trackId==='music').map(c=>[c.start,c.in,c.duration]),[[0,0,2],[2,4,4]]);assert.deepEqual(edited.clips.filter(c=>c.trackId==='titles').map(c=>[c.start,c.duration]),[[1,1],[2,2]]);assert.equal(edited.markers[0].time,5);validateClipLinks(edited);validateTransitions(edited);assert.equal(edited.transitions.length,1);
    await page.keyboard.press('Control+z');assert.equal(await head(),'00:00:08:00');assert.deepEqual((await save()).clips,baseline.clips);await page.keyboard.press('Control+Shift+z');assert.equal(await head(),'00:00:06:00');assert.deepEqual((await save()).clips,edited.clips);
    checks.push('right-click shows the exact gap, fits the window, blocks unrelated shortcuts, preserves selection when cancelled, and ripples all tracks with one Undo/Redo');
    await page.keyboard.press('Control+o');await page.waitForFunction(()=>document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]').disabled);edited=await save();assert.equal(await clip('after').getAttribute('aria-label'),'後ろの映像、開始 2.00 秒、長さ 2.00 秒');
    await page.keyboard.press('Home');await page.keyboard.press('l');await page.waitForFunction(()=>document.querySelector('.meter-reading').textContent!=='−∞ dB');await page.keyboard.press('k');await page.keyboard.press('End');await page.keyboard.press('j');await page.waitForFunction(()=>document.querySelector('.meter-reading').textContent!=='−∞ dB');await page.keyboard.press('k');
    const output=path.join(results,'gap-ripple-native.mp4');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('品質',{exact:true}).selectOption('high');await page.getByLabel('書き出し方式',{exact:true}).selectOption('cpu');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();
    await page.waitForFunction(()=>document.body.innerText.includes('書き出しが完了しました')||document.querySelector('.export-error'),null,{timeout:180000});
    assert.equal(await page.locator('.export-error').count(),0,'native export must succeed');
    assert.ok(Math.abs(Number((await probe(output)).format.duration)-6)<.06);
    for(const [time,channel]of [[.5,0],[2.5,2]]){const rgb=await run(ffmpeg,['-v','error','-ss',String(time),'-i',output,'-vf','crop=2:2:10:10,scale=1:1','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.ok(rgb[channel]>220&&rgb[1]<30,'expected retained source color at '+time);}
    const pcm=await run(ffmpeg,['-v','error','-ss','2.1','-i',output,'-t','0.4','-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);let energy=0;for(let i=0;i<pcm.length;i+=4)energy+=pcm.readFloatLE(i)**2;assert.ok(Math.sqrt(energy/(pcm.length/4))>.015);
    await page.keyboard.press('Escape');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    checks.push('saved linked clips, volume and opacity fragments reload, forward/reverse audio plays, and real MP4 is exactly two seconds shorter with the retained video frames and audible audio');
    const locked={...baseline,id:'locked-gap',name:'ロック保護',tracks:tracks.map(t=>({...t,locked:t.id==='music'}))};await open(locked);await rightGap('video',3);assert.ok(await action().isDisabled());assert.match(await menu().textContent(),/ミュージック.*ロック/);await page.keyboard.press('Escape');assert.deepEqual((await save()).clips,locked.clips);
    for(const [track,time]of [['video',9],['empty',3]]){await rightGap(track,time);assert.ok(await action().isDisabled());await page.keyboard.press('Escape');}
    checks.push('locked spanning media, trailing space and empty tracks disable ripple deletion without changing clips');
    const leading={...baseline,id:'leading-gap',name:'先頭の空白',clips:clips.map(c=>({...c,start:c.start+2}))};await open(leading);await page.keyboard.press('Home');await lane('video').focus();await page.keyboard.press('Shift+F10');await menu().waitFor();await page.keyboard.press('Enter');assert.equal((await save()).clips.find(c=>c.id==='before').start,0);
    checks.push('focused lane Shift+F10 and Enter close a leading gap');
    const distant={...baseline,id:'scrolled-gap',name:'スクロール中の空白',clips:clips.map(c=>({...c,start:c.start+90})),markers:[]};await open(distant);await zoom(120);
    // Wait for the zoom layout and keep the clicked lane below the sticky ruler.
    await page.waitForFunction(()=>document.querySelector('.timeline-clip[data-clip-id="before"]').style.width==='240px');
    await page.locator('.timeline-scroll').evaluate(el=>{el.scrollLeft=90*120;});await rightGap('video',93);assert.match(await menu().textContent(),/00:01:32:00.*00:01:34:00/);await action().click();assert.equal((await save()).clips.find(c=>c.id==='after').start,92);
    await clip('after').focus();await page.keyboard.press('Shift+F10');await page.getByRole('menu',{name:'クリップの編集',exact:true}).waitFor();await page.keyboard.press('Escape');
    await page.locator('.timeline-transition').focus();await page.keyboard.press('Shift+F10');await page.getByRole('menu',{name:'トランジションの編集',exact:true}).waitFor();await page.keyboard.press('Escape');
    checks.push('zoomed and horizontally scrolled right-click uses the actual sequence time; existing clip and transition menus remain available');
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(results,'gap-ripple-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,consoleErrors:errors},null,2));console.log('Timeline gap ripple deletion verified.');
  }catch(error){await page.screenshot({path:path.join(results,'gap-ripple-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
