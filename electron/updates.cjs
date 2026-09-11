const RELEASES = 'https://github.com/altimix/LumaStudio/releases';
const API = 'https://api.github.com/repos/altimix/LumaStudio/releases/latest';
function versionParts(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value || '');
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  return parts.every(Number.isSafeInteger) ? { parts, prerelease: match[4] } : null;
}
function isNewer(latest, current) {
  const a=versionParts(latest), b=versionParts(current);
  if (!a || !b || a.prerelease) return false;
  for (let i=0;i<3;i++) if(a.parts[i]!==b.parts[i]) return a.parts[i]>b.parts[i];
  return !!b.prerelease;
}
function releaseInfo(release, currentVersion, platform, arch, checkedAt) {
  const parsed=versionParts(release?.tag_name);
  if (!parsed || parsed.prerelease || release.draft || release.prerelease) throw Error('安定版の更新情報を確認できませんでした。');
  const latestVersion=parsed.parts.join('.');
  const suffix=platform==='darwin'&&arch==='arm64'?'macOS-arm64.zip':platform==='win32'&&arch==='x64'?'Windows.exe':null;
  const compatible=!!suffix && Array.isArray(release.assets) && release.assets.some(a=>a.name===`Luma-Studio-${latestVersion}-${suffix}`&&a.state==='uploaded');
  return {status:isNewer(latestVersion,currentVersion)?(compatible?'available':'unsupported'):'current',currentVersion,latestVersion,checkedAt,platform,arch,releaseUrl:`${RELEASES}/tag/${encodeURIComponent(release.tag_name)}`};
}
function createUpdateChecker({currentVersion,platform,arch,fetchRelease,now=Date.now}) {
  let pending, cached;
  const fetchLatest=fetchRelease || (async()=>{
    const response=await fetch(API,{headers:{Accept:'application/vnd.github+json','User-Agent':'LumaStudio-update-check'},signal:AbortSignal.timeout(10000),redirect:'error'});
    if (!response.ok) throw Error(response.status===403||response.status===429?'更新確認の回数制限に達しました。しばらくしてから再確認してください。':'更新情報を取得できませんでした。通信環境を確認してください。');
    const text=await response.text(); if(text.length>1024*1024)throw Error('更新情報が大きすぎます。');
    return JSON.parse(text);
  });
  return {check(refresh=false) {
    if(pending)return pending;
    if(!refresh&&cached&&now()-cached.checkedAt<10*60*1000)return Promise.resolve(cached);
    pending=Promise.resolve().then(fetchLatest).then(release=>{
      cached=releaseInfo(release,currentVersion,platform,arch,now());return cached;
    }).catch(error=>({status:'error',currentVersion,platform,arch,checkedAt:now(),message:error?.name==='TimeoutError'?'更新確認が時間切れになりました。あとで再確認してください。':error instanceof SyntaxError?'更新情報の形式を確認できませんでした。':error instanceof TypeError?'更新情報を取得できませんでした。通信環境を確認してください。':error.message||'更新情報を取得できませんでした。'})).finally(()=>{pending=undefined;});
    return pending;
  }};
}
module.exports={createUpdateChecker,releaseInfo,isNewer,RELEASES};
