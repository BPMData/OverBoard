// OverBoard PDF: open a PDF, write on it with the overlay's toolbar, keep the ink, export an annotated PDF.
// Everything runs in this browser tab. Nothing is uploaded.

import { fitTools, makePopMenu, historyKey, hlInk, makeHlMenu, holdRepeat, confirmTap, flashBtn } from '../shared/ink-core.js';
import { loadPdfjs, PDFJS_CMAPS_URL, PDFJS_FONTS_URL } from './libs.js';
import { Viewer } from './viewer.js';
import { Ink } from './ink.js';
import { Finder } from './find.js';
import * as store from './store.js';
import { isHtml, boardName, addOverlay, layoutWarnings, localFiles, saveBoardCopy } from './html.js';
import { findBase, readEmbeddedInk, inspectBase, buildUpdate, writeInto } from './embed.js';
import { setupOffline } from './offline.js';

/* ===== SETTINGS (same meaning as in the overlay) ===== */
const PERIODS = ['P1', 'P2', 'P3', 'P4'];
const SAVE_DELAY_MS = 3000;       // after you stop writing, wait this long, then save. Also saves when the tab is hidden or closed.
const PDF_SAVE_DELAY_MS = 8000;   // "Save ink into PDF" (when on) writes the file this long after you stop writing
const FINGER_SCROLLS = true;      // true = finger scrolls, pen writes. The toolbar button flips this (remembered per browser).
const PALM_ERASER_W = 92;         // eraser size (screen px) when you wipe with your palm, fist or side of hand
const ERASER_W = 44;              // eraser size (screen px) with the Eraser button
const SMOOTHING = 3;              // starting level 0-8
const HIGHLIGHT_COLOR = '#fdd835';   // highlighter starts yellow; after that it remembers the last highlighter color you picked
const HIGHLIGHT_W = 22;           // starting highlighter width; the - / + buttons change it while the highlighter is on
const HIGHLIGHT_STRENGTH = 50;    // highlight strength in % (Highlighter ▾ slider, 10-100): 100 = the full color, 50 = halfway to white
const PEN_COLOR = '#e0218a';      // the pen starts Barbie pink (high visibility on the board); the palette changes it
const COVER_COLOR = '#111111';    // Highlighter ▾ Cover: an opaque stroke that hides answers (erase it to reveal them)
/* ===================== */

const $ = (s, el = document) => el.querySelector(s);
const bar = $('#ink-bar'), showBtn = $('#ink-show'), statusEl = $('#ink-status'), periodsEl = $('#ink-periods');
const pagesEl = $('#ob-pages'), pageInput = $('#ob-page'), pagesTotal = $('#ob-pages-total');
const picker = $('#ink-picker'), customFill = $('[data-act="custom"] .fill', bar);
const sizeNum = $('#ink-size .num'), sizeDot = $('#ink-size .dot'), smoothNum = $('#ink-smooth .num');
const toc = $('#ob-toc'), tocBtn = $('[data-act="toc"]', bar), fitBtn = $('[data-act="zoom-fit"]', bar);

function getLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function setLS(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');

/* ---------- tool state (read by the ink layer) ---------- */
const T = {
  mode: 'write', erasing: false, hiliting: false, covering: false,   // covering: the highlighter is in Cover mode
  penColor: PEN_COLOR, hlColor: HIGHLIGHT_COLOR, coverColor: COVER_COLOR,   // pen, highlighter and cover each remember their own color
  color: PEN_COLOR, width: 2.5, hlWidth: HIGHLIGHT_W, smooth: SMOOTHING, fingerScrolls: FINGER_SCROLLS,
  customColor: '', PALM_ERASER_W, ERASER_W,
  hlStrength: HIGHLIGHT_STRENGTH,
  hlInk() { return hlInk(this.color, this.hlStrength); },   // mixed toward white; it multiplies, so text stays black
};
{
  const sw = parseFloat(getLS('ink-width')); if (sw >= 1 && sw <= 14) T.width = sw;
  const hw = parseFloat(getLS('ink-hl-width')); if (hw >= 8 && hw <= 40) T.hlWidth = hw;
  const hc = getLS('ink-hl-color'); if (isHex(hc)) T.hlColor = hc;
  const cc = getLS('ink-custom'); if (isHex(cc)) T.customColor = cc;
  T.covering = getLS('ink-hl-mode') === 'cover';
  const hs = parseInt(getLS('ink-hl-strength'), 10); if (hs >= 10 && hs <= 100) T.hlStrength = hs;
  const kc = getLS('ink-cover-color'); if (isHex(kc)) T.coverColor = kc;
  const sl = getLS('ink-smooth'); if (sl !== null && +sl >= 0 && +sl <= 8) T.smooth = +sl;
  const fm = getLS('ink-finger'); if (fm) T.fingerScrolls = fm === 'scroll';
}

/* ---------- the open document ---------- */
let doc = null;       // { hash, name, pages, file, pdf }
let D = null;         // ink data: { v: 3, t, active, at, periods: { P1: [strokes] } }
let saveTimer = null, dirty = false;

const viewer = new Viewer(pagesEl, {
  show: (P) => ink.show(P), hide: (P) => ink.hide(P), resize: (P) => ink.resize(P), textReady: (P) => finder.showHit(P),
});
const findPanel = $('#ob-find'), finder = new Finder(viewer, findPanel, setStatus);
const ink = new Ink(viewer, T, () => { refreshRedo(); markDirty(); });
ink.attach(pagesEl);
window.__overboard = { viewer, ink, get doc() { return doc; }, get data() { return D; }, flush: () => writeNow() };   // for tests and the curious

function setStatus(t) { statusEl.textContent = t; }
function fresh() { const p = {}; PERIODS.forEach((n) => { p[n] = []; }); return { v: 3, t: 0, active: PERIODS[0], at: 1, periods: p }; }
function validData(o) {
  if (!o || !o.periods || typeof o.periods !== 'object' || !Object.keys(o.periods).length) return null;
  if (!o.periods[o.active]) o.active = Object.keys(o.periods)[0];
  return o;
}

/* ---------- saving (IndexedDB, keyed by the PDF's SHA-256) ---------- */
function markDirty() {
  if (!doc) return;
  D.t = Date.now(); dirty = true;
  setStatus(D.active + ' · saving…');
  clearTimeout(saveTimer); saveTimer = setTimeout(writeNow, SAVE_DELAY_MS);
  if (doc.link && doc.linkOn) { pdfDirty = true; clearTimeout(pdfTimer); pdfTimer = setTimeout(writePdf, PDF_SAVE_DELAY_MS); }
}
async function writeNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!doc || !dirty) return;
  dirty = false;
  D.at = viewer.currentPage();
  const hash = doc.hash;
  try { await store.saveInk(hash, D); dropBackup(hash); setStatus(D.active + ' · saved in this browser'); }
  catch (e) { dirty = true; setStatus('Could not save in this browser (' + ((e && e.name) || e) + '). Use Save ink.'); }
}
/* A reload or a closed tab can cut off the IndexedDB write above, losing the last few seconds of ink.
   So on the way out, also keep a copy in localStorage (written at once); opening the PDF again uses
   whichever copy is newer. sessionStorage remembers the open PDF, so a reload reopens it. */
