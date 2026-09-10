const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFontLibrary } = require('../electron/fonts.cjs');
const { fonts, fontStyle, validateTextStyle } = require('../shared/text-style.mjs');
const catalogue = require('../electron/font-sources.json');
const bytes = require('node:fs').readFileSync(path.join(__dirname,'../public/fonts/NotoSansJP.ttf'));
test('every Japanese family has licensed, allowlisted sources and only supported weights are accepted', () => {
  assert.equal(fonts.length, 68); assert.equal(new Set(fonts.map(f => f.family)).size, 68);
  assert.deepEqual(fonts.map(f => f.family), catalogue.fonts.map(f => f.family));
  for (const entry of catalogue.fonts) {
    assert.match(entry.license, /LICENSE|License/);
    for (const weight of entry.weights) {
      validateTextStyle({ fontFamily: entry.family, fontWeight: weight });
      assert.ok(entry.files.some(f => { const [min, max = min] = f.weight.split(' ').map(Number); return weight >= min && weight <= max; }));
    }
    for (const file of entry.files) assert.match(file.url, /^https:\/\/fonts\.gstatic\.com\/s\/.+\.ttf$/);
  }
  assert.deepEqual(fontStyle({ textStyle: 'minimal' }), { family: 'Noto Sans JP', weight: 500 });
  for (const patch of [{fontFamily:'Unknown'},{fontFamily:null},{fontFamily:''},{fontFamily:false},{fontWeight:null},{fontWeight:''},{fontWeight:false}, {fontWeight:NaN}, {fontWeight:1000}, {fontWeight:750.5}, {textShadow:1}, {shadowColor:'red'}, {textStroke:'true'}, {strokeWidth:21}, {shadowBlur:-1}, {captionBackgroundOpacity:-.1}, {captionBackgroundOpacity:1.1}, {captionBackgroundOpacity:null}, {captionBackgroundOpacity:'0.25'}]) assert.throws(() => validateTextStyle(patch));
  validateTextStyle({ fontWeight:750, textStroke:true, strokeColor:'#ff3300', shadowBlur:0 });
  for(const opacity of [0,.25,1])validateTextStyle({captionBackgroundOpacity:opacity});
});
test('font cache deduplicates downloads, works offline and repairs altered cached bytes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-fonts-')); t.after(() => fs.rm(dir, {recursive:true,force:true}));
  let calls = 0, offline = false;
  const fetcher = async (_url, options) => { calls++; assert.equal(options.redirect,'error'); if(offline) throw Error('network'); return new Response(bytes); };
  const library = createFontLibrary(dir, file => file, fetcher);
  const pair = await Promise.all([library.load('Zen Kaku Gothic New',400), library.load('Zen Kaku Gothic New',400)]);
  assert.deepEqual(pair[0], pair[1]); assert.equal(calls,1);
  offline = true; assert.deepEqual(await library.load('Zen Kaku Gothic New',400), pair[0]); assert.equal(calls,1);
  const altered = Buffer.from(bytes); altered[32] = 17; await fs.writeFile(pair[0].url,altered);
  await assert.rejects(library.load('Zen Kaku Gothic New',400), /インターネット/);
  offline = false; await library.load('Zen Kaku Gothic New',400); assert.deepEqual(await fs.readFile(pair[0].url),bytes);
  assert.ok((await fs.readdir(dir)).some(name => name.endsWith('-LICENSE.txt')));
  await assert.rejects(library.load('../../outside',400),/不正/); await assert.rejects(library.load('Zen Kaku Gothic New',750),/太さ/);
});
test('invalid or oversized font responses never become cached fonts', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-font-reject-')); t.after(() => fs.rm(dir, {recursive:true,force:true}));
  for (const response of [new Response('<html>wrong</html>'), new Response(bytes.subarray(0,64)), new Response(bytes.subarray(0,bytes.length-8)), new Response(Buffer.from(bytes).fill(0,bytes.length-1024)), new Response(bytes,{headers:{'content-length':String(41*1024*1024)}})]) {
    const library=createFontLibrary(dir,file=>file,async()=>response);
    await assert.rejects(library.load('Noto Sans JP',500),/読み込めません/); assert.deepEqual(await fs.readdir(dir),[]);
  }
});
