// Native integration: only OpenAI responses are mocked, in the isolated main process.
// Credentials, IPC validation, FFmpeg audio, persistence, captions and MP4 are real.
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ffmpeg, ffprobe, run } = require('../electron/media.cjs');
const { timelineKey } = require('../shared/youtube.mjs');
const root = path.join(__dirname, '..');
const KEY = 'sk-fake-key-for-isolated-tests-only';
const base = { in:0,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'',fontSize:58,color:'#ffffff',textStyle:'subtitle' };
(async () => {
  const results = path.join(root,'test-results'); await fs.mkdir(results,{recursive:true}); await fs.mkdir(path.join(root,'.local'),{recursive:true});
  const profile = await fs.mkdtemp(path.join(root,'.local','youtube-profile-'));
  const env = { ...process.env, LUMA_TEST_DATA:profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.OPENAI_API_KEY; delete env.LUMA_ENV_FILE;
  const voice = path.join(profile,'日本語検証用 音声 &.wav'), jpeg = path.join(profile,'thumbnail-fixture.jpg');
  await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=36','-ar','48000','-ac','2',voice]);
  await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=0x344b28:s=1536x864','-frames:v','1',jpeg]);
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const app = await electron.launch({ executablePath,args:executablePath?[]:[root],env,timeout:60000 });
  const page = await app.firstWindow(); const errors = [], checks = [], resourceFailures = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', request => resourceFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  try {
    await page.locator('.media-card').first().waitFor({timeout:60000});
    await page.locator('.loading-screen').waitFor({state:'hidden',timeout:60000});
    await app.evaluate(({dialog},data) => {
      const path = process.getBuiltinModule('path');
      dialog.showSaveDialog = async (_window, options) => ({canceled:false,filePath:path.join(data.results,path.basename(options.defaultPath))});
      globalThis.__ytRequests=[];
      globalThis.fetch = async (url, options) => {
        if (!url.startsWith('https://api.openai.com/v1/') || options.headers.Authorization !== `Bearer ${data.key}`) throw new Error('Unexpected test request');
        if (globalThis.__ytHold) return new Promise((_resolve,reject) => options.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
        if (globalThis.__ytFailure) return new Response(data.key,{status:globalThis.__ytFailure});
        if (url.endsWith('/audio/transcriptions')) {
          const file=options.body.get('file'), model=options.body.get('model'); globalThis.__ytRequests.push({kind:'transcription',model,language:options.body.get('language')||options.body.get('languages[]'),bytes:file.size});
          if(globalThis.__ytAlignmentFailure) return Response.json(model==='gpt-transcribe'?{text:'本文側で専門用語を認識しました。'}:{words:[{word:'実測時刻と一緒に認識した字幕。',start:1.1,end:2.2}]});
          if(model==='gpt-transcribe') return Response.json({text:'日本語の字幕を自然な区切りで読みやすく作成します。タイムラインで編集します。概要欄を作成します。動画を書き出します。'});
          return Response.json({words:[{start:0.3,end:1.2,word:'日本語の字幕を自然な区切りで'},{start:1.2,end:2.5,word:'読みやすく作成します。'},{start:12,end:14,word:'タイムラインで編集します。'},{start:24,end:26,word:'概要欄を作成します。'},{start:32,end:34,word:'動画を書き出します。'}]});
        }
        const body=JSON.parse(options.body);
        if (url.endsWith('/responses')) {
          globalThis.__ytRequests.push({kind:'metadata',model:body.model,stored:body.store,reasoning:body.reasoning,strict:body.text.format.strict});
          return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({titles:['日本語字幕で動画編集を始めよう','YouTube動画の編集と字幕の作り方','字幕から投稿素材まで作る動画編集'],description:'日本語の字幕を作成し、タイムラインで編集します。概要欄を準備して動画を書き出す流れを紹介します。',chapters:[{time:0,label:'日本語字幕を作成'},{time:12,label:'タイムライン編集'},{time:24,label:'投稿準備と書き出し'}],keywords:['動画編集','日本語字幕','YouTube','文字起こし','自動字幕','タイムライン','概要欄','サムネイル','Shorts','Luma Studio'],hashtags:['#動画編集','#日本語字幕','#YouTube制作'],thumbnailPrompt:'動画編集画面と大きな日本語見出し「字幕から投稿まで」。緑と黒で読みやすい構図。'})}]}]});
        }
        if (url.endsWith('/images/generations')) { globalThis.__ytRequests.push({kind:'image',size:body.size,model:body.model}); return Response.json({data:[{b64_json:data.jpeg}]}); }
        throw new Error('Unexpected route');
      };
    },{results,key:KEY,jpeg:(await fs.readFile(jpeg)).toString('base64')});
    await page.keyboard.press('Control+n'); await page.getByRole('dialog',{name:'新規プロジェクト',exact:true}).waitFor();
    await page.screenshot({path:path.join(results,'youtube-new-project.png')});
    await page.getByRole('button',{name:/YouTube 横動画/}).click();
    const openFile = async file => {
      // The project name stays the same on reload. Observe its reset playhead so
      // later keys cannot run against the previous project while IPC is pending.
      await page.keyboard.press('Home'); await page.locator('.preview-meta > .timecode.accent').filter({hasText:'00:00:00:00'}).waitFor();
      await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
      await page.keyboard.press('Control+o'); await page.locator('.preview-meta > .timecode.accent').filter({hasText:'00:00:02:12'}).waitFor();
      await page.getByRole('button',{name:'日本語字幕の制作検証',exact:true}).waitFor();
    };
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},voice);
    await page.locator('.import-button').click(); await page.locator('.media-card').first().waitFor();
    await page.getByRole('button',{name:'プロジェクトを保存 (Ctrl+S)',exact:true}).click(); await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
    const initial = JSON.parse(await fs.readFile(path.join(results,'新しいプロジェクト.luma'),'utf8'));
    assert.equal(initial.width,1920); assert.equal(initial.height,1080); checks.push('new landscape sequence before editing');
    const p = {...initial,name:'日本語字幕の制作検証',clips:[{...base,id:'voice-clip',assetId:initial.assets[0].id,trackId:initial.tracks[2].id,kind:'audio',name:'音声',start:0,duration:35}]};
    const projectFile=path.join(results,'日本語字幕の制作検証.luma'); await fs.writeFile(projectFile,JSON.stringify(p)); await openFile(projectFile);
    // Start collecting after the demo video has been unloaded; only subtitle
    // backing stores are expected in this audio-only fixture.
    await page.evaluate(() => { const create = document.createElement.bind(document); window.__ytCanvases = []; document.createElement = (name, options) => { const element = create(name, options); if (name === 'canvas') window.__ytCanvases.push(element); return element; }; });
    const studio = async () => { await page.getByRole('button',{name:'YouTube',exact:true}).click(); await page.getByRole('dialog',{name:'YouTube制作スタジオ'}).waitFor(); };
    const done = async () => { await page.locator('.yt-progress').waitFor({state:'hidden',timeout:120000}); };
    await studio(); await page.getByRole('button',{name:'API設定',exact:true}).click();
    await page.getByLabel('OpenAI APIキー',{exact:true}).fill(KEY); await page.getByRole('button',{name:'キーを保存',exact:true}).click(); await done();
    assert.ok(!(await fs.readFile(path.join(profile,'openai-key.bin'))).includes(Buffer.from(KEY)));
    assert.ok(!JSON.stringify(await page.evaluate(()=>window.luma.aiStatus())).includes(KEY)); checks.push('native encrypted key storage and no key in IPC status');
    await page.getByRole('button',{name:'日本語字幕',exact:true}).click(); await page.getByRole('button',{name:'日本語で文字起こし',exact:true}).click();
    await page.locator('.yt-cue').first().waitFor({timeout:120000}); await done(); assert.equal(await page.locator('.yt-cue').count(),4);
    const firstCue=await page.getByRole('textbox',{name:'字幕1の本文',exact:true}).inputValue();
    assert.equal(firstCue.replace(/\s/g,''),'日本語の字幕を自然な区切りで読みやすく作成します。');
    assert.ok([...firstCue.replace(/\s/g,'')].length>=20&&[...firstCue.replace(/\s/g,'')].length<=30);
    assert.ok(firstCue.split('\n').length<=2); checks.push('20–30 character caption keeps the sentence and real word interval');
    const first=page.getByRole('textbox',{name:'字幕1の本文',exact:true}), originalCue=await first.inputValue();
    await first.fill('一行目\n\n三行目');
    for (const name of ['字幕をタイムラインに適用','SRT保存','VTT保存']) assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true);
    await first.press('Tab'); assert.equal(await first.inputValue(),originalCue); assert.match(await page.locator('.yt-error').textContent(),/空行/);
    const cueEnd=page.getByRole('spinbutton',{name:'字幕1の終了秒',exact:true}); await cueEnd.fill('13'); assert.equal(await page.getByRole('button',{name:'SRT保存',exact:true}).isDisabled(),true); await cueEnd.press('Tab'); assert.equal(await cueEnd.inputValue(),'2.5');
    checks.push('invalid subtitle drafts block apply/export and revert to accepted text and times on blur');
    await first.fill('日本語の字幕を\n読みやすく作成します。'); await first.press('Tab');
    await page.getByRole('button',{name:'字幕をタイムラインに適用',exact:true}).click();
    await page.getByRole('button',{name:'SRT保存',exact:true}).click(); await done(); await page.getByRole('button',{name:'VTT保存',exact:true}).click(); await done();
    assert.match(await fs.readFile(path.join(results,'日本語字幕の制作検証.srt'),'utf8'),/00:00:00,300 --> 00:00:02,500/);
    assert.match(await fs.readFile(path.join(results,'日本語字幕の制作検証.vtt'),'utf8'),/^WEBVTT/);
    await page.screenshot({path:path.join(results,'youtube-captions.png')}); checks.push('rendered timeline sent as bounded Japanese transcription, edited captions applied, SRT/VTT saved');
    await page.getByRole('button',{name:'タイトル・概要欄',exact:true}).click(); await page.getByRole('button',{name:'投稿文を生成',exact:true}).click();
    await page.getByRole('textbox',{name:'YouTubeタイトル案1',exact:true}).waitFor(); await done();
    assert.equal(await page.getByRole('textbox',{name:/YouTubeタイトル案/}).count(),3);
    assert.equal((await page.getByRole('textbox',{name:'YouTube検索ワード',exact:true}).inputValue()).split(',').length,10);
    const tagsField = page.getByRole('textbox', { name: 'YouTubeハッシュタグ', exact: true });
    const generatedTags = await tagsField.inputValue();
    assert.equal(generatedTags, '#動画編集 #日本語字幕 #YouTube制作');
    await tagsField.fill('手動字幕 動画編集 YouTube制作'); await tagsField.blur();
    await page.getByRole('button', { name: '編集に戻る', exact: true }).click(); await page.keyboard.press('Control+z'); await studio(); await page.getByRole('button', { name: 'タイトル・概要欄', exact: true }).click();
    assert.equal(await tagsField.inputValue(), generatedTags);
    await page.getByRole('button', { name: '編集に戻る', exact: true }).click(); await page.keyboard.press('Control+Shift+z'); await studio(); await page.getByRole('button', { name: 'タイトル・概要欄', exact: true }).click();
    assert.equal(await tagsField.inputValue(), '#手動字幕 #動画編集 #YouTube制作');
    await tagsField.fill(generatedTags); await tagsField.blur();
    checks.push('three generated hashtags support editing and one-step Undo/Redo');
    const description = page.getByRole('textbox',{name:'YouTube概要欄',exact:true}), originalDescription = await description.inputValue();
    await description.focus(); await description.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'); await description.pressSequentially('追記'.repeat(60)); await description.press('Tab');
    const editedDescription = await description.inputValue(); assert.equal(editedDescription, originalDescription + '追記'.repeat(60));
    await page.getByRole('button',{name:'編集に戻る',exact:true}).click(); await page.keyboard.press('Control+z'); await studio(); await page.getByRole('button',{name:'タイトル・概要欄',exact:true}).click();
    assert.equal(await description.inputValue(), originalDescription, 'one Undo restores metadata after more than 80 typed characters');
    await page.getByRole('button',{name:'編集に戻る',exact:true}).click(); await page.keyboard.press('Control+Shift+z'); await studio(); await page.getByRole('button',{name:'タイトル・概要欄',exact:true}).click();
    assert.equal(await description.inputValue(), editedDescription, 'one Redo restores the entire metadata edit'); checks.push('120-character metadata edit preserves single-step Undo and Redo');
    await page.getByRole('button',{name:'テキスト保存',exact:true}).click(); await done();
    const txt=await fs.readFile(path.join(results,'日本語字幕の制作検証.txt'),'utf8'); assert.match(txt,/00:00 日本語字幕を作成/); assert.match(txt,/00:24 投稿準備と書き出し/);
    await require('./verify-youtube-copy.cjs')(app,page,checks,results,txt);
    await page.evaluate(key=>window.luma.aiSetKey(key),KEY);
    await page.screenshot({path:path.join(results,'youtube-metadata.png')}); checks.push('three titles, ten keywords, eligible chapters and text export');
    await page.getByRole('button',{name:'サムネイル',exact:true}).click(); await page.getByRole('button',{name:'サムネイルを1枚生成',exact:true}).click();
    await page.getByRole('img',{name:'生成したYouTubeサムネイル'}).waitFor({timeout:60000}); await done();
    await page.waitForFunction(()=>{const img=document.querySelector('.yt-thumbnail-preview img');return img?.complete && img.naturalWidth===1536;});
    await page.waitForFunction(()=>[...document.querySelectorAll('.media-card img')].every(img=>img.complete && img.naturalWidth>0));
    await page.screenshot({path:path.join(results,'youtube-thumbnail.png')});
    await page.getByRole('button',{name:'JPEGを保存',exact:true}).click(); await done(); assert.deepEqual(await fs.readFile(path.join(results,'日本語字幕の制作検証.jpg')),await fs.readFile(jpeg)); checks.push('Image API integration and original JPEG save');
    // Confirm masked authentication errors and an abort do not discard prior successful outputs.
    await app.evaluate(()=>{globalThis.__ytFailure=401;}); await page.getByRole('button',{name:'タイトル・概要欄',exact:true}).click(); await page.getByRole('button',{name:'投稿文を生成',exact:true}).click();
    await page.locator('.yt-error').waitFor(); await done(); assert.match(await page.locator('.yt-error').textContent(),/401/); assert.ok(!(await page.locator('.yt-error').textContent()).includes(KEY));
    await app.evaluate(()=>{globalThis.__ytFailure=0;globalThis.__ytHold=true;}); await page.getByRole('button',{name:'投稿文を生成',exact:true}).click(); await page.locator('.yt-progress').waitFor(); await page.getByRole('button',{name:'中止',exact:true}).click(); await done(); await app.evaluate(()=>{globalThis.__ytHold=false;});
    assert.equal(await page.getByRole('textbox',{name:/YouTubeタイトル案/}).count(),3); checks.push('401 redaction, cancellation and existing results retained');
    await page.getByRole('button',{name:'編集に戻る',exact:true}).click(); await page.keyboard.press('Control+s'); await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
    const saved=JSON.parse(await fs.readFile(projectFile,'utf8')); assert.equal(saved.clips.filter(c=>c.subtitle).length,4);assert.ok(saved.clips.filter(c=>c.subtitle).every(c=>c.textShadow===false&&c.textStroke===true&&c.strokeColor==='#0064ff'&&c.strokeWidth===4&&c.captionBackgroundOpacity===.25&&c.y>33&&c.fontWeight===700));checks.push('captions persist a four-pixel blue outline, a light background and a lower position'); assert.equal(saved.clips.find(c=>c.subtitle).text,'日本語の字幕を\n読みやすく作成します。'); assert.equal(saved.youtube.titles.length,3); assert.deepEqual(saved.youtube.hashtags,['#動画編集','#日本語字幕','#YouTube制作']); assert.ok(!JSON.stringify(saved).includes(KEY)); await openFile(projectFile);
    await page.waitForFunction(()=>window.__ytCanvases.some(c=>c.width>0)); await page.keyboard.press('End'); await page.waitForFunction(()=>window.__ytCanvases.every(c=>c.width===0)); checks.push('inactive subtitle canvas backing stores are released');
    // Use a short export fixture; AI chapters were tested above against all 35 seconds.
    saved.clips=saved.clips.filter(c=>c.start<6).map(c=>({...c,duration:Math.min(c.duration,6-c.start)})); saved.youtube.cues=saved.youtube.cues.filter(c=>c.end<=6); saved.youtube.sourceKey=timelineKey(saved);
    await fs.writeFile(projectFile,JSON.stringify(saved)); await openFile(projectFile);
    await page.keyboard.press('Home'); for(let i=0;i<3;i++) await page.keyboard.press('Shift+ArrowRight');
    await page.waitForFunction(()=>{const c=document.querySelector('.canvas-wrap canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=4) if(d[i]>100)return true;return false;});
    checks.push('project reload preserves captions/metadata without keys and preview renders Japanese text');
    const backgroundAlpha=()=>page.evaluate(()=>{
      const canvases=window.__ytCanvases.filter(c=>c.width>0),histogram=new Map();
      for(const c of canvases){const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=4)if(d[i]>0&&d[i]<255)histogram.set(d[i],(histogram.get(d[i])||0)+1);}
      return [...histogram].sort((a,b)=>b[1]-a[1])[0]?.[0];
    });
    assert.ok(Math.abs((await backgroundAlpha())-64)<=1,'new subtitle background alpha is 25 percent');
    const subtitleId=saved.clips.find(c=>c.subtitle&&c.start<=1&&c.start+c.duration>1).id;
    await page.locator(`[data-clip-id="${subtitleId}"]`).click();
    const background=page.getByRole('spinbutton',{name:'字幕の背景の濃さ（%）',exact:true});
    assert.equal(await background.inputValue(),'25');await background.fill('50');await background.press('Enter');
    await page.waitForFunction(()=>window.__ytCanvases.some(c=>{if(!c.width)return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=3;i<d.length;i+=4)if(Math.abs(d[i]-128)<=1)count++;return count>1000;}));
    assert.ok(Math.abs((await backgroundAlpha())-128)<=1,'inspector change immediately invalidates subtitle preview');
    await page.keyboard.press('Control+z');
    // Blurring the field before Undo above leaves normal editor shortcuts active.
    await page.waitForFunction(()=>window.__ytCanvases.some(c=>{if(!c.width)return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=3;i<d.length;i+=4)if(Math.abs(d[i]-64)<=1)count++;return count>1000;}));
    checks.push('subtitle background opacity is 25 percent and inspector changes refresh the preview and undo');
    const captionInput=page.getByRole('textbox',{name:'テロップのテキスト',exact:true}),fontSizeInput=page.getByRole('spinbutton',{name:'文字サイズ',exact:true}),positionY=page.getByRole('spinbutton',{name:'位置 Y',exact:true});
    await captionInput.fill('字幕の行数を変更しても\n下端を画面に収めます。');await captionInput.blur();await fontSizeInput.fill('120');await fontSizeInput.press('Enter');
    await page.waitForFunction(expected=>Math.abs(Number(document.querySelector('#prop-y').value)-expected)<.02,saved.height*.96-120*2.7/2);
    await positionY.fill('500');await positionY.press('Enter');await captionInput.fill('手動で移動した字幕');await captionInput.blur();assert.equal(Number(await positionY.inputValue()),500);
    for(let i=0;i<4;i++)await page.keyboard.press('Control+z');
    assert.equal(await captionInput.inputValue(),saved.clips.find(c=>c.id===subtitleId).text);checks.push('caption text and font-size edits keep the lower margin while manual placement and Undo are preserved');

    async function exportVideo(target, name) {
      const output=path.join(results,name); await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
      await page.getByRole('button',{name:'書き出し',exact:true}).click(); await page.getByRole('combobox',{name:'書き出しサイズ',exact:true}).selectOption(target); await page.getByRole('combobox',{name:'品質',exact:true}).selectOption('draft');
      await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click(); await page.locator('.export-success').waitFor({timeout:180000}); await page.getByRole('button',{name:'閉じる',exact:true}).click();
      const info=JSON.parse((await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',output])).toString()); const video=info.streams.find(s=>s.codec_type==='video'); assert.equal(video.width,target==='shorts'?1080:1920); assert.equal(video.height,target==='shorts'?1920:1080); assert.equal(video.codec_name,'h264'); assert.ok(Math.abs(Number(info.format.duration)-6)<0.1); assert.ok(info.streams.some(s=>s.codec_name==='aac'));
      const frame=await run(ffmpeg,['-v','error','-ss','1','-i',output,'-frames:v','1','-vf','scale=192:192','-pix_fmt','gray','-f','rawvideo','pipe:1']); assert.ok(frame.some(v=>v>120),'export must contain visible captions');const rgb=await run(ffmpeg,['-v','error','-ss','1','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);let blue=0;for(let i=0;i<rgb.length;i+=3)if(rgb[i]<50&&rgb[i+1]>60&&rgb[i+1]<150&&rgb[i+2]>200)blue++;assert.ok(blue>100,'export must contain the blue caption outline'); return {name,width:video.width,height:video.height,duration:Number(info.format.duration)};
    }
    const landscape=await exportVideo('youtube','youtube-landscape.mp4');
    await page.getByRole('button',{name:'シーケンス',exact:true}).click(); await page.getByRole('combobox',{name:'フレームサイズ',exact:true}).selectOption('1080x1920'); await page.getByRole('button',{name:'設定を適用',exact:true}).click();
    await studio(); await page.getByRole('button',{name:'字幕をタイムラインに適用',exact:true}).click(); await page.getByRole('button',{name:'編集に戻る',exact:true}).click();
    await page.screenshot({path:path.join(results,'youtube-shorts-preview.png')}); const shorts=await exportVideo('shorts','youtube-shorts.mp4'); checks.push('actual 1920x1080 and 1080x1920 H264/AAC exports contain Japanese captions');
    await page.keyboard.press('Control+s'); await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
    // A changed audio edit keeps old text readable, but blocks applying stale timing.
    const changed=JSON.parse(await fs.readFile(projectFile,'utf8')); changed.clips.find(c=>c.kind==='audio').volume=0.7; await fs.writeFile(projectFile,JSON.stringify(changed)); await openFile(projectFile); await studio(); await page.locator('.yt-notice').filter({hasText:'音声の編集内容が変わりました'}).waitFor(); assert.equal(await page.getByRole('button',{name:'字幕をタイムラインに適用',exact:true}).isDisabled(),true); checks.push('audio edits visibly invalidate old transcript timing');
    await page.getByRole('button',{name:'編集に戻る',exact:true}).click();
    const longRetry={...changed,clips:changed.clips.map(c=>c.kind==='audio'?{...c,duration:35}:c)};await fs.writeFile(projectFile,JSON.stringify(longRetry));await openFile(projectFile);await studio();
    await app.evaluate(()=>{globalThis.__ytAlignmentFailure=true;});await page.getByRole('button',{name:'文字起こしを再実行',exact:true}).click();await done();
    await page.locator('.yt-notice').filter({hasText:'時刻付き認識を採用'}).waitFor();
    await page.getByRole('button',{name:'編集に戻る',exact:true}).click();await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
    const retried=JSON.parse(await fs.readFile(projectFile,'utf8'));assert.equal(retried.youtube.transcriptionStats.retries,7);assert.equal(retried.youtube.transcriptionStats.timingFallbacks,8);assert.equal(retried.youtube.cues.length,8);assert.ok(retried.youtube.cues.at(-1).start>30);
    await openFile(projectFile);await studio();await page.locator('.yt-notice').filter({hasText:'時刻付き認識を採用'}).waitFor();checks.push('automatic short-window retries, measured-text fallback and its notice survive real IPC/save/reload');
    await page.getByRole('button',{name:'編集に戻る',exact:true}).click();
    const large={...retried,youtube:{...retried.youtube,cues:Array.from({length:100000},(_,i)=>({start:i,end:i+.5,text:'字幕'}))}};
    await fs.writeFile(projectFile,JSON.stringify(large));await openFile(projectFile);await studio();
    await page.evaluate(()=>{const original=JSON.stringify;globalThis.__fullProjectSerializations=0;globalThis.__restoreStringify=()=>{JSON.stringify=original;};JSON.stringify=function(value,...args){if(value&&Array.isArray(value.assets)&&value.youtube)globalThis.__fullProjectSerializations++;return original.call(this,value,...args);};});
    await page.getByRole('textbox',{name:'字幕1の本文',exact:true}).fill('大量字幕の編集');
    assert.equal(await page.evaluate(()=>globalThis.__fullProjectSerializations),0,'typing must not serialize the whole project');
    await page.getByRole('textbox',{name:'字幕内を検索',exact:true}).click();
    assert.ok(await page.evaluate(()=>globalThis.__fullProjectSerializations)>0,'blur must check persisted project capacity');
    await page.evaluate(()=>globalThis.__restoreStringify());
    await page.getByRole('button',{name:'編集に戻る',exact:true}).click();await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
    const editedLarge=JSON.parse(await fs.readFile(projectFile,'utf8'));assert.equal(editedLarge.youtube.cues.length,100000);assert.equal(editedLarge.youtube.cues[0].text,'大量字幕の編集');
    checks.push('100000-cue editing validates only the draft while typing, checks full size on blur and saves successfully');
    await studio();await page.getByRole('textbox',{name:'字幕1の本文',exact:true}).fill('');await page.keyboard.press('Escape');
    await page.getByRole('dialog',{name:'YouTube制作スタジオ',exact:true}).waitFor();assert.ok(await page.locator('.yt-error').count());
    assert.equal(await page.getByRole('textbox',{name:'字幕1の本文',exact:true}).inputValue(),'大量字幕の編集');
    for(const [text,escape] of [['Escで確定',true],['画面外で確定',false]]){
      await page.getByRole('textbox',{name:'字幕1の本文',exact:true}).fill(text);
      if(escape)await page.keyboard.press('Escape');else await page.locator('.modal-backdrop').click({position:{x:4,y:4}});
      await page.getByRole('dialog',{name:'YouTube制作スタジオ',exact:true}).waitFor({state:'hidden'});
      await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
      assert.equal(JSON.parse(await fs.readFile(projectFile,'utf8')).youtube.cues[0].text,text);await studio();
    }
    checks.push('Escape and backdrop commit active drafts before closing; rejected drafts keep the editor open');
    const requests=await app.evaluate(()=>globalThis.__ytRequests); assert.ok(requests.some(r=>r.kind==='transcription'&&r.language==='ja'&&r.bytes>10000)); assert.ok(requests.some(r=>r.kind==='image'&&r.size==='1536x864')); assert.ok(requests.filter(r=>r.kind==='metadata').every(r=>r.model==='gpt-6-astra'&&r.stored===false&&r.reasoning.effort==='low'&&r.strict===true));
    assert.deepEqual(errors,[]); await fs.writeFile(path.join(results,'youtube-verification.json'),JSON.stringify({passed:true,packaged:!!executablePath,api:'mocked OpenAI responses; real native IPC, encrypted settings, audio render and video exports',checks,exports:[landscape,shorts],requests,consoleErrors:errors},null,2)); console.log('YouTube studio, Japanese captions and horizontal/Shorts MP4 exports verified (OpenAI responses mocked).');
  } catch(e) { await page.screenshot({path:path.join(results,'youtube-failure.png')}).catch(()=>{}); await fs.writeFile(path.join(results,'youtube-failure.json'),JSON.stringify({message:e.message,resourceFailures,images:await page.locator('img').evaluateAll(images=>images.map(img=>({src:img.src,width:img.naturalWidth,complete:img.complete})))},null,2)); throw e; }
  finally { await app.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
