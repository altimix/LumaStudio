// Refresh the official Japanese catalogue. Review the JSON diff before release;
// this script is intentionally not run automatically at application startup.
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.join(__dirname, '..');
const parse = text => JSON.parse(text.slice(text.indexOf('{')));
async function download(url) { const response = await fetch(url,{signal:AbortSignal.timeout(45000)}); if(!response.ok)throw Error(`Font catalogue request failed: ${response.status}`); return parse(await response.text()); }
async function main() {
  const metadata=await download('https://fonts.google.com/metadata/fonts');
  const families=metadata.familyMetadataList.filter(f=>f.subsets.includes('japanese'));
  if(families.length<60)throw Error('Unexpected catalogue size; keep the current snapshot.');
  const names=['Thin','ExtraLight','Light','Regular','Medium','SemiBold','Bold','ExtraBold','Black'],fonts=[];let next=0;
  async function worker(){for(;;){const i=next++;if(i>=families.length)return;const f=families[i],m=(await download('https://fonts.google.com/download/list?family='+encodeURIComponent(f.family))).manifest;
    const refs=m.fileRefs.filter(r=>/\.ttf$/.test(r.filename)&&!/italic/i.test(r.filename)),variable=refs.find(r=>r.filename.includes('VariableFont_wght'));
    const weights=Object.keys(f.fonts).filter(k=>/^\d+$/.test(k)).map(Number).sort((a,b)=>a-b);
    const files=variable?[{url:variable.url,weight:`${weights[0]} ${weights.at(-1)}`}]:weights.map(w=>{const r=refs.find(r=>r.filename.endsWith('-'+names[w/100-1]+'.ttf'))||(weights.length===1?refs[0]:null);if(!r)throw Error(`Cannot map ${f.family} ${w}`);return{url:r.url,weight:String(w)};});
    const license=m.files.find(file=>/^(OFL|LICENSE|LICENCE)/i.test(file.filename));if(!license)throw Error(`Missing license: ${f.family}`);
    if(files.some(file=>!/^https:\/\/fonts\.gstatic\.com\/s\/.+\.ttf$/.test(file.url)))throw Error('Unrecognized font source.');
    fonts[i]={family:f.family,label:f.displayName||f.family,weights,files,license:license.contents};
  }}
  await Promise.all(Array.from({length:4},worker));
  const catalogue={updated:new Date().toISOString().slice(0,10),source:'https://fonts.google.com/metadata/fonts',fonts};
  await fs.writeFile(path.join(root,'electron','font-sources.json'),JSON.stringify(catalogue,null,2)+'\n');
  await fs.writeFile(path.join(root,'shared','japanese-fonts.json'),JSON.stringify(fonts.map(f=>({family:f.family,label:f.label,weights:f.weights,variable:f.files.some(file=>file.weight.includes(' '))})),null,2)+'\n');
  console.log(`Japanese catalogue refreshed: ${fonts.length} families. The bundled default TTF is unchanged.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
