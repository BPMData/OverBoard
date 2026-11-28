// The PDF app's main objects: the page viewer, the ink layer, Find, Select and Type, plus the status line.

import { makeSelect, makeTyping } from '../shared/ink-core.js';
import { Finder } from './find.js';
import { Ink, PT_PER_UNIT } from './ink.js';
import { Viewer } from './viewer.js';
import { closeMenus, fitToolbar } from './menus.js';
import { markDirty, writeNow } from './saving.js';
import { D, doc, findPanel, pagesEl, statusEl, T, tr } from './state.js';
import { refreshRedo } from './main.js';

export let viewer, finder, ink, typing;
export function initCore() {
  viewer = new Viewer(pagesEl, {
    show: (P) => ink.show(P),
    hide: (P) => ink.hide(P),
    resize: (P) => ink.resize(P),
    textReady: (P) => finder.showHit(P),
    turn: (n) => (D && D.rot && D.rot[n]) || 0,
  });
  finder = new Finder(viewer, findPanel, setStatus, () => tr);
  ink = new Ink(viewer, T, () => {
    refreshRedo();
    markDirty();
  });
  ink.onTextCopied = () => setStatus(tr('st_text_copied'));
  ink.attach(pagesEl);
  /* Select (shared with the overlay): circle ink to send a copy to another period, copy and paste it, move it or delete it */
  ink.sel = makeSelect({
    t: () => tr,
    status: setStatus,
    pageList: (n) => ink.pageList(n),
    all: () => ink.strokes,
    replace: (next) => ink.replaceAll(next),
    addTo: (name, list) => ink.addTo(name, list),
    periods: () => Object.keys(D.periods),
    active: () => D.active,
    preview: (n, hide, add) => ink.preview(n, hide, add),
    host: (n) => ink.host(n),
    pastePage: (n) => (n && viewer.pages[n - 1] && isOnScreen(n) ? n : viewer.currentPage()),
    onOpen: () => closeMenus('sel'),
  });
  typing = ink.typing = makeTyping({
    t: () => tr,
    status: setStatus,
    pageList: (n) => ink.pageList(n),
    all: () => ink.strokes,
    replace: (next) => ink.replaceAll(next),
    preview: (n, hide, add) => ink.preview(n, hide, add),
    host: (n) => ink.host(n),
    style: () => ({ c: T.penColor, f: Math.round((10 + T.width * 4) * PT_PER_UNIT * 100) / 100 }),
    page: (n) => n,
  });
  window.__overboard = {
    viewer,
    ink,
    get doc() {
      return doc;
    },
    get data() {
      return D;
    },
    flush: () => writeNow(),
  }; // for tests and the curious
}

export function setStatus(msg) {
  // a message that takes more (or fewer) lines changes the toolbar's height, so fit it again
  const h = statusEl.offsetHeight;
  statusEl.textContent = msg;
  if (statusEl.offsetHeight !== h && doc) queueMicrotask(() => fitToolbar());
}
export function isOnScreen(n) {
  const r = viewer.pages[n - 1].el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
}
