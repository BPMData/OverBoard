// The HTML overlay keeps its ink in IndexedDB (v21+). Helpers for tests that open a worksheet with it.

/* open a worksheet and wait until the overlay has read its saved ink (drawing waits for that too) */
async function openOverlay(page, url = './') {
  await page.goto(url);
  await overlayReady(page);
}
const overlayReady = (page) => page.waitForSelector('#ink-bar[data-ready]', { state: 'attached' });

/* save now (as if the tab closed) and return this worksheet's ink as saved in IndexedDB */
const savedInk = (page) => page.evaluate(async () => {
  window.dispatchEvent(new Event('pagehide'));
  const key = Object.keys(localStorage).find((k) => k.startsWith('ink-v2:'));
  for (let i = 0; i < 100 && key && localStorage.getItem(key) !== null; i++) await new Promise((r) => setTimeout(r, 20));   // the backup goes once IndexedDB has the ink
  const db = await new Promise((res, rej) => { const rq = indexedDB.open('ink-data'); rq.onsuccess = () => res(rq.result); rq.onerror = rej; });
  const prefix = 'ink-v2:' + location.pathname + ':';
  const out = await new Promise((res) => {
    const st = db.transaction('ink').objectStore('ink'), rq = st.getAllKeys();
    rq.onsuccess = () => { const k = rq.result.find((k) => k.startsWith(prefix)); if (!k) return res(null); const g = st.get(k); g.onsuccess = () => res(g.result); };
  });
  db.close();
  return out;
});

module.exports = { openOverlay, overlayReady, savedInk };
