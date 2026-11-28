// Opening and closing a document: PDFs, pictures, HTML worksheets (board copies), and the browser's Back / Forward steps.

import { findBase, readEmbeddedInk } from './embed.js';
import { addOverlay, boardName, isHtml, layoutWarnings, localFiles, saveBoardCopy } from './html.js';
import { imageToPdf, IMG_RE, isImage, stripExt } from './image.js';
import { dropPdfWorker, loadPdfjs, pdfWorker } from './libs.js';
import { NB_RE } from './notebook.js';
import * as store from './store.js';
import { finder, ink, setStatus, viewer } from './core.js';
import { fitToolbar, layoutClear, pageMenu } from './menus.js';
import { clearChapters, fitSpace, loadOutline } from './page-view.js';
import {
  dropBackup,
  fresh,
  readBackup,
  reconnectLink,
  refreshLink,
  rememberOpen,
  setDirty,
  validData,
  writeNow,
  writePdf,
} from './saving.js';
import { renderRecent } from './start-screen.js';
import { $, addPageEl, bar, D, doc, pagesTotal, PDF_OPTS, setDoc, setInkData, showBtn, toc, tr } from './state.js';
import { refresh, refreshRedo, renderPeriods } from './main.js';

/* The browser's Back button: opening a PDF adds one step to this tab's history (the address doesn't change), so Back
   returns to the start screen and Forward opens the PDF again. Opening another PDF from inside one replaces the step. */
export const inPdfStep = () => !!(history.state && history.state.obPdf);
let stepBack = false,
  leaving = null; // Open another PDF went back one step and the browser hasn't arrived yet; the PDF being closed
function pdfStep(hash) {
  if (stepBack) return; // added when the step back lands (popstate)
  if (inPdfStep()) history.replaceState({ obPdf: hash }, '');
  else history.pushState({ obPdf: hash }, '');
}
export function toStart() {
  // Open another PDF: close now, and take back the step we added, so Back isn't needed twice
  if (inPdfStep()) {
    stepBack = true;
    leaving = doc;
    history.back();
  }
  closeDoc(true);
}
export function initOpen() {
  window.addEventListener('popstate', (e) => {
    if (stepBack) {
      // a PDF picked in the meantime gets its step (not the one still saving on its way out)
      stepBack = false;
      if (doc && doc !== leaving) pdfStep(doc.hash);
      leaving = null;
      return;
    }
    const hash = e.state && e.state.obPdf;
    if (doc && !hash) closeDoc(true);
    else if (hash && (!doc || doc.hash !== hash)) reopen(hash);
  });
}
export async function reopen(hash) {
  // a PDF kept in the Open again store
  const rec = await store.getFile(hash).catch(() => null);
  if (rec && rec.blob && (!doc || doc.hash !== hash))
    openFile(new File([rec.blob], rec.name, { type: 'application/pdf' }));
  else if (!rec && inPdfStep()) history.replaceState(null, ''); // no longer stored: stay on the start screen
}

/* ---------- opening a PDF ---------- */
const errorEl = $('#ob-error');
export function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

const msgEl = $('#ob-msg');
function showMsg(msg) {
  msgEl.textContent = msg;
  msgEl.hidden = !msg;
}

/* an .html worksheet: make a board copy with the overlay, like the installer */
async function makeBoardCopy(file, handlePromise) {
  showError('');
  showMsg('');
  try {
    const { status, html, message } = await addOverlay(await file.text());
    const name = boardName(file.name);
    if (status === 'same' && name === file.name) {
      showMsg(file.name + ' ' + message + '. Just open it in Chrome.');
      return;
    }
    const handle = handlePromise ? await handlePromise.catch(() => null) : null;
    const where = await saveBoardCopy(html, name, handle && handle.kind === 'file' ? handle : undefined);
    if (!where) return;
    const warns = layoutWarnings(html);
    const files = localFiles(html);
    showMsg(
      file.name +
        ': ' +
        message +
        '; ' +
        where +
        '. Double-click it to open it in Chrome and write on it.' +
        (files.length
          ? ' This worksheet uses files stored separately (like ' +
            files.slice(0, 2).join(', ') +
            '). Put ' +
            name +
            ' in the same folder as ' +
            file.name +
            ', or ' +
            (files.length > 1 ? 'they' : 'it') +
            " won't show."
          : '') +
        (warns.length ? ' Heads-up: ' + warns.join('; ') + ', so ink may not stay on the page.' : '')
    );
    if (doc) setStatus(name + ' saved');
  } catch (e) {
    showError('Could not add OverBoard to "' + file.name + '": ' + ((e && e.message) || e));
  }
}

