// OverBoard PDF: open a PDF, write on it with the overlay's toolbar, keep the ink, export an annotated PDF.
// Everything runs in this browser tab. Nothing is uploaded.

import { obLangs, obLang, obT, obTranslate } from '../shared/strings.js';
import { fitTools, makePopMenu, historyKey, hlInk, makeHlMenu, holdRepeat, confirmTap, flashBtn, makePeriodPicker, makeSettings, loadPeriods, startPen, remapPeriods } from '../shared/ink-core.js';
import { loadPdfjs, PDFJS_CMAPS_URL, PDFJS_FONTS_URL } from './libs.js';
import { Viewer } from './viewer.js';
import { Ink } from './ink.js';
import { Finder } from './find.js';
import * as store from './store.js';
import { isHtml, boardName, addOverlay, layoutWarnings, localFiles, saveBoardCopy } from './html.js';
import { findBase, readEmbeddedInk, inspectBase, buildUpdate, writeInto } from './embed.js';
import { setupOffline } from './offline.js';

/* ===== SETTINGS (same meaning as in the overlay) ===== */
const PERIODS = ['P1', 'P2', 'P3', 'P4'];   // until a list is set in File ▸ Settings… (shared with the overlay)
const SAVE_DELAY_MS = 3000;       // after you stop writing, wait this long, then save. Also saves when the tab is hidden or closed.
const PDF_SAVE_DELAY_MS = 8000;   // "Save ink into PDF" (when on) writes the file this long after you stop writing
const FINGER_SCROLLS = true;      // true = finger scrolls, pen writes. The toolbar button flips this (remembered per browser).
const PALM_ERASER_W = 92;         // eraser size (screen px) when you wipe with your palm, fist or side of hand
const ERASER_W = 44;              // eraser size (screen px) with the Eraser button
const SMOOTHING = 3;              // starting level 0-8
const HIGHLIGHT_COLOR = '#fdd835';   // highlighter starts yellow; after that it remembers the last highlighter color you picked
const HIGHLIGHT_W = 22;           // starting highlighter width; the - / + buttons change it while the highlighter is on
const HIGHLIGHT_STRENGTH = 50;    // highlight strength in % (Highlighter ▾ slider, 10-100): 100 = the full color, 50 = halfway to white
let tr = obT(obLang());   // OverBoard's words in the language picked in Settings (shared/strings.js); setLang() swaps it
const PEN_COLOR = '#e0218a';      // the pen starts Barbie pink (high visibility on the board) unless File ▸ Settings… picks another; the palette changes it
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
  T.penColor = T.color = startPen(PEN_COLOR);
}

/* ---------- the open document ---------- */
let doc = null;       // { hash, name, pages, file, pdf }
let D = null;         // ink data: { v: 3, t, active, at, periods: { P1: [strokes] } }
let saveTimer = null, dirty = false;

const viewer = new Viewer(pagesEl, {
  show: (P) => ink.show(P), hide: (P) => ink.hide(P), resize: (P) => ink.resize(P), textReady: (P) => finder.showHit(P),
});
const findPanel = $('#ob-find'), finder = new Finder(viewer, findPanel, setStatus, () => tr);
const ink = new Ink(viewer, T, () => { refreshRedo(); markDirty(); });
ink.attach(pagesEl);
window.__overboard = { viewer, ink, get doc() { return doc; }, get data() { return D; }, flush: () => writeNow() };   // for tests and the curious

function setStatus(msg) {   // a message that takes more (or fewer) lines changes the toolbar's height, so fit it again
  const h = statusEl.offsetHeight; statusEl.textContent = msg;
  if (statusEl.offsetHeight !== h && doc) queueMicrotask(() => fitToolbar());
}
function fresh() { const names = loadPeriods(PERIODS), p = {}; names.forEach((n) => { p[n] = []; }); return { v: 3, t: 0, active: names[0], at: 1, periods: p }; }
function validData(o) {
  if (!o || !o.periods || typeof o.periods !== 'object' || !Object.keys(o.periods).length) return null;
  if (!o.periods[o.active]) o.active = Object.keys(o.periods)[0];
  return o;
}

