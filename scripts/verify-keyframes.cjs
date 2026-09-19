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
    assert.ok(await page.getByText('書き出しが完了しました',{exact:true}).isVisible(),await page.locator('.export-error').textContent().catch(()=>''));
    const differences=[];
    for(let index=0;index<samples.length;index++){
      const actual=await run(ffmpeg,['-v','error','-ss',String(samples[index]),'-i',output,'-frames:v','1','-vf','scale=640:360','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.equal(actual.length,reference[index].length);
      let sum=0;for(let i=0;i<actual.length;i++)sum+=Math.abs(actual[i]-reference[index][i]);const mean=sum/actual.length;differences.push(mean);assert.ok(mean<8,`${name} at ${samples[index]}: mean error ${mean}`);
    }
    await page.getByRole('button',{name:'閉じる',exact:true}).click();return differences;
  };
  try{
    await page.locator('.app-titlebar').waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
    const p=base();p.clips[0].opacityKeyframes=[{time:0,value:0},{time:1,value:1}];await open(p);
    assert.equal(await page.locator('.clip-visual-key').count(),2);assert.equal(await page.locator('.clip-visual-keys path').count(),1);
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
    assert.equal(await page.getByRole('spinbutton',{name:'位置 X',exact:true}).inputValue(),'320');await input('位置 X',300);saved=await save();assert.equal(saved.clips[0].visualKeyframes.length,3);assert.equal(saved.clips[0].visualKeyframes[1].values.x,-3.125);await undo();
    const target=page.locator('.media-drag-target');await target.waitFor();const box=await target.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+20,{steps:5});await page.mouse.up();saved=await save();assert.equal(saved.clips[0].visualKeyframes.length,3);await undo();
    const videoError=await exportAndCompare('映像の共通キーフレーム',[0,.5,1]);checks.push('映像の位置・サイズ・回転・不透明度・色・モニター操作・実MP4一致');
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(results,'keyframe-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,textError,videoError,consoleErrors:errors},null,2));console.log('Visual keyframes verified:',{checks,textError,videoError});
  }catch(error){await page.screenshot({path:path.join(results,'keyframes-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
