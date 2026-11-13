const { parentPort, workerData } = require('node:worker_threads');
const { convertFile } = require('./engine');
const controller = new AbortController();
parentPort.on('message', message => { if (message === 'cancel') controller.abort(); });
(async () => {
  for (const item of workerData.items) {
    if (controller.signal.aborted) break;
    parentPort.postMessage({ type: 'working', id: item.id, progress: 0 });
    try {
      const result = await convertFile({
        source: item.source, ...workerData.options, signal: controller.signal,
        onProgress: progress => parentPort.postMessage({ type: 'progress', id: item.id, progress })
      });
      parentPort.postMessage({ type: 'done', id: item.id, result });
    } catch (error) {
      parentPort.postMessage({ type: controller.signal.aborted ? 'cancelled' : 'error', id: item.id, error: error.message });
    }
  }
  parentPort.postMessage({ type: 'finished' });
  parentPort.close();
})();