/* ---------- saving (IndexedDB, keyed by the PDF's SHA-256) ---------- */
function markDirty() {
  if (!doc) return;
  D.t = Date.now(); dirty = true;
  setStatus(tr('st_saving', { p: D.active }));
  clearTimeout(saveTimer); saveTimer = setTimeout(writeNow, SAVE_DELAY_MS);
  if (doc.link && doc.linkOn) { pdfDirty = true; clearTimeout(pdfTimer); pdfTimer = setTimeout(writePdf, PDF_SAVE_DELAY_MS); }
}
async function writeNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!doc || !dirty) return;
  dirty = false;
  D.at = viewer.currentPage();
  const hash = doc.hash;
  try { await store.saveInk(hash, D); dropBackup(hash); setStatus(tr('st_saved_this_browser', { p: D.active })); }
  catch (e) { dirty = true; setStatus(tr('st_could_not_save_browser', { e: (e && e.name) || e })); }
}
/* A reload or a closed tab can cut off the IndexedDB write above, losing the last few seconds of ink.
   So on the way out, also keep a copy in localStorage (written at once); opening the PDF again uses
   whichever copy is newer. sessionStorage remembers the open PDF, so a reload reopens it. */
const BACKUP = 'ob-unsaved:', OPEN_KEY = 'ob-open';
function backupNow() { if (doc) { try { localStorage.setItem(BACKUP + doc.hash, JSON.stringify(D)); } catch (e) { /* full or blocked */ } } }
function dropBackup(hash) { try { localStorage.removeItem(BACKUP + hash); } catch (e) { /* blocked */ } }
function readBackup(hash) { try { return validData(JSON.parse(localStorage.getItem(BACKUP + hash))); } catch (e) { return null; } }
function rememberOpen(hash) { try { if (hash) sessionStorage.setItem(OPEN_KEY, hash); else sessionStorage.removeItem(OPEN_KEY); } catch (e) { /* blocked */ } }
/* The browser's Back button: opening a PDF adds one step to this tab's history (the address doesn't change), so Back
   returns to the start screen and Forward opens the PDF again. Opening another PDF from inside one replaces the step. */
