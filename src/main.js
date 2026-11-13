const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
let win, worker, quitting = false, settings, settingsFile;
let settingsWrite = Promise.resolve();
const items = new Map();
const initialFiles = process.argv.slice(1).filter(value => /\.ncm$/i.test(value));
const testMode = !app.isPackaged && process.env.SHIYIN_TEST === '1';
function send(data) { if (win && !win.isDestroyed()) win.webContents.send('update', data); }
function snapshot() { return { items: [...items.values()], outputDir: settings.outputDir, theme: settings.theme, running: !!worker }; }
function saveSettings() {
  const contents = JSON.stringify(settings);
  settingsWrite = settingsWrite.catch(() => {}).then(async () => {
    await fs.writeFile(settingsFile + '.tmp', contents);
    await fs.rename(settingsFile + '.tmp', settingsFile);
  });
  return settingsWrite;
}
async function addFiles(paths) {
  if (worker) return { message: '请等当前转换完成后再添加' };
  let added = 0, ignored = 0;
  const existing = new Set([...items.values()].map(item => item.source.toLowerCase()));
  for (const source of paths) {
    if (typeof source !== 'string' || !path.isAbsolute(source) || !/\.ncm$/i.test(source)) { ignored++; continue; }
    const normalized = path.resolve(source);
    if (existing.has(normalized.toLowerCase())) continue;
    try {
      const stat = await fs.stat(normalized);
      if (!stat.isFile()) { ignored++; continue; }
      const id = randomUUID();
      items.set(id, { id, source: normalized, name: path.basename(normalized), size: stat.size, status: 'pending', progress: 0 });
      existing.add(normalized.toLowerCase()); added++;
    } catch { ignored++; }
  }
  send({ type: 'state', ...snapshot() });
  return { added, message: ignored ? `已添加 ${added} 个文件，忽略 ${ignored} 个非 NCM 或不可读文件` : added ? `已添加 ${added} 个文件` : '没有新的 NCM 文件可添加' };
}
async function addFolder(folder) {
  const paths = [];
  let unreadable = 0;
  async function visit(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { unreadable++; return; }
    for (const entry of entries) {
      // Do not follow directory links or junctions into unrelated folders.
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && /\.ncm$/i.test(entry.name)) paths.push(target);
    }
  }
  await visit(folder);
  const result = await addFiles(paths);
  if (unreadable) result.message += `，${unreadable} 个子文件夹不可读`;
  return result;
}
function finishBatch(error) {
  for (const item of items.values()) if (item.status === 'working') { item.status = error ? 'error' : 'pending'; item.error = error || ''; }
  worker = null;
  if (win && !win.isDestroyed()) win.setProgressBar(-1);
  send({ type: 'state', ...snapshot() });
}
function startBatch() {
  if (worker) return;
  const pending = [...items.values()].filter(item => item.status === 'pending' || item.status === 'error');
  if (!pending.length) return;
  for (const item of pending) { item.status = 'pending'; item.error = ''; item.progress = 0; }
  const current = new Worker(path.join(__dirname, 'worker.js'), { workerData: {
    items: pending.map(({ id, source }) => ({ id, source })),
    options: { outputDir: settings.outputDir, mode: 'mp3', bitrate: '320', ffmpeg: app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg.exe') : require('ffmpeg-static') }
  } });
  worker = current;
  send({ type: 'state', ...snapshot() });
  current.on('message', message => {
    if (message.type === 'finished') return finishBatch();
    const item = items.get(message.id); if (!item) return;
    if (message.type === 'working') item.status = 'working';
    if (message.type === 'progress') item.progress = message.progress;
    if (message.type === 'done') { item.status = 'done'; item.progress = 100; item.result = { path: message.result.path, size: message.result.size, title: message.result.title }; }
    if (message.type === 'error') { item.status = 'error'; item.error = message.error; }
    if (message.type === 'cancelled') { item.status = 'pending'; item.progress = 0; }
    const completed = pending.filter(value => value.status === 'done' || value.status === 'error').length;
    if (win && !win.isDestroyed()) win.setProgressBar((completed + (item.status === 'working' ? item.progress / 100 : 0)) / pending.length);
    send({ type: 'item', item });
  });
  current.on('error', error => { if (worker === current) finishBatch(error.message); });
  current.on('exit', code => { if (worker === current) finishBatch(code ? '转换进程意外退出，请重试' : ''); });
}
function register(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('无效请求');
    try { return await handler(...args); } catch (error) { return { error: error.message }; }
  });
}
function createWindow() {
  win = new BrowserWindow({ width: 1040, height: 780, minWidth: 800, minHeight: 620, frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#17171c' : '#fafafb', title: '拾音 NCM · NCM 转 MP3', icon: path.join(__dirname, '../assets/icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/i.test(details.url) }));
  win.loadFile(path.join(__dirname, 'ui/index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.once('did-finish-load', () => { if (initialFiles.length) addFiles(initialFiles); });
  win.on('close', event => {
    if (worker && !quitting) {
      event.preventDefault();
      const result = dialog.showMessageBoxSync(win, { type: 'question', title: '转换还在进行', message: '停止转换并退出？', detail: '已完成的音乐会保留。', buttons: ['继续转换', '停止并退出'], defaultId: 0, cancelId: 0 });
      if (result === 1) { quitting = true; worker.once('exit', () => app.quit()); worker.postMessage('cancel'); }
    }
  });
}
if (!testMode && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, args) => { win?.restore(); win?.focus(); addFiles(args.filter(value => /\.ncm$/i.test(value))); });
  app.whenReady().then(async () => {
    if (testMode && process.env.SHIYIN_TEST_DATA) app.setPath('userData', process.env.SHIYIN_TEST_DATA);
    settingsFile = path.join(app.getPath('userData'), 'settings.json');
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    try { settings = JSON.parse(await fs.readFile(settingsFile, 'utf8')); } catch { settings = {}; }
    if (!settings || typeof settings !== 'object') settings = {};
    if (typeof settings.outputDir !== 'string' || !path.isAbsolute(settings.outputDir)) settings.outputDir = path.join(app.getPath('music'), '拾音转换');
    if (!['system', 'light', 'dark'].includes(settings.theme)) settings.theme = 'system';
    nativeTheme.themeSource = settings.theme;
    nativeTheme.on('updated', () => { if (win && !win.isDestroyed()) win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#17171c' : '#fafafb'); });
    register('state', snapshot);
    register('set-theme', async theme => {
      if (!['system', 'light', 'dark'].includes(theme)) return;
      settings.theme = theme;
      nativeTheme.themeSource = theme;
      await saveSettings();
      send({ type: 'state', ...snapshot() });
    });
    register('pick-files', async () => {
      if (worker) return;
      const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: '网易云音乐 NCM', extensions: ['ncm'] }] });
      return result.canceled ? null : addFiles(result.filePaths);
    });
    register('pick-input-folder', async () => {
      if (worker) return;
      const result = await dialog.showOpenDialog(win, { title: '导入含 NCM 音乐的文件夹', properties: ['openDirectory'] });
      return result.canceled ? null : addFolder(result.filePaths[0]);
    });
    register('add-files', async paths => {
      if (worker) return;
      const files = [];
      let added = 0;
      for (const target of Array.isArray(paths) ? paths.slice(0, 10000) : []) {
        if (typeof target !== 'string' || !path.isAbsolute(target)) continue;
        try { if ((await fs.lstat(target)).isDirectory()) { added += (await addFolder(target)).added || 0; } else files.push(target); } catch { /* addFiles reports unreadable files. */ files.push(target); }
      }
      const result = await addFiles(files);
      return added ? { message: `已添加 ${added + (result.added || 0)} 个文件` } : result;
    });
    register('pick-output-folder', async () => {
      if (worker) return;
      const result = await dialog.showOpenDialog(win, { title: '设置 MP3 输出文件夹', defaultPath: settings.outputDir, properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled) {
        settings.outputDir = result.filePaths[0];
        await saveSettings();
        send({ type: 'state', ...snapshot() });
      }
    });
    register('remove', id => { if (!worker) items.delete(id); send({ type: 'state', ...snapshot() }); });
    register('clear', () => { if (!worker) items.clear(); send({ type: 'state', ...snapshot() }); });
    register('start', startBatch);
    register('cancel', () => worker?.postMessage('cancel'));
    register('open-output', async () => { await fs.mkdir(settings.outputDir, { recursive: true }); const error = await shell.openPath(settings.outputDir); if (error) throw new Error(error); });
    register('window', action => { if (action === 'minimize') win.minimize(); if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); if (action === 'close') win.close(); });
    if (testMode) global.shiyinTest = { addFiles, addFolder, items, configure: outputDir => { settings.outputDir = outputDir; send({ type: 'state', ...snapshot() }); } };
    createWindow();
  });
}
app.on('window-all-closed', () => app.quit());
