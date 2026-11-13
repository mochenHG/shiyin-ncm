const fs = require('node:fs/promises');
const path = require('node:path');
const { createCipheriv } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');
function encrypt(bytes, key) { const c = createCipheriv('aes-128-ecb', Buffer.from(key, 'hex'), null); return Buffer.concat([c.update(bytes), c.final()]); }
function uint(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
// An independently constructed NCM container, also checked against the source website's WASM decoder.
function wrap(audio, meta = {}, cover = Buffer.alloc(0), padding = 0) {
  const key = Buffer.from('independent-integration-test-key-2026');
  const k = encrypt(Buffer.concat([Buffer.from('neteasecloudmusic'), key]), '687a4852416d736f356b496e62617857');
  const box = Array.from({ length: 256 }, (_, i) => i);
  let previous = 0;
  for (let x = 0; x !== 256; x++) {
    const swap = box[x];
    const c = (swap + previous + key[x % key.length]) % 256;
    box[x] = box[c]; box[c] = swap; previous = c;
  }
  const payload = Buffer.from(audio);
  for (let n = 0; n < payload.length; n++) {
    const j = (n + 1) % 256;
    payload[n] ^= box[(box[j] + box[(box[j] + j) % 256]) % 256];
  }
  const m = Buffer.from("163 key(Don't modify):" + encrypt(Buffer.from('music:' + JSON.stringify(meta)), '2331346c6a6b5f215c5d2630553c2728').toString('base64'));
  for (let n = 0; n < k.length; n++) k[n] ^= 0x64;
  for (let n = 0; n < m.length; n++) m[n] ^= 0x63;
  return Buffer.concat([Buffer.from('CTENFDAM'), Buffer.alloc(2), uint(k.length), k, uint(m.length), m, Buffer.alloc(5), uint(cover.length + padding), uint(cover.length), cover, Buffer.alloc(padding), payload]);
}
async function createFixtures(root) {
  await fs.mkdir(root, { recursive: true });
  const cover = await require('sharp')({ create: { width: 64, height: 64, channels: 3, background: '#e54552' } }).jpeg().toBuffer();
  const results = {};
  for (const format of ['mp3', 'flac']) {
    const raw = path.join(root, 'tone.' + format);
    execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', format === 'mp3' ? 'libmp3lame' : 'flac', raw], { windowsHide: true });
    const audio = await fs.readFile(raw);
    const source = path.join(root, format === 'mp3' ? '测试歌手 - 午后晴空.ncm' : '测试歌手 - 湖畔来信.NCM');
    const meta = { musicName: format === 'mp3' ? '午后晴空' : '湖畔来信', artist: [['测试歌手', 1]], album: '拾音测试专辑', duration: 4000, format };
    await fs.writeFile(source, wrap(audio, meta, cover, 37));
    results[format] = { raw, audio, source, meta };
  }
  const invalid = path.join(root, '损坏文件.ncm'); await fs.writeFile(invalid, 'invalid ncm'); results.invalid = invalid;
  return results;
}
module.exports = { wrap, createFixtures };
