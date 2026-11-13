const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('shiyin', {
  state: invoke('state'), pickFiles: invoke('pick-files'), pickInputFolder: invoke('pick-input-folder'), pickOutputFolder: invoke('pick-output-folder'),
  remove: invoke('remove'), clear: invoke('clear'), start: invoke('start'), cancel: invoke('cancel'), openOutput: invoke('open-output'), window: invoke('window'),
  setTheme: invoke('set-theme'),
  addDropped: files => ipcRenderer.invoke('add-files', Array.from(files, file => webUtils.getPathForFile(file))),
  onUpdate: callback => { const handler = (_event, data) => callback(data); ipcRenderer.on('update', handler); return () => ipcRenderer.removeListener('update', handler); }
});
