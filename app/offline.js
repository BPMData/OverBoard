// Offline use and installing. Registers the service worker (sw.js, which keeps a complete copy of the
// app), shows "Install app" on the start screen when Chrome or Edge offer installing, and opens a PDF
// the installed app was launched with (Finder: Open With ▸ OverBoard PDF). Version switches happen in
// index.html's loader, before the app starts.
export function setupOffline(openFile) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('sw.js', import.meta.url).href).catch(() => { /* file:// or blocked */ });
  }

  // index.html keeps the beforeinstallprompt event (it can fire before this module loads)
  const row = document.getElementById('ob-install');
  const show = () => { row.hidden = !window.__obInstall; };
  document.addEventListener('ob-installable', show);
  window.addEventListener('appinstalled', () => { window.__obInstall = null; show(); });
  row.querySelector('button').addEventListener('click', () => {
    const ask = window.__obInstall;
    window.__obInstall = null; show();   // each offer can be used once; Chrome offers again if declined
    if (ask) ask.prompt();
  });
  show();

  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      const handle = params.files && params.files[0];
      if (handle) openFile(await handle.getFile());
    });
  }
}
