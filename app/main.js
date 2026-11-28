// OverBoard PDF: open a PDF, write on it with the overlay's toolbar, keep the ink, export an annotated PDF.
// Everything runs in this browser tab. Nothing is uploaded.

import { confirmTap, flashBtn, historyKey } from '../shared/ink-core.js';
import { stripExt } from './image.js';
import { loadPdfjs, pdfWorker, warmPdfjs } from './libs.js';
import { addPage, newNotebook, removePage, shiftInk, shiftTurns } from './notebook.js';
import { setupOffline } from './offline.js';
import * as store from './store.js';
import { finder, initCore, ink, isOnScreen, setStatus, typing, viewer } from './core.js';
import {
  clearMenu,
  closeMenus,
  fileMenu,
  fitToolbar,
  initMenus,
  layoutClear,
  pageMenu,
  showFileMenu,
} from './menus.js';
import { initOpen, inPdfStep, openFile, reopen, showError, toStart } from './open.js';
import { fitSpace, initPageView, jump, toggleToc, turnPages, zoomBy } from './page-view.js';
import { baseBlob, initSaving, markDirty, onLinkButton, OPEN_KEY, writeNow } from './saving.js';
import { initSettings, settings, timer, translateAll } from './settings.js';
import { initStartScreen, renderRecent } from './start-screen.js';
import {
  $,
  addPageEl,
  bar,
  D,
  doc,
  findPanel,
  pageInput,
  pagesTotal,
  PDF_OPTS,
  picker,
  setInkData,
  setLS,
  showBtn,
  T,
  toc,
  tr,
} from './state.js';
import {
  initPeriods,
  initTools,
  pickColor,
  refresh,
  renderPeriods,
  selectOff,
  STEPPERS,
  tapColor,
  toolColor,
  typeOff,
  typeOn,
} from './tools.js';

