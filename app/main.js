// OverBoard PDF: open a PDF, write on it with the overlay's toolbar, keep the ink, export an annotated PDF.
// Everything runs in this browser tab. Nothing is uploaded.

import { obLangs, obT, obTranslate } from '../shared/strings.js';
import {
  confirmTap,
  flashBtn,
  historyKey,
  holdRepeat,
  makePeriodPicker,
  makeSettings,
  makeTimer,
  paletteColors,
  remapPeriods,
  setPalette,
  showLaser,
} from '../shared/ink-core.js';
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
  hlMenu,
  initMenus,
  layoutClear,
  pageMenu,
  showFileMenu,
} from './menus.js';
import { initOpen, inPdfStep, openFile, reopen, showError, toStart } from './open.js';
import { fitSpace, initPageView, jump, refreshZoom, toggleToc, turnPages, zoomBy } from './page-view.js';
import { baseBlob, initSaving, markDirty, onLinkButton, OPEN_KEY, refreshLink, writeNow } from './saving.js';
import { initStartScreen, renderRecent } from './start-screen.js';
import {
  $,
  addPageEl,
  bar,
  COVER_COLOR,
  customFill,
  D,
  doc,
  findPanel,
  FINGER_SCROLLS,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_STRENGTH,
  HIGHLIGHT_W,
  pageInput,
  pagesBtn,
  pagesEl,
  pagesTotal,
  PDF_OPTS,
  PEN_COLOR,
  PERIODS,
  periodsEl,
  picker,
  setInkData,
  setLS,
  setTr,
  showBtn,
  sizeDot,
  sizeNum,
  SMOOTHING,
  smoothNum,
  T,
  toc,
  tr,
} from './state.js';

/* ---------- class periods ---------- */
// one button per period, or a "P5 ▾" list when they don't fit (shared with the overlay)
export let periodPicker;
function initPeriods() {
  periodPicker = makePeriodPicker(
    bar,
    periodsEl,
    (name) => {
      if (ink.switchTo(name)) renderPeriods();
      refresh();
    },
    () => closeMenus('periods'),
    (k, v) => tr(k, v)
  );
}
export function renderPeriods() {
  periodPicker.render(Object.keys(D.periods), D.active);
}

/* ---------- ⏱ Timer (shared with the overlay). Its own sound (Settings ▸ Timer sound) is kept beside the ink. ---------- */
const SOUND_KEY = 'ob-timer-sound';
let timer, settings;
function initSettings() {
  timer = makeTimer({
    t: () => tr,
    bar,
    btn: $('[data-act="timer"]', bar),
    loadSound: () => store.loadExtra(SOUND_KEY).catch(() => null),
    saveSound: (rec) =>
      (rec ? store.saveExtra(SOUND_KEY, rec) : store.dropExtra(SOUND_KEY)).then(
        () => true,
        () => false
      ),
  });
  settings = makeSettings({
    defaults: PERIODS,
    pen: PEN_COLOR,
    extra: timer.soundEl,
    colors: paletteColors('pen').map((c) => [c[0], c[2], c[1]]),
    langs: obLangs(),
    setLang,
    t: () => tr,
    periods: () => (D ? Object.keys(D.periods) : null),
    applyPeriods(names) {
      if (!D) return true;
      const r = remapPeriods(D.periods, D.active, names);
      if (r.same) return true;
      if (r.lost.length && !confirm(tr('confirm_remove_pdf', { list: r.lost.join(', ') }))) return false;
      ink.setPeriods(r.periods, r.active);
      renderPeriods();
      refreshRedo();
      setStatus(tr('st_periods_changed', { p: D.active }));
      return true;
    },
    tools: () => ({
      finger: T.fingerScrolls,
      width: T.width,
      smooth: T.smooth,
      hlColor: T.hlColor,
      hlStrength: T.hlStrength,
    }),
    setPen(c) {
      T.penColor = c;
      if (!T.hiliting) T.color = c;
      T.erasing = false;
      T.laser = false;
      if (T.typing) typing.restyle();
      refresh();
    },
    resetTools() {
      Object.assign(T, {
        width: 2.5,
        hlWidth: HIGHLIGHT_W,
        hlColor: HIGHLIGHT_COLOR,
        customColor: '',
        covering: false,
        hlStrength: HIGHLIGHT_STRENGTH,
        coverColor: COVER_COLOR,
        smooth: SMOOTHING,
        fingerScrolls: FINGER_SCROLLS,
        penColor: PEN_COLOR,
        erasing: false,
        laser: false,
      });
      T.color = toolColor();
      refresh();
    },
    onOpen: () => {
      closeMenus();
      timer.syncSound();
    },
  });
  for (const [code, name] of obLangs()) langPick.append(new Option(name, code));
  langPick.addEventListener('change', () => setLang(langPick.value));
}

/* ---------- File ▸ Settings… (shared with the overlay) ---------- */

/* ---------- language (Settings ▸ Language, or the 🌐 list on the start screen; shared/strings.js) ---------- */
const langPick = $('#ob-lang');
function translateAll() {
  obTranslate(document.body, tr); // everything marked data-t / data-th / data-tt / data-ta / data-tp
  $('[data-act="clear"]', bar).textContent = tr('clear') + ' ▸';
  pagesBtn.textContent = tr('pages') + ' ▸';
  langPick.value = tr.lang;
  $('#ob-start a[href^="report/"]').href = 'report/?from=start&lang=' + tr.lang;
}
function setLang(code) {
  // remember the choice and put the new words everywhere at once (no reload)
  try {
    localStorage.setItem('ob-lang', code);
  } catch (e) {
    /* blocked */
  }
  setTr(obT(code));
  translateAll();
  renderRecent();
  timer.refresh();
  if (!doc) return;
  refresh();
  refreshLink();
  layoutClear();
  renderPeriods();
  refreshZoom();
  pagesTotal.textContent = tr('of_n', { n: doc.pages });
  fitToolbar();
  setStatus(tr('st_ready', { p: D.active }));
}

