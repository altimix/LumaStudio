const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ffmpeg,run}=require('../electron/media.cjs');
const {exportProject}=require('../electron/export.cjs');

module.exports=async function verifyBgmVolume({app,page,save,projectFile,results,checks}) {
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},projectFile);
  const before=await save(),targets=before.clips.filter(c=>c.kind==='audio'&&c.volume>0),first=targets[0],second=targets[1];assert.ok(first&&second);
  const clip=id=>page.locator(`.timeline-clip[data-clip-id="${id}"]`),menu=()=>page.getByRole('menu',{name:'クリップの編集',exact:true});
  const openMenu=async(id=first.id)=>{await clip(id).click({button:'right',position:{x:22,y:22}});await menu().waitFor();};
  const action=id=>menu().locator(`[data-action="${id}"]`);
  const volume=async id=>(await save()).clips.find(c=>c.id===id).volume;
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));
  await clip(first.id).click({position:{x:22,y:22}});const head=await page.locator('.ruler-label .timecode').textContent();
  await openMenu();const bounds=await menu().boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height);
  await action('bgm-volume-20').click();assert.equal(await volume(first.id),.1);assert.equal(await volume(second.id),second.volume);assert.equal(await page.locator('.ruler-label .timecode').textContent(),head);
  await openMenu();assert.equal(await action('bgm-volume-20').getAttribute('aria-checked'),'true');await action('bgm-volume-20').click();await page.keyboard.press('Control+z');assert.equal(await volume(first.id),first.volume);await page.keyboard.press('Control+Shift+z');assert.equal(await volume(first.id),.1);
  checks.push('right-click sets only the selected BGM to -20 dB, preserves the playhead, and repeated settings do not add history');

  const previewLevel=async()=>{
    await clip(first.id).focus();await page.keyboard.press('Home');for(let i=0;i<6;i++)await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('l');
    await page.waitForFunction(()=>Number.isFinite(parseFloat(document.querySelector('.meter-reading')?.textContent)),{},{timeout:10000});
    const values=await page.evaluate(async()=>{await new Promise(resolve=>setTimeout(resolve,250));const levels=[];for(let i=0;i<5;i++){levels.push(parseFloat(document.querySelector('.meter-reading').textContent));await new Promise(resolve=>setTimeout(resolve,60));}return levels;});
    await page.keyboard.press('k');const valid=values.filter(Number.isFinite).sort((a,b)=>a-b);assert.ok(valid.length>=3);return valid[Math.floor(valid.length/2)];
  };
  const levels={minus20:await previewLevel()};let minus20=await save();
  await clip(first.id).focus();await page.keyboard.press('Shift+F10');await menu().waitFor();await page.keyboard.press('Home');
  for(let i=0;i<20 && await page.locator(':focus').getAttribute('data-action')!=='bgm-volume-15';i++)await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').getAttribute('data-action'),'bgm-volume-15');await page.keyboard.press('Enter');assert.ok(Math.abs(20*Math.log10(await volume(first.id))+15)<1e-8);
  levels.minus15=await previewLevel();assert.ok(Math.abs(levels.minus15-levels.minus20-5)<1,JSON.stringify(levels));const minus15=await save();
  checks.push('Shift+F10 and arrow navigation set -15 dB, and the actual preview meter increases by five dB');

  await openMenu();assert.equal(await action('bgm-volume-15').getAttribute('aria-checked'),'true');await page.screenshot({path:path.join(results,'bgm-volume-menu.png')});await action('audio-volume-properties').click();
  assert.equal(await page.locator('.inspector-tabs .selected').textContent(),'オーディオ');assert.equal(await page.locator('#prop-volume').inputValue(),'17.78');await page.locator('#prop-volume').fill('12');await page.locator('#prop-volume').press('Enter');assert.equal(await volume(first.id),.12);await page.keyboard.press('Control+z');assert.ok(Math.abs(await volume(first.id)-10**(-15/20))<1e-12);
  checks.push('the fine-adjustment menu opens the audio volume control, and its percentage value remains editable');
  const method=page.getByRole('combobox',{name:'調整方法',exact:true}),apply=page.getByRole('button',{name:'音量を適用',exact:true});
  await method.selectOption('bgm-20');assert.ok((await page.locator('.audio-enhancement').innerText()).includes('会話中心の動画におすすめ'));assert.equal(await page.getByRole('button',{name:'解析して適用',exact:true}).count(),0);
  await apply.click();assert.equal(await volume(first.id),.1);await apply.click();await clip(first.id).focus();await page.keyboard.press('Control+z');assert.ok(Math.abs(await volume(first.id)-10**(-15/20))<1e-12);
  await method.selectOption('bgm-15');await apply.click();assert.ok(Math.abs(await volume(first.id)-10**(-15/20))<1e-12);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1600,1000));await method.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(results,'bgm-volume-method.png')});
  checks.push('audio adjustment methods include recommended -20 dB and -15 dB presets, apply without analysis, and preserve no-op Undo behavior');
  await clip(first.id).click({position:{x:22,y:22}});await clip(second.id).click({position:{x:22,y:22},modifiers:['Shift']});await openMenu(second.id);await action('bgm-volume-20').click();assert.equal(await volume(first.id),.1);assert.equal(await volume(second.id),.1);await page.keyboard.press('Control+z');assert.equal(await volume(second.id),second.volume);assert.ok(Math.abs(await volume(first.id)-10**(-15/20))<1e-12);
  checks.push('multi-selected BGM clips change together and a single Undo restores both prior volumes');
  const track=before.tracks.find(t=>t.id===first.trackId);await page.getByRole('button',{name:track.name+' ロック',exact:true}).click();await openMenu();assert.ok(await action('bgm-volume-20').isDisabled());assert.ok(await action('bgm-volume-15').isDisabled());await page.keyboard.press('Escape');await page.getByRole('button',{name:track.name+' ロック解除',exact:true}).click();
  const persisted=await save();await page.keyboard.press('Control+o');await page.waitForFunction(()=>document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]')?.disabled);assert.deepEqual((await save()).clips,persisted.clips);
  checks.push('locked BGM tracks disable both presets and the exact gain survives saving and reopening');

  const settings={width:320,height:180,fps:30,quality:'high',encoder:'cpu'},rms=async file=>{const pcm=await run(ffmpeg,['-v','error','-ss','2','-t','0.5','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);let sum=0;for(let i=0;i<pcm.length;i+=4)sum+=pcm.readFloatLE(i)**2;return Math.sqrt(sum/(pcm.length/4));};
  const exportGain=async(p,name)=>{const file=path.join(results,name);await exportProject({...p,clips:p.clips.filter(c=>c.kind!=='audio'||c.id===first.id)},settings,file);return rms(file);};
  const reference={...minus20,clips:minus20.clips.map(c=>c.id===first.id?{...c,volume:1}:c)};
  const exported={reference:await exportGain(reference,'BGM音量100パーセント.mp4'),minus20:await exportGain(minus20,'BGM音量マイナス20dB.mp4'),minus15:await exportGain(minus15,'BGM音量マイナス15dB.mp4')};
  const db={minus20:20*Math.log10(exported.minus20/exported.reference),minus15:20*Math.log10(exported.minus15/exported.reference)};assert.ok(Math.abs(db.minus20+20)<.25,JSON.stringify(db));assert.ok(Math.abs(db.minus15+15)<.25,JSON.stringify(db));
  checks.push('real MP4 output measures -20 dB and -15 dB against a unity-gain export of the same song');
  await fs.writeFile(projectFile,JSON.stringify(before));await page.keyboard.press('Control+o');await page.waitForFunction(()=>document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]')?.disabled);
  return {previewDb:levels,exportRms:exported,exportDb:db};
};
