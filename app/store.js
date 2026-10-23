// Ink and recent-file storage in IndexedDB, keyed by the SHA-256 of the PDF's bytes.
// Nothing here leaves the browser.

const DB_NAME = 'overboard';
const DB_VERSION = 2;
const MAX_RECENT = 12;          // PDFs kept for one-tap reopening (ink is kept even after a PDF is dropped from this list)

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const rq = indexedDB.open(DB_NAME, DB_VERSION);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains('ink')) d.createObjectStore('ink');     // hash -> ink data
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files'); // hash -> { hash, name, size, pages, opened, blob }
        if (!d.objectStoreNames.contains('links')) d.createObjectStore('links'); // hash -> file handle that "Save ink into PDF" writes to
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
      rq.onblocked = () => reject(new Error('storage is blocked by another tab'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    let out;
    const req = fn(tx.objectStore(store));
    if (req) req.onsuccess = () => { out = req.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('storage failed'));
  }));
}

export async function hashBytes(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const loadInk = (hash) => run('ink', 'readonly', (s) => s.get(hash));
export const saveInk = (hash, data) => run('ink', 'readwrite', (s) => s.put(data, hash));

// Small extras kept in the same place, under keys that are never a PDF's hash (the timer's own sound: 'ob-timer-sound')
export const loadExtra = (key) => run('ink', 'readonly', (s) => s.get(key));
export const saveExtra = (key, val) => run('ink', 'readwrite', (s) => s.put(val, key));
export const dropExtra = (key) => run('ink', 'readwrite', (s) => { s.delete(key); });

export async function rememberFile(hash, info, blob) {
  const rec = { hash, name: info.name, size: blob.size, pages: info.pages, opened: Date.now(), blob };
  await run('files', 'readwrite', (s) => s.put(rec, hash));
  const all = await listFiles();
  for (const old of all.slice(MAX_RECENT)) await forgetFile(old.hash);
}

export async function listFiles() {   // newest first, without the PDF bytes
  const recs = await run('files', 'readonly', (s) => s.getAll());
  return (recs || []).map(({ blob, ...r }) => r).sort((a, b) => b.opened - a.opened);
}

export const getLink = (hash) => run('links', 'readonly', (s) => s.get(hash));
export const setLink = (hash, handle) => run('links', 'readwrite', (s) => s.put(handle, hash));
export const forgetLink = (hash) => run('links', 'readwrite', (s) => s.delete(hash));

export const getFile = (hash) => run('files', 'readonly', (s) => s.get(hash));
export const forgetFile = (hash) => run('files', 'readwrite', (s) => s.delete(hash));

export function askPersistent() {   // ask the browser not to evict our data when the disk is low
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
}

/* ---------- .overboard.json sidecar ---------- */

export function makeSidecar(D, doc) {
  return JSON.stringify({
    app: 'OverBoard', kind: 'pdf-ink', v: 3,
    pdf: { sha256: doc.hash, name: doc.name, pages: doc.pages },
    t: D.t, active: D.active, periods: D.periods,
  });
}

/* returns { data, pdf } or throws with a message a teacher can read */
export function parseSidecar(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error('That is not an OverBoard ink file.'); }
  if (!o || o.kind !== 'pdf-ink' || !o.periods || typeof o.periods !== 'object') throw new Error('That is not an OverBoard ink file for a PDF.');
  const periods = {};
  for (const [name, list] of Object.entries(o.periods)) {
    if (!Array.isArray(list)) continue;
    periods[name] = list.filter((s) => s && Array.isArray(s.p) && s.p.length >= 2 && s.page >= 1);
  }
  if (!Object.keys(periods).length) throw new Error('That ink file has no class periods in it.');
  const active = periods[o.active] ? o.active : Object.keys(periods)[0];
  return { data: { v: 3, t: o.t || Date.now(), active, periods }, pdf: o.pdf || {} };
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
