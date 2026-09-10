const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { validateProject } = require('./export.cjs');
const { timelineKey } = require('../shared/youtube.mjs');

function rebaseStartupYoutube(original, copy, ids = new Map()) {
  if (!original.youtube) return copy;
  const youtube={...original.youtube};
  if (youtube.thumbnailAssetId) youtube.thumbnailAssetId=ids.get(youtube.thumbnailAssetId)||youtube.thumbnailAssetId;
  if (youtube.sourceKey===timelineKey(original)) youtube.sourceKey=timelineKey(copy);
  return {...copy,youtube};
}

async function hashFile(file) {
  const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');
}
async function verifyBundle(directory, projectBytes, savedAssets, resolvedAssets) {
  const file=path.join(directory,'manifest.json');let stat;
  try{stat=await fs.stat(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}
  if(stat.size>2*1024*1024)throw Error('初期素材の検証情報が大きすぎます。');
  let manifest;try{manifest=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw Error('初期素材の検証情報を読み取れません。素材付きZIPを再展開してください。');}
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length!==savedAssets.length+1||manifest.files.some(entry=>!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.path!=='string'||!Number.isSafeInteger(entry.size)||entry.size<0||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256)))throw Error('初期素材の検証情報が不正です。素材付きZIPを再展開してください。');
  const entries=new Map(manifest.files.map(entry=>[entry.path,entry]));
  if(entries.size!==manifest.files.length)throw Error('初期素材の検証情報に重複があります。');
  const check=(name,size,digest)=>{const entry=entries.get(name);if(!entry||entry.size!==size||entry.sha256!==digest)throw Error(`初期素材が変更されています：${name}。素材付きZIPを再展開してください。`);};
  check('初期プロジェクト.luma',projectBytes.length,createHash('sha256').update(projectBytes).digest('hex'));
  for(const [i,asset] of savedAssets.entries())check(asset.path,(await fs.stat(resolvedAssets[i].path)).size,await hashFile(resolvedAssets[i].path));
  return true;
}
async function loadStartupProject(directory) {
  const file = path.join(directory, '初期プロジェクト.luma');
  let stat;
  try { stat = await fs.stat(file); } catch(error) {
    if(error.code!=='ENOENT')throw error;
    try { await fs.stat(directory); } catch(directoryError) { if(directoryError.code==='ENOENT')return null;throw directoryError; }
    throw Error('初期プロジェクト.lumaがありません。素材付きZIPをすべて展開してください。');
  }
  if(stat.size>10*1024*1024)throw Error('初期プロジェクトのサイズが大きすぎます。');
  const projectBytes=await fs.readFile(file);
  let project;try{project=JSON.parse(projectBytes.toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('初期プロジェクトのJSON形式が不正です。素材付きZIPを再展開してください。');}
  if(!project||typeof project!=='object'||Array.isArray(project))throw Error('初期プロジェクトの形式が不正です。');
  if(!Array.isArray(project.assets)||project.assets.length>2000)throw Error('初期プロジェクトの素材一覧が不正です。');
  const root=await fs.realpath(directory);
  const assets=[];
  for(const asset of project.assets){
    if(!asset||typeof asset!=='object'||Array.isArray(asset))throw Error('初期プロジェクトの素材情報が不正です。');
    if(typeof asset.path!=='string'||path.isAbsolute(asset.path)||asset.path.includes(':'))throw Error('初期プロジェクトの素材は相対パスで指定してください。');
    const resolved=path.resolve(root,asset.path),relative=path.relative(root,resolved);
    if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('初期プロジェクトの素材がフォルダの外を参照しています。');
    const real=await fs.realpath(resolved),realRelative=path.relative(root,real);
    if(realRelative==='..'||realRelative.startsWith('..'+path.sep)||path.isAbsolute(realRelative))throw Error('初期プロジェクトの素材リンクがフォルダの外を参照しています。');
    const {url,thumbnail,playbackPath,thumbnailPath,offline,...saved}=asset;
    assets.push({...saved,path:real});
  }
  const verified=await verifyBundle(root,projectBytes,project.assets,assets);
  // A manually assembled template without a manifest may load, but its saved
  // transcript cannot be assumed to match the current media contents.
  if(!verified&&project.youtube)project.youtube={...project.youtube,sourceKey:'unverified-startup-media'};
  const result={...project,id:randomUUID(),assets};
  validateProject(result);
  // Recovery can reuse the template IDs with relinked paths. Keep registrations distinct.
  const ids=new Map(assets.map(asset=>[asset.id,randomUUID()]));
  return rebaseStartupYoutube(project,{...result,assets:assets.map(asset=>({...asset,id:ids.get(asset.id)})),clips:result.clips.map(clip=>clip.assetId?{...clip,assetId:ids.get(clip.assetId)}:clip)},ids);
}
async function readStartupProject(directory) {
  try{return await loadStartupProject(directory);}
  catch(error){
    if(error.code)throw Error('初期プロジェクトまたは素材を読み込めません。素材付きZIPをすべて再展開し、フォルダのアクセス権を確認してください。');
    throw error;
  }
}
module.exports={readStartupProject,rebaseStartupYoutube};
