// OverBoard PDF: open a PDF, write on it with the overlay's toolbar, keep the ink, export an annotated PDF.
// Everything runs in this browser tab. Nothing is uploaded.

import { tint, holdRepeat, confirmTap, flashBtn } from '../shared/ink-core.js';
import { loadPdfjs, PDFJS_CMAPS_URL, PDFJS_FONTS_URL } from './libs.js';
import { Viewer } from './viewer.js';
import { Ink } from './ink.js';
import * as store from './store.js';

/* ===== SETTINGS (same meaning as in the overlay) ===== */
const PERIODS = ['P1', 'P2', 'P3', 'P4'];
const SAVE_DELAY_MS = 3000;       // after you stop writing, wait this long, then save. Also saves when the tab is hidden or closed.
const FINGER_SCROLLS = true;      // true = finger scrolls, pen writes. The toolbar button flips this (remembered per browser).
const PALM_ERASER_W = 92;         // eraser size (screen px) when you wipe with your palm, fist or side of hand
const ERASER_W = 44;              // eraser size (screen px) with the Eraser button
const SMOOTHING = 3;              // starting level 0-8
const HIGHLIGHT_COLOR = '#fdd835';   // highlighter starts yellow; after that it remembers the last highlighter color you picked
const HIGHLIGHT_W = 22;           // starting highlighter width; the - / + buttons change it while the highlighter is on
const HIGHLIGHT_TINT = 0.5;       // how much white is mixed into the color for highlighting
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
  mode: 'write', erasing: false, hiliting: false,
  penColor: '#111111', hlColor: HIGHLIGHT_COLOR,   // pen and highlighter each remember their own color
  color: '#111111', width: 2.5, hlWidth: HIGHLIGHT_W, smooth: SMOOTHING, fingerScrolls: FINGER_SCROLLS,
  customColor: '', PALM_ERASER_W, ERASER_W,
  hlInk() { return tint(this.color, HIGHLIGHT_TINT); },
};
{
  const sw = parseFloat(getLS('ink-width')); if (sw >= 1 && sw <= 14) T.width = sw;
  const hw = parseFloat(getLS('ink-hl-width')); if (hw >= 8 && hw <= 40) T.hlWidth = hw;
  const hc = getLS('ink-hl-color'); if (isHex(hc)) T.hlColor = hc;
  const cc = getLS('ink-custom'); if (isHex(cc)) T.customColor = cc;
  const sl = getLS('ink-smooth'); if (sl !== null && +sl >= 0 && +sl <= 8) T.smooth = +sl;
  const fm = getLS('ink-finger'); if (fm) T.fingerScrolls = fm === 'scroll';
}

/* ---------- the open document ---------- */
let doc = null;       // { hash, name, pages, file, pdf }
let D = null;         // ink data: { v: 3, t, active, at, periods: { P1: [strokes] } }
let saveTimer = null, dirty = false;

