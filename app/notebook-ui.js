// Blank notebooks: the start screen's paper buttons, adding and removing pages (the PDF work is in app/notebook.js).

import { confirmTap, flashBtn } from '../shared/ink-core.js';
import { loadPdfjs, pdfWorker } from './libs.js';
import { addPage, newNotebook, removePage, shiftInk, shiftTurns } from './notebook.js';
import * as store from './store.js';
import { finder, ink, setStatus, viewer } from './core.js';
import { fitToolbar, layoutClear, pageMenu } from './menus.js';
import { openFile, showError } from './open.js';
import { baseBlob, markDirty } from './saving.js';
import { addPageEl, D, doc, pageInput, pagesTotal, PDF_OPTS, tr } from './state.js';
import { refreshRedo } from './toolbar.js';

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

export function initNotebook() {
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
