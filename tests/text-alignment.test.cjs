const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateProject}=require('../electron/export.cjs');
function project(textAlign){return {version:1,id:'p',name:'文字揃え',width:640,height:360,fps:30,assets:[],markers:[],tracks:[{id:'v',kind:'video'}],clips:[{id:'t',trackId:'v',kind:'title',name:'文字',start:0,in:0,duration:2,speed:1,x:0,y:0,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,volume:1,fadeIn:0,fadeOut:0,text:'テキスト',fontSize:40,color:'#ffffff',textStyle:'minimal',textAlign}]};}
test('export accepts legacy alignment and rejects corrupt base/keyed alignment',()=>{
  for(const align of [undefined,'left','center','right','justify'])assert.doesNotThrow(()=>validateProject(project(align)));
  for(const align of [null,'distributed',0,{},[]]){
    assert.throws(()=>validateProject(project(align)),/文字揃え/);
    const p=project('center');p.clips[0].visualKeyframes=[{time:0,values:{textAlign:align}}];assert.throws(()=>validateProject(p),/文字揃え/);
  }
});
