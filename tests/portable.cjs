const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve('test-output/portable'), profile = path.join(root, 'profile'), output = path.join(root, 'output');
  await fs.mkdir(profile, { recursive: true }); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ outputDir: output }));
  await fs.rm(path.join(profile, 'DevToolsActivePort'), { force: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const source = path.resolve('test-output/simple-ui/测试歌手 - 湖畔来信.NCM');
  const child = spawn(path.resolve(`dist/Shiyin-NCM-${require('../package.json').version}.exe`), ['--remote-debugging-port=0', '--user-data-dir=' + profile, source], { env, windowsHide: true, stdio: 'ignore' });
  let browser, page;
  try {
    let port;
    for (let attempt = 0; attempt < 300; attempt++) {
      try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; if (port) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(port, 'portable app must start within 30 seconds');
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(15000);
    await page.emulateMedia({ colorScheme:null });
    await page.waitForFunction(() => document.querySelectorAll('.file-row').length === 1);
    assert.equal((await page.evaluate(() => window.shiyin.state())).theme, 'system');
    await page.click('[data-theme="dark"]');
    await page.waitForFunction(() => document.querySelector('[data-theme="dark"]').getAttribute('aria-pressed') === 'true' && getComputedStyle(document.querySelector('h1')).color === 'rgb(238, 234, 240)');
    await page.click('#convert');
    await page.waitForFunction(() => document.querySelectorAll('.file-status.done').length === 1 && !document.querySelector('#add').disabled, null, { timeout: 30000 });
    const state = await page.evaluate(() => window.shiyin.state());
    assert.equal((await fs.readFile(state.items[0].result.path)).subarray(0, 3).toString(), 'ID3');
    await page.screenshot({ path: path.join(root, 'converted.png') });
    await page.click('#clear');
    await page.waitForFunction(() => document.querySelectorAll('.file-row').length === 0);
    const cdp = await page.context().newCDPSession(page);
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: 200, y: 220, data: { items: [], files: [source], dragOperationsMask: 1 } });
    await page.waitForFunction(() => document.querySelectorAll('.file-row').length === 1 && !document.querySelector('#add').disabled);
    await page.click('#clear');
    await page.screenshot({ path: path.join(root, 'ready.png') });
    assert.equal(await page.locator('.record').evaluate(element => getComputedStyle(element).animationName), 'record-turn');
    assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8')).theme, 'dark');
    console.log('PASS: the single portable EXE starts with system appearance, switches to dark, saves its preference, animates the record, converts FLAC NCM to MP3, and accepts native drag-and-drop.');
    await page.click('[data-window="close"]');
  } finally {
    if (page && !page.isClosed()) await page.evaluate(() => window.shiyin.window('close')).catch(() => {});
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