const BACKUP = 'ob-unsaved:', OPEN_KEY = 'ob-open';
function backupNow() { if (doc) { try { localStorage.setItem(BACKUP + doc.hash, JSON.stringify(D)); } catch (e) { /* full or blocked */ } } }
function dropBackup(hash) { try { localStorage.removeItem(BACKUP + hash); } catch (e) { /* blocked */ } }
function readBackup(hash) { try { return validData(JSON.parse(localStorage.getItem(BACKUP + hash))); } catch (e) { return null; } }
function rememberOpen(hash) { try { if (hash) sessionStorage.setItem(OPEN_KEY, hash); else sessionStorage.removeItem(OPEN_KEY); } catch (e) { /* blocked */ } }
window.addEventListener('pagehide', () => { if (doc) { D.at = viewer.currentPage(); backupNow(); dirty = true; writeNow(); writePdf(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && doc) { dirty = true; writeNow(); writePdf(); } });
window.addEventListener('beforeunload', (e) => { if (doc && pdfDirty && doc.linkOn) { writePdf(); e.preventDefault(); } });   // the PDF write takes a moment

/* ---------- "Save ink into PDF" (opt-in): the ink lives inside a PDF file the teacher chose ---------- */
// doc.link = file handle, doc.linkOn = permission granted and saving. See app/embed.js for what is written.
let pdfTimer = null, pdfDirty = false, pdfBusy = null;
const FSA = typeof window.showSaveFilePicker === 'function';
const linkBtn = $('[data-act="pdf-link"]'), dlg = $('#ob-embed');

function refreshLink() {
  if (!doc) return;
  linkBtn.classList.toggle('good', !!doc.linkOn);
  linkBtn.textContent = doc.linkOn ? 'Saving into PDF ✓' : doc.link ? 'Resume saving into PDF' : FSA ? 'Save ink into PDF…' : 'Download PDF + ink…';
  linkBtn.title = doc.linkOn ? 'Ink is saved inside ' + doc.link.name + '. Tap to turn this off.' :
    doc.link ? 'Tap to allow saving into ' + doc.link.name + ' again' : 'Keep the ink inside a PDF file (you choose the file)';
  linkBtn._label = linkBtn.textContent;
}
const baseBlob = () => doc.file.slice(0, doc.base);
async function linkInfo() {
  if (!doc.info) doc.info = await inspectBase(new Uint8Array(await baseBlob().arrayBuffer()));
  return doc.info;
}
async function writePdf() {
  clearTimeout(pdfTimer); pdfTimer = null;
  if (!doc || !doc.link || !doc.linkOn || !pdfDirty) return pdfBusy;
  if (pdfBusy) { await pdfBusy; return writePdf(); }
  const d = doc;
  pdfDirty = false;
  pdfBusy = (async () => {
    try {
      const update = await buildUpdate(await linkInfo(), d.base, store.makeSidecar(D, d));
      await writeInto(d.link, baseBlob(), update);
      d.file = await d.link.getFile();   // same original bytes + the new ink; keeps working even if it was the file we opened
      if (doc === d) setStatus(D.active + ' · saved into ' + d.link.name + ' ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    } catch (e) {
      pdfDirty = true;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) { d.linkOn = false; refreshLink(); setStatus('Tap Resume saving into PDF to allow it again'); }
      else setStatus('Could not save into the PDF: ' + ((e && e.message) || e));
    } finally { pdfBusy = null; }
  })();
  return pdfBusy;
}
async function startLink(handle) {
  try {
    doc.link = handle; doc.linkOn = true; pdfDirty = true;
    refreshLink(); setStatus('Saving ink into ' + handle.name + '…');
    await writePdf();
    if (!doc.linkOn) return;
    await store.setLink(doc.hash, handle).catch(() => {});
    flashBtn(linkBtn, 'Saved!', 'good');
    setStatus('Ink saves into ' + handle.name + ' from now on');
  } catch (e) { setStatus('Could not save into the PDF: ' + ((e && e.message) || e)); }
}
async function stopLink() {
  await writePdf();
  const name = doc.link && doc.link.name;
  doc.link = null; doc.linkOn = false; doc.info = null;
  await store.forgetLink(doc.hash).catch(() => {});
  refreshLink();
  setStatus('Stopped saving into ' + name + ' (its ink stays in it). Ink still saves in this browser.');
}
async function downloadWithInk() {   // browsers without file access: a one-time copy
  try {
    const update = await buildUpdate(await linkInfo(), doc.base, store.makeSidecar(D, doc));
    store.download(new Blob([baseBlob(), update], { type: 'application/pdf' }), boardPdfName());
    setStatus('Downloaded ' + boardPdfName() + ' with the ink inside');
  } catch (e) { setStatus('Could not make the PDF: ' + ((e && e.message) || e)); }
}
const boardPdfName = () => doc.name.replace(/\.pdf$/i, '').replace(/_board$/, '') + '_board.pdf';
function onLinkButton(b) {
  if (doc.linkOn) { confirmTap(b, stopLink); return; }
  if (doc.link) {   // reconnect: the browser asks again after a restart
    doc.link.requestPermission({ mode: 'readwrite' }).then((p) => {
      if (p === 'granted') startLink(doc.link); else setStatus('Not allowed. Ink still saves in this browser.');
    }).catch(() => setStatus('Could not reconnect to ' + doc.link.name));
    return;
  }
  $('.name', dlg).textContent = boardPdfName();
  dlg.classList.toggle('nofsa', !FSA);
  $('[value="ok"]', dlg).textContent = FSA ? 'Choose file…' : 'Download it';
  dlg.showModal();
}
dlg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) { if (e.target === dlg) dlg.close(); return; }
  dlg.close();
  if (b.value !== 'ok' || !doc) return;
  if (!FSA) { downloadWithInk(); return; }
  // the save window must open straight from the tap
  window.showSaveFilePicker({ suggestedName: boardPdfName(), ...(doc.origin ? { startIn: doc.origin } : { id: 'overboard-pdf' }), types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] })
    .then((h) => startLink(h))
    .catch((err) => { if (!err || err.name !== 'AbortError') setStatus('Could not open the save window: ' + ((err && err.message) || err)); });
});
async function reconnectLink() {   // a file chosen on an earlier visit
  if (!FSA || !doc) return;
  const d = doc, h = await store.getLink(d.hash).catch(() => null);
  if (!h || doc !== d) return;
  d.link = h;
  try { d.linkOn = (await h.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { d.linkOn = false; }
  refreshLink();
  if (!d.linkOn) setStatus(D.active + ' · tap Resume saving into PDF to keep saving into ' + h.name);
}

/* ---------- opening a PDF ---------- */
const errorEl = $('#ob-error');
function showError(msg) { errorEl.textContent = msg; errorEl.hidden = !msg; }

const msgEl = $('#ob-msg');
function showMsg(msg) { msgEl.textContent = msg; msgEl.hidden = !msg; }

/* an .html worksheet: make a board copy with the overlay, like the installer */
async function makeBoardCopy(file, handlePromise) {
  showError(''); showMsg('');
  try {
    const { status, html, message } = await addOverlay(await file.text());
    const name = boardName(file.name);
    if (status === 'same' && name === file.name) { showMsg(file.name + ' ' + message + '. Just open it in Chrome.'); return; }
    const handle = handlePromise ? await handlePromise.catch(() => null) : null;
    const where = await saveBoardCopy(html, name, handle && handle.kind === 'file' ? handle : undefined);
    if (!where) return;
    const warns = layoutWarnings(html);
    const files = localFiles(html);
    showMsg(file.name + ': ' + message + '; ' + where + '. Double-click it to open it in Chrome and write on it.' +
      (files.length ? ' This worksheet uses files stored separately (like ' + files.slice(0, 2).join(', ') + '). Put ' + name +
        ' in the same folder as ' + file.name + ', or ' + (files.length > 1 ? 'they' : 'it') + ' won\'t show.' : '') +
      (warns.length ? ' Heads-up: ' + warns.join('; ') + ', so ink may not stay on the page.' : ''));
    if (doc) setStatus(name + ' saved');
  } catch (e) {
    showError('Could not add OverBoard to "' + file.name + '": ' + ((e && e.message) || e));
  }
}

async function openFile(file, handlePromise) {
  if (!file) return;
  if (isHtml(file)) { if (doc) await closeDoc(true); return makeBoardCopy(file, handlePromise); }
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { showError('"' + file.name + '" is not a PDF or an HTML worksheet. (Word files: File → Save as PDF first.)'); return; }
  showError(''); showMsg('');
  const drop = $('#ob-drop strong'), label = drop.textContent;
  drop.textContent = 'Opening ' + file.name + '…';
  try {
    if (doc) await closeDoc(false);
    const buf = await file.arrayBuffer();
    const base = findBase(new Uint8Array(buf));   // a PDF OverBoard saved ink into: the original bytes come first
    const hash = await store.hashBytes(new Uint8Array(buf, 0, base));
    const lib = await loadPdfjs();
    const task = lib.getDocument({ data: new Uint8Array(buf), cMapUrl: PDFJS_CMAPS_URL, cMapPacked: true, standardFontDataUrl: PDFJS_FONTS_URL, isEvalSupported: false });
    task.onPassword = (give, reason) => {
      const pw = prompt(reason === 2 ? 'Wrong password. Try again:' : 'This PDF has a password:');
      if (pw === null) task.destroy(); else give(pw);
    };
    const pdf = await task.promise;
    let saved = validData(await store.loadInk(hash).catch(() => null));
    const backup = readBackup(hash);   // ink from a reload that cut off the last save
    const fromBackup = !!backup && (!saved || (backup.t || 0) > (saved.t || 0));
    if (fromBackup) saved = backup;
    let inPdf = null;   // ink stored inside the PDF itself; the newest copy wins, a tie goes to the file
    try { const txt = await readEmbeddedInk(pdf); if (txt) inPdf = store.parseSidecar(txt).data; } catch (e) { /* not ours */ }
    const fromPdf = inPdf && (!saved || (inPdf.t || 0) >= (saved.t || 0));
    D = fromPdf ? inPdf : saved || fresh();
    doc = { hash, base, name: file.name, pages: pdf.numPages, file, pdf, link: null, linkOn: false, info: null };
    store.rememberFile(hash, { name: file.name, pages: pdf.numPages }, file).catch(() => setStatus('PDF too big to keep for reopening; ink still saves.'));
    store.askPersistent();
    document.body.classList.remove('start');
    bar.hidden = false;
    layoutClear(); fitToolbar();
    document.title = file.name.replace(/\.pdf$/i, '') + ' · OverBoard';
    pagesTotal.textContent = 'of ' + pdf.numPages;
    fitSpace();
    await viewer.open(pdf);
    ink.setData(D); refreshRedo();
    renderPeriods(); refresh(); fitToolbar();
    if (D.at > 1) viewer.goTo(D.at); else window.scrollTo(0, 0);
    setStatus(D.active + ' · ' + (fromPdf ? 'ink loaded from inside the PDF' : saved ? 'ink restored from this browser' : 'ready'));
    if (fromPdf || fromBackup) store.saveInk(hash, D).then(() => dropBackup(hash), () => {});   // keep this browser's copy current too
    rememberOpen(hash);
    if (handlePromise) handlePromise.then((h) => { if (h && h.kind === 'file' && doc && doc.hash === hash) doc.origin = h; }, () => {});   // its folder, for save windows
    refreshLink(); reconnectLink();
    loadOutline(pdf);
  } catch (e) {
    console.error(e);
    doc = null; D = null;
    document.body.classList.add('start'); bar.hidden = true;
    showError(e && e.name === 'PasswordException' ? 'That PDF is locked with a password.' :
      e && /fetch|import|module/i.test(String(e.message)) ? 'Could not load the PDF reader. Check the internet connection and reload the page.' :
      'Could not open "' + file.name + '": ' + ((e && e.message) || e));
  } finally { drop.textContent = label; }
}

async function closeDoc(showStart = true) {
  if (!doc) return;
  rememberOpen(null);   // first, so a reload while this finishes doesn't reopen it
  dirty = true; await writeNow(); await writePdf();
  viewer.close();
  try { await doc.pdf.destroy(); } catch (e) { /* already gone */ }
  doc = null; D = null;
  toc.hidden = true; outline = []; hasChapters = false;
  finder.close(); finder.reset();
  if (showStart) {
    document.body.classList.add('start'); bar.hidden = true; showBtn.classList.remove('show');
    document.title = 'OverBoard PDF';
    renderRecent();
  }
}

$('#ob-file').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
const dropZone = $('#ob-drop');
dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseFile(); } });
/* Chrome/Edge: choose with showOpenFilePicker, which gives a handle to the file, so save windows can start in
   its folder (Save ink into PDF, an HTML board copy). Other browsers use the plain file input. */
