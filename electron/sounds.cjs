const fs=require('node:fs/promises');const path=require('node:path');const {soundWave,SOUNDS}=require('../shared/sounds.mjs');const {atomicWrite}=require('./persistence.cjs');
async function soundFile(directory,id,minimumDuration=0){
  const sound=SOUNDS.find(s=>s.id===id);if(!sound)throw new Error('効果音の種類が不正です。');
  const expected=Buffer.from(soundWave(id,minimumDuration)),suffix=minimumDuration>sound.duration?'-'+Math.ceil(minimumDuration*48000):'';
  const folder=path.join(directory,`original-sounds-v${sound.revision}`),file=path.join(folder,`${id}${suffix}.wav`);await fs.mkdir(folder,{recursive:true});
  const saved=await fs.readFile(file).catch(()=>null);if(!saved?.equals(expected))await atomicWrite(file,expected);return file;
}
module.exports={soundFile};
