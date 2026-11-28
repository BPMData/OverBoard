// Keeping the ink: the browser's copy (IndexedDB, plus a localStorage backup on the way out) and "Save ink into PDF".

import { confirmTap, flashBtn, loadPeriods } from '../shared/ink-core.js';
import { buildUpdate, inspectBase, writeInto } from './embed.js';
import { stripExt } from './image.js';
import * as store from './store.js';
import { setStatus, viewer } from './core.js';
import { $, D, doc, PDF_SAVE_DELAY_MS, PERIODS, SAVE_DELAY_MS, tr } from './state.js';

let saveTimer = null,
  dirty = false;
export function setDirty(v) {
  dirty = v;
}

export function fresh() {
  const names = loadPeriods(PERIODS),
    p = {};
  names.forEach((n) => {
    p[n] = [];
  });
  return { v: 3, t: 0, active: names[0], at: 1, periods: p };
}
export function validData(o) {
  if (!o || !o.periods || typeof o.periods !== 'object' || !Object.keys(o.periods).length) return null;
  if (!o.periods[o.active]) o.active = Object.keys(o.periods)[0];
  return o;
}

/* ---------- saving (IndexedDB, keyed by the PDF's SHA-256) ---------- */
export function markDirty() {
  if (!doc) return;
  D.t = Date.now();
  dirty = true;
  setStatus(tr('st_saving', { p: D.active }));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, SAVE_DELAY_MS);
  if (doc.link && doc.linkOn) {
    pdfDirty = true;
    clearTimeout(pdfTimer);
    pdfTimer = setTimeout(writePdf, PDF_SAVE_DELAY_MS);
  }
}
export async function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!doc || !dirty) return;
  dirty = false;
  D.at = viewer.currentPage();
  const hash = doc.hash;
  try {
    await store.saveInk(hash, D);
    dropBackup(hash);
    setStatus(tr('st_saved_this_browser', { p: D.active }));
  } catch (e) {
    dirty = true;
    setStatus(tr('st_could_not_save_browser', { e: (e && e.name) || e }));
  }
}
/* A reload or a closed tab can cut off the IndexedDB write above, losing the last few seconds of ink.
   So on the way out, also keep a copy in localStorage (written at once); opening the PDF again uses
   whichever copy is newer. sessionStorage remembers the open PDF, so a reload reopens it. */
export const BACKUP = 'ob-unsaved:',
  OPEN_KEY = 'ob-open';
function backupNow() {
  if (doc) {
    try {
      localStorage.setItem(BACKUP + doc.hash, JSON.stringify(D));
    } catch (e) {
      /* full or blocked */
    }
  }
}
export function dropBackup(hash) {
  try {
    localStorage.removeItem(BACKUP + hash);
  } catch (e) {
    /* blocked */
  }
}
export function readBackup(hash) {
  try {
    return validData(JSON.parse(localStorage.getItem(BACKUP + hash)));
  } catch (e) {
    return null;
  }
}
export function rememberOpen(hash) {
  try {
    if (hash) sessionStorage.setItem(OPEN_KEY, hash);
    else sessionStorage.removeItem(OPEN_KEY);
  } catch (e) {
    /* blocked */
  }
}
/* ---------- "Save ink into PDF" (opt-in): the ink lives inside a PDF file the teacher chose ---------- */
// doc.link = file handle, doc.linkOn = permission granted and saving. See app/embed.js for what is written.
let pdfTimer = null,
  pdfDirty = false,
  pdfBusy = null;
const FSA = typeof window.showSaveFilePicker === 'function';
const linkBtn = $('[data-act="pdf-link"]'),
  dlg = $('#ob-embed');

