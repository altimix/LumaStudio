const fs = require('node:fs/promises');
const RATE = 48000;
function signal(time, channel) {
  return channel === 0 ? 0.2 * Math.sin(2 * Math.PI * (97 * time + 13 * time * time)) + 0.07 * Math.sin(2 * Math.PI * (503 * time + 3 * time * time))
    : 0.17 * Math.sin(2 * Math.PI * (163 * time + 7 * time * time)) + 0.04 * Math.sin(2 * Math.PI * (331 * time + 2 * time * time));
}
async function audioFixture(file, seconds = 12) {
  const samples = new Float32Array(RATE * seconds * 2);
  for (let i = 0; i < samples.length / 2; i++) for (let ch = 0; ch < 2; ch++) samples[2 * i + ch] = signal(i / RATE, ch);
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + samples.byteLength, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 8, 28); header.writeUInt16LE(8, 32); header.writeUInt16LE(32, 34); header.write('data', 36); header.writeUInt32LE(samples.byteLength, 40);
  await fs.writeFile(file, Buffer.concat([header, Buffer.from(samples.buffer)])); return samples;
}
module.exports = { audioFixture, signal, RATE };
