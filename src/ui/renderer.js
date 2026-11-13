const api = window.shiyin, $ = id => document.getElementById(id);
let state = { items: [], outputDir: '', theme: 'system', running: false }, stopping = false, toastTimer, dragDepth = 0, importing = false;
const rows = new Map();
const icon = name => `<svg><use href="#i-${name}"/></svg>`;
const introCopies = [
  ['YOUR MUSIC, UNLOCKED.', '换个格式，继续喜欢。', '拖入音乐，一键转换为 MP3，直接保存到本地。'],
  ['GOOD MUSIC GOES WITH YOU.', '把好音乐，带到任何地方。', '从 NCM 到 MP3，让喜欢的旋律陪你多走一程。'],
  ['A LITTLE MORE FREEDOM.', '让喜欢的歌，自由一点。', '拖进来，换个格式，再把熟悉的旋律带走。'],
  ['SAME SONG, NEW POSSIBILITIES.', '格式换了，心动照旧。', '把 NCM 变成 MP3，那份喜欢一首也不落下。'],
  ['KEEP THE GOOD PART.', '把旋律留下，把格式放下。', '选好音乐和去处，剩下的交给拾音。'],
  ['MAKE ROOM FOR MUSIC.', '给你的歌，换个小天地。', '一首也好，一整个文件夹也好，拖进来就行。'],
  ['LET YOUR PLAYLIST WANDER.', '今天，让歌单出门逛逛。', '转换为 MP3，让每首喜欢都多几个落脚的地方。'],
  ['A NEW HOME FOR EVERY SONG.', '喜欢的音乐，都有去处。', '把歌拖进来，再为它们选一个舒服的文件夹。'],
  ['PRESS PLAY ON POSSIBILITY.', '下一段旋律，轻装出发。', '熟悉的歌，通用的格式。转换好，就可以带走。'],
  ['KEEP YOUR FAVORITES CLOSE.', '把好听的，留在身边。', '把藏在 NCM 里的旋律，装进随身的 MP3。']
];
// Pick once per window; exclude the previous launch's greeting when storage is available.
let lastIntro = -1;
try { const saved = localStorage.getItem('last-intro'); if (saved !== null) lastIntro = Number(saved); } catch {}
const introIndex = Number.isInteger(lastIntro) && lastIntro >= 0 && lastIntro < introCopies.length
  ? (lastIntro + 1 + Math.floor(Math.random() * (introCopies.length - 1))) % introCopies.length
  : Math.floor(Math.random() * introCopies.length);
try { localStorage.setItem('last-intro', String(introIndex)); } catch {}
['intro-kicker', 'intro-title', 'intro-description'].forEach((id, index) => { $(id).textContent = introCopies[introIndex][index]; });

