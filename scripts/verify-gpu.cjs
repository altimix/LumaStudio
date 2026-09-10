const { _electron: electron }=require('playwright');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const {ffmpeg,run,probe}=require('../electron/media.cjs');const root=path.join(__dirname,'..');
async function verify(){
  const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});const profile=await fs.mkdtemp(path.join(root,'.local','gpu-profile-'));
  const env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;const executablePath=process.env.LUMA_VERIFY_EXE;const app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});const page=await app.firstWindow(),errors=[],exports=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.locator('.media-card').first().waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});const file=path.join(results,'GPUの書き出し.luma');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    await page.keyboard.press('Control+s');await page.getByText('プロジェクトを保存しました',{exact:true}).waitFor();const p=JSON.parse(await fs.readFile(file,'utf8'));
    p.name='GPU書き出し検証';p.width=640;p.height=360;p.markers=[];p.clips=[p.clips.find(c=>c.kind==='video'),p.clips.find(c=>c.kind==='audio'),p.clips.find(c=>c.kind==='title')].map(c=>({...c,start:0,duration:1,in:0,fadeIn:0,fadeOut:0,opacityKeyframes:undefined,text:'日本語 GPU',fontSize:62}));
    await fs.writeFile(file,JSON.stringify(p));await page.keyboard.press('Control+o');await page.getByRole('button',{name:p.name,exact:true}).waitFor();await page.keyboard.press('Home');
    const capabilities=await page.evaluate(()=>window.luma.exportEncoders());assert.ok(capabilities.encoders.some(e=>e.id==='cpu'&&e.available));
    let cpuPixels,cpuAudio;
    for(const id of ['cpu','auto',...capabilities.encoders.filter(e=>e.id!=='cpu'&&e.available).map(e=>e.id)]){
      const output=path.join(results,`gpu-${id}.mp4`);await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
      await page.getByRole('button',{name:'書き出し',exact:true}).click();const select=page.getByLabel('書き出し方式',{exact:true});await page.getByRole('button',{name:'GPUを再確認',exact:true}).waitFor();await page.waitForFunction(()=>![...document.querySelectorAll('.encoder-settings button')].some(b=>b.disabled));
      for(const e of capabilities.encoders.filter(e=>!e.available))assert.equal(await select.locator(`option[value="${e.id}"]`).evaluate(option=>option.disabled),true,`${e.id} must be disabled`);
      await select.selectOption(id);await page.getByLabel('品質',{exact:true}).selectOption('high');if(id==='auto')await page.screenshot({path:path.join(results,'gpu-export-settings.png')});
      await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();await page.getByText('書き出しが完了しました',{exact:true}).waitFor({timeout:120000});
      const chosen=capabilities.encoders.find(e=>e.id===(id==='auto'?capabilities.recommended:id));assert.match(await page.locator('.export-encoder-used').textContent(),new RegExp(chosen.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      const info=await probe(output);assert.equal(info.streams.find(s=>s.codec_type==='video').codec_name,'h264');assert.ok(Math.abs(Number(info.format.duration)-1)<.06);
      const pixels=await run(ffmpeg,['-v','error','-ss','0.5','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);const audio=await run(ffmpeg,['-v','error','-i',output,'-vn','-f','f32le','pipe:1']);
      let meanPixelError=0,audioCorrelation=1;
      if(id==='cpu'){cpuPixels=pixels;cpuAudio=audio;}else{assert.equal(pixels.length,cpuPixels.length);for(let i=0;i<pixels.length;i++)meanPixelError+=Math.abs(pixels[i]-cpuPixels[i]);meanPixelError/=pixels.length;assert.ok(meanPixelError<6);assert.equal(audio.length,cpuAudio.length);let cross=0,power=0,reference=0;for(let i=0;i<audio.length;i+=4){const a=audio.readFloatLE(i),b=cpuAudio.readFloatLE(i);cross+=a*b;power+=a*a;reference+=b*b;}audioCorrelation=cross/Math.sqrt(power*reference);assert.ok(audioCorrelation>.995);}
      exports.push({selected:id,used:chosen.id,seconds:Number(info.format.duration),meanPixelError,audioCorrelation});await page.keyboard.press('Escape');
    }
    await app.evaluate(({ipcMain})=>{let calls=0;ipcMain.removeHandler('export-encoders');ipcMain.handle('export-encoders',()=>({recommended:'cpu',encoders:[{id:'cpu',label:'CPU',available:true},{id:'nvenc',label:'NVIDIA',available:++calls===1}]}));});
    await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.encoder-settings button').disabled);
    const refreshed=page.getByLabel('書き出し方式',{exact:true});await refreshed.selectOption('nvenc');await page.getByRole('button',{name:'GPUを再確認',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="書き出し方式"]').value==='auto');
    assert.match(await page.locator('.encoder-settings [role="status"]').textContent(),/自動.*戻しました/);await page.keyboard.press('Escape');
    const rejection=await page.evaluate(async p=>{try{await window.luma.exportProject(p,{width:640,height:360,fps:30,quality:'high',encoder:'unknown'},{ });return '';}catch(error){return error.message;}},p);assert.match(rejection,/方式/);
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(results,'gpu-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,capabilities,exports,checks:['native GPU capability detection and unavailable options','automatic/CPU/available GPU selection','Japanese title and audio export agreement','actual encoder shown after export','IPC rejects unknown encoders'],consoleErrors:errors},null,2));console.log(`GPU export verified: ${exports.map(e=>e.selected).join(', ')}.`);
  }catch(error){await page.screenshot({path:path.join(results,'gpu-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
