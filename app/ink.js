// Ink on PDF pages: one pen canvas (+ a highlighter canvas under it, only when needed) per page,
// created only for pages near the screen that have ink. Same input rules as the overlay.
// Strokes: { page: n, c, w, e, h, o, p: [x,y,...] } with x, y, w in PDF points from the page's top-left,
// so zooming never moves ink. o: 1 marks a cover (an opaque highlighter stroke): it is drawn on the pen
// layer, above the page and its text, instead of multiplied underneath.

import { seeThrough, pointerKind, paintStroke, liveStart, liveAdd, livePieces, liveEndPieces, paintPieces, liveLift } from '../shared/ink-core.js';
import { GUTTER } from './viewer.js';

export const PT_PER_UNIT = 0.75;   // toolbar sizes are in 1/96 in (CSS px at 100%), like the overlay; ink is stored in points
const MAX_INK_PX = 8e6;            // per ink canvas

export class Ink {
  constructor(viewer, tools, onChange) {
    this.v = viewer;
    this.T = tools;                // live tool settings from the toolbar (color, width, hiliting, ...)
    this.onChange = onChange;      // called after every change to the ink (for autosave)
    this.D = null;
    this.byPage = new Map();       // page -> strokes of the active period, in order
    this.cur = null; this.curP = null; this.live = null;
    this.active = null; this.drag = null; this.downAt = 0;
    this.lastCleared = null;       // { page, before } or { all } so Undo can bring back what Clear took
    this.redos = [];               // what Undo took back, newest last: a stroke, or { cleared: page }
    this.sel = null;               // the Select tool (makeSelect in shared/ink-core.js), set by main.js
    this.selP = null;              // the page a Select gesture started on
    this.pv = null;                // { page, hide, add }: a selection being dragged, drawn in its new spot
  }

  dropSel() { if (this.sel) this.sel.drop(); }

  get strokes() { return this.D.periods[this.D.active]; }

  setData(D) {
    this.D = D;
    this.dropSel();
    this.lastCleared = null; this.redos = [];
    this.reindex();
  }

  reindex() {
    const old = [...this.byPage.keys()];
    this.byPage = new Map();
    for (const s of this.strokes) {
      if (!this.byPage.has(s.page)) this.byPage.set(s.page, []);
      this.byPage.get(s.page).push(s);
    }
    for (const n of new Set([...old, ...this.byPage.keys()])) this.refreshPage(n);
  }

  /* ---------- canvases ---------- */

  pageList(n) { return this.byPage.get(n) || []; }
  P(n) { return this.v.pages[n - 1]; }

  ensure(P, needHl) {
    if (!P.ink) P.ink = this.makeCanvas(P, 'ink');
    if (needHl && !P.hl) { P.hl = this.makeCanvas(P, 'hl'); this.redraw(P); }
  }

  makeCanvas(P, cls) {
    const c = document.createElement('canvas');
    c.className = cls;
    if (cls === 'hl') P.el.insertBefore(c, P.ink || null); else P.el.appendChild(c);
    this.sizeCanvas(P, c);
    return c;
  }