function toast(text) { if (!text) return; $('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500); }
async function request(promise) { try { const result = await promise; if (result?.error || result?.message) toast(result.error || result.message); return result; } catch (error) { toast(error.message); } }
const size = bytes => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : (bytes / 1024).toFixed(1) + ' KB';
function createRow(item) {
  const row = document.createElement('div'); row.className = 'file-row'; row.dataset.id = item.id;
  row.innerHTML = `<div class="file-info"><div class="file-icon">${icon('music')}</div><div><strong></strong><small></small></div></div><span class="file-size"></span><div class="file-status"></div><div class="row-action"></div>`;
  row.querySelector('strong').textContent = item.name; row.querySelector('strong').title = item.source;
  row.querySelector('.file-size').textContent = size(item.size);
  return row;
}
function renderRows() {
  const present = new Set(state.items.map(item => item.id));
  for (const [id, row] of rows) if (!present.has(id)) { row.remove(); rows.delete(id); }
  for (const item of state.items) {
    let row = rows.get(item.id);
    if (!row) { row = createRow(item); rows.set(item.id, row); $('file-list').append(row); }
    row.querySelector('small').textContent = item.result ? item.result.path : 'NCM → MP3';
    row.querySelector('small').title = item.result?.path || item.source;
    const status = row.querySelector('.file-status');
    if (row.dataset.status !== item.status) {
      row.dataset.status = item.status;
      status.className = 'file-status ' + item.status;
      status.replaceChildren(document.createElement('span'));
      if (item.status === 'working') {
        const bar = document.createElement('div'); bar.className = 'row-progress'; bar.append(document.createElement('span')); status.append(bar);
      }
      const action = row.querySelector('.row-action');
      if (item.status === 'done') action.innerHTML = `<span class="saved-icon">${icon('check')}</span>`;
      else action.innerHTML = `<button class="remove" title="移除文件" aria-label="移除文件">${icon('x')}</button>`;
    }
    status.firstElementChild.textContent = item.status === 'done' ? '已输出 MP3' : item.status === 'error' ? '转换失败' : item.status === 'working' ? `转换中 ${item.progress}%` : '等待转换';
    status.title = item.error || '';
    if (item.status === 'working') status.querySelector('.row-progress span').style.width = item.progress + '%';
    const button = row.querySelector('.remove'); if (button) button.disabled = state.running || importing;
  }
}
function render() {
  const done = state.items.filter(item => item.status === 'done').length;
  const errors = state.items.filter(item => item.status === 'error').length;
  const active = state.items.find(item => item.status === 'working');
  document.body.classList.toggle('is-converting', state.running);
  $('count').textContent = state.items.length;
  $('summary').textContent = state.items.length ? `${done} 首已完成 / 共 ${state.items.length} 首` : '等待添加音乐';
  $('output-path').textContent = state.outputDir; $('output-path').title = state.outputDir;
  $('empty').classList.toggle('hidden', !!state.items.length);
  for (const id of ['add', 'import-folder', 'output-folder', 'clear']) $(id).disabled = state.running || importing;
  $('clear').disabled = state.running || importing || !state.items.length;
  $('convert').disabled = stopping || importing || (!state.running && (!state.items.length || done === state.items.length));
  $('convert').querySelector('use').setAttribute('href', '#i-' + (state.running ? 'x' : 'convert'));
  $('convert').querySelector('span').textContent = stopping ? '正在停止…' : state.running ? '停止转换' : errors ? '重试转换' : '开始转换';
  $('batch-status').textContent = importing ? '正在导入文件夹…' : active ? `正在转换 ${state.items.indexOf(active) + 1} / ${state.items.length}` : state.running ? '正在准备转换…' : done && done === state.items.length ? `转换完成，${done} 首音乐已输出。` : errors ? `${done} 首已输出，${errors} 首转换失败。` : '准备好，随时开始。';
  $('batch-status').title = active?.name || (errors ? '鼠标停在失败状态上可查看原因' : '');
  $('overall-progress').style.width = state.running ? ((done + errors + (active ? active.progress / 100 : 0)) / state.items.length * 100) + '%' : done && done === state.items.length ? '100%' : '0%';
  document.querySelectorAll('[data-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === state.theme)));
  renderRows();
}
api.onUpdate(update => {
  if (update.type === 'state') { state = update; if (!state.running) stopping = false; }
  else if (update.type === 'item') { const i = state.items.findIndex(item => item.id === update.item.id); if (i >= 0) state.items[i] = update.item; }
  render();
});
$('add').onclick = event => { event.stopPropagation(); request(api.pickFiles()); };
$('import-folder').onclick = async event => { event.stopPropagation(); importing = true; render(); await request(api.pickInputFolder()); importing = false; render(); };
$('dropzone').onclick = () => { if (!state.running && !importing) request(api.pickFiles()); };
$('dropzone').onkeydown = event => { if (event.target === $('dropzone') && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); $('dropzone').click(); } };
$('output-folder').onclick = () => request(api.pickOutputFolder());
$('open-output').onclick = () => request(api.openOutput());
$('clear').onclick = () => request(api.clear());
$('convert').onclick = () => { if (state.running) { stopping = true; render(); request(api.cancel()); } else request(api.start()); };
$('file-list').onclick = event => { const button = event.target.closest('button.remove'); if (button) request(api.remove(button.closest('.file-row').dataset.id)); };
document.querySelectorAll('[data-window]').forEach(button => button.onclick = () => api.window(button.dataset.window));
document.querySelectorAll('[data-theme]').forEach(button => button.onclick = () => request(api.setTheme(button.dataset.theme)));
document.addEventListener('dragenter', event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth++; if (!state.running && !importing) document.body.classList.add('dragging'); } });
document.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = state.running || importing ? 'none' : 'copy'; });
document.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('drop', async event => { event.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (!state.running && !importing) { const files = Array.from(event.dataTransfer.files); importing = true; render(); await request(api.addDropped(files)); importing = false; render(); } });
document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 'o') { event.preventDefault(); if (!state.running && !importing) request(api.pickFiles()); } });
api.state().then(result => { if (result.error) toast(result.error); else { state = result; render(); } });