export function refreshLink() {
  if (!doc) return;
  linkBtn.classList.toggle('good', !!doc.linkOn);
  // a blank notebook has no other PDF to put the ink "into", so until a file is chosen it says Save notebook…
  linkBtn.textContent = tr(
    doc.linkOn
      ? 'saving_into_pdf'
      : doc.link
        ? 'resume_saving'
        : doc.notebook
          ? 'save_notebook'
          : FSA
            ? 'save_into_pdf'
            : 'download_pdf_ink'
  );
  linkBtn.title = doc.linkOn
    ? tr('saving_into_tip', { f: doc.link.name })
    : doc.link
      ? tr('resume_tip', { f: doc.link.name })
      : tr(doc.notebook ? 'save_notebook_tip' : 'save_into_pdf_tip');
  linkBtn._label = linkBtn.textContent;
}
export const baseBlob = () => doc.file.slice(0, doc.base);
async function linkInfo() {
  if (!doc.info) doc.info = await inspectBase(new Uint8Array(await baseBlob().arrayBuffer()));
  return doc.info;
}
export async function writePdf() {
  clearTimeout(pdfTimer);
  pdfTimer = null;
  if (!doc || !doc.link || !doc.linkOn || !pdfDirty) return pdfBusy;
  if (pdfBusy) {
    await pdfBusy;
    return writePdf();
  }
  const d = doc;
  pdfDirty = false;
  pdfBusy = (async () => {
    try {
      const update = await buildUpdate(await linkInfo(), d.base, store.makeSidecar(D, d));
      await writeInto(d.link, baseBlob(), update);
      d.file = await d.link.getFile(); // same original bytes + the new ink; keeps working even if it was the file we opened
      if (doc === d)
        setStatus(
          tr('st_saved_into', {
            p: D.active,
            f: d.link.name,
            t: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          })
        );
    } catch (e) {
      pdfDirty = true;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
        d.linkOn = false;
        refreshLink();
        setStatus(tr('st_tap_resume'));
      } else setStatus(tr('st_could_not_save_pdf', { e: (e && e.message) || e }));
    } finally {
      pdfBusy = null;
    }
  })();
  return pdfBusy;
}
async function startLink(handle) {
  try {
    doc.link = handle;
    doc.linkOn = true;
    pdfDirty = true;
    refreshLink();
    setStatus(tr('st_saving_into', { f: handle.name }));
    await writePdf();
    if (!doc.linkOn) return;
    await store.setLink(doc.hash, handle).catch(() => {});
    flashBtn(linkBtn, tr('saved_flash'), 'good');
    setStatus(tr('st_saves_into_now', { f: handle.name }));
  } catch (e) {
    setStatus(tr('st_could_not_save_pdf', { e: (e && e.message) || e }));
  }
}
async function stopLink() {
  await writePdf();
  const name = doc.link && doc.link.name;
  doc.link = null;
  doc.linkOn = false;
  doc.info = null;
  await store.forgetLink(doc.hash).catch(() => {});
  refreshLink();
  setStatus(tr('st_stopped_saving', { f: name }));
}
async function downloadWithInk() {
  // browsers without file access: a one-time copy
  try {
    const update = await buildUpdate(await linkInfo(), doc.base, store.makeSidecar(D, doc));
    store.download(new Blob([baseBlob(), update], { type: 'application/pdf' }), boardPdfName());
    setStatus(tr('st_downloaded_with_ink', { f: boardPdfName() }));
  } catch (e) {
    setStatus(tr('st_could_not_make_pdf', { e: (e && e.message) || e }));
  }
}
const boardPdfName = () => (doc.notebook ? doc.name : stripExt(doc.name).replace(/_board$/, '') + '_board.pdf'); // a notebook keeps its own name
export function onLinkButton(b) {
  if (doc.linkOn) {
    confirmTap(b, stopLink, tr('sure'));
    return;
  }
  if (doc.link) {
    // reconnect: the browser asks again after a restart
    doc.link
      .requestPermission({ mode: 'readwrite' })
      .then((p) => {
        if (p === 'granted') startLink(doc.link);
        else setStatus(tr('st_not_allowed'));
      })
      .catch(() => setStatus(tr('st_could_not_reconnect', { f: doc.link.name })));
    return;
  }
  for (const n of dlg.querySelectorAll('.name')) n.textContent = boardPdfName();
  dlg.classList.toggle('nofsa', !FSA);
  $('[value="ok"]', dlg).textContent = tr(FSA ? 'choose_file' : 'download_it');
  dlg.showModal();
}
export function initSaving() {
  window.addEventListener('pagehide', () => {
    if (doc) {
      D.at = viewer.currentPage();
      backupNow();
      dirty = true;
      writeNow();
      writePdf();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && doc) {
      dirty = true;
      writeNow();
      writePdf();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (doc && pdfDirty && doc.linkOn) {
      writePdf();
      e.preventDefault();
    }
  }); // the PDF write takes a moment
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) {
      if (e.target === dlg) dlg.close();
      return;
    }
    dlg.close();
    if (b.value !== 'ok' || !doc) return;
    if (!FSA) {
      downloadWithInk();
      return;
    }
    // the save window must open straight from the tap
    window
      .showSaveFilePicker({
        suggestedName: boardPdfName(),
        ...(doc.origin ? { startIn: doc.origin } : { id: 'overboard-pdf' }),
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      })
      .then((h) => startLink(h))
      .catch((err) => {
        if (!err || err.name !== 'AbortError')
          setStatus(tr('st_could_not_open_save', { e: (err && err.message) || err }));
      });
  });
}
export async function reconnectLink() {
  // a file chosen on an earlier visit
  if (!FSA || !doc) return;
  const d = doc,
    h = await store.getLink(d.hash).catch(() => null);
  if (!h || doc !== d) return;
  d.link = h;
  try {
    d.linkOn = (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch (e) {
    d.linkOn = false;
  }
  refreshLink();
  if (!d.linkOn) setStatus(tr('st_tap_resume_keep', { p: D.active, f: h.name }));
}