function initToolbar() {
  bar.addEventListener('click', onToolbarClick);
  showBtn.addEventListener('click', () => {
    bar.style.display = '';
    showBtn.classList.remove('show');
    fitToolbar();
    if (viewer.fit && doc) {
      fitSpace();
      viewer.layout();
    }
  });
  $('[data-act="toc-close"]', toc).addEventListener('click', () => {
    toc.hidden = true;
  });
  $('[data-act="find-close"]', findPanel).addEventListener('click', () => finder.close());
  document.addEventListener('keydown', (e) => {
    const t = document.activeElement,
      inBox = t && /^(INPUT|TEXTAREA)$/.test(t.tagName);
    const h = historyKey(e); // Ctrl/⌘+Z undo; Ctrl/⌘+Y, Ctrl/⌘+R or Ctrl/⌘+Shift+Z redo; keyboard reload is off
    if (h && (h === 'block' || !inBox)) {
      e.preventDefault();
      if (h !== 'block' && doc) historyStep(h);
    } // text boxes keep their own undo
    // Select: Ctrl/⌘+C, Ctrl/⌘+V, Delete, Escape (text boxes keep their own)
    else if (T.selecting && doc && !inBox && !e.defaultPrevented && ink.sel.key(e)) e.preventDefault();
    // the browser's own find only sees pages near the screen; ours searches the whole PDF
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && doc) {
      openFind();
      e.preventDefault();
    }
    if (e.key === 'Escape' && !findPanel.hidden) finder.close();
  });
}
export function onToolbarClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (/^(type|erase|hilite|select)$/.test(b.dataset.act)) T.laser = false; // another tool puts the laser pointer away
  if (b.dataset.color) tapColor(b.dataset.color);
  else if (b.dataset.period !== undefined) {
    if (ink.switchTo(b.dataset.period)) renderPeriods();
  } else
    switch (b.dataset.act) {
      case 'type':
        if (T.typing) typeOff();
        else typeOn();
        break;
      case 'erase':
        typeOff();
        T.erasing = !T.erasing;
        selectOff();
        break;
      case 'hilite':
        T.hiliting = T.erasing || T.selecting ? true : !T.hiliting;
        T.color = toolColor(); // highlighter (or cover) gets its own color back; turning it off restores your pen color
        typeOff();
        T.erasing = false;
        selectOff();
        break;
      case 'select':
        if (T.selecting) selectOff();
        else {
          typeOff();
          T.selecting = true;
          T.erasing = false;
          setStatus(tr('st_sel_how'));
        }
        break;
      case 'custom':
        if (T.customColor && (T.color !== T.customColor || T.erasing)) pickColor(T.customColor);
        else {
          picker.value = T.customColor || T.color;
          try {
            picker.showPicker ? picker.showPicker() : picker.click();
          } catch (_) {
            picker.click();
          }
        }
        break;
      case 'finger':
        T.fingerScrolls = !T.fingerScrolls;
        setLS('ink-finger', T.fingerScrolls ? 'scroll' : 'draw');
        break;
      case 'thinner':
      case 'thicker':
      case 'rougher':
      case 'smoother':
      case 'zoom-in':
      case 'zoom-out':
        if (e.detail === 0) {
          // keyboard only; taps are handled on pointerdown
          if (STEPPERS[b.dataset.act]) STEPPERS[b.dataset.act][0](STEPPERS[b.dataset.act][1]);
          else zoomBy(b.dataset.act === 'zoom-in' ? 1.1 : 1 / 1.1);
        }
        break;
      case 'zoom-fit':
        viewer.setZoom('fit');
        break;
      case 'undo':
      case 'redo':
        historyStep(b.dataset.act);
        break;
      case 'clear':
        clearMenu.show(clearMenu.el.hidden);
        return;
      case 'pages':
        pageMenu.show(pageMenu.el.hidden);
        return; // only shown beside Chapters: this page or all pages
      case 'clear-page': {
        const n = viewer.currentPage();
        if (!ink.pageList(n).length) setStatus(tr('st_page_no_ink', { n, p: D.active }));
        else {
          ink.clearPage(n);
          setStatus(tr('st_page_cleared', { n }));
        }
        break;
      }
      case 'clear-all':
        if (!ink.count()) {
          setStatus(tr('st_no_ink_clear', { p: D.active }));
          break;
        }
        confirmTap(
          b,
          () => {
            ink.clearAll();
            setStatus(tr(doc.pages > 1 ? 'st_all_cleared' : 'st_cleared', { p: D.active }));
            clearMenu.show(false);
          },
          tr('sure')
        );
        return;
      case 'toc':
        toggleToc();
        break;
      case 'find':
        openFind();
        break;
      case 'prev':
        jump(-1);
        break;
      case 'next':
        jump(1);
        break;
      case 'export':
        exportPdf(b);
        break;
      case 'turn-page':
      case 'turn-all':
        turnPages(b.dataset.act === 'turn-all');
        break;
      case 'ink-save':
        saveInkFile(b);
        break;
      case 'pdf-link':
        onLinkButton(b);
        return;
      case 'ink-load':
        $('#ob-inkfile').click();
        break;
      case 'close':
        toStart();
        break;
      case 'settings':
        settings.show(true);
        break;
      case 'timer':
        closeMenus();
        timer.open();
        break;
      case 'report':
        window.open('report/?from=app&lang=' + tr.lang, '_blank');
        break; // "Board not working?" page (app/report/), in OverBoard's language
      case 'side':
        bar.classList.toggle('right');
        toc.classList.toggle('left', bar.classList.contains('right'));
        findPanel.classList.toggle('left', bar.classList.contains('right'));
        layoutClear(); // Clear ▸ moves to the side its menu opens on
        break;
      case 'file':
        showFileMenu(fileMenu.hidden);
        return;
      case 'hide':
        closeMenus();
        bar.style.display = 'none';
        showBtn.classList.toggle('right', bar.classList.contains('right'));
        showBtn.classList.add('show');
        if (viewer.fit) {
          fitSpace();
          viewer.layout();
        }
        break;
    }
  refresh();
}
function openFind() {
  if (!doc) return;
  toc.hidden = true;
  findPanel.classList.toggle('left', bar.classList.contains('right'));
  finder.open();
}
function historyStep(act) {
  // Undo or Redo, then show the page it changed
  typing.close();
  const n = act === 'redo' ? ink.redo() : ink.undo();
  if (n && !isOnScreen(n)) viewer.goTo(n);
}
const redoBtn = $('[data-act="redo"]', bar);
export function refreshRedo() {
  redoBtn.disabled = !ink.canRedo();
}
/* ---------- blank notebooks (app/notebook.js) ---------- */
// Start screen: a new one-page notebook. Under the last page: add a page at the end. Pages ▸: add one after
// the page you are on, or remove that page. Every change makes a new PDF and keeps the ink on its own page.
function notebookName() {
  const d = new Date();
  const when =
    d.toLocaleDateString(tr.lang, { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(tr.lang, { hour: 'numeric', minute: '2-digit' });
  return (tr('notebook') + ' ' + when).replace(/[\\/:*?"<>|]+/g, '.').replace(/\s+/g, ' ') + '.pdf';
}
async function startBlank(paper, btns) {
  btns.forEach((b) => {
    b.disabled = true;
  });
  try {
    const name = notebookName();
    const bytes = await newNotebook(paper, name.replace(/\.pdf$/, ''));
    await openFile(new File([bytes], name, { type: 'application/pdf' }));
  } catch (e) {
    showError(tr('err_could_not_open', { f: tr('notebook'), e: (e && e.message) || e }));
  } finally {
    btns.forEach((b) => {
      b.disabled = false;
    });
  }
}
const blankBtns = [...document.querySelectorAll('#ob-blank [data-paper]')];

function initNotebook() {
  for (const b of blankBtns) b.addEventListener('click', () => startBlank(b.dataset.paper, blankBtns));
  for (const b of addPageEl.querySelectorAll('[data-paper]'))
    b.addEventListener('click', () => {
      if (doc) addPageAfter(b.dataset.paper, doc.pages);
    });
  pageMenu.el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !doc) return;
    if (b.dataset.paper) {
      pageMenu.show(false);
      addPageAfter(b.dataset.paper, viewer.currentPage());
    } else if (b.dataset.act === 'remove-page') {
      if (doc.pages <= 1) {
        setStatus(tr('st_last_page'));
        flashBtn(b, tr('st_last_page'), 'warn');
        return;
      }
      confirmTap(
        b,
        () => {
          pageMenu.show(false);
          removeThisPage();
        },
        tr('sure')
      );
    }
  });
}

let paging = false; // one page change at a time
/* change(bytes) -> new bytes; ink is moved with shiftInk(at, by); then show page `show` */
async function changePages(change, at, by, show, msg) {
  if (!doc || !doc.notebook || paging) return;
  paging = true;
  const d = doc,
    y = window.scrollY;
  try {
    const bytes = await change(new Uint8Array(await baseBlob().arrayBuffer()));
    const lib = await loadPdfjs();
    const pdf = await lib.getDocument({ data: bytes.slice(), worker: pdfWorker(lib), ...PDF_OPTS }).promise;
    if (doc !== d) {
      pdf.destroy();
      return;
    } // closed in the meantime
    const old = d.pdf;
    d.file = new File([bytes], d.name, { type: 'application/pdf' });
    d.base = d.file.size;
    d.info = null;
    d.pdf = pdf;
    d.pages = pdf.numPages;
    shiftInk(D.periods, at, by);
    D.rot = shiftTurns(D.rot, at, by);
    finder.close();
    finder.reset();
    await viewer.open(pdf);
    old.destroy().catch(() => {});
    ink.setData(D);
    refreshRedo(); // Undo starts fresh: its steps point at the old page numbers
    window.scrollTo(0, y);
    pagesTotal.textContent = tr('of_n', { n: d.pages });
    layoutClear();
    fitToolbar();
    store.rememberFile(d.hash, { name: d.name, pages: d.pages }, d.file).catch(() => setStatus(tr('st_too_big_keep')));
    markDirty(); // saves the ink (and the linked PDF file, if Save ink into PDF is on)
    viewer.goTo(show, true);
    pageInput.value = show;
    setStatus(msg);
  } catch (e) {
    console.error(e);
    setStatus(tr('st_could_not_pages', { e: (e && e.message) || e }));
  } finally {
    paging = false;
  }
}
function addPageAfter(paper, after) {
  changePages((bytes) => addPage(bytes, paper, after), after + 1, 1, after + 1, tr('st_page_added', { n: after + 1 }));
}
function removeThisPage() {
  if (doc.pages <= 1) {
    setStatus(tr('st_last_page'));
    return;
  }
  const n = viewer.currentPage();
  changePages((bytes) => removePage(bytes, n), n, -1, Math.min(n, doc.pages - 1), tr('st_page_removed', { n }));
}

/* ---------- export annotated PDF ---------- */
const baseName = () => stripExt(doc.name);
// only the active period is exported, so the name says which: Moby_Dick_annotated_P1.pdf
const exportName = () => (baseName() + '_annotated_' + D.active).replace(/\s+/g, '_') + '.pdf';
const coverWarn = $('#ob-coverwarn');
function ask(dialog) {
  // resolves true for the dialog's "ok" button
  return new Promise((done) => {
    const onClick = (e) => {
      const b = e.target.closest('button');
      if (!b && e.target !== dialog) return;
      dialog.removeEventListener('click', onClick);
      dialog.close();
      done(!!b && b.value === 'ok');
    };
    dialog.addEventListener('click', onClick);
    dialog.addEventListener(
      'cancel',
      () => {
        dialog.removeEventListener('click', onClick);
        done(false);
      },
      { once: true }
    );
    dialog.showModal();
  });
}
async function exportPdf(btn) {
  if (!doc) return;
  let covered = false;
  await writeNow();
  // an empty notebook still exports: printable paper
  // ... and so does a PDF with turned pages: a copy the right way up
  if (!ink.count() && !doc.notebook && !Object.keys(D.rot || {}).length) {
    flashBtn(btn, tr('no_ink_yet'), 'warn');
    setStatus(tr('st_no_ink_export', { p: D.active }));
    return;
  }
  btn.disabled = true;
  setStatus(tr('st_making_pdf'));
  try {
    const { exportAnnotatedPdf, hasCovers } = await import('./export.js');
    // covers hide answers in the PDF too, but the text under them is still in the file: say so plainly
    covered = hasCovers(ink.byPage);
    if (covered && !(await ask(coverWarn))) {
      setStatus(tr('st_export_cancelled', { p: D.active }));
      return;
    }
    const bytes = new Uint8Array(await doc.file.slice(0, doc.base).arrayBuffer()); // without the stored ink
    const out = await exportAnnotatedPdf(bytes, doc.pdf, ink.byPage, D.rot, (n) =>
      setStatus(tr('st_making_pdf_n', { n }))
    );
    store.download(new Blob([out], { type: 'application/pdf' }), exportName());
    setStatus(tr('st_pdf_downloaded', { p: D.active }) + (covered ? tr('st_covered_note') : ''));
    flashBtn(btn, tr('downloaded_flash'), 'good');
  } catch (e) {
    console.error(e);
    setStatus(tr('st_export_failed', { e: (e && e.message) || e }));
    flashBtn(btn, tr('not_saved'), 'warn');
  } finally {
    btn.disabled = false;
  }
}

/* ---------- ink sidecar file (.overboard.json) ---------- */
async function saveInkFile(btn) {
  if (!doc) return;
  await writeNow();
  store.download(new Blob([store.makeSidecar(D, doc)], { type: 'application/json' }), baseName() + '.overboard.json');
  flashBtn(btn, tr('saved_flash'), 'good');
  setStatus(tr('st_ink_file_downloaded'));
}
export async function importInk(file) {
  try {
    const { data, pdf } = store.parseSidecar(await file.text());
    if (
      pdf.sha256 &&
      pdf.sha256 !== doc.hash &&
      !confirm(tr('confirm_other_pdf', { f: pdf.name || tr('another_pdf') }))
    )
      return;
    const has = Object.values(D.periods).some((l) => l.length);
    if (has && !confirm(tr('confirm_replace_ink', { f: file.name }))) return;
    setInkData(data);
    ink.setData(D);
    viewer.applyTurns();
    refreshRedo();
    renderPeriods();
    refresh();
    markDirty();
    await writeNow();
    setStatus(tr('st_ink_loaded_from', { f: file.name }));
  } catch (e) {
    setStatus(e.message || String(e));
  }
}
function initExporting() {
  $('#ob-inkfile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f && doc) importInk(f);
  });
}

initCore();
initOpen();
initSaving();
initStartScreen();
initPageView();
initPeriods();
initSettings();
initTools();
initMenus();
initToolbar();
initNotebook();
initExporting();

/* ---------- start ---------- */
translateAll();
refresh();
renderRecent();
warmPdfjs();
setupOffline(openFile);
(() => {
  // reopen the PDF after a reload; typing or clicking the address shows the start screen
  const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  const how = nav ? nav.type : 'navigate';
  let hash = null;
  if (how === 'reload') {
    try {
      hash = sessionStorage.getItem(OPEN_KEY);
    } catch (e) {
      /* blocked */
    }
  } else if (how === 'back_forward' && inPdfStep()) hash = history.state.obPdf; // Back/Forward to where a PDF was open
  if (!hash && inPdfStep()) history.replaceState(null, '');
  if (hash && !doc) reopen(hash);
})();