/* ---------- toolbar ---------- */
const isPreset = (c) => !!bar.querySelector('[data-color="' + c + '"]');
export function refresh() {
  setPalette(bar, T.hiliting ? (T.covering ? 'cover' : 'hl') : 'pen', tr); // the swatches change with the tool
  for (const b of bar.querySelectorAll('[data-color]'))
    b.classList.toggle('on', !T.erasing && b.dataset.color === T.color);
  showLaser(bar, T.laser, laserReady(), tr);
  $('[data-act="custom"]', bar).classList.toggle(
    'on',
    !T.erasing && !!T.customColor && T.color === T.customColor && !isPreset(T.color)
  );
  customFill.style.background = T.customColor || 'transparent';
  const w = T.hiliting ? T.hlWidth : T.width,
    shown = T.hiliting && !T.covering ? T.hlInk() : T.color;
  sizeNum.textContent = w;
  sizeDot.style.width = sizeDot.style.height = Math.min(w, 26) + 'px';
  sizeDot.style.background = shown;
  smoothNum.textContent = T.smooth ? T.smooth : tr('off');
  $('[data-act="erase"]', bar).classList.toggle('on', T.erasing);
  $('[data-act="select"]', bar).classList.toggle('on', T.selecting);
  $('[data-act="type"]', bar).classList.toggle('on', T.typing);
  pagesEl.classList.toggle('type-mode', T.typing);
  const hb = $('[data-act="hilite"]', bar);
  hb.classList.toggle('on', T.hiliting && !T.erasing && !T.selecting);
  hb.classList.toggle('cover', T.covering);
  hb.textContent = tr(T.covering ? 'cover' : 'highlighter'); // the ▾ choice shows on the button
  hlMenu.sync();
  $('[data-act="finger"]', bar).textContent = tr(T.fingerScrolls ? 'finger_scrolls' : 'finger_draws');
  refreshZoom();
}
/* Type: tap the page to type a note (makeTyping in shared/ink-core.js). Eraser, Highlighter and Select turn it off. */
export function typeOff() {
  if (T.typing) {
    T.typing = false;
    typing.close();
  }
}
function typeOn() {
  T.typing = true;
  T.erasing = false;
  selectOff();
  if (T.hiliting) {
    T.hiliting = false;
    T.color = toolColor();
  } // notes use the pen color
  setStatus(tr('st_type_how'));
}
export function selectOff() {
  if (T.selecting) {
    T.selecting = false;
    ink.dropSel();
  }
}
export function toolColor() {
  return T.hiliting ? (T.covering ? T.coverColor : T.hlColor) : T.penColor;
}
function laserReady() {
  return !T.erasing && !T.selecting && !T.typing && !(T.hiliting && T.covering);
} // pen and highlighter colors only
/* a tap on a color swatch: the color you already have selected turns the laser pointer on or off; any other color just picks it */
function tapColor(c) {
  const again = c === T.color && laserReady(),
    was = T.laser;
  pickColor(c);
  if (again) {
    T.laser = !was;
    if (T.laser) ink.laser.sound();
    setStatus(tr(T.laser ? 'st_laser_on' : 'st_laser_off'));
  }
}
function pickColor(c) {
  T.color = c;
  T.laser = false;
  if (T.hiliting && T.covering) {
    T.coverColor = c;
    setLS('ink-cover-color', c);
  } else if (T.hiliting) {
    T.hlColor = c;
    setLS('ink-hl-color', c);
  } else T.penColor = c;
  T.erasing = false;
  selectOff();
  if (T.typing) typing.restyle();
  refresh();
}
/* - / + : size controls the highlighter width while it's on */
function stepSize(dir) {
  if (T.hiliting) {
    const hv = Math.min(40, Math.max(8, T.hlWidth + dir * 2));
    if (hv === T.hlWidth && !T.erasing) return false;
    T.hlWidth = hv;
    setLS('ink-hl-width', hv);
  } else {
    const w = Math.min(14, Math.max(1, T.width + dir * 0.5));
    if (w === T.width && !T.erasing) return false;
    T.width = w;
    setLS('ink-width', w);
  }
  T.erasing = false;
  selectOff();
  if (T.typing) typing.restyle();
  refresh();
  return true;
}
function stepSmooth(dir) {
  const s = Math.min(8, Math.max(0, T.smooth + dir));
  if (s === T.smooth) return false;
  T.smooth = s;
  refresh();
  setLS('ink-smooth', s);
  return true;
}
const STEPPERS = {
  thinner: [stepSize, -1],
  thicker: [stepSize, 1],
  rougher: [stepSmooth, -1],
  smoother: [stepSmooth, 1],
};
function initTools() {
  for (const [act, [step, dir]] of Object.entries(STEPPERS))
    holdRepeat($('[data-act="' + act + '"]', bar), () => step(dir));
  holdRepeat($('[data-act="zoom-in"]', bar), () => {
    if (viewer.zoom >= 6) return false;
    zoomBy(1.1);
    return true;
  });
  holdRepeat($('[data-act="zoom-out"]', bar), () => {
    if (viewer.zoom <= 0.2) return false;
    zoomBy(1 / 1.1);
    return true;
  });

  picker.addEventListener('input', () => {
    T.customColor = picker.value;
    setLS('ink-custom', T.customColor);
    pickColor(T.customColor);
  });
}
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
