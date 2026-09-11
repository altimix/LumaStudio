const fs=require('node:fs/promises');
const {ffmpeg,run}=require('./media.cjs');
// Use decimal MB so the output is below both 2 MB and 2 MiB limits.
const MAX_THUMBNAIL_BYTES=2_000_000;
async function thumbnailJpeg(file,signal){
  signal?.throwIfAborted();
  if((await fs.stat(file)).size<MAX_THUMBNAIL_BYTES){
    const bytes=await fs.readFile(file);
    if(bytes.length<MAX_THUMBNAIL_BYTES&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return bytes;
  }
  for(const quality of [3,5,8,12,18,24,31]){
    const jpeg=await run(ffmpeg,['-v','error','-i',file,'-frames:v','1','-q:v',String(quality),'-pix_fmt','yuvj420p','-c:v','mjpeg','-f','image2pipe','pipe:1'],{signal});
    if(jpeg.length>0&&jpeg.length<MAX_THUMBNAIL_BYTES)return jpeg;
  }
  throw new Error('サムネイルを2MB未満のJPEGにできませんでした。再生成してください。');
}
module.exports={MAX_THUMBNAIL_BYTES,thumbnailJpeg};
