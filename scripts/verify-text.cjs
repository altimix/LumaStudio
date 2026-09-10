const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ffmpeg, run, probe } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');
async function verify() {
  const results=path.join(root,'test-results'); await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'.local','text-profile-')); const env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.LUMA_VERIFY_EXE;const app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
  const page=await app.firstWindow(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));const file=path.join(results,'日本語テキスト.luma');
  const save=async()=>{await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));return JSON.parse(await fs.readFile(file,'utf8'));};
  const open=async project=>{await fs.writeFile(file,JSON.stringify(project));await page.keyboard.press('Control+o');await page.getByRole('button',{name:project.name,exact:true}).waitFor();await page.keyboard.press('Home');};
  const select=async()=>page.locator('.timeline-clip.title').first().click();
  const setNumber=async(label,value)=>{const field=page.getByRole('spinbutton',{name:label,exact:true});await field.fill(String(value));await field.press('Enter');};
  const color=async(label,value)=>page.getByLabel(label,{exact:true}).evaluate((input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const canvas=async()=>page.locator('.canvas-wrap canvas').evaluate(async c=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return c.toDataURL('image/png').split(',')[1];});
  const writeCanvas=async name=>{const target=path.join(results,name);await fs.writeFile(target,Buffer.from(await canvas(),'base64'));return target;};
  const pixels=async input=>run(ffmpeg,['-v','error','-i',input,'-frames:v','1','-vf','scale=480:-2','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
  try {
    await page.locator('.media-card').first().waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
    await app.evaluate(({dialog},data)=>{
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[data.file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:data.file});
      globalThis.__fontRequests=0;globalThis.__fontOffline=true;
      globalThis.fetch=async url=>{globalThis.__fontRequests++;if(globalThis.__fontOffline||!url.startsWith('https://fonts.gstatic.com/s/'))throw Error('Offline font test');
        return new Response(await process.getBuiltinModule('fs/promises').readFile(data.font));};
    },{file,font:path.join(root,'public','fonts','NotoSansJP.ttf')});
    const blank={version:1,id:'text-landscape',name:'横型のテキスト検証',width:1920,height:1080,fps:30,assets:[],markers:[],tracks:[{id:'titles',name:'テキスト',kind:'video',muted:false,hidden:false,locked:false,solo:false}],clips:[]};
    await open(blank);await page.getByRole('tab',{name:'テキスト',exact:true}).click();await page.getByRole('button',{name:/ミニマル/}).click();
    await page.locator('.title-drag-target').waitFor();assert.equal(await page.getByRole('spinbutton',{name:'位置 X',exact:true}).inputValue(),'960');assert.equal(await page.getByRole('spinbutton',{name:'位置 Y',exact:true}).inputValue(),'540');
    assert.equal(await page.getByLabel('日本語フォント',{exact:true}).inputValue(),'Noto Sans JP');assert.equal(await page.getByLabel('日本語フォント',{exact:true}).locator('option').count(),68);
    assert.equal(await app.evaluate(()=>globalThis.__fontRequests),0);checks.push('bundled Japanese default works offline, 68 families selectable, horizontal center 960/540');
    await page.getByRole('textbox',{name:'テロップのテキスト',exact:true}).fill('日本語 Aa');await page.getByRole('textbox',{name:'テロップのテキスト',exact:true}).blur();await setNumber('長さ',2);
    const original=await save();assert.equal(original.clips[0].strokeColor,'#0064ff');
    for(const [i,patch]of [{fontFamily:'Missing Font'},{fontFamily:null},{fontFamily:''},{fontWeight:null}].entries()){
      const invalidFontFile=path.join(results,'不正フォント-'+i+'.luma');await fs.writeFile(invalidFontFile,JSON.stringify({...original,name:'読み込んではいけない',clips:original.clips.map(c=>({...c,...patch}))}));await page.locator('input[type="file"][accept=".luma"]').setInputFiles(invalidFontFile);await page.getByText('日本語フォントまたは太さが不正です。',{exact:true}).waitFor();await page.getByRole('button',{name:original.name,exact:true}).waitFor();
    }
    checks.push('browser file importer rejects unknown fonts while keeping the active edit usable');
    const target=page.locator('.title-drag-target').first();const rect=await target.boundingBox(),wrap=await page.locator('.canvas-wrap').boundingBox();
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+wrap.width*.12,rect.y+rect.height/2+wrap.height*.1,{steps:8});await page.mouse.up();
    const moved=await save();assert.ok(Math.abs(moved.clips[0].x-12)<0.5&&Math.abs(moved.clips[0].y-10)<0.5);
    await page.keyboard.press('Control+z');let saved=await save();assert.equal(saved.clips[0].x,0);assert.equal(saved.clips[0].y,0);
    await page.keyboard.press('Control+Shift+z');saved=await save();assert.equal(saved.clips[0].x,moved.clips[0].x);await select();
    const movedRect=await target.boundingBox();await page.mouse.move(movedRect.x+movedRect.width/2,movedRect.y+movedRect.height/2);await page.mouse.down();await page.mouse.move(movedRect.x+20,movedRect.y+10,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();saved=await save();assert.equal(saved.clips[0].x,moved.clips[0].x);assert.equal(saved.clips[0].y,moved.clips[0].y);
    checks.push('native drag updates position, one Undo/Redo restores it, Escape cancels the gesture');
    await page.getByRole('button',{name:'画面の中央に配置',exact:true}).click();await page.getByRole('button',{name:'テキスト ロック',exact:true}).click();assert.ok(await target.isDisabled());assert.ok(await page.getByLabel('日本語フォント',{exact:true}).isDisabled());await page.getByRole('button',{name:'テキスト ロック解除',exact:true}).click();checks.push('locked track protects dragging and text controls');
    await page.getByText('影・縁取りを調整',{exact:true}).click();assert.equal(await page.getByLabel('文字に影を付ける',{exact:true}).isChecked(),false);assert.equal(await page.getByLabel('文字に縁取りを付ける',{exact:true}).isChecked(),true);checks.push('new minimal text defaults to an outline without a shadow');await page.getByLabel('文字に影を付ける',{exact:true}).uncheck();const thin=await pixels(await writeCanvas('text-500.png'));await page.getByLabel('文字の太さ',{exact:true}).selectOption('900');
    await page.waitForFunction(()=>document.querySelector('#title-weight').value==='900'&&!document.querySelector('#title-weight').disabled);
    const thick=await pixels(await writeCanvas('text-900.png'));const ink=p=>{let n=0;for(let i=0;i<p.length;i+=3)if(p[i]>150&&p[i+1]>150&&p[i+2]>150)n++;return n;};assert.ok(ink(thick)>ink(thin)*1.15);checks.push('font weight changes the actual rendered Japanese glyphs');
    await page.getByLabel('文字に影を付ける',{exact:true}).check();await color('影の色','#ff0000');await setNumber('影のぼかし（px）',0);await setNumber('影の距離（px）',18);
    await page.getByLabel('文字に縁取りを付ける',{exact:true}).check();await color('縁取りの色','#00ff00');await setNumber('縁取りの幅（px）',5);
    const expected=await pixels(await writeCanvas('text-effects-preview.png'));let green=0,red=0;for(let i=0;i<expected.length;i+=3){if(expected[i+1]>80&&expected[i+1]>expected[i]*1.5)green++;if(expected[i]>80&&expected[i]>expected[i+1]*1.5)red++;}assert.ok(green>30&&red>30);checks.push('shadow and outline colors appear in canvas pixels');
    saved=await save();await open({...saved,name:'非表示フォントの検証',tracks:[...saved.tracks,{...saved.tracks[0],id:'hidden',name:'非表示',hidden:true}],clips:[...saved.clips,{...saved.clips[0],id:'hidden-title',trackId:'hidden',fontFamily:'Aoboshi One',fontWeight:400}]});await select();await page.locator('.title-drag-target').waitFor();assert.equal(await app.evaluate(()=>globalThis.__fontRequests),0);checks.push('hidden tracks do not download unused fonts or block offline export');await page.screenshot({path:path.join(results,'text-editor.png')});const output=path.join(results,'日本語テキスト.mp4');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('品質',{exact:true}).selectOption('draft');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();await page.getByText('書き出しが完了しました',{exact:true}).waitFor({timeout:120000});
    const rendered=await pixels(output);assert.equal(rendered.length,expected.length);let diff=0;for(let i=0;i<rendered.length;i++)diff+=Math.abs(rendered[i]-expected[i]);const meanError=diff/rendered.length;assert.ok(meanError<2,`preview/export mean error ${meanError}`);assert.ok(Math.abs(Number((await probe(output)).format.duration)-2)<0.05);await page.keyboard.press('Escape');checks.push('native MP4 contains the same font, position, weight, shadow and outline as preview');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    // Test the download/IPC/cache path without making network a CI prerequisite.
    // A valid bundled TTF is served as a deterministic transport fixture.
    await app.evaluate(()=>{globalThis.__fontOffline=false;});await page.getByLabel('日本語フォント',{exact:true}).selectOption('Zen Kaku Gothic New');await page.waitForFunction(()=>document.querySelector('#title-font').value==='Zen Kaku Gothic New'&&!document.querySelector('#title-font').disabled);saved=await save();
    await app.evaluate(()=>{globalThis.__fontOffline=true;});await page.reload();await page.locator('.media-card').first().waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});await open({...saved,name:'保存した日本語フォント'});await select();await page.locator('.title-drag-target').waitFor();assert.equal(await page.getByLabel('日本語フォント',{exact:true}).inputValue(),'Zen Kaku Gothic New');assert.equal(await app.evaluate(()=>globalThis.__fontRequests),1);checks.push('downloaded font choice/effects persist and the disk cache reloads offline');
    await page.getByLabel('日本語フォント',{exact:true}).selectOption('Aoboshi One');await page.getByText(/初回はインターネットに接続/).waitFor();assert.equal(await page.getByLabel('日本語フォント',{exact:true}).inputValue(),'Zen Kaku Gothic New');checks.push('failed font download retains the previous choice with actionable feedback');
    await open({...blank,id:'text-portrait',name:'縦型の中央配置検証',width:1080,height:1920});await page.getByRole('tab',{name:'テキスト',exact:true}).click();await page.getByRole('button',{name:/ミニマル/}).click();await page.locator('.title-drag-target').waitFor();
    assert.equal(await page.getByRole('spinbutton',{name:'位置 X',exact:true}).inputValue(),'540');assert.equal(await page.getByRole('spinbutton',{name:'位置 Y',exact:true}).inputValue(),'960');await page.screenshot({path:path.join(results,'text-portrait.png')});checks.push('portrait minimal text starts at 540/960');
    if(process.platform==='darwin')await app.evaluate(({BrowserWindow})=>{globalThis.__textFullscreenReady=new Promise(resolve=>BrowserWindow.getAllWindows()[0].once('enter-full-screen',resolve));});
    await page.getByRole('button',{name:'プレビューを全画面表示',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);
    if(process.platform==='darwin')await app.evaluate(()=>globalThis.__textFullscreenReady);
    const full=await page.locator('.canvas-wrap').boundingBox(),fullTarget=await page.locator('.title-drag-target').boundingBox();assert.ok(Math.abs(full.width/full.height-1080/1920)<.002);assert.ok(Math.abs(fullTarget.x+fullTarget.width/2-full.x-full.width/2)<3);
    await page.mouse.move(fullTarget.x+fullTarget.width/2,fullTarget.y+fullTarget.height/2);await page.mouse.down();await page.mouse.move(fullTarget.x+fullTarget.width/2+full.width*.1,fullTarget.y+fullTarget.height/2+full.height*.1,{steps:5});await page.mouse.up();await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.fullscreenElement);const fullSaved=await save();assert.ok(Math.abs(fullSaved.clips[0].x-10)<.7&&Math.abs(fullSaved.clips[0].y-10)<.7);checks.push('fullscreen portrait target follows the contained canvas and maps pointer movement accurately');
    const slow=require('../electron/font-sources.json').fonts.find(f=>!['Noto Sans JP','Zen Kaku Gothic New','Aoboshi One'].includes(f.family));
    await app.evaluate(({dialog})=>{globalThis.__fontGate=null;globalThis.__exportDialogs=0;globalThis.fetch=()=>new Promise(resolve=>{globalThis.__fontGate=resolve;});dialog.showSaveDialog=async()=>{globalThis.__exportDialogs++;return {canceled:true};};});
    await open({...blank,id:'slow-font',name:'フォント準備の中止',clips:[{...fullSaved.clips[0],trackId:blank.tracks[0].id,fontFamily:slow.family,fontWeight:slow.weights[0]}]});await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();await page.getByText('日本語フォントを準備しています…',{exact:true}).last().waitFor();await page.getByRole('button',{name:'書き出しを中止',exact:true}).click();await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).waitFor({timeout:1500});
    await app.evaluate(async(_,font)=>{globalThis.__fontGate(new Response(await process.getBuiltinModule('fs/promises').readFile(font)));},path.join(root,'public/fonts/NotoSansJP.ttf'));await page.waitForFunction(()=>!document.querySelector('.preview-font-status'));assert.equal(await app.evaluate(()=>globalThis.__exportDialogs),0);checks.push('canceling pending font preparation immediately unlocks export and never starts a late native export');
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(results,'text-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,meanPixelError:meanError,fontTransportFixture:'bundled Noto Sans JP, external network disabled',consoleErrors:errors},null,2));console.log(`Japanese text verified: ${checks.length} cases, export pixel error ${meanError.toFixed(3)}.`);
  } catch(error){await page.screenshot({path:path.join(results,'text-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
