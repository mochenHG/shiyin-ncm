const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const CORE = Buffer.from('687a4852416d736f356b496e62617857', 'hex');
const META = Buffer.from('2331346c6a6b5f215c5d2630553c2728', 'hex');

function aes(data, key) {
  const cipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

// NCM uses a fixed 256-byte mask after its RC4-style key scheduling.
function makeMask(key) {
  if (!key.length) throw new Error('NCM 密钥为空');
  const box = Uint8Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + box[i] + key[i % key.length]) & 255;
    [box[i], box[j]] = [box[j], box[i]];
  }
  return Buffer.from(Array.from({ length: 256 }, (_, i) => {
    const a = (i + 1) & 255;
    return box[(box[a] + box[(box[a] + a) & 255]) & 255];
  }));
}

async function readHeader(handle) {
  const { size } = await handle.stat();
  let offset = 0;
  async function read(n) {
    if (!Number.isSafeInteger(n) || n < 0 || offset + n > size) throw new Error('NCM 文件不完整或已损坏');
    const result = Buffer.alloc(n);
    const { bytesRead } = await handle.read(result, 0, n, offset);
    if (bytesRead !== n) throw new Error('NCM 文件读取不完整');
    offset += n;
    return result;
  }
  const uint = async () => (await read(4)).readUInt32LE();
  if ((await read(8)).toString() !== 'CTENFDAM') throw new Error('不是有效的 NCM 文件');
  await read(2);
  const keyLength = await uint();
  if (!keyLength || keyLength > 1024 * 1024 || keyLength % 16) throw new Error('NCM 密钥数据损坏');
  const keyData = await read(keyLength);
  for (let i = 0; i < keyData.length; i++) keyData[i] ^= 0x64;
  let mask;
  try { mask = makeMask(aes(keyData, CORE).subarray(17)); }
  catch { throw new Error('无法解密 NCM 密钥，文件可能已损坏'); }
  const metaLength = await uint();
  if (metaLength > 16 * 1024 * 1024) throw new Error('NCM 信息区异常');
  const metaData = await read(metaLength);
  let meta = {}, warning = '';
  if (metaLength) {
    try {
      for (let i = 0; i < metaData.length; i++) metaData[i] ^= 0x63;
      const decoded = aes(Buffer.from(metaData.subarray(22).toString(), 'base64'), META).toString('utf8');
      meta = JSON.parse(decoded.slice(decoded.indexOf(':') + 1));
    } catch { warning = '歌曲信息不可读，已保留音频'; }
  }
  await read(5); // CRC32 and cover version.
  const frameLength = await uint();
  const coverLength = await uint();
  if (coverLength > frameLength || coverLength > 32 * 1024 * 1024 || offset + frameLength > size) {
    throw new Error('NCM 封面数据损坏');
  }
  const cover = await read(coverLength);
  offset += frameLength - coverLength;
  if (offset >= size) throw new Error('NCM 文件没有音频数据');
  return { offset, size, mask, meta, cover, warning };
}

function detectFormat(bytes) {
  if (bytes.subarray(0, 4).toString() === 'fLaC') return 'flac';
  if (bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) return 'mp3';
  throw new Error('解密后的音频格式无法识别，仅支持 MP3 / FLAC');
}

function safeName(name) {
  let value = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = '_' + value;
  return value.slice(0, 130).replace(/[. ]+$/g, '') || '未命名歌曲';
}

function runFFmpeg(executable, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
      windowsHide: true, signal, stdio: ['ignore', 'ignore', 'pipe']
    });
    let errors = '';
    child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(signal?.aborted ? '已停止转换' : `音频处理失败：${errors.trim() || 'FFmpeg 退出 ' + code}`)));
  });
}

function checkAbort(signal) {
  if (signal?.aborted) throw new Error('已停止转换');
}

