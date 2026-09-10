const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { blackVideo } = require('../electron/black-video.cjs');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
test('black video creates a durable full-frame black image without a media duration limit',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-black-'));
  try{
    for(const [width,height] of [[320,180],[180,320]]){
      const file=await blackVideo(dir,width,height),asset=await inspectMedia(file,path.join(dir,'cache'));
      assert.equal(asset.kind,'image');assert.equal(asset.width,width);assert.equal(asset.height,height);assert.equal(asset.hasAudio,false);
      const pixels=await run(ffmpeg,['-v','error','-i',file,'-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
      assert.equal(pixels.length,width*height*3);assert.ok(pixels.every(v=>v===0));
      assert.ok((await fs.stat(file)).size>0);
    }
    for(const dims of [[0,180],[320,100000],['320',180],[NaN,180],[320.5,180]])await assert.rejects(blackVideo(dir,...dims),/サイズ/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