function chooseFile() {
  if (!window.showOpenFilePicker) { $('#ob-file').click(); return; }
  window.showOpenFilePicker({ id: 'overboard-open', types: [{ description: 'PDF or HTML worksheet', accept: { 'application/pdf': ['.pdf'], 'text/html': ['.html', '.htm'] } }] })
    .then(async ([h]) => openFile(await h.getFile(), Promise.resolve(h)))
    .catch((err) => { if (!err || err.name !== 'AbortError') $('#ob-file').click(); });
}
dropZone.addEventListener('click', (e) => { if (window.showOpenFilePicker && e.target !== $('#ob-file')) { e.preventDefault(); chooseFile(); } });

// drop a PDF (or an .overboard.json ink file) anywhere
const cover = $('#ob-dropcover');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; cover.hidden = false; dropZone.classList.add('over'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; cover.hidden = true; dropZone.classList.remove('over'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; cover.hidden = true; dropZone.classList.remove('over');
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (!f) return;
  // Chrome/Edge: a handle to the dropped file lets the board copy be saved next to it (must be asked for during the drop)
  const item = e.dataTransfer.items && e.dataTransfer.items[0];
  const handle = item && item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null;
  if (/\.json$/i.test(f.name)) { if (doc) importInk(f); else showError('Open the PDF first, then drop its ink file.'); }
  else openFile(f, handle);
});