const inPdfStep = () => !!(history.state && history.state.obPdf);
let stepBack = false, leaving = null;   // Open another PDF went back one step and the browser hasn't arrived yet; the PDF being closed
function pdfStep(hash) {
  if (stepBack) return;   // added when the step back lands (popstate)
  if (inPdfStep()) history.replaceState({ obPdf: hash }, '');
  else history.pushState({ obPdf: hash }, '');
}
function toStart() {   // Open another PDF: close now, and take back the step we added, so Back isn't needed twice
  if (inPdfStep()) { stepBack = true; leaving = doc; history.back(); }
  closeDoc(true);
}
window.addEventListener('popstate', (e) => {
  if (stepBack) {   // a PDF picked in the meantime gets its step (not the one still saving on its way out)
    stepBack = false;
    if (doc && doc !== leaving) pdfStep(doc.hash);
    leaving = null;
    return;
  }
  const hash = e.state && e.state.obPdf;
  if (doc && !hash) closeDoc(true);
  else if (hash && (!doc || doc.hash !== hash)) reopen(hash);
});
async function reopen(hash) {   // a PDF kept in the Open again store
  const rec = await store.getFile(hash).catch(() => null);
  if (rec && rec.blob && (!doc || doc.hash !== hash)) openFile(new File([rec.blob], rec.name, { type: 'application/pdf' }));
  else if (!rec && inPdfStep()) history.replaceState(null, '');   // no longer stored: stay on the start screen
}
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
  linkBtn.textContent = tr(doc.linkOn ? 'saving_into_pdf' : doc.link ? 'resume_saving' : FSA ? 'save_into_pdf' : 'download_pdf_ink');
  linkBtn.title = doc.linkOn ? tr('saving_into_tip', { f: doc.link.name }) : doc.link ? tr('resume_tip', { f: doc.link.name }) : tr('save_into_pdf_tip');
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
      if (doc === d) setStatus(tr('st_saved_into', { p: D.active, f: d.link.name, t: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }));
    } catch (e) {
      pdfDirty = true;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) { d.linkOn = false; refreshLink(); setStatus(tr('st_tap_resume')); }
      else setStatus(tr('st_could_not_save_pdf', { e: (e && e.message) || e }));
    } finally { pdfBusy = null; }
  })();
  return pdfBusy;
}
async function startLink(handle) {
  try {
    doc.link = handle; doc.linkOn = true; pdfDirty = true;
    refreshLink(); setStatus(tr('st_saving_into', { f: handle.name }));
    await writePdf();
    if (!doc.linkOn) return;
    await store.setLink(doc.hash, handle).catch(() => {});
    flashBtn(linkBtn, tr('saved_flash'), 'good');
    setStatus(tr('st_saves_into_now', { f: handle.name }));
  } catch (e) { setStatus(tr('st_could_not_save_pdf', { e: (e && e.message) || e })); }
}
async function stopLink() {
  await writePdf();
  const name = doc.link && doc.link.name;
  doc.link = null; doc.linkOn = false; doc.info = null;
  await store.forgetLink(doc.hash).catch(() => {});
  refreshLink();
  setStatus(tr('st_stopped_saving', { f: name }));
}
async function downloadWithInk() {   // browsers without file access: a one-time copy
  try {
    const update = await buildUpdate(await linkInfo(), doc.base, store.makeSidecar(D, doc));
    store.download(new Blob([baseBlob(), update], { type: 'application/pdf' }), boardPdfName());
    setStatus(tr('st_downloaded_with_ink', { f: boardPdfName() }));
  } catch (e) { setStatus(tr('st_could_not_make_pdf', { e: (e && e.message) || e })); }
}
const boardPdfName = () => doc.name.replace(/\.pdf$/i, '').replace(/_board$/, '') + '_board.pdf';
function onLinkButton(b) {
  if (doc.linkOn) { confirmTap(b, stopLink, tr('sure')); return; }
  if (doc.link) {   // reconnect: the browser asks again after a restart
    doc.link.requestPermission({ mode: 'readwrite' }).then((p) => {
      if (p === 'granted') startLink(doc.link); else setStatus(tr('st_not_allowed'));
    }).catch(() => setStatus(tr('st_could_not_reconnect', { f: doc.link.name })));
    return;
  }
  $('.name', dlg).textContent = boardPdfName();
  dlg.classList.toggle('nofsa', !FSA);
  $('[value="ok"]', dlg).textContent = tr(FSA ? 'choose_file' : 'download_it');
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
    .catch((err) => { if (!err || err.name !== 'AbortError') setStatus(tr('st_could_not_open_save', { e: (err && err.message) || err })); });
});
async function reconnectLink() {   // a file chosen on an earlier visit
  if (!FSA || !doc) return;
  const d = doc, h = await store.getLink(d.hash).catch(() => null);
  if (!h || doc !== d) return;
  d.link = h;
  try { d.linkOn = (await h.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { d.linkOn = false; }
  refreshLink();
  if (!d.linkOn) setStatus(tr('st_tap_resume_keep', { p: D.active, f: h.name }));
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
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { showError(tr('err_not_pdf', { f: file.name })); return; }
  showError(''); showMsg('');
  const drop = $('#ob-drop strong'), label = drop.textContent;
  drop.textContent = tr('opening', { f: file.name });
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
    store.rememberFile(hash, { name: file.name, pages: pdf.numPages }, file).catch(() => setStatus(tr('st_too_big_keep')));
    store.askPersistent();
    document.body.classList.remove('start');
    bar.hidden = false;
    layoutClear(); fitToolbar();
    document.title = file.name.replace(/\.pdf$/i, '') + ' · OverBoard';
    pagesTotal.textContent = tr('of_n', { n: pdf.numPages });
    fitSpace();
    await viewer.open(pdf);
    ink.setData(D); refreshRedo();
    renderPeriods(); refresh(); fitToolbar();
    if (D.at > 1) viewer.goTo(D.at); else window.scrollTo(0, 0);
    setStatus(tr(fromPdf ? 'st_loaded_inside_pdf' : saved ? 'st_restored' : 'st_ready', { p: D.active }));
    if (fromPdf || fromBackup) store.saveInk(hash, D).then(() => dropBackup(hash), () => {});   // keep this browser's copy current too
    rememberOpen(hash);
    pdfStep(hash);
    if (handlePromise) handlePromise.then((h) => { if (h && h.kind === 'file' && doc && doc.hash === hash) doc.origin = h; }, () => {});   // its folder, for save windows
    refreshLink(); reconnectLink();
    loadOutline(pdf);
  } catch (e) {
    console.error(e);
    doc = null; D = null;
    document.body.classList.add('start'); bar.hidden = true;
    showError(e && e.name === 'PasswordException' ? tr('err_password') :
      e && /fetch|import|module/i.test(String(e.message)) ? tr('err_pdf_reader') :
      tr('err_could_not_open', { f: file.name, e: (e && e.message) || e }));
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
    if (inPdfStep() && !stepBack) history.replaceState(null, '');
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
  if (/\.json$/i.test(f.name)) { if (doc) importInk(f); else showError(tr('err_open_pdf_first')); }
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
    sm.textContent = tr(r.pages === 1 ? 'n_page' : 'n_pages', { n: r.pages }) + ' · ' + tr('opened_on', { d: new Date(r.opened).toLocaleDateString(tr.lang, { month: 'short', day: 'numeric' }) });
    open.append(b, sm);
    open.addEventListener('click', async () => {
      const rec = await store.getFile(r.hash).catch(() => null);
      if (!rec || !rec.blob) { showError(tr('err_no_longer_stored')); renderRecent(); return; }
      openFile(new File([rec.blob], rec.name, { type: 'application/pdf' }));
    });
    const forget = document.createElement('button');
    forget.className = 'forget'; forget.textContent = '×';
    forget.title = forget.ariaLabel = tr('forget_tip');
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
  if (!allBtn.classList.contains('warn')) allBtn.textContent = tr(many ? 'clear_all' : 'clear');
  if (bar.classList.contains('right')) tocBtn.before(menuBtn); else tocBtn.after(menuBtn);
  if (!menu) clearMenu.show(false);
}
/* the toolbar and its popouts shrink to fit a short window, such as a laptop screen */
const fitToolbar = () => fitTools(bar, [fileMenu, clearMenu.el, hlMenu.el, periodPicker.el], 1);

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
      const t = document.createElement('span'); t.textContent = it.title || tr('untitled');
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
function refreshZoom() { fitBtn.textContent = viewer.fit ? tr('fit') : Math.round(viewer.zoom / ZOOM_100 * 100) + '%'; }
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
// one button per period, or a "P5 ▾" list when they don't fit (shared with the overlay)
const periodPicker = makePeriodPicker(bar, periodsEl, (name) => { if (ink.switchTo(name)) renderPeriods(); refresh(); }, () => closeMenus('periods'), (k, v) => tr(k, v));
function renderPeriods() { periodPicker.render(Object.keys(D.periods), D.active); }

/* ---------- File ▸ Settings… (shared with the overlay) ---------- */
const settings = makeSettings({
  defaults: PERIODS, pen: PEN_COLOR,
  colors: [...bar.querySelectorAll('[data-color]')].map((b) => [b.dataset.color, b.title, b.dataset.ta]),
  langs: obLangs(), setLang, t: () => tr,
  periods: () => (D ? Object.keys(D.periods) : null),
  applyPeriods(names) {
    if (!D) return true;
    const r = remapPeriods(D.periods, D.active, names);
    if (r.same) return true;
    if (r.lost.length && !confirm(tr('confirm_remove_pdf', { list: r.lost.join(', ') }))) return false;
    ink.setPeriods(r.periods, r.active); renderPeriods(); refreshRedo();
    setStatus(tr('st_periods_changed', { p: D.active }));
    return true;
  },
  tools: () => ({ finger: T.fingerScrolls, width: T.width, smooth: T.smooth, hlColor: T.hlColor, hlStrength: T.hlStrength }),
  setPen(c) { T.penColor = c; if (!T.hiliting) T.color = c; T.erasing = false; setMode('write'); refresh(); },
  resetTools() {
    Object.assign(T, { width: 2.5, hlWidth: HIGHLIGHT_W, hlColor: HIGHLIGHT_COLOR, customColor: '', covering: false, hlStrength: HIGHLIGHT_STRENGTH,
      coverColor: COVER_COLOR, smooth: SMOOTHING, fingerScrolls: FINGER_SCROLLS, penColor: PEN_COLOR, erasing: false });
    T.color = toolColor(); refresh();
  },
  onOpen: () => closeMenus(),
});

/* ---------- language (Settings ▸ Language, or the 🌐 list on the start screen; shared/strings.js) ---------- */
const langPick = $('#ob-lang');
for (const [code, name] of obLangs()) langPick.append(new Option(name, code));
langPick.addEventListener('change', () => setLang(langPick.value));
function translateAll() {
  obTranslate(document.body, tr);   // everything marked data-t / data-th / data-tt / data-ta / data-tp
  $('[data-act="clear"]', bar).textContent = tr('clear') + ' ▸';
  langPick.value = tr.lang;
}
function setLang(code) {   // remember the choice and put the new words everywhere at once (no reload)
  try { localStorage.setItem('ob-lang', code); } catch (e) { /* blocked */ }
  tr = obT(code); translateAll(); renderRecent();
  if (!doc) return;
  refresh(); refreshLink(); layoutClear(); renderPeriods(); refreshZoom();
  pagesTotal.textContent = tr('of_n', { n: doc.pages });
  fitToolbar(); setStatus(tr('st_ready', { p: D.active }));
}

/* ---------- toolbar ---------- */
const isPreset = (c) => !!bar.querySelector('[data-color="' + c + '"]');
function refresh() {
  for (const b of bar.querySelectorAll('[data-color]')) b.classList.toggle('on', !T.erasing && b.dataset.color === T.color);
  $('[data-act="custom"]', bar).classList.toggle('on', !T.erasing && !!T.customColor && T.color === T.customColor && !isPreset(T.color));
  customFill.style.background = T.customColor || 'transparent';
  const w = T.hiliting ? T.hlWidth : T.width, shown = T.hiliting && !T.covering ? T.hlInk() : T.color;
  sizeNum.textContent = w; sizeDot.style.width = sizeDot.style.height = Math.min(w, 26) + 'px'; sizeDot.style.background = shown;
  smoothNum.textContent = T.smooth ? T.smooth : tr('off');
  $('[data-act="erase"]', bar).classList.toggle('on', T.erasing);
  const hb = $('[data-act="hilite"]', bar);
  hb.classList.toggle('on', T.hiliting && !T.erasing);
  hb.classList.toggle('cover', T.covering);
  hb.textContent = tr(T.covering ? 'cover' : 'highlighter');   // the ▾ choice shows on the button
  hlMenu.sync();
  $('[data-act="finger"]', bar).textContent = tr(T.fingerScrolls ? 'finger_scrolls' : 'finger_draws');
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
  if (except !== 'periods') periodPicker.show(false);
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
      if (!ink.pageList(n).length) setStatus(tr('st_page_no_ink', { n, p: D.active }));
      else { ink.clearPage(n); setStatus(tr('st_page_cleared', { n })); }
      break;
    }
    case 'clear-all':
      if (!ink.count()) { setStatus(tr('st_no_ink_clear', { p: D.active })); break; }
      confirmTap(b, () => { ink.clearAll(); setStatus(tr(doc.pages > 1 ? 'st_all_cleared' : 'st_cleared', { p: D.active })); clearMenu.show(false); }, tr('sure'));
      return;
    case 'toc': toggleToc(); break;
    case 'find': openFind(); break;
    case 'prev': jump(-1); break;
    case 'next': jump(1); break;
    case 'export': exportPdf(b); break;
    case 'ink-save': saveInkFile(b); break;
    case 'pdf-link': onLinkButton(b); return;
    case 'ink-load': $('#ob-inkfile').click(); break;
    case 'close': toStart(); break;
    case 'settings': settings.show(true); break;
    case 'report': window.open('report/?from=app', '_blank'); break;   // "Board not working?" page (app/report/)
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
  if (!ink.count()) { flashBtn(btn, tr('no_ink_yet'), 'warn'); setStatus(tr('st_no_ink_export', { p: D.active })); return; }
  btn.disabled = true;
  setStatus(tr('st_making_pdf'));
  try {
    const { exportAnnotatedPdf, hasCovers } = await import('./export.js');
    // covers hide answers in the PDF too, but the text under them is still in the file: say so plainly
    covered = hasCovers(ink.byPage);
    if (covered && !(await ask(coverWarn))) { setStatus(tr('st_export_cancelled', { p: D.active })); return; }
    const bytes = new Uint8Array(await doc.file.slice(0, doc.base).arrayBuffer());   // without the stored ink
    const out = await exportAnnotatedPdf(bytes, doc.pdf, ink.byPage, (n) => setStatus(tr('st_making_pdf_n', { n })));
    store.download(new Blob([out], { type: 'application/pdf' }), exportName());
    setStatus(tr('st_pdf_downloaded', { p: D.active }) + (covered ? tr('st_covered_note') : ''));
    flashBtn(btn, tr('downloaded_flash'), 'good');
  } catch (e) {
    console.error(e);
    setStatus(tr('st_export_failed', { e: (e && e.message) || e }));
    flashBtn(btn, tr('not_saved'), 'warn');
  } finally { btn.disabled = false; }
}

/* ---------- ink sidecar file (.overboard.json) ---------- */
async function saveInkFile(btn) {
  if (!doc) return;
  await writeNow();
  store.download(new Blob([store.makeSidecar(D, doc)], { type: 'application/json' }), baseName() + '.overboard.json');
  flashBtn(btn, tr('saved_flash'), 'good');
  setStatus(tr('st_ink_file_downloaded'));
}
async function importInk(file) {
  try {
    const { data, pdf } = store.parseSidecar(await file.text());
    if (pdf.sha256 && pdf.sha256 !== doc.hash &&
        !confirm(tr('confirm_other_pdf', { f: pdf.name || tr('another_pdf') }))) return;
    const has = Object.values(D.periods).some((l) => l.length);
    if (has && !confirm(tr('confirm_replace_ink', { f: file.name }))) return;
    D = data;
    ink.setData(D); refreshRedo(); renderPeriods(); refresh();
    markDirty(); await writeNow();
    setStatus(tr('st_ink_loaded_from', { f: file.name }));
  } catch (e) { setStatus(e.message || String(e)); }
}
$('#ob-inkfile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f && doc) importInk(f); });

/* ---------- start ---------- */
translateAll(); refresh(); setMode('write'); renderRecent();
setupOffline(openFile);
(() => {   // reopen the PDF after a reload; typing or clicking the address shows the start screen
  const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  const how = nav ? nav.type : 'navigate';
  let hash = null;
  if (how === 'reload') { try { hash = sessionStorage.getItem(OPEN_KEY); } catch (e) { /* blocked */ } }
  else if (how === 'back_forward' && inPdfStep()) hash = history.state.obPdf;   // Back/Forward to where a PDF was open
  if (!hash && inPdfStep()) history.replaceState(null, '');
  if (hash && !doc) reopen(hash);
})();