const viewer = new Viewer(pagesEl, {
  show: (P) => ink.show(P), hide: (P) => ink.hide(P), resize: (P) => ink.resize(P),
});
const ink = new Ink(viewer, T, () => markDirty());
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
}
async function writeNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!doc || !dirty) return;
  dirty = false;
  D.at = viewer.currentPage();
  try { await store.saveInk(doc.hash, D); setStatus(D.active + ' · saved in this browser'); }
  catch (e) { dirty = true; setStatus('Could not save in this browser (' + ((e && e.name) || e) + '). Use Save ink.'); }
}
window.addEventListener('pagehide', () => { if (doc) { dirty = true; writeNow(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && doc) { dirty = true; writeNow(); } });

/* ---------- opening a PDF ---------- */
const errorEl = $('#ob-error');
function showError(msg) { errorEl.textContent = msg; errorEl.hidden = !msg; }

async function openFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { showError('"' + file.name + '" is not a PDF. (Word files: File → Save as PDF first.)'); return; }
  showError('');
  const drop = $('#ob-drop strong'), label = drop.textContent;
  drop.textContent = 'Opening ' + file.name + '…';
  try {
    if (doc) await closeDoc(false);
    const buf = await file.arrayBuffer();
    const hash = await store.hashBytes(buf);
    const lib = await loadPdfjs();
    const task = lib.getDocument({ data: new Uint8Array(buf), cMapUrl: PDFJS_CMAPS_URL, cMapPacked: true, standardFontDataUrl: PDFJS_FONTS_URL, isEvalSupported: false });
    task.onPassword = (give, reason) => {
      const pw = prompt(reason === 2 ? 'Wrong password. Try again:' : 'This PDF has a password:');
      if (pw === null) task.destroy(); else give(pw);
    };
    const pdf = await task.promise;
    const saved = validData(await store.loadInk(hash).catch(() => null));
    D = saved || fresh();
    doc = { hash, name: file.name, pages: pdf.numPages, file, pdf };
    store.rememberFile(hash, { name: file.name, pages: pdf.numPages }, file).catch(() => setStatus('PDF too big to keep for reopening; ink still saves.'));
    store.askPersistent();
    document.body.classList.remove('start');
    bar.hidden = false;
    document.title = file.name.replace(/\.pdf$/i, '') + ' · OverBoard';
    pagesTotal.textContent = '/ ' + pdf.numPages;
    fitSpace();
    await viewer.open(pdf);
    ink.setData(D);
    renderPeriods(); refresh();
    if (D.at > 1) viewer.goTo(D.at); else window.scrollTo(0, 0);
    setStatus(D.active + ' · ' + (saved ? 'ink restored from this browser' : 'ready'));
    loadOutline(pdf);
  } catch (e) {
    console.error(e);
    doc = null; D = null;
    document.body.classList.add('start'); bar.hidden = true;
    showError(e && e.name === 'PasswordException' ? 'That PDF is locked with a password.' :
      e && /fetch|import|module/i.test(String(e.message)) ? 'Could not load the PDF reader. Check the internet connection (it loads once from cdn.jsdelivr.net).' :
      'Could not open "' + file.name + '": ' + ((e && e.message) || e));
  } finally { drop.textContent = label; }
}

async function closeDoc(showStart = true) {
  if (!doc) return;
  dirty = true; await writeNow();
  viewer.close();
  try { await doc.pdf.destroy(); } catch (e) { /* already gone */ }
  doc = null; D = null;
  toc.hidden = true; tocBtn.disabled = true; outline = [];
  if (showStart) {
    document.body.classList.add('start'); bar.hidden = true; showBtn.classList.remove('show');
    document.title = 'OverBoard PDF';
    renderRecent();
  }
}

$('#ob-file').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
const dropZone = $('#ob-drop');
dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#ob-file').click(); } });

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
  if (/\.json$/i.test(f.name)) { if (doc) importInk(f); else showError('Open the PDF first, then drop its ink file.'); }
  else openFile(f);
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

