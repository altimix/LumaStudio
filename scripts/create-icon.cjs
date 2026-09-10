const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
function crc32(buffer) { let crc=0xffffffff; for(const b of buffer){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
function chunk(type, data) { const t=Buffer.from(type);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([size,t,data,crc]); }
function png(size) {
 const raw=Buffer.alloc((size*4+1)*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   let r=0,g=0,b=0,a=0;
   for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++){
     const px=(x+(sx+.5)/4)/size,py=(y+(sy+.5)/4)/size;
     const cx=Math.max(.16-px,0,px-.84),cy=Math.max(.16-py,0,py-.84);
     const inside=Math.hypot(cx,cy)<.16;
     let color=[25,31,28,inside?255:0];
     if((px>=.25&&px<=.43&&py>=.2&&py<=.79)||(px>=.25&&px<=.8&&py>=.62&&py<=.8))color=[187,220,152,255];
     if(px>=.52&&px<=.8&&py>=.2&&py<=.48&&py-.2>=px-.52)color=[112,145,90,255];
     r+=color[0];g+=color[1];b+=color[2];a+=color[3];
   }
   const pos=y*(size*4+1)+1+x*4;raw[pos]=Math.round(r/16);raw[pos+1]=Math.round(g/16);raw[pos+2]=Math.round(b/16);raw[pos+3]=Math.round(a/16);
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const sizes=[16,32,48,64,128,256];const images=sizes.map(png);const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
for(let i=0;i<sizes.length;i++){const p=6+i*16;header[p]=sizes[i]%256;header[p+1]=sizes[i]%256;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(images[i].length,p+8);header.writeUInt32LE(offset,p+12);offset+=images[i].length;}
fs.writeFileSync(path.join(__dirname,'..','electron','luma.ico'),Buffer.concat([header,...images]));
fs.writeFileSync(path.join(__dirname,'..','electron','luma.png'),png(1024));
console.log('Application icons created.');
