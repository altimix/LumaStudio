const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { atomicWrite } = require('./persistence.cjs');
const catalogue = require('./font-sources.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function validFont(bytes){
  if(bytes.length<12||bytes.length>40*1024*1024||![0x00010000,0x4f54544f].includes(bytes.readUInt32BE(0)))return false;
  const count=bytes.readUInt16BE(4),directoryEnd=12+16*count,tables=new Map(),spans=[];
  if(!count||count>256||directoryEnd>bytes.length)return false;
  for(let i=0;i<count;i++){
    const row=12+i*16,tag=bytes.toString('ascii',row,row+4),checksum=bytes.readUInt32BE(row+4),offset=bytes.readUInt32BE(row+8),length=bytes.readUInt32BE(row+12);
    if(tables.has(tag)||offset%4||offset<directoryEnd||offset+length>bytes.length)return false;
    tables.set(tag,{offset,length});if(length)spans.push([offset,offset+length]);
    let sum=0;for(let n=0;n<length;n+=4){let word=0;for(let j=0;j<4;j++)word=(word*256+(n+j<length?bytes[offset+n+j]:0))>>>0;if(tag==='head'&&n===8)word=0;sum=(sum+word)>>>0;}
    if(sum!==checksum)return false;
  }
  spans.sort((a,b)=>a[0]-b[0]);if(spans.some((s,i)=>i&&s[0]<spans[i-1][1]))return false;
  if(!['cmap','head','hhea','hmtx','maxp','name','post'].every(tag=>tables.has(tag)))return false;
  if(!((tables.has('glyf')&&tables.has('loca'))||tables.has('CFF ')||tables.has('CFF2')))return false;
  const head=tables.get('head');return head.length>=54&&bytes.readUInt32BE(head.offset+12)===0x5f0f3cf5;
}
function createFontLibrary(directory, present, fetcher = (...args) => fetch(...args)) {
  const pending = new Map(), queue = []; let active = 0;
  function pump() {
    while (active < 2 && queue.length) {
      const job = queue.shift(); active++;
      job.work().then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
  }
  return {
    async load(family, weight) {
      const entry = catalogue.fonts.find(f => f.family === family);
      if (!entry || !Number.isInteger(weight) ) throw new Error('日本語フォントまたは太さが不正です。');
      const source = entry.files.find(f => { const range = f.weight.split(' ').map(Number); return range.length === 2 ? weight >= range[0] && weight <= range[1] : weight === range[0]; });
      if (!source) throw new Error('フォントの太さを取得できません。');
      const url = new URL(source.url);
      if (url.origin !== 'https://fonts.gstatic.com' || !url.pathname.startsWith('/s/') || !url.pathname.endsWith('.ttf')) throw new Error('フォントの配布元が不正です。');
      const key = digest(source.url), dir = typeof directory === 'function' ? directory() : directory;
      let promise = pending.get(key);
      if (!promise) {
        if (queue.length > 150) throw new Error('フォントを準備しています。しばらくしてから再実行してください。');
        promise = new Promise((resolve, reject) => {
          queue.push({ resolve, reject, work: async () => {
            const file = path.join(dir, `${key}.ttf`), report = path.join(dir, `${key}.json`);
            try {
              const info = JSON.parse(await fs.readFile(report, 'utf8')), stat = await fs.stat(file);
              if (stat.size > 40 * 1024 * 1024) throw new Error('cache');
              const bytes = await fs.readFile(file);
              if (validFont(bytes) && info.hash === digest(bytes)) return { url: present(file, key), weight: source.weight };
            } catch { /* Cache integrity or availability changed; fetch the published font again. */ }
            let response, bytes;
            try {
              response = await fetcher(source.url, { redirect: 'error', signal: AbortSignal.timeout(45000) });
              if (!response.ok || Number(response.headers.get('content-length')) > 40 * 1024 * 1024) throw new Error('download');
              const reader = response.body.getReader(), chunks = []; let size = 0;
              try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 40 * 1024 * 1024) throw new Error('size'); chunks.push(value); } } finally { await reader.cancel().catch(() => {}); }
              bytes = Buffer.concat(chunks); if (!validFont(bytes)) throw new Error('format');
            } catch { await response?.body?.cancel().catch(() => {}); throw new Error(`「${entry.label}」を読み込めません。初回はインターネットに接続して再試行してください。`); }
            await fs.mkdir(dir, { recursive: true });
            await atomicWrite(file, bytes); await atomicWrite(path.join(dir, `${key}-LICENSE.txt`), entry.license);
            await atomicWrite(report, JSON.stringify({ family, hash: digest(bytes), source: source.url }));
            return { url: present(file, key), weight: source.weight };
          } }); pump();
        }).finally(() => pending.delete(key));
        pending.set(key, promise);
      }
      return promise;
    }
  };
}
module.exports = { createFontLibrary, validFont };
