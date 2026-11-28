// What each toolbar and menu button does (data-act), the keyboard shortcuts, and Undo / Redo.

import { confirmTap, historyKey } from '../shared/ink-core.js';
import { finder, ink, isOnScreen, setStatus, typing, viewer } from './core.js';
import { clearMenu, closeMenus, fileMenu, fitToolbar, layoutClear, pageMenu, showFileMenu } from './menus.js';
import { toStart } from './open.js';
import { fitSpace, jump, toggleToc, turnPages, zoomBy } from './page-view.js';
import { onLinkButton } from './saving.js';
import { settings, timer } from './settings.js';
import { $, bar, D, doc, findPanel, picker, setLS, showBtn, T, toc, tr } from './state.js';
import {
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
import { exportPdf, saveInkFile } from './main.js';

export function initToolbar() {
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
