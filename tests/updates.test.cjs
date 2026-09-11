const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isNewer,releaseInfo,createUpdateChecker}=require('../electron/updates.cjs');
const release=(tag='v1.1.0',suffix='macOS-arm64.zip')=>({tag_name:tag,draft:false,prerelease:false,html_url:'https://evil.invalid/',assets:[{name:`Luma-Studio-${tag.replace(/^v/,'')}-${suffix}`,state:'uploaded'}]});
test('stable semantic versions compare numerically and never downgrade',()=>{
 assert.equal(isNewer('1.10.0','1.9.9'),true);assert.equal(isNewer('1.0.0','1.0.0-beta.1'),true);
 for(const [a,b] of [['1.0.0','1.0.0'],['1.0.0','2.0.0'],['1.1.0-beta','1.0.0'],['../../evil','1.0.0'],['1.1.0','unknown']])assert.equal(isNewer(a,b),false);
});
test('release must be stable and asset must match this platform and architecture',()=>{
 assert.equal(releaseInfo(release(),'1.0.0','darwin','arm64',0).status,'available');
 assert.equal(releaseInfo(release('v1.1.0','Windows.exe'),'1.0.0','win32','x64',0).status,'available');
 for(const [platform,arch] of [['darwin','x64'],['win32','arm64'],['linux','x64'],['win32','x64']])assert.equal(releaseInfo(release(),'1.0.0',platform,arch,0).status,'unsupported');
 const incomplete=release();incomplete.assets[0].state='new';assert.equal(releaseInfo(incomplete,'1.0.0','darwin','arm64',0).status,'unsupported');
 for(const r of [{...release(),draft:true},{...release(),prerelease:true},release('v1.1.0-beta'),{},null])assert.throws(()=>releaseInfo(r,'1.0.0','darwin','arm64',0));
 assert.equal(releaseInfo(release('1.1.0'),'1.0.0','darwin','arm64',0).releaseUrl,'https://github.com/altimix/LumaStudio/releases/tag/1.1.0');
});
test('startup checks coalesce, cache expires, and explicit refresh works',async()=>{
 let calls=0,time=0;const checker=createUpdateChecker({currentVersion:'1.0.0',platform:'darwin',arch:'arm64',now:()=>time,fetchRelease:async()=>{calls++;return release();}});
 const [a,b]=await Promise.all([checker.check(),checker.check(true)]);assert.equal(a,b);assert.equal(calls,1);
 await checker.check();assert.equal(calls,1);await checker.check(true);assert.equal(calls,2);
 time=600001;await checker.check();assert.equal(calls,3);
});
test('offline and malformed responses return errors and can recover',async()=>{
 let outcome=0;const checker=createUpdateChecker({currentVersion:'1.0.0',platform:'win32',arch:'x64',fetchRelease:async()=>{if(outcome===0)throw Error('offline');if(outcome===1)return {};return release('v1.1.0','Windows.exe');}});
 assert.equal((await checker.check()).status,'error');outcome=1;assert.equal((await checker.check()).status,'error');outcome=2;assert.equal((await checker.check()).status,'available');
});