/* ---------- recent files ---------- */
async function renderRecent() {
  const sec = $('#ob-recent'), ul = $('ul', sec);
  let list = [];
  try { list = await store.listFiles(); } catch (e) { /* storage blocked */ }
  ul.textContent = '';
  sec.hidden = !list.length;
  for (const r of list) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'open';
    const b = document.createElement('b'); b.textContent = r.name;
    const sm = document.createElement('small');
    sm.textContent = r.pages + (r.pages === 1 ? ' page' : ' pages') + ' · opened ' + new Date(r.opened).toLocaleDateString([], { month: 'short', day: 'numeric' });
    open.append(b, sm);
    open.addEventListener('click', async () => {
      const rec = await store.getFile(r.hash).catch(() => null);
      if (!rec || !rec.blob) { showError('That PDF is no longer stored here. Drop it in again; its ink is still saved.'); renderRecent(); return; }
      openFile(new File([rec.blob], rec.name, { type: 'application/pdf' }));
    });
    const forget = document.createElement('button');
    forget.className = 'forget'; forget.textContent = '×';
    forget.title = forget.ariaLabel = 'Remove from this list (its ink stays saved)';
    forget.addEventListener('click', async () => { await store.forgetFile(r.hash).catch(() => {}); renderRecent(); });
    li.append(open, forget);
    ul.appendChild(li);
  }
}

