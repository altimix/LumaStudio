const path = require('node:path');
const folder = path.join(__dirname, '..', 'vendor', 'media', `${process.platform}-${process.arch}`).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const extension = process.platform === 'win32' ? '.exe' : '';
module.exports = { ffmpeg: path.join(folder, 'ffmpeg' + extension), ffprobe: path.join(folder, 'ffprobe' + extension) };