  sizeCanvas(P, c) {
    const z = this.v.zoom, cw = (P.w + 2 * GUTTER) * z, ch = P.h * z;
    const bs = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_INK_PX / (cw * ch)));
    const w = Math.round(cw * bs), h = Math.round(ch * bs);
    c._sc = z * bs; c._ox = GUTTER * z * bs;
    if (c.width === w && c.height === h) return false;
    c.width = w; c.height = h;
    return true;
  }

  free(P) {
    for (const k of ['ink', 'hl']) if (P[k]) { P[k].width = 0; P[k].remove(); P[k] = null; }
  }

  layersFor(P, s) { return (s.e ? [P.ink, P.hl] : seeThrough(s) ? [P.hl] : [P.ink]).filter(Boolean); }

  redraw(P) {
    for (const c of [P.ink, P.hl]) if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    const pv = this.pv && this.pv.page === P.n ? this.pv : null;
    for (const s of this.pageList(P.n)) if (!pv || !pv.hide.includes(s)) for (const c of this.layersFor(P, s)) paintStroke(c.getContext('2d'), s, c._sc, c._ox, 0);
    if (pv) for (const s of pv.add) for (const c of this.layersFor(P, s)) paintStroke(c.getContext('2d'), s, c._sc, c._ox, 0);
  }

  /* Select: draw page n with a selection being dragged (null: as it is) */
  preview(n, hide, add) {
    const was = this.pv;
    this.pv = n ? { page: n, hide, add } : null;
    if (!n) { if (was) this.refreshPage(was.page); return; }
    const P = this.P(n);
    if (!P) return;
    this.ensure(P, add.some(seeThrough) || this.pageList(n).some(seeThrough));
    this.redraw(P);
  }
  /* where the selection box goes on page n: [element, css px per point, x offset, y offset] */
  host(n) {
    const P = this.P(n), z = this.v.zoom;
    return P ? [P.el, z, GUTTER * z, 0] : null;
  }

  /* make a page's canvases match its ink: create, redraw or free */
  refreshPage(n) {
    const P = this.P(n);
    if (!P || P === this.curP) return;
    const list = this.pageList(n);
    if (!list.length) { this.free(P); return; }
    if (!this.v.want.has(P) && !P.ink) return;        // off screen: drawn when it comes back
    if (P.hl && !list.some(seeThrough)) { P.hl.width = 0; P.hl.remove(); P.hl = null; }
    this.ensure(P, list.some(seeThrough));
    this.redraw(P);
  }

  // viewer hooks
  show(P) { if (this.pageList(P.n).length && !P.ink) { this.ensure(P, this.pageList(P.n).some(seeThrough)); this.redraw(P); } }
  hide(P) { if (P !== this.curP) this.free(P); }
  resize(P) {
    for (const c of [P.ink, P.hl]) if (c) this.sizeCanvas(P, c);
    this.redraw(P);   // always: zoom changes the transform even when the pixel size stays the same
    if (this.sel) this.sel.layout();
  }

  /* ---------- input ---------- */

  attach(box) {
    this.box = box;
    box.addEventListener('pointerdown', (e) => this.down(e));
    box.addEventListener('pointermove', (e) => this.move(e));
    box.addEventListener('pointerup', (e) => this.end(e));
    box.addEventListener('pointercancel', (e) => this.end(e));
    box.addEventListener('contextmenu', (e) => {   // a right-click on a selection opens its menu
      e.preventDefault();
      const el = this.T.selecting && this.sel && e.target.closest && e.target.closest('.pg');
      if (el) { const q = this.pt(e, el._P); this.sel.contextMenu(el._P.n, q[0], q[1], e.clientX, e.clientY); }
    });
  }

  pt(e, P) {
    const r = P.el.getBoundingClientRect(), z = this.v.zoom;
    return [Math.round(((e.clientX - r.left) / z - GUTTER) * 100) / 100, Math.round(((e.clientY - r.top) / z) * 100) / 100];
  }

  down(e) {
    if (this.active !== null || !this.D) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const T = this.T, kind = pointerKind(e);
    const scrolling = T.mode === 'scroll' || (kind === 'finger' && T.fingerScrolls);
    // Scroll mode: pressing on the PDF's text selects it and links open, like any PDF viewer.
    // (The text and link layers only take pointer events in Scroll mode, so this never happens in Write mode.)
    const layer = T.mode === 'scroll' && e.target.closest && e.target.closest('.textLayer, a.ob-link');
    if (layer) { if (layer.classList.contains('textLayer')) this.selecting(layer); return; }
    this.active = e.pointerId;
    try { this.box.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (scrolling) { this.drag = { x: e.screenX, y: e.screenY, x0: e.screenX, y0: e.screenY }; e.preventDefault(); return; }
    const el = e.target.closest('.pg');
    if (!el) { this.active = null; return; }
    const P = el._P, q = this.pt(e, P), z = this.v.zoom;
    if (T.selecting && kind !== 'palm' && this.sel) {   // Select: circle ink, tap it, or drag the selection
      this.selP = P;
      this.sel.down(P.n, q[0], q[1], e.clientX, e.clientY);
      e.preventDefault(); return;
    }
    let s;
    // the palm / eraser width is about the hand, so it stays the same size on screen at any zoom
    if (kind === 'palm' || T.erasing) s = { page: P.n, c: T.color, w: (kind === 'palm' ? T.PALM_ERASER_W : T.ERASER_W) / z, e: 1, p: q };
    else if (T.hiliting && T.covering) s = { page: P.n, c: T.color, w: T.hlWidth * PT_PER_UNIT, e: 0, h: 1, o: 1, p: q };
    else if (T.hiliting) s = { page: P.n, c: T.hlInk(), w: T.hlWidth * PT_PER_UNIT, e: 0, h: 1, p: q };
    else s = { page: P.n, c: T.color, w: T.width * PT_PER_UNIT, e: 0, p: q };
    s.w = Math.round(s.w * 100) / 100;
    this.cur = s; this.curP = P;
    this.ensure(P, seeThrough(s));
    this.downAt = performance.now();
    this.live = liveStart(q[0], q[1]);
    for (const c of this.layersFor(P, s)) paintStroke(c.getContext('2d'), s, c._sc, c._ox, 0);
    e.preventDefault();
  }

  move(e) {
    if (e.pointerId !== this.active) return;
    if (this.drag) {
      window.scrollBy(this.drag.x - e.screenX, this.drag.y - e.screenY);
      this.drag.x = e.screenX; this.drag.y = e.screenY;
      e.preventDefault(); return;
    }
    if (this.selP) {
      let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (!evs || !evs.length) evs = [e];
      for (const ev of evs) { const q = this.pt(ev, this.selP); this.sel.move(q[0], q[1], ev.clientX, ev.clientY); }
      e.preventDefault(); return;
    }
    const s = this.cur, P = this.curP;
    if (!s) return;
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (!evs || !evs.length) evs = [e];
    for (const ev of evs) { const q = this.pt(ev, P); liveAdd(s, this.live, q[0], q[1], this.T.smooth); }
    this.paintLive(P, s, livePieces(s, this.live));
    e.preventDefault();
  }

  paintLive(P, s, pieces) {
    for (const c of this.layersFor(P, s)) paintPieces(c.getContext('2d'), s, pieces, c._sc, c._ox, 0);
  }

  end(e) {
    if (e.pointerId !== this.active) return;
    const drag = this.drag;
    this.active = null; this.drag = null;
    // a tap (not a drag) in Scroll mode clears a text selection, like clicking beside text does
    if (drag && this.T.mode === 'scroll' && Math.abs(e.screenX - drag.x0) + Math.abs(e.screenY - drag.y0) < 8) {
      const sel = window.getSelection(); if (sel) sel.removeAllRanges();
    }
    if (this.selP) {
      const P = this.selP; this.selP = null;
      if (e.type === 'pointerup') { const q = this.pt(e, P); this.sel.up(q[0], q[1], e.clientX, e.clientY); } else this.sel.cancel();
      return;
    }
    const s = this.cur, P = this.curP;
    if (!s) return;
    this.cur = null; this.curP = null;
    if (e.type === 'pointerup') { const q = this.pt(e, P); liveLift(s, q[0], q[1]); }
    this.paintLive(P, s, liveEndPieces(s, this.live));
    // the board sends a few-millisecond blip when you switch between hand and pen; drop it
    if (performance.now() - this.downAt < 15 && s.p.length <= 4) { this.refreshPage(P.n); return; }
    if (s.e && !this.pageList(P.n).length) { this.refreshPage(P.n); return; }   // erasing a blank page: nothing to keep
    this.strokes.push(s);
    if (!this.byPage.has(P.n)) this.byPage.set(P.n, []);
    this.byPage.get(P.n).push(s);
    this.lastCleared = null; this.redos = [];   // new ink starts a new history
    this.dropSel();
    if (!this.v.want.has(P)) this.free(P);
    this.onChange();
  }

  /* while selecting, the layer's filler covers the gaps between words so the selection doesn't jump */
  selecting(layer) {
    layer.classList.add('selecting');
    const done = () => { layer.classList.remove('selecting'); window.removeEventListener('pointerup', done, true); window.removeEventListener('pointercancel', done, true); };
    window.addEventListener('pointerup', done, true);
    window.addEventListener('pointercancel', done, true);
  }

  /* ---------- undo / clear / periods ---------- */

  undo() {
    this.dropSel();
    if (this.lastCleared && this.lastCleared.all) {   // the last thing done was Clear all (or a Select change): bring every page back
      this.redos.push({ after: this.strokes });
      this.D.periods[this.D.active] = this.lastCleared.all;
      this.lastCleared = null;
      this.reindex(); this.onChange();
      return this.strokes.length ? this.strokes[this.strokes.length - 1].page : null;
    }
    if (this.lastCleared) {   // the last thing done was Clear: bring that page back, in its old place
      const { page, before } = this.lastCleared;
      this.lastCleared = null;
      this.D.periods[this.D.active] = before;
      this.byPage.set(page, before.filter((s) => s.page === page));
      this.redos.push({ cleared: page });
      this.refreshPage(page); this.onChange();
      return page;
    }
    const s = this.strokes.pop();
    if (!s) return null;
    const list = this.byPage.get(s.page);
    list.pop();
    if (!list.length) this.byPage.delete(s.page);
    this.redos.push(s);
    this.refreshPage(s.page); this.onChange();
    return s.page;
  }

  redo() {   // puts back what Undo took, in order; returns the page it changed
    const r = this.redos.pop();
    if (!r) return null;
    this.dropSel();
    if (r.after) { this.replaceAll(r.after, true); return null; }
    if (r.cleared) { this.clearPage(r.cleared, true); return r.cleared; }
    this.strokes.push(r);
    if (!this.byPage.has(r.page)) this.byPage.set(r.page, []);
    this.byPage.get(r.page).push(r);
    this.lastCleared = null;
    this.refreshPage(r.page); this.onChange();
    return r.page;
  }
  canRedo() { return this.redos.length > 0; }

  clearPage(n, keepRedo) {
    const list = this.pageList(n);
    if (!list.length) return false;
    this.dropSel();
    const gone = new Set(list);
    this.lastCleared = { page: n, before: this.strokes };
    this.D.periods[this.D.active] = this.strokes.filter((s) => !gone.has(s));
    this.byPage.delete(n);
    if (!keepRedo) this.redos = [];
    this.refreshPage(n); this.onChange();
    return true;
  }

  clearAll() {   // every page of the active period; Undo brings them all back
    if (!this.strokes.length) return false;
    this.replaceAll([]);
    return true;
  }

  /* the active period's strokes become next (Clear all, and Select's paste, move and delete); Undo brings back the old ones */
  replaceAll(next, keepRedo) {
    this.lastCleared = { all: this.strokes };
    this.D.periods[this.D.active] = next;
    if (!keepRedo) this.redos = [];
    this.reindex(); this.onChange();
  }

  /* Select ▸ Send a copy to: add strokes to another period (it saves with the rest) */
  addTo(name, list) {
    if (!this.D.periods[name]) return;
    this.D.periods[name].push(...list);
    this.onChange();
  }

  switchTo(name) {
    if (!this.D.periods[name] || name === this.D.active) return false;
    this.dropSel();
    this.D.active = name;
    this.lastCleared = null; this.redos = [];
    this.reindex(); this.onChange();
    return true;
  }

  setPeriods(periods, active) {   // File ▸ Settings… changed the class periods (renamed ones keep their ink)
    this.dropSel();
    this.D.periods = periods; this.D.active = active;
    this.lastCleared = null; this.redos = [];
    this.reindex(); this.onChange();
  }

  count() { return this.strokes.length; }
}