/* ---------- the Clear buttons ----------
   A PDF with chapters: Chapters | Clear ▸ (a menu: this page or all pages), with Clear on the side the menu
   opens. Without chapters: Clear page | Clear all, like the HTML overlay. One page: just Clear. */
let hasChapters = false;
function layoutClear() {
  const many = !!doc && doc.pages > 1, menu = hasChapters && many;
  const menuBtn = $('[data-act="clear"]', bar), pageBtn = $('[data-act="clear-page"]', bar), allBtn = $('[data-act="clear-all"]', bar);
  tocBtn.hidden = !hasChapters;
  menuBtn.hidden = !menu;
  pageBtn.hidden = menu || !many;
  allBtn.hidden = menu;
  allBtn.classList.toggle('wide', !hasChapters && !many);
  if (!allBtn.classList.contains('warn')) allBtn.textContent = many ? 'Clear all' : 'Clear';
  if (bar.classList.contains('right')) tocBtn.before(menuBtn); else tocBtn.after(menuBtn);
  if (!menu) clearMenu.show(false);
}
/* the toolbar and its popouts shrink to fit a short window, such as a laptop screen */
const fitToolbar = () => fitTools(bar, [fileMenu, clearMenu.el, hlMenu.el], 1);

/* ---------- chapters (PDF outline) ---------- */
let outline = [];   // flat [{ button, page }] for marking the current chapter
async function loadOutline(pdf) {
  const ul = $('ul', toc);
  ul.textContent = ''; outline = [];
  let items = null;
  try { items = await pdf.getOutline(); } catch (e) { /* no outline */ }
  if (doc.pdf !== pdf) return;
  hasChapters = !!(items && items.length);
  layoutClear(); fitToolbar();
  if (!hasChapters) return;
  const build = (list, parent) => {
    for (const it of list) {
      const li = document.createElement('li'), b = document.createElement('button');
      const t = document.createElement('span'); t.textContent = it.title || '(untitled)';
      const n = document.createElement('small');
      b.append(t, n);
      const entry = { button: b, page: null, dest: it.dest, num: n };
      outline.push(entry);
      b.addEventListener('click', async () => {
        const p = entry.page || await viewer.resolveDest(it.dest);
        if (p) { viewer.goTo(p); if (window.innerWidth < 900) toc.hidden = true; }
      });
      li.appendChild(b);
      if (it.items && it.items.length) { const sub = document.createElement('ul'); build(it.items, sub); li.appendChild(sub); }
      parent.appendChild(li);
    }
  };
  build(items, ul);
  for (const entry of outline) {   // page numbers fill in shortly after
    if (doc?.pdf !== pdf) return;
    entry.page = await viewer.resolveDest(entry.dest);
    if (entry.page) entry.num.textContent = entry.page;
  }
  markChapter();
}
function markChapter() {
  if (toc.hidden || !outline.length) return;
  const n = viewer.currentPage();
  let here = null;
  for (const e of outline) if (e.page && e.page <= n && (!here || e.page >= here.page)) here = e;
  for (const e of outline) e.button.classList.toggle('here', e === here);
}
function toggleToc() {
  toc.hidden = !toc.hidden;
  if (!toc.hidden && !findPanel.hidden) finder.close();
  toc.classList.toggle('left', bar.classList.contains('right'));
  if (!toc.hidden) { markChapter(); const h = $('.here', toc); if (h) h.scrollIntoView({ block: 'center' }); }
}

/* ---------- page number box ---------- */
let scrollRaf = 0;
window.addEventListener('scroll', () => {
  if (scrollRaf || !doc) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (document.activeElement !== pageInput) pageInput.value = viewer.currentPage();
    markChapter();
  });
}, { passive: true });
function goToTyped() {
  const n = parseInt(pageInput.value, 10);
  if (n >= 1 && doc) viewer.goTo(Math.min(n, doc.pages));
  pageInput.value = viewer.currentPage();
}
pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { goToTyped(); pageInput.blur(); } });
pageInput.addEventListener('change', goToTyped);
pageInput.addEventListener('focus', () => pageInput.select());