async function convertFile({ source, outputDir, mode = 'mp3', bitrate = '320', ffmpeg, signal, onProgress = () => {} }) {
  await fs.mkdir(outputDir, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(outputDir, '.shiyin-'));
  let input;
  try {
    checkAbort(signal);
    input = await fs.open(source, 'r');
    const header = await readHeader(input);
    const rawPath = path.join(temporary, 'decoded');
    const raw = await fs.open(rawPath, 'wx');
    let position = header.offset, audioOffset = 0, format;
    const chunk = Buffer.alloc(1024 * 1024);
    try {
      while (position < header.size) {
        checkAbort(signal);
        const { bytesRead } = await input.read(chunk, 0, Math.min(chunk.length, header.size - position), position);
        if (!bytesRead) throw new Error('音频数据意外结束');
        for (let i = 0; i < bytesRead; i++) chunk[i] ^= header.mask[(audioOffset + i) & 255];
        if (!format) format = detectFormat(chunk.subarray(0, bytesRead));
        let written = 0;
        while (written < bytesRead) written += (await raw.write(chunk, written, bytesRead - written)).bytesWritten;
        position += bytesRead;
        audioOffset += bytesRead;
        onProgress(Math.round((position - header.offset) / (header.size - header.offset) * 65));
      }
    } finally { await raw.close(); }
    await input.close(); input = null;
    const meta = header.meta;
    const title = typeof meta.musicName === 'string' ? meta.musicName : path.basename(source, path.extname(source));
    const artist = Array.isArray(meta.artist) ? meta.artist.map(item => Array.isArray(item) ? item[0] : item.name).filter(Boolean).join(' / ') : '';
    const album = typeof meta.album === 'string' ? meta.album : '';
    const targetFormat = mode === 'original' ? format : 'mp3';
    const resultPath = path.join(temporary, 'result.' + targetFormat);
    const args = ['-y', '-i', rawPath];
    const hasCover = header.cover.length > 0 && (header.cover.subarray(0, 3).equals(Buffer.from([255, 216, 255])) || header.cover.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
    if (hasCover) {
      const coverPath = path.join(temporary, 'cover');
      await fs.writeFile(coverPath, header.cover);
      args.push('-i', coverPath, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    } else args.push('-map', '0:a:0');
    args.push('-map_metadata', '0');
    if (title) args.push('-metadata', 'title=' + title);
    if (artist) args.push('-metadata', 'artist=' + artist);
    if (album) args.push('-metadata', 'album=' + album);
    if (targetFormat === 'mp3') {
      // Already-MP3 sources are remuxed, preserving their original audio frames.
      args.push('-c:a', format === 'mp3' ? 'copy' : 'libmp3lame');
      if (format !== 'mp3') args.push('-b:a', ['128', '192', '256', '320'].includes(String(bitrate)) ? String(bitrate) + 'k' : '320k');
      args.push('-id3v2_version', '3');
    } else args.push('-c:a', 'copy');
    args.push(resultPath);
    onProgress(70);
    await runFFmpeg(ffmpeg, args, signal);
    checkAbort(signal);
    const base = safeName(artist ? artist + ' - ' + title : title);
    let destination;
    for (let index = 0; ; index++) {
      destination = path.join(outputDir, base + (index ? ` (${index})` : '') + '.' + targetFormat);
      try { await fs.copyFile(resultPath, destination, fs.constants.COPYFILE_EXCL); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    onProgress(100);
    return {
      title, artist, album, format: targetFormat, sourceFormat: format, path: destination,
      size: (await fs.stat(destination)).size, duration: Number(meta.duration) / 1000 || 0,
      cover: hasCover ? `data:image/${header.cover[0] === 255 ? 'jpeg' : 'png'};base64,${header.cover.toString('base64')}` : '',
      warning: header.warning
    };
  } finally {
    if (input) await input.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

module.exports = { readHeader, makeMask, detectFormat, safeName, convertFile, runFFmpeg };
