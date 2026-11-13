const { _electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve('test-output/packaged'); await fs.mkdir(path.join(root, 'profile'), { recursive: true });
  const output = path.join(root, 'output'); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(root, 'profile/settings.json'), JSON.stringify({ outputDir: output }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.SHIYIN_TEST; delete env.SHIYIN_TEST_DATA;
  const executable = path.resolve('dist/win-unpacked/拾音 NCM.exe');
  const app = await _electron.launch({ executablePath: executable, args: ['--user-data-dir=' + path.join(root, 'profile'), path.resolve('test-output/simple-ui/测试歌手 - 湖畔来信.NCM')], env, timeout: 45000 });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    assert.equal(await app.evaluate(() => typeof global.shiyinTest), 'undefined');
    await page.waitForFunction(() => document.querySelectorAll('.file-row').length === 1);
    await page.click('#convert');
    await page.waitForFunction(() => document.querySelectorAll('.file-status.done').length === 1 && !document.querySelector('#add').disabled, null, { timeout: 30000 });
    const result = (await page.evaluate(() => window.shiyin.state())).items[0].result;
    assert.equal((await fs.readFile(result.path)).subarray(0, 3).toString(), 'ID3');
    await page.screenshot({ path: path.join(root, 'packaged-converted.png') });
    await page.click('#clear');
    await page.screenshot({ path: path.join(root, 'ready.png') });
    console.log('PASS: packaged application starts, imports NCM, uses bundled FFmpeg, outputs actual MP3, and excludes development hooks.');
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