function jump(dir) {
  if (!doc) return;
  const n = viewer.currentPage(), P = viewer.pages[n - 1];
  const top = P.el.getBoundingClientRect().top;
  if (dir < 0 && top < -60) viewer.goTo(n, true);   // well into this page: back to its top first
  else viewer.goTo(n + dir, true);
}

/* ---------- zoom ---------- */
const ZOOM_100 = 96 / 72;   // CSS px per point at 100%
function fitSpace() { viewer.sideSpace = bar.style.display === 'none' || bar.hidden ? 16 : bar.getBoundingClientRect().width + 20; }
function zoomBy(f) { viewer.setZoom(viewer.zoom * f); refreshZoom(); }
function refreshZoom() { fitBtn.textContent = viewer.fit ? 'Fit' : Math.round(viewer.zoom / ZOOM_100 * 100) + '%'; }
window.addEventListener('wheel', (e) => {   // trackpad pinch / ctrl+wheel zooms the pages, not the toolbar
  if (!doc || !e.ctrlKey) return;
  e.preventDefault();
  zoomBy(Math.exp(-e.deltaY * 0.01));
}, { passive: false });
let resizeRaf = 0;
window.addEventListener('resize', () => {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; if (doc) { fitToolbar(); fitSpace(); viewer.layout(); refreshZoom(); } });
});

/* ---------- class periods ---------- */
function renderPeriods() {
  periodsEl.textContent = '';
  for (const n of Object.keys(D.periods)) {
    const b = document.createElement('button');
    b.className = 'sm' + (n === D.active ? ' on' : '');
    b.dataset.period = n; b.textContent = n; b.title = n;
    periodsEl.appendChild(b);
  }
}

/* ---------- toolbar ---------- */
const isPreset = (c) => !!bar.querySelector('[data-color="' + c + '"]');
function refresh() {
  for (const b of bar.querySelectorAll('[data-color]')) b.classList.toggle('on', !T.erasing && b.dataset.color === T.color);
  $('[data-act="custom"]', bar).classList.toggle('on', !T.erasing && !!T.customColor && T.color === T.customColor && !isPreset(T.color));
  customFill.style.background = T.customColor || 'transparent';
  const w = T.hiliting ? T.hlWidth : T.width, shown = T.hiliting && !T.covering ? T.hlInk() : T.color;
  sizeNum.textContent = w; sizeDot.style.width = sizeDot.style.height = Math.min(w, 26) + 'px'; sizeDot.style.background = shown;
  smoothNum.textContent = T.smooth ? T.smooth : 'Off';
  $('[data-act="erase"]', bar).classList.toggle('on', T.erasing);
  const hb = $('[data-act="hilite"]', bar);
  hb.classList.toggle('on', T.hiliting && !T.erasing);
  hb.classList.toggle('cover', T.covering);
  hb.textContent = T.covering ? 'Cover' : 'Highlighter';   // the ▾ choice shows on the button
  hlMenu.sync();
  $('[data-act="finger"]', bar).textContent = 'Finger: ' + (T.fingerScrolls ? 'scrolls' : 'draws');
  refreshZoom();
}
function setMode(m) {
  T.mode = m;
  pagesEl.classList.toggle('scroll-mode', m === 'scroll');
  $('[data-act="write"]', bar).classList.toggle('on', m === 'write');
  $('[data-act="scroll"]', bar).classList.toggle('on', m === 'scroll');
}
function toolColor() { return T.hiliting ? (T.covering ? T.coverColor : T.hlColor) : T.penColor; }
function pickColor(c) {
  T.color = c;
  if (T.hiliting && T.covering) { T.coverColor = c; setLS('ink-cover-color', c); }
  else if (T.hiliting) { T.hlColor = c; setLS('ink-hl-color', c); } else T.penColor = c;
  T.erasing = false; setMode('write'); refresh();
}
/* - / + : size controls the highlighter width while it's on */
function stepSize(dir) {
  if (T.hiliting) {
    const hv = Math.min(40, Math.max(8, T.hlWidth + dir * 2));
    if (hv === T.hlWidth && !T.erasing) return false;
    T.hlWidth = hv; setLS('ink-hl-width', hv);
  } else {
    const w = Math.min(14, Math.max(1, T.width + dir * 0.5));
    if (w === T.width && !T.erasing) return false;
    T.width = w; setLS('ink-width', w);
  }
  T.erasing = false; setMode('write'); refresh();
  return true;
}
function stepSmooth(dir) {
  const s = Math.min(8, Math.max(0, T.smooth + dir));
  if (s === T.smooth) return false;
  T.smooth = s; refresh(); setLS('ink-smooth', s);
  return true;
}
const STEPPERS = { thinner: [stepSize, -1], thicker: [stepSize, 1], rougher: [stepSmooth, -1], smoother: [stepSmooth, 1] };
for (const [act, [step, dir]] of Object.entries(STEPPERS)) holdRepeat($('[data-act="' + act + '"]', bar), () => step(dir));
holdRepeat($('[data-act="zoom-in"]', bar), () => { if (viewer.zoom >= 6) return false; zoomBy(1.1); return true; });
holdRepeat($('[data-act="zoom-out"]', bar), () => { if (viewer.zoom <= 0.2) return false; zoomBy(1 / 1.1); return true; });

