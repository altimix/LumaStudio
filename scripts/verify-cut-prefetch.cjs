const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const results = path.join(root, 'test-results', 'prefetch'); await fs.mkdir(results, { recursive: true });
  const source = path.join(results, '時刻が変わる長いGOP.mp4');
  await run(ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=10','-c:v','libx264','-g','250','-keyint_min','250','-sc_threshold','0','-pix_fmt','yuv420p',source]);
  const asset = await inspectMedia(source, path.join(results, 'cache'));
  const clip = {id:'from',assetId:asset.id,trackId:'v',name:'映像',kind:'video',start:0,in:0,duration:4,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0};
  const project = {version:1,id:'prefetch',name:'先読み競合の検証',width:320,height:180,fps:30,assets:[asset],markers:[],tracks:[{id:'v',name:'映像',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[clip,{...clip,id:'to',start:4,in:2}],transitions:[{id:'effect',fromId:'from',toId:'to',mode:'fixed',duration:1,video:'dissolve'}]};
  const file=path.join(results,'先読み.luma'); await fs.writeFile(file,JSON.stringify(project));
  const profile=await fs.mkdtemp(path.join(results,'profile-')),env={...process.env,LUMA_TEST_DATA:profile}; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.LUMA_VERIFY_EXE, app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
  try {
    const page=await app.firstWindow();
    // An empty document also has no loading screen. Observe React mounting
    // before waiting for bootstrap to finish and sending editor shortcuts.
    await page.locator('.app-titlebar').waitFor({state:'visible',timeout:60000});
    await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
    await page.getByRole('button',{name:'ヘルプ',exact:true}).waitFor({timeout:60000});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    await page.keyboard.press('Control+o'); await page.getByRole('button',{name:project.name,exact:true}).waitFor();
    await page.evaluate(()=>{
      window.seekWrites=[];
      const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
      Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{configurable:true,get:d.get,set(value){window.seekWrites.push({id:this.dataset.clipId,value,t:Number(document.querySelector('.canvas-wrap canvas')?.dataset.previewTime)});return d.set.call(this,value);}});
    });
    const checks=[];
    for(const [name,reverse,effect,expected] of [['forward-effect',false,true,1.5],['reverse-effect',true,true,4.5],['forward-cut',false,false,2],['reverse-cut',true,false,4-1/30]]){
      const fixture={...project,id:name,name,transitions:effect?project.transitions:[]};
      await fs.writeFile(file,JSON.stringify(fixture));await page.keyboard.press('Control+o');await page.getByRole('button',{name,exact:true}).waitFor();
      await page.keyboard.press(reverse?'End':'Home');
      await page.waitForFunction(reverse=>{const t=Number(document.querySelector('.canvas-wrap canvas').dataset.previewTime);return reverse?t>7.8:t===0;},reverse);
      await page.evaluate(()=>{window.seekWrites=[];});await page.keyboard.press(reverse?'j':'l');
      await page.waitForFunction(reverse=>{const t=Number(document.querySelector('.canvas-wrap canvas').dataset.previewTime);return reverse?t<4.7:t>3.3;},reverse,{timeout:30000});
      await page.keyboard.press('Space');
      const writes=await page.evaluate(()=>window.seekWrites);
      await fs.writeFile(path.join(results, name+'-seek-writes.json'),JSON.stringify(writes,null,2));
      const incoming=writes.filter(w=>w.id===(reverse?'from':'to')&&(reverse?w.t>4.7:w.t<3.3));
      assert.ok(incoming.length>0,name+': incoming decoder is primed');
      const wrong=incoming.filter(w=>Math.abs(w.value-expected)>.01);
      checks.push({name,expected,incomingSeeks:incoming.length,incorrectHandleSeeks:wrong.length,first:incoming.slice(0,8)});
      console.log(JSON.stringify(checks.at(-1)));
      assert.equal(wrong.length,0,name+': decoder only seeks to the correct source handle');
    }
    await fs.writeFile(path.join(results,'verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks},null,2));
  } catch(error) {
    const page=await app.firstWindow();
    await page.screenshot({path:path.join(results,'failure.png')}).catch(()=>{});
    console.error('Prefetch status:',await page.locator('.statusbar').textContent().catch(()=>null));
    throw error;
  } finally {await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