export async function openFile(file, handlePromise) {
  if (!file) return;
  if (isHtml(file)) {
    if (doc) await closeDoc(true);
    return makeBoardCopy(file, handlePromise);
  }
  if (isImage(file)) {
    // a picture: open it as a one-page PDF (app/image.js)
    try {
      file = await imageToPdf(file);
    } catch (e) {
      console.error(e);
      showError(tr('err_could_not_open', { f: file.name, e: (e && e.message) || e }));
      return;
    }
  }
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showError(tr('err_not_pdf', { f: file.name }));
    return;
  }
  showError('');
  showMsg('');
  const drop = $('#ob-drop strong'),
    label = drop.textContent;
  drop.textContent = tr('opening', { f: file.name });
  try {
    if (doc) await closeDoc(false);
    const libP = loadPdfjs(); // usually ready already (warmPdfjs); if not, it loads while the file is read
    const buf = await file.arrayBuffer();
    const base = findBase(new Uint8Array(buf)); // a PDF OverBoard saved ink into: the original bytes come first
    const hashP = store.hashBytes(new Uint8Array(buf, 0, base)); // copies the bytes now, so the PDF can open meanwhile
    const lib = await libP;
    const task = lib.getDocument({ data: new Uint8Array(buf), worker: pdfWorker(lib), ...PDF_OPTS }); // hands the bytes to the reader
    task.onPassword = (give, reason) => {
      const pw = prompt(reason === 2 ? 'Wrong password. Try again:' : 'This PDF has a password:');
      if (pw === null) task.destroy();
      else give(pw);
    };
    hashP.catch(() => {}); // (if the PDF fails first, that's the error to show)
    const pdf = await task.promise;
    let hash = await hashP;
    // a blank notebook OverBoard made: its ink is kept under the notebook's ID, which stays the same as pages are added
    // a picture OverBoard turned into a PDF: its ink is kept under the picture's ID (app/image.js)
    let nb = null,
      im = null;
    try {
      const kw = ((await pdf.getMetadata()).info || {}).Keywords || '';
      nb = NB_RE.exec(kw);
      im = IMG_RE.exec(kw);
    } catch (e) {
      /* no metadata */
    }
    if (nb) hash = 'notebook-' + nb[1];
    else if (im) hash = 'image-' + im[1];
    let saved = validData(await store.loadInk(hash).catch(() => null));
    const backup = readBackup(hash); // ink from a reload that cut off the last save
    const fromBackup = !!backup && (!saved || (backup.t || 0) > (saved.t || 0));
    if (fromBackup) saved = backup;
    let inPdf = null; // ink stored inside the PDF itself; the newest copy wins, a tie goes to the file
    try {
      const txt = await readEmbeddedInk(pdf);
      if (txt) inPdf = store.parseSidecar(txt).data;
    } catch (e) {
      /* not ours */
    }
    const fromPdf = inPdf && (!saved || (inPdf.t || 0) >= (saved.t || 0));
    setInkData(fromPdf ? inPdf : saved || fresh());
    setDoc({
      hash,
      base,
      name: file.name,
      pages: pdf.numPages,
      file,
      pdf,
      link: null,
      linkOn: false,
      info: null,
      notebook: !!nb,
    });
    document.body.classList.toggle('notebook', doc.notebook);
    addPageEl.hidden = !doc.notebook;
    store
      .rememberFile(hash, { name: file.name, pages: pdf.numPages }, file)
      .catch(() => setStatus(tr('st_too_big_keep')));
    store.askPersistent();
    document.body.classList.remove('start');
    bar.hidden = false;
    layoutClear();
    fitToolbar();
    document.title = stripExt(file.name) + ' · OverBoard';
    pagesTotal.textContent = tr('of_n', { n: pdf.numPages });
    fitSpace();
    await viewer.open(pdf);
    ink.setData(D);
    refreshRedo();
    renderPeriods();
    refresh();
    fitToolbar();
    if (D.at > 1) viewer.goTo(D.at);
    else window.scrollTo(0, 0);
    setStatus(tr(fromPdf ? 'st_loaded_inside_pdf' : saved ? 'st_restored' : 'st_ready', { p: D.active }));
    if (fromPdf || fromBackup)
      store.saveInk(hash, D).then(
        () => dropBackup(hash),
        () => {}
      ); // keep this browser's copy current too
    rememberOpen(hash);
    pdfStep(hash);
    if (handlePromise)
      handlePromise.then(
        (h) => {
          if (h && h.kind === 'file' && doc && doc.hash === hash) doc.origin = h;
        },
        () => {}
      ); // its folder, for save windows
    refreshLink();
    reconnectLink();
    loadOutline(pdf);
  } catch (e) {
    console.error(e);
    setDoc(null);
    setInkData(null);
    if (!e || e.name !== 'PasswordException') dropPdfWorker();
    document.body.classList.add('start');
    bar.hidden = true;
    addPageEl.hidden = true;
    showError(
      e && e.name === 'PasswordException'
        ? tr('err_password')
        : e && /fetch|import|module/i.test(String(e.message))
          ? tr('err_pdf_reader')
          : tr('err_could_not_open', { f: file.name, e: (e && e.message) || e })
    );
  } finally {
    drop.textContent = label;
  }
}

async function closeDoc(showStart = true) {
  if (!doc) return;
  rememberOpen(null); // first, so a reload while this finishes doesn't reopen it
  setDirty(true);
  await writeNow();
  await writePdf();
  viewer.close();
  try {
    await doc.pdf.destroy();
  } catch (e) {
    /* already gone */
  }
  setDoc(null);
  setInkData(null);
  toc.hidden = true;
  clearChapters();
  addPageEl.hidden = true;
  pageMenu.show(false);
  document.body.classList.remove('notebook');
  finder.close();
  finder.reset();
  if (showStart) {
    if (inPdfStep() && !stepBack) history.replaceState(null, '');
    document.body.classList.add('start');
    bar.hidden = true;
    showBtn.classList.remove('show');
    document.title = 'OverBoard PDF';
    renderRecent();
  }
}