picker.addEventListener('input', () => { T.customColor = picker.value; setLS('ink-custom', T.customColor); pickColor(T.customColor); });
/* Popout menus beside the toolbar. They open on a tap and stay open until a choice is tapped, a tap lands
   anywhere else, or Escape. Lifting the pen or finger never closes them. */
const fileMenu = $('#ob-filemenu'), clearMenu = makePopMenu($('#ob-clearmenu'), $('[data-act="clear"]', bar), bar, () => closeMenus('clear'));
const file = makePopMenu(fileMenu, $('[data-act="file"]', bar), bar, () => closeMenus('file'));
const placeFileMenu = file.place, showFileMenu = file.show;
function closeMenus(except) {   // only one popout at a time
  if (except !== 'file') file.show(false);
  if (except !== 'clear') clearMenu.show(false);
  if (except !== 'hl') hlMenu.show(false);
}
// Highlighter ▾: Highlight (with strength) or Cover. Shared with the overlay (shared/ink-core.js).
// A choice, or moving the slider, turns the highlighter on in that mode.
const hlMenu = makeHlMenu(bar, T, () => {
  setLS('ink-hl-mode', T.covering ? 'cover' : 'hl');
  setLS('ink-hl-strength', T.hlStrength);
  if (T.covering) setLS('ink-cover-color', T.coverColor);
  T.hiliting = true; T.erasing = false; T.color = toolColor(); setMode('write'); refresh();
}, () => closeMenus('hl'));
for (const m of [fileMenu, clearMenu.el]) m.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  onToolbarClick(e);
  // keep it open while a two-tap confirm ("Sure?") is waiting, or after moving the toolbar
  if (!b.classList.contains('warn') && b.dataset.act !== 'side') closeMenus();
  else if (b.dataset.act === 'side') placeFileMenu();
});

bar.addEventListener('click', onToolbarClick);
function onToolbarClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.color) pickColor(b.dataset.color);
  else if (b.dataset.period !== undefined) { if (ink.switchTo(b.dataset.period)) renderPeriods(); }
  else switch (b.dataset.act) {
    case 'write': setMode('write'); break;
    case 'scroll': setMode('scroll'); break;
    case 'erase': T.erasing = !T.erasing; setMode('write'); break;
    case 'hilite':
      T.hiliting = T.erasing ? true : !T.hiliting;
      T.color = toolColor();   // highlighter (or cover) gets its own color back; turning it off restores your pen color
      T.erasing = false; setMode('write'); break;
    case 'custom':
      if (T.customColor && (T.color !== T.customColor || T.erasing)) pickColor(T.customColor);
      else { picker.value = T.customColor || T.color; try { picker.showPicker ? picker.showPicker() : picker.click(); } catch (_) { picker.click(); } }
      break;
    case 'finger': T.fingerScrolls = !T.fingerScrolls; setLS('ink-finger', T.fingerScrolls ? 'scroll' : 'draw'); break;
    case 'thinner': case 'thicker': case 'rougher': case 'smoother': case 'zoom-in': case 'zoom-out':
      if (e.detail === 0) {   // keyboard only; taps are handled on pointerdown
        if (STEPPERS[b.dataset.act]) STEPPERS[b.dataset.act][0](STEPPERS[b.dataset.act][1]);
        else zoomBy(b.dataset.act === 'zoom-in' ? 1.1 : 1 / 1.1);
      }
      break;
    case 'zoom-fit': viewer.setZoom('fit'); break;
    case 'undo': case 'redo': historyStep(b.dataset.act); break;
    case 'clear': clearMenu.show(clearMenu.el.hidden); return;   // only shown beside Chapters: this page or all pages
    case 'clear-page': {
      const n = viewer.currentPage();
      if (!ink.pageList(n).length) setStatus('Page ' + n + ' has no ink in ' + D.active);
      else { ink.clearPage(n); setStatus('Page ' + n + ' cleared · Undo brings it back'); }
      break;
    }
    case 'clear-all':
      if (!ink.count()) { setStatus(D.active + ' has no ink to clear'); break; }
      confirmTap(b, () => { ink.clearAll(); setStatus((doc.pages > 1 ? 'All pages cleared in ' : 'Cleared ') + D.active + ' · Undo brings it back'); clearMenu.show(false); });
      return;
    case 'toc': toggleToc(); break;
    case 'find': openFind(); break;
    case 'prev': jump(-1); break;
    case 'next': jump(1); break;
    case 'export': exportPdf(b); break;
    case 'ink-save': saveInkFile(b); break;
    case 'pdf-link': onLinkButton(b); return;
    case 'ink-load': $('#ob-inkfile').click(); break;
    case 'close': closeDoc(true); break;
    case 'side':
      bar.classList.toggle('right');
      toc.classList.toggle('left', bar.classList.contains('right'));
      findPanel.classList.toggle('left', bar.classList.contains('right'));
      layoutClear();   // Clear ▸ moves to the side its menu opens on
      break;
    case 'file': showFileMenu(fileMenu.hidden); return;
    case 'hide':
      closeMenus();
      bar.style.display = 'none';
      showBtn.classList.toggle('right', bar.classList.contains('right')); showBtn.classList.add('show');
      if (viewer.fit) { fitSpace(); viewer.layout(); }
      break;
  }
  refresh();
}
showBtn.addEventListener('click', () => {
  bar.style.display = ''; showBtn.classList.remove('show'); fitToolbar();
  if (viewer.fit && doc) { fitSpace(); viewer.layout(); }
});
$('[data-act="toc-close"]', toc).addEventListener('click', () => { toc.hidden = true; });
$('[data-act="find-close"]', findPanel).addEventListener('click', () => finder.close());
function openFind() {
  if (!doc) return;
  toc.hidden = true;
  findPanel.classList.toggle('left', bar.classList.contains('right'));
  finder.open();
}
document.addEventListener('keydown', (e) => {
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  const h = historyKey(e);   // Ctrl/⌘+Z undo; Ctrl/⌘+Y, Ctrl/⌘+R or Ctrl/⌘+Shift+Z redo; keyboard reload is off
  if (h && (h === 'block' || !typing)) { e.preventDefault(); if (h !== 'block' && doc) historyStep(h); }   // text boxes keep their own undo
  // the browser's own find only sees pages near the screen; ours searches the whole PDF
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && doc) { openFind(); e.preventDefault(); }
  if (e.key === 'Escape' && !findPanel.hidden) finder.close();
});
function historyStep(act) {   // Undo or Redo, then show the page it changed
  const n = act === 'redo' ? ink.redo() : ink.undo();
  if (n && !isOnScreen(n)) viewer.goTo(n);
}
const redoBtn = $('[data-act="redo"]', bar);
function refreshRedo() { redoBtn.disabled = !ink.canRedo(); }
function isOnScreen(n) {
  const r = viewer.pages[n - 1].el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
}

