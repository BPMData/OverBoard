// Injected into test pages: a stand-in for Chrome's save window and file handles, kept in memory.
window.__files = {};
window.__pickName = null;
function fakeHandle(name) {
  return {
    kind: 'file', name,
    async getFile() { return new File([window.__files[name] || new Blob()], name, { type: 'application/pdf' }); },
    async createWritable() { const parts = []; return { async write(b) { parts.push(b); }, async close() { window.__files[name] = new Blob(parts); window.__writes = (window.__writes || 0) + 1; }, async abort() {} }; },
    async queryPermission() { return window.__perm || 'granted'; },
    async requestPermission() { return 'granted'; },
  };
}
window.showSaveFilePicker = async (o) => { window.__pickOpts = o; return fakeHandle(window.__pickName || o.suggestedName); };
window.__fileBytes = async (name) => Array.from(new Uint8Array(await window.__files[name].arrayBuffer()));
