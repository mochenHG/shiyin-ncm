// The interface talks directly to the Go application through Wails.
if (!window.shiyin) {
  const call = (name, ...args) => window.go.main.App[name](...args).catch(error => ({ error:error?.message || String(error) }));
  window.shiyin = {
    state:() => call('State'), ready:() => call('Ready'),
    pickFiles:() => call('PickFiles'), pickInputFolder:() => call('PickInputFolder'), pickOutputFolder:() => call('PickOutputFolder'),
    setTheme:theme => call('SetTheme',theme), clear:() => call('Clear'), remove:id => call('Remove',id),
    start:() => call('Start'), cancel:() => call('Cancel'), openOutput:() => call('OpenOutput'), window:action => call('Window',action),
    addDropped:() => Promise.resolve(null),
    onUpdate:callback => window.runtime.EventsOn('update',callback)
  };
  window.runtime.OnFileDrop((_x,_y,paths) => {
    document.body.classList.remove('dragging');
    call('AddFiles',paths).then(result => { if(result?.message || result?.error) window.dispatchEvent(new CustomEvent('shiyin-notice',{detail:result.error || result.message})); });
  },false);
}