/* ---------- export annotated PDF ---------- */
const baseName = () => doc.name.replace(/\.pdf$/i, '');
// only the active period is exported, so the name says which: Moby_Dick_annotated_P1.pdf
const exportName = () => (baseName() + '_annotated_' + D.active).replace(/\s+/g, '_') + '.pdf';
const coverWarn = $('#ob-coverwarn');
function ask(dialog) {   // resolves true for the dialog's "ok" button
  return new Promise((done) => {
    const onClick = (e) => {
      const b = e.target.closest('button');
      if (!b && e.target !== dialog) return;
      dialog.removeEventListener('click', onClick);
      dialog.close();
      done(!!b && b.value === 'ok');
    };
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('cancel', () => { dialog.removeEventListener('click', onClick); done(false); }, { once: true });
    dialog.showModal();
  });
}
async function exportPdf(btn) {
  if (!doc) return;
  let covered = false;
  await writeNow();
  if (!ink.count()) { flashBtn(btn, 'No ink yet', 'warn'); setStatus(D.active + ' has no ink to export'); return; }
  btn.disabled = true;
  setStatus('Making the PDF…');
  try {
    const { exportAnnotatedPdf, hasCovers } = await import('./export.js');
    // covers hide answers in the PDF too, but the text under them is still in the file: say so plainly
    covered = hasCovers(ink.byPage);
    if (covered && !(await ask(coverWarn))) { setStatus(D.active + ' · export cancelled'); return; }
    const bytes = new Uint8Array(await doc.file.slice(0, doc.base).arrayBuffer());   // without the stored ink
    const out = await exportAnnotatedPdf(bytes, doc.pdf, ink.byPage, (n) => setStatus('Making the PDF… ' + n + ' pages'));
    store.download(new Blob([out], { type: 'application/pdf' }), exportName());
    setStatus(D.active + ' · PDF downloaded' + (covered ? '. Covered answers are hidden but can still be copied from it.' : ''));
    flashBtn(btn, 'Downloaded!', 'good');
  } catch (e) {
    console.error(e);
    setStatus('Export failed: ' + ((e && e.message) || e));
    flashBtn(btn, 'Not saved!', 'warn');
  } finally { btn.disabled = false; }
}

/* ---------- ink sidecar file (.overboard.json) ---------- */
async function saveInkFile(btn) {
  if (!doc) return;
  await writeNow();
  store.download(new Blob([store.makeSidecar(D, doc)], { type: 'application/json' }), baseName() + '.overboard.json');
  flashBtn(btn, 'Saved!', 'good');
  setStatus('Ink file downloaded (all periods)');
}
async function importInk(file) {
  try {
    const { data, pdf } = store.parseSidecar(await file.text());
    if (pdf.sha256 && pdf.sha256 !== doc.hash &&
        !confirm('This ink file was made for "' + (pdf.name || 'another PDF') + '", not this one. Load it anyway?')) return;
    const has = Object.values(D.periods).some((l) => l.length);
    if (has && !confirm('Replace the ink on this PDF (all class periods) with the ink from "' + file.name + '"?')) return;
    D = data;
    ink.setData(D); refreshRedo(); renderPeriods(); refresh();
    markDirty(); await writeNow();
    setStatus('Ink loaded from ' + file.name);
  } catch (e) { setStatus(e.message || String(e)); }
}
$('#ob-inkfile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f && doc) importInk(f); });

/* ---------- start ---------- */
refresh(); setMode('write'); renderRecent();
setupOffline(openFile);
(async () => {   // reopen the PDF that was open before a reload
  let hash = null;
  try { hash = sessionStorage.getItem(OPEN_KEY); } catch (e) { /* blocked */ }
  const rec = hash && await store.getFile(hash).catch(() => null);
  if (rec && rec.blob && !doc) openFile(new File([rec.blob], rec.name, { type: 'application/pdf' }));
})();
