const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ffmpeg, run, probe } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');
async function verify() {
  const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});await fs.mkdir(path.join(root,'.local'),{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'.local','text-alignment-'));
  const env={...process.env,LUMA_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.LUMA_VERIFY_EXE;
  const app=await electron.launch({executablePath,args:executablePath?[]:[root],env,timeout:60000});
  const page=await app.firstWindow(),errors=[],checks=[],frames=[];page.on('pageerror',e=>errors.push(e.message));
  const file=path.join(results,'文字揃え.luma');
  const save=async()=>{await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));return JSON.parse(await fs.readFile(file,'utf8'));};
  const open=async project=>{if(await page.locator('.unsaved-dot').count())await save();await fs.writeFile(file,JSON.stringify(project));await page.keyboard.press('Control+o');await page.getByRole('button',{name:project.name,exact:true}).waitFor();await page.keyboard.press('Home');await page.locator('.timeline-clip.title').first().click();};
  const canvas=async()=>page.locator('.canvas-wrap canvas').evaluate(async c=>{
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const {width:w,height:h}=c,data=c.getContext('2d').getImageData(0,0,w,h).data;
    const rows=[{left:w,right:-1},{left:w,right:-1}];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(data[i]>180&&data[i+1]>180&&data[i+2]>180){const b=rows[y<h/2?0:1];b.left=Math.min(b.left,x);b.right=Math.max(b.right,x);}}
    return {png:c.toDataURL('image/png').split(',')[1],rows};
  });
  const compareRows=(rows,align)=>{const [a,b]=rows;assert.ok(a.right>a.left&&b.right>b.left);const close=(x,y)=>Math.abs(x-y)<=2;
    if(align==='left')assert.ok(close(a.left,b.left),JSON.stringify(rows));
    if(align==='center')assert.ok(close(a.left+a.right,b.left+b.right),JSON.stringify(rows));
    if(align==='right')assert.ok(close(a.right,b.right),JSON.stringify(rows));
    if(align==='justify')assert.ok(close(a.left,b.left)&&close(a.right,b.right),JSON.stringify(rows));
  };
  try {
    await page.locator('.media-card').first().waitFor({timeout:60000});await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    const clip={id:'title',name:'文字揃え',kind:'title',trackId:'titles',start:0,in:0,duration:1,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'田田田田\n田田',fontSize:60,fontFamily:'Noto Sans JP',fontWeight:500,color:'#ffffff',textStyle:'minimal',textShadow:false,textStroke:false};
    const base={version:1,id:'text-align',name:'文字揃えの検証',width:640,height:360,fps:30,assets:[],markers:[],tracks:[{id:'titles',kind:'video',name:'テキスト'}],clips:[clip]};
    await open(base);await page.locator('.title-drag-target').waitFor();await page.getByRole('combobox',{name:'プレビュー画質',exact:true}).selectOption('1');await page.waitForFunction(()=>!document.querySelector('.preview-font-status'));
    assert.equal(await page.getByRole('button',{name:'中央揃え',exact:true}).getAttribute('aria-pressed'),'true');
    const legacy=await canvas();compareRows(legacy.rows,'center');await page.getByRole('button',{name:'中央揃え',exact:true}).click();assert.equal((await canvas()).png,legacy.png);checks.push('legacy projects retain identical centered pixels');
    const names={left:'左揃え',center:'中央揃え',right:'右揃え',justify:'均等割付'};
    for(const boxed of [false,true]){
      if(boxed)await open({...base,name:'枠内の文字揃え',clips:[{...clip,textBox:{width:420,height:210}}]});
      for(const [align,label]of Object.entries(names)){
        await page.getByRole('button',{name:label,exact:true}).click();const saved=await save();assert.equal(saved.clips[0].textAlign,align);
        const current=await canvas();compareRows(current.rows,align);
        const png=path.join(results,`text-align-${boxed?'box':'line'}-${align}.png`);await fs.writeFile(png,Buffer.from(current.png,'base64'));
        frames.push({clip:{...saved.clips[0],id:`title-${frames.length}`,start:frames.length},png});
      }
    }
    checks.push('all four alignments position multiline glyphs correctly with and without a text box');
    await page.keyboard.press('Control+z');assert.equal((await save()).clips[0].textAlign,'right');await page.keyboard.press('Control+Shift+z');assert.equal((await save()).clips[0].textAlign,'justify');
    const saved=await save();await open({...saved,name:'文字揃えを再読込'});assert.equal(await page.getByRole('button',{name:'均等割付',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'テキスト ロック',exact:true}).click();assert.ok(await page.getByRole('button',{name:'左揃え',exact:true}).isDisabled());await page.getByRole('button',{name:'テキスト ロック解除',exact:true}).click();checks.push('save/reopen, Undo/Redo and track locks preserve alignment');
    await page.getByLabel('文字に縁取りを付ける',{exact:true}).check();await page.getByLabel('文字に影を付ける',{exact:true}).check();
    for(const label of ['縁取りの幅','影のぼかし','影の距離'])assert.ok(await page.getByRole('spinbutton',{name:label,exact:true}).isVisible());
    await page.getByRole('button',{name:'フォント検索を切り替え'}).click();await page.getByRole('textbox',{name:'日本語フォントを検索'}).fill('源ノ明朝');assert.ok(await page.getByLabel('日本語フォント',{exact:true}).locator('option').count()<68);await page.getByRole('button',{name:'フォント検索を切り替え'}).click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,1050));
    await page.locator('.inspector-content').evaluate(el=>el.scrollTop=0);
    const compact=await page.locator('.text-effects').evaluate(el=>{const panel=el.closest('.inspector-content');return {overflow:el.scrollWidth>el.clientWidth,help:[...panel.querySelectorAll('.field-help')].some(item=>item.getBoundingClientRect().height>0),width:el.clientWidth};});
    assert.ok(!compact.overflow&&!compact.help,JSON.stringify(compact));await page.screenshot({path:path.join(results,'text-properties-compact.png')});await page.locator('.text-decoration').last().scrollIntoViewIfNeeded();await page.locator('.inspector-panel').screenshot({path:path.join(results,'text-properties-effects.png')});checks.push('compact controls have no horizontal overflow or explanatory paragraphs; outline and shadow are directly accessible');
    const {setVisualKey}=require('../shared/visual-keyframes.mjs');
    let keyed={...clip,id:'keyed-title',start:frames.length,duration:4};
    for(const [i,align]of Object.keys(names).entries())keyed=setVisualKey(keyed,i,{textAlign:align});
    const exportProject={...base,name:'文字揃えの一括書き出し',clips:[...frames.map(frame=>frame.clip),keyed]};
    const keyStart=frames.length;for(let i=0;i<4;i++)frames.push({clip:{start:keyStart+i},png:frames[i].png});
    await open(exportProject);
    await page.getByRole('button',{name:'先頭へ (Home)',exact:true}).click();
    for(const [i,align]of Object.keys(names).entries()){
      const steps=i===0?keyStart*3:3;for(let j=0;j<steps;j++)await page.keyboard.press('Shift+ArrowRight');
      compareRows((await canvas()).rows,align);
    }
    checks.push('alignment keyframes switch preview pixels at their exact times');
    const output=path.join(results,'左・中央・右・均等割付.mp4');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('品質',{exact:true}).selectOption('draft');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();await page.getByText('書き出しが完了しました',{exact:true}).waitFor({timeout:120000});
    const meanErrors=[];
    for(const [i,frame]of frames.entries()){
      const pixels=async(input,time)=>run(ffmpeg,['-v','error',...(time===undefined?[]:['-ss',String(time)]),'-i',input,'-frames:v','1','-vf','scale=640:360','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
      const actual=await pixels(output,i+.25),expected=await pixels(frame.png);assert.equal(actual.length,expected.length);let total=0;for(let j=0;j<actual.length;j++)total+=Math.abs(actual[j]-expected[j]);const mean=total/actual.length;assert.ok(mean<2,`frame ${i} preview/export error ${mean}`);meanErrors.push(mean);
    }
    assert.ok(Math.abs(Number((await probe(output)).format.duration)-frames.length)<.05);await page.keyboard.press('Escape');
    await page.locator('input[type="file"][multiple]').first().setInputFiles(output);await page.getByRole('button',{name:/左・中央・右・均等割付/}).first().waitFor({timeout:60000});
    checks.push('all static and keyed preview images match native MP4 output; exported video can be reimported');assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(results,'text-alignment-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,checks,meanPixelErrors:meanErrors,consoleErrors:errors},null,2));console.log(`Text alignment verified: ${checks.length} cases, maximum pixel error ${Math.max(...meanErrors).toFixed(3)}.`);
  } catch(error){await page.screenshot({path:path.join(results,'text-alignment-failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
