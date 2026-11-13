const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createFixtures } = require('./fixtures.cjs');
(async () => {
  const root = path.resolve('test-output/simple-ui');
  await fs.rm(root, { recursive: true, force: true });
  const fixture = await createFixtures(root);
  const nested = path.join(root, '子文件夹'); await fs.mkdir(nested); await fs.copyFile(fixture.mp3.source, path.join(nested, '子目录音乐.ncm'));
  const output = path.join(root, '音乐输出'); await fs.mkdir(output);
  const env = { ...process.env, SHIYIN_TEST: '1', SHIYIN_TEST_DATA: path.join(root, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [path.resolve('.')], env, timeout: 60000 });
  let page;
  try {
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('#output-path').textContent.length > 0);
    await page.waitForFunction(() => document.querySelector('.queue').getAnimations().every(animation => animation.playState === 'finished'));
    console.log('UI started');
    await page.screenshot({ path: path.join(root, '01-home.png') });
    await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, [output]);
    await page.click('#output-folder');
    await page.waitForFunction(target => document.querySelector('#output-path').textContent === target, output);
    await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, [root]);
    await page.click('#import-folder');
    await page.waitForFunction(() => document.querySelectorAll('.file-row').length === 4);
    console.log('Recursive folder import and output selection passed');
    await app.evaluate(async (_electron, source) => global.shiyinTest.addFiles([source]), fixture.mp3.source);
    assert.equal((await page.evaluate(() => window.shiyin.state())).items.length, 4);
    await page.click('#convert');
    await page.waitForFunction(() => !document.querySelector('#add').disabled && document.querySelectorAll('.file-status.done').length === 3 && document.querySelectorAll('.file-status.error').length === 1, null, { timeout: 30000 });
    console.log('Batch conversion passed');
    const state = await page.evaluate(() => window.shiyin.state());
    for (const item of state.items.filter(item => item.status === 'done')) { await fs.access(item.result.path); assert.match(item.result.path, /\.mp3$/); }
    await page.screenshot({ path: path.join(root, '02-converted.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 620));
    await page.screenshot({ path: path.join(root, '03-small.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.click('#clear');
    await page.waitForFunction(() => document.querySelectorAll('.file-row').length === 0);
    await fs.access(state.items.find(item => item.status === 'done').result.path);
    const cdp = await page.context().newCDPSession(page);
    for (const [file, expected] of [[fixture.mp3.source, 1], [root, 4]]) {
      for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: 200, y: 220, data: { items: [], files: [file], dragOperationsMask: 1 } });
      await page.waitForFunction(count => document.querySelectorAll('.file-row').length === count && !document.querySelector('#add').disabled, expected);
      await page.click('#clear');
      await page.waitForFunction(() => document.querySelectorAll('.file-row').length === 0);
    }
    // Use a real batch long enough to cancel after the button's hover transition.
    const cancelFolder = path.join(root, 'cancel-batch'); await fs.mkdir(cancelFolder);
    const cancelFiles = [];
    for (let index = 0; index < 30; index++) {
      const target = path.join(cancelFolder, `cancel-${index}.ncm`);
      await fs.copyFile(fixture.flac.source, target); cancelFiles.push(target);
    }
    await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, cancelFiles);
    await page.click('#add');
    await page.waitForFunction(() => document.querySelectorAll('.file-row').length === 30);
    await page.click('#convert');
    await page.click('#convert');
    await page.waitForFunction(() => !document.querySelector('#add').disabled, null, { timeout: 15000 });
    assert.ok((await page.evaluate(() => window.shiyin.state())).items.some(item => item.status === 'pending'));
    await page.click('#clear');
    await page.waitForFunction(() => document.querySelectorAll('.file-row').length === 0);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'profile/settings.json'), 'utf8')).outputDir, output);
    assert.deepEqual(errors, []);
    console.log('PASS: native file and folder drops, folder import (including subfolders), file selection, deduplication, output selection and persistence, MP3 conversion, failure isolation, cancellation, safe clear, and small-window layout.');
  } catch (error) {
    console.error('UI test failed', error);
    if (page) { console.error(await page.evaluate(() => window.shiyin.state()).catch(() => 'No state')); await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); }
    throw error;
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
