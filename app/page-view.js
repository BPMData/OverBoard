// Moving around the document: Chapters, the page number box, ▲ / ▼ Page, zoom and Turn page.

import { finder, ink, setStatus, viewer } from './core.js';
import { fitToolbar, layoutClear } from './menus.js';
import { markDirty } from './saving.js';
import { $, bar, D, doc, findPanel, fitBtn, pageInput, toc, tr } from './state.js';
import { refreshRedo } from './main.js';

export let hasChapters = false;
/* ---------- chapters (PDF outline) ---------- */
let outline = []; // flat [{ button, page }] for marking the current chapter
export function clearChapters() {
  outline = [];
  hasChapters = false;
}
export async function loadOutline(pdf) {
  const ul = $('ul', toc);
  ul.textContent = '';
  outline = [];
  let items = null;
  try {
    items = await pdf.getOutline();
  } catch (e) {
    /* no outline */
  }
  if (doc.pdf !== pdf) return;
  hasChapters = !!(items && items.length);
  layoutClear();
  fitToolbar();
  if (!hasChapters) return;
  const build = (list, parent) => {
    for (const it of list) {
      const li = document.createElement('li'),
        b = document.createElement('button');
      const t = document.createElement('span');
      t.textContent = it.title || tr('untitled');
      const n = document.createElement('small');
      b.append(t, n);
      const entry = { button: b, page: null, dest: it.dest, num: n };
      outline.push(entry);
      b.addEventListener('click', async () => {
        const p = entry.page || (await viewer.resolveDest(it.dest));
        if (p) {
          viewer.goTo(p);
          if (window.innerWidth < 900) toc.hidden = true;
        }
      });
      li.appendChild(b);
      if (it.items && it.items.length) {
        const sub = document.createElement('ul');
        build(it.items, sub);
        li.appendChild(sub);
      }
      parent.appendChild(li);
    }
  };
  build(items, ul);
  for (const entry of outline) {
    // page numbers fill in shortly after
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
export function toggleToc() {
  toc.hidden = !toc.hidden;
  if (!toc.hidden && !findPanel.hidden) finder.close();
  toc.classList.toggle('left', bar.classList.contains('right'));
  if (!toc.hidden) {
    markChapter();
    const h = $('.here', toc);
    if (h) h.scrollIntoView({ block: 'center' });
  }
}

/* ---------- page number box ---------- */
let scrollRaf = 0;
export function initPageView() {
  window.addEventListener(
    'scroll',
    () => {
      if (scrollRaf || !doc) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        if (document.activeElement !== pageInput) pageInput.value = viewer.currentPage();
        markChapter();
      });
    },
    { passive: true }
  );
  pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      goToTyped();
      pageInput.blur();
    }
  });
  pageInput.addEventListener('change', goToTyped);
  pageInput.addEventListener('focus', () => pageInput.select());
  window.addEventListener(
    'wheel',
    (e) => {
      // trackpad pinch / ctrl+wheel zooms the pages, not the toolbar
      if (!doc || !e.ctrlKey) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.01));
    },
    { passive: false }
  );
  window.addEventListener('resize', () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (doc) {
        fitToolbar();
        fitSpace();
        viewer.layout();
        refreshZoom();
      }
    });
  });
}

function goToTyped() {
  const n = parseInt(pageInput.value, 10);
  if (n >= 1 && doc) viewer.goTo(Math.min(n, doc.pages));
  pageInput.value = viewer.currentPage();
}

export function jump(dir) {
  if (!doc) return;
  const n = viewer.currentPage(),
    P = viewer.pages[n - 1];
  const top = P.el.getBoundingClientRect().top;
  if (dir < 0 && top < -60)
    viewer.goTo(n, true); // well into this page: back to its top first
  else viewer.goTo(n + dir, true);
}

/* ---------- zoom ---------- */
const ZOOM_100 = 96 / 72; // CSS px per point at 100%
export function fitSpace() {
  viewer.sideSpace = bar.style.display === 'none' || bar.hidden ? 16 : bar.getBoundingClientRect().width + 20;
}
export function zoomBy(f) {
  viewer.setZoom(viewer.zoom * f);
  refreshZoom();
}
export function refreshZoom() {
  fitBtn.textContent = viewer.fit ? tr('fit') : Math.round((viewer.zoom / ZOOM_100) * 100) + '%';
}
let resizeRaf = 0;

/* ---------- Turn page (for PDFs scanned or saved upside down or sideways) ----------
   Each tap turns the page a quarter turn clockwise; tap twice for upside down. The turn is kept with
   the ink (D.rot), ink already on the page turns with it, and Export PDF comes out turned the same way.
   The PDF file itself isn't changed, so its ink stays matched to it. */
let turning = false;
export async function turnPages(all) {
  if (!doc || turning) return;
  turning = true;
  try {
    const n = viewer.currentPage();
    const list = all ? viewer.pages.map((P) => P.n) : [n];
    const inked = new Set();
    for (const l of Object.values(D.periods)) for (const s of l) inked.add(s.page);
    D.rot = D.rot || {};
    for (const k of list) {
      if (inked.has(k)) {
        const { w, h } = await viewer.shownSize(k);
        ink.turnInk(k, 1, w, h);
      }
      const t = ((D.rot[k] || 0) + 90) % 360;
      if (t) D.rot[k] = t;
      else delete D.rot[k];
    }
    viewer.applyTurns();
    if (!all) viewer.goTo(n);
    refreshRedo();
    markDirty();
    setStatus(tr(all ? 'st_turned_all' : 'st_turned', { n }));
  } catch (e) {
    console.error(e);
    setStatus(String((e && e.message) || e));
  } finally {
    turning = false;
  }
}