/* ---------- chapters (PDF outline) ---------- */
let outline = [];   // flat [{ button, page }] for marking the current chapter
async function loadOutline(pdf) {
  const ul = $('ul', toc);
  ul.textContent = ''; outline = [];
  let items = null;
  try { items = await pdf.getOutline(); } catch (e) { /* no outline */ }
  tocBtn.disabled = !(items && items.length);
  tocBtn.title = tocBtn.disabled ? 'This PDF has no chapter list' : 'Chapters of this PDF';
  if (!items || !items.length || doc.pdf !== pdf) return;
  const build = (list, parent) => {
    for (const it of list) {
      const li = document.createElement('li'), b = document.createElement('button');
      const t = document.createElement('span'); t.textContent = it.title || '(untitled)';
      const n = document.createElement('small');
      b.append(t, n);
      const entry = { button: b, page: null, dest: it.dest, num: n };
      outline.push(entry);
      b.addEventListener('click', async () => {
        const p = entry.page || await resolveDest(pdf, it.dest);
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
    entry.page = await resolveDest(pdf, entry.dest);
    if (entry.page) entry.num.textContent = entry.page;
  }
  markChapter();
}
async function resolveDest(pdf, dest) {
  try {
    if (typeof dest === 'string') dest = await pdf.getDestination(dest);
    if (!Array.isArray(dest)) return null;
    const ref = dest[0];
    if (typeof ref === 'number') return ref + 1;
    return (await pdf.getPageIndex(ref)) + 1;
  } catch (e) { return null; }
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
function fitSpace() { viewer.sideSpace = bar.style.display === 'none' || bar.hidden ? 16 : bar.offsetWidth + 20; }
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
  resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; if (doc) { fitSpace(); viewer.layout(); refreshZoom(); } });
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
  const w = T.hiliting ? T.hlWidth : T.width, shown = T.hiliting ? T.hlInk() : T.color;
  sizeNum.textContent = w; sizeDot.style.width = sizeDot.style.height = Math.min(w, 26) + 'px'; sizeDot.style.background = shown;
  smoothNum.textContent = T.smooth ? T.smooth : 'Off';
  $('[data-act="erase"]', bar).classList.toggle('on', T.erasing);
  $('[data-act="hilite"]', bar).classList.toggle('on', T.hiliting && !T.erasing);
  $('[data-act="finger"]', bar).textContent = 'Finger: ' + (T.fingerScrolls ? 'scrolls' : 'draws');
  refreshZoom();
}
function setMode(m) {
  T.mode = m;
  pagesEl.classList.toggle('scroll-mode', m === 'scroll');
  $('[data-act="write"]', bar).classList.toggle('on', m === 'write');
  $('[data-act="scroll"]', bar).classList.toggle('on', m === 'scroll');
}
function pickColor(c) {
  T.color = c;
  if (T.hiliting) { T.hlColor = c; setLS('ink-hl-color', c); } else T.penColor = c;
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
bar.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.color) pickColor(b.dataset.color);
  else if (b.dataset.period !== undefined) { if (ink.switchTo(b.dataset.period)) renderPeriods(); }
  else switch (b.dataset.act) {
    case 'write': setMode('write'); break;
    case 'scroll': setMode('scroll'); break;
    case 'erase': T.erasing = !T.erasing; setMode('write'); break;
    case 'hilite':
      T.hiliting = T.erasing ? true : !T.hiliting;
      T.color = T.hiliting ? T.hlColor : T.penColor;   // highlighter gets its own color back; turning it off restores your pen color
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
    case 'undo': { const n = ink.undo(); if (n && !isOnScreen(n)) viewer.goTo(n); break; }
    case 'clear': {
      const n = viewer.currentPage();
      if (!ink.pageList(n).length) { setStatus('Page ' + n + ' has no ink in ' + D.active); break; }
      confirmTap(b, () => { ink.clearPage(n); setStatus('Page ' + n + ' cleared · Undo brings it back'); });
      break;
    }
    case 'toc': toggleToc(); break;
    case 'prev': jump(-1); break;
    case 'next': jump(1); break;
    case 'export': exportPdf(b); break;
    case 'ink-save': saveInkFile(b); break;
    case 'ink-load': $('#ob-inkfile').click(); break;
    case 'close': closeDoc(true); break;
    case 'side':
      bar.classList.toggle('right');
      toc.classList.toggle('left', bar.classList.contains('right'));
      break;
    case 'hide':
      bar.style.display = 'none';
      showBtn.classList.toggle('right', bar.classList.contains('right')); showBtn.classList.add('show');
      if (viewer.fit) { fitSpace(); viewer.layout(); }
      break;
  }
  refresh();
});
showBtn.addEventListener('click', () => {
  bar.style.display = ''; showBtn.classList.remove('show');
  if (viewer.fit && doc) { fitSpace(); viewer.layout(); }
});
$('[data-act="toc-close"]', toc).addEventListener('click', () => { toc.hidden = true; });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && doc && document.activeElement !== pageInput) { ink.undo(); e.preventDefault(); }
});
function isOnScreen(n) {
  const r = viewer.pages[n - 1].el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
}

/* ---------- export annotated PDF ---------- */
const baseName = () => doc.name.replace(/\.pdf$/i, '');
// only the active period is exported, so the name says which: Moby_Dick_annotated_P1.pdf
const exportName = () => (baseName() + '_annotated_' + D.active).replace(/\s+/g, '_') + '.pdf';
async function exportPdf(btn) {
  if (!doc) return;
  await writeNow();
  if (!ink.count()) { flashBtn(btn, 'No ink yet', 'warn'); setStatus(D.active + ' has no ink to export'); return; }
  btn.disabled = true;
  setStatus('Making the PDF…');
  try {
    const { exportAnnotatedPdf } = await import('./export.js');
    const bytes = new Uint8Array(await doc.file.arrayBuffer());
    const out = await exportAnnotatedPdf(bytes, doc.pdf, ink.byPage, (n) => setStatus('Making the PDF… ' + n + ' pages'));
    store.download(new Blob([out], { type: 'application/pdf' }), exportName());
    setStatus(D.active + ' · PDF downloaded');
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
    ink.setData(D); renderPeriods(); refresh();
    dirty = true; await writeNow();
    setStatus('Ink loaded from ' + file.name);
  } catch (e) { setStatus(e.message || String(e)); }
}
$('#ob-inkfile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f && doc) importInk(f); });

/* ---------- start ---------- */
refresh(); setMode('write'); renderRecent();
