const fs=require('node:fs/promises'),path=require('node:path');
const {createReadStream}=require('node:fs'),{createHash}=require('node:crypto');
const {rebaseStartupYoutube}=require('../electron/startup-project.cjs');
const {validateProject}=require('../electron/export.cjs');
const {inspectMedia}=require('../electron/media.cjs');
const {assertReplacement}=require('../electron/project.cjs');
async function hash(file){const digest=createHash('sha256');for await(const part of createReadStream(file))digest.update(part);return digest.digest('hex');}
async function bundleStartupProject(source,destination){
  source=path.resolve(source);destination=path.resolve(destination);
  const original=await fs.readFile(source),sourceHash=createHash('sha256').update(original).digest('hex');
  const project=JSON.parse(original.toString('utf8').replace(/^\uFEFF/,''));
  validateProject(project);
  if(!Array.isArray(project.assets)||project.assets.length>2000)throw Error('素材一覧が不正です。');
  try{await fs.lstat(destination);throw Object.assign(Error('Destination already exists'),{code:'EEXIST'});}catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=await fs.mkdtemp(path.join(path.dirname(destination),`.${path.basename(destination)}.staging-`));
  let published=false;
  try{
  await fs.mkdir(path.join(temporary,'media'));
  const entries=[],assets=[];
  for(const [index,asset] of project.assets.entries()){
    const file=path.resolve(path.dirname(source),asset.path),before=await hash(file);
    const filename=`${String(index+1).padStart(3,'0')}-${path.basename(file).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')}`;
    const relative=`media/${filename}`,target=path.join(temporary,relative);
    await fs.copyFile(file,target);
    const copied=await hash(target),after=await hash(file);
    if(before!==copied||before!==after)throw Error(`コピー中に素材が変更されました：${asset.name}`);
    let fresh;
    try{fresh=await inspectMedia(target,path.join(temporary,'.validation-cache'));assertReplacement(asset,fresh);}
    catch(error){throw Error(`同梱する素材を確認してください：${asset.name}。${error.message}`);}
    const candidate={...fresh,id:asset.id,name:asset.name};
    validateProject({...project,transitions:[],assets:[candidate],clips:project.clips.filter(clip=>clip.assetId===asset.id)});
    const {url,thumbnail,offline,playbackPath,thumbnailPath,...saved}=candidate;
    assets.push({...saved,path:relative});entries.push({path:relative,size:(await fs.stat(target)).size,sha256:copied});
  }
  if(await hash(source)!==sourceHash)throw Error('コピー中に初期プロジェクトが更新されました。最新版で作り直してください。');
  // Saved projects have no content digest binding transcription to source bytes.
  // Preserve the editable results, but never certify them from path/stat identity.
  await fs.rm(path.join(temporary,'.validation-cache'),{recursive:true,force:true});
  const verifiedProject=!project.youtube?project:{...project,youtube:{...project.youtube,sourceKey:'unverified-source-media'}};
  const file=path.join(temporary,'初期プロジェクト.luma');await fs.writeFile(file,JSON.stringify(rebaseStartupYoutube(verifiedProject,{...verifiedProject,assets}),null,2));
  entries.unshift({path:'初期プロジェクト.luma',size:(await fs.stat(file)).size,sha256:await hash(file)});
  const manifest={version:1,createdAt:new Date().toISOString(),sourceProjectSha256:sourceHash,files:entries};
  await fs.writeFile(path.join(temporary,'manifest.json'),JSON.stringify(manifest,null,2));
  await fs.rename(temporary,destination);published=true;
  return manifest;
  }finally{
    if(!published){
      if(path.dirname(temporary)!==path.dirname(destination)||!path.basename(temporary).startsWith(`.${path.basename(destination)}.staging-`))throw Error('Temporary bundle path is outside its staging directory.');
      await fs.rm(temporary,{recursive:true,force:true});
    }
  }
}
if(require.main===module){const [source,destination]=process.argv.slice(2);if(!source||!destination){console.error('Usage: node scripts/bundle-startup-project.cjs SOURCE.luma NEW_OUTPUT_DIRECTORY');process.exitCode=1;}else bundleStartupProject(source,destination).then(m=>console.log(`Bundled ${m.files.length-1} assets; source SHA256 ${m.sourceProjectSha256}`)).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={bundleStartupProject,hash};
