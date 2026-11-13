const { test, before, after } = require('node:test');
const { existsSync } = require('node:fs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createFixtures, wrap } = require('./fixtures.cjs');
const { convertFile, readHeader } = require('../src/engine');
const ffmpeg = require('ffmpeg-static');
const root = path.resolve('test-output/engine');
let fixture;
before(async () => { await fs.rm(root, { recursive: true, force: true }); fixture = await createFixtures(root); });
const options = () => ({ outputDir: path.join(root, 'converted'), ffmpeg });
const pcmHash = filename => createHash('sha256').update(execFileSync(ffmpeg, ['-v', 'error', '-i', filename, '-map', '0:a:0', '-f', 's16le', '-'], { windowsHide: true })).digest('hex');

test('MP3 extraction preserves audio samples, tags and cover, and leaves the NCM untouched', async () => {
  const before = await fs.readFile(fixture.mp3.source);
  const result = await convertFile({ ...options(), source: fixture.mp3.source });
  assert.equal(result.format, 'mp3');
  assert.equal(pcmHash(result.path), pcmHash(fixture.mp3.raw));
  assert.deepEqual(await fs.readFile(fixture.mp3.source), before);
  const details = spawnSync(ffmpeg, ['-hide_banner', '-i', result.path, '-map', '0:a:0', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
  assert.equal(details.status, 0);
  assert.match(details.stderr, /午后晴空/); assert.match(details.stderr, /测试歌手/); assert.match(details.stderr, /attached pic/);
});

test('FLAC can become an actual MP3 with embedded metadata and playable audio', async () => {
  const result = await convertFile({ ...options(), source: fixture.flac.source, mode: 'mp3', bitrate: '320' });
  assert.equal(result.format, 'mp3'); assert.equal(result.sourceFormat, 'flac');
  assert.equal((await fs.readFile(result.path)).subarray(0, 3).toString(), 'ID3');
  assert.equal(result.title, '湖畔来信'); assert.equal(result.artist, '测试歌手');
  assert.ok(result.cover.startsWith('data:image/jpeg;'));
  const pcm = execFileSync(ffmpeg, ['-v', 'error', '-i', result.path, '-map', '0:a:0', '-f', 's16le', '-'], { windowsHide: true });
  assert.ok(pcm.length > 300000);
});

test('Original-quality mode preserves FLAC audio exactly', async () => {
  const result = await convertFile({ ...options(), source: fixture.flac.source, mode: 'original' });
  assert.equal(result.format, 'flac');
  assert.equal(pcmHash(result.path), pcmHash(fixture.flac.raw));
});

test('Repeated conversion never overwrites an existing result', async () => {
  const result = await convertFile({ ...options(), source: fixture.mp3.source });
  const previous = await fs.readFile(result.path);
  const another = await convertFile({ ...options(), source: fixture.mp3.source });
  assert.notEqual(result.path, another.path); assert.deepEqual(await fs.readFile(result.path), previous);
});

test('Corrupt files and cancelled jobs fail cleanly without leaving temporary files', async () => {
  await assert.rejects(convertFile({ ...options(), source: fixture.invalid }), /不完整|有效/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(convertFile({ ...options(), source: fixture.mp3.source, signal: controller.signal }), /停止/);
  assert.ok(!(await fs.readdir(options().outputDir)).some(name => name.startsWith('.shiyin-')));
});

test('Header parser honors reserved cover padding and rejects truncated payloads', async () => {
  const handle = await fs.open(fixture.mp3.source);
  try {
    const header = await readHeader(handle);
    assert.equal(header.size - header.offset, fixture.mp3.audio.length);
  } finally { await handle.close(); }
  const broken = path.join(root, 'truncated.ncm'); await fs.writeFile(broken, wrap(Buffer.alloc(0)));
  await assert.rejects(convertFile({ ...options(), source: broken }), /没有音频/);
});

test('The source website WASM decoder independently confirms the NCM fixture audio', { skip: !existsSync('reference/ncmdump.mjs') || !existsSync('reference/ncmdump.wasm') }, async () => {
  const create = (await import(pathToFileURL(path.resolve('reference/ncmdump.mjs')).href)).default;
  const module = await create({ wasmBinary: await fs.readFile('reference/ncmdump.wasm') });
  for (const format of ['mp3', 'flac']) {
    const bytes = await fs.readFile(fixture[format].source);
    const pointer = module._malloc(bytes.length);
    try {
      module.HEAPU8.set(bytes, pointer);
      const result = module.decryptNCM(pointer, bytes.length);
      assert.ok(result, module.getLastError());
      // ncmdump adds tags; compare decoded audio rather than its metadata bytes.
      const decoded = path.join(root, 'website.' + format); await fs.writeFile(decoded, Buffer.from(result));
      assert.equal(pcmHash(decoded), pcmHash(fixture[format].raw));
    } finally { module._free(pointer); }
  }
});
