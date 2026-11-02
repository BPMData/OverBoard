// PDF pages laid out in one scrolling column. Page images render only near the viewport
// (IntersectionObserver) and are freed again far away, so a 600-page book stays light.
// Units: page sizes are PDF points as shown (PDF.js viewport at scale 1); `zoom` is CSS px per point.
// Each page also gets selectable text and clickable links (textlayer.js), made and freed with its image.
// Turned pages: the teacher can turn any page by quarter turns (hooks.turn(n) gives 0, 90, 180 or 270),
// added to the PDF's own rotation. Sizes, images and text layers all use the page as shown.

import { addLayers, freeLayers, markHits } from './textlayer.js';

export const GUTTER = 36;            // writable margin beside each page, in points (0.5 in), like the overlay's side space
const MAX_IMG_PX = 12e6;             // cap per page image (about 48 MB); keeps memory bounded on 4K boards
const RENDER_AHEAD = '100% 0px';     // render pages within 1 screen of the viewport
const KEEP = '200% 0px';             // free them once they are 2 screens away
const MAX_ZOOM = 6, MIN_ZOOM = 0.2;

export class Viewer {
  constructor(container, hooks) {
    this.box = container;
    this.hooks = hooks;              // { show(P), hide(P), resize(P), textReady(P), turn(n) }
    this.pages = [];
    this.zoom = 1;
    this.fit = true;
    this.sideSpace = 0;              // px kept clear on each side for the toolbar when fitting
    this.want = new Set();
    this.busy = 0;
    this.gen = 0;                    // bumps on close, so stale async work stops
    this.query = '';                 // search text marked in the text layers (lower case)
    container.addEventListener('click', (e) => {   // internal links (e.g. a contents page) jump inside the PDF
      const a = e.target.closest && e.target.closest('a.ob-link');
      if (!a || (!a._dest && !a._action)) return;
      e.preventDefault();
      this.follow(a);
    });
  }

  turnOf(n) { return (this.hooks.turn && this.hooks.turn(n)) || 0; }

  /* a PDF.js page's viewport as shown: its own rotation plus the teacher's turn */
  view(page, scale) { return page.getViewport({ scale, rotation: (page.rotate + this.turnOf(page.pageNumber)) % 360 }); }

  async open(pdf) {
    this.close();
    const gen = ++this.gen;
    this.pdf = pdf;
    const first = this.view(await pdf.getPage(1), 1);
    if (gen !== this.gen) return;
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= pdf.numPages; n++) {
      const el = document.createElement('div');
      el.className = 'pg';
      el.dataset.n = n;
      const sheet = document.createElement('div');
      sheet.className = 'sheet';
      el.appendChild(sheet);
      const P = { n, w: first.width, h: first.height, sized: n === 1, turn: this.turnOf(n), rv: 0, el, sheet, img: null, imgZoom: 0, task: null, text: null, ink: null, hl: null };
      el._P = P;
      this.pages.push(P);
      frag.appendChild(el);
    }
    this.box.appendChild(frag);
    this.near = new IntersectionObserver((es) => this.onNear(es), { rootMargin: RENDER_AHEAD });
    this.far = new IntersectionObserver((es) => this.onFar(es), { rootMargin: KEEP });
    this.layout();
    for (const P of this.pages) { this.near.observe(P.el); this.far.observe(P.el); }
    this.loadSizes(gen);
  }

  close() {
    this.gen++;
    if (this.near) this.near.disconnect();
    if (this.far) this.far.disconnect();
    for (const P of this.pages) { this.freeImage(P); this.hooks.hide(P); }
    this.pages = [];
    this.want.clear();
    this.box.textContent = '';
    this.pdf = null;
  }

  /* pages start at page 1's size; the real sizes load in the background (fast: no rendering) */
  async loadSizes(gen) {
    for (let n = 2; n <= this.pages.length; n++) {
      let vp;
      try { vp = this.view(await this.pdf.getPage(n), 1); } catch (e) { continue; }
      if (gen !== this.gen) return;
      const P = this.pages[n - 1];
      P.sized = true; P.turn = this.turnOf(n);
      if (Math.abs(vp.width - P.w) > 0.01 || Math.abs(vp.height - P.h) > 0.01) {
        P.w = vp.width; P.h = vp.height;
        this.sizePage(P);
        if (this.fit && P.w > this.maxW) this.layout();
      }
    }
  }

  /* the size of page n as shown now, in points (loads it if the background pass hasn't yet) */
  async shownSize(n) {
    const P = this.pages[n - 1];
    if (!P.sized || P.turn !== this.turnOf(n)) {
      const vp = this.view(await this.pdf.getPage(n), 1);
      return { w: vp.width, h: vp.height };
    }
    return { w: P.w, h: P.h };
  }

  /* after hooks.turn changed for some pages: resize them and draw them again, turned */
  applyTurns() {
    for (const P of this.pages) {
      const t = this.turnOf(P.n);
      if (t === P.turn) continue;
      if (((t - P.turn + 360) / 90) % 2) [P.w, P.h] = [P.h, P.w];
      P.turn = t;
      P.rv++;                        // a render already under way is for the old turn: drop it
      this.freeImage(P);
    }
    this.layout();
  }

  get maxW() { return Math.max(...this.pages.filter((P) => P.sized).map((P) => P.w)); }

  fitZoom() {
    const avail = document.documentElement.clientWidth - 2 * this.sideSpace;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, avail / (this.maxW + 2 * GUTTER)));
  }

  /* zoom: a number (CSS px per point) or 'fit'. Keeps the spot at the middle of the screen in place. */
  setZoom(z) {
    if (z === 'fit') this.fit = true;
    else { this.fit = false; this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)); }
    this.layout();
  }

  layout() {
    if (!this.pages.length) return;
    const anchor = this.anchor();
    if (this.fit) this.zoom = this.fitZoom();
    if (this.dpr !== window.devicePixelRatio) {   // browser zoom changed: re-render images at the new sharpness
      this.dpr = window.devicePixelRatio;
      for (const P of this.pages) P.imgZoom = 0;
    }
    for (const P of this.pages) this.sizePage(P);
    if (anchor) this.restore(anchor);
    for (const P of this.pages) if (P.ink || P.hl) this.hooks.resize(P);
    this.pump();
  }

  sizePage(P) {
    const z = this.zoom;
    P.el.style.width = (P.w + 2 * GUTTER) * z + 'px';
    P.el.style.height = P.h * z + 'px';
    P.el.style.setProperty('--scale-factor', z);   // sizes the text layer (PDF.js) without rebuilding it
    P.sheet.style.left = GUTTER * z + 'px';
    P.sheet.style.width = P.w * z + 'px';
  }

  anchor() {   // which page is at the middle of the screen, and how far down it
    const y = window.innerHeight / 2, P = this.pageAt(y);
    if (!P) return null;
    const r = P.el.getBoundingClientRect();
    return { P, f: (y - r.top) / r.height };
  }
  restore({ P, f }) {
    const r = P.el.getBoundingClientRect();
    window.scrollBy(0, r.top + f * r.height - window.innerHeight / 2);
  }

  /* the page under a screen y (binary search on page tops) */
  pageAt(clientY) {
    const ps = this.pages;
    if (!ps.length) return null;
    const y = clientY + window.scrollY;
    let lo = 0, hi = ps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ps[mid].el.offsetTop + this.box.offsetTop <= y) lo = mid; else hi = mid - 1;
    }
    return ps[lo];
  }

  currentPage() { const P = this.pageAt(window.innerHeight / 3); return P ? P.n : 1; }

  goTo(n, smooth) {
    const P = this.pages[Math.min(this.pages.length, Math.max(1, n)) - 1];
    if (!P) return;
    const top = P.el.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }

  /* ---------- lazy rendering ---------- */

  onNear(entries) {
    for (const e of entries) {
      const P = e.target._P;
      if (e.isIntersecting) { this.want.add(P); this.hooks.show(P); }
      else this.want.delete(P);
    }
    this.pump();
  }

  onFar(entries) {
    for (const e of entries) {
      if (e.isIntersecting) continue;
      const P = e.target._P;
      this.want.delete(P);
      this.freeImage(P);
      this.hooks.hide(P);
    }
  }

  pump() {
    while (this.busy < 2) {
      const mid = window.innerHeight / 2;
      let best = null, bestD = Infinity;
      for (const P of this.want) {
        if (P.task || P.imgZoom === this.zoom) continue;
        const r = P.el.getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < bestD) { bestD = d; best = P; }
      }
      if (!best) return;
      this.render(best);
    }
  }

  async render(P) {
    const gen = this.gen, z = this.zoom, rv = P.rv;
    this.busy++;
    const c = document.createElement('canvas');
    try {
      const page = await this.pdf.getPage(P.n);
      if (gen !== this.gen) return;
      const css = this.view(page, z);
      const bs = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_IMG_PX / (css.width * css.height)));
      const vp = this.view(page, z * bs);
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.className = 'img';
      P.task = page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp });
      await P.task.promise;
      if (gen !== this.gen || !this.want.has(P) || rv !== P.rv) { c.width = 0; return; }
      if (P.img) { P.img.width = 0; P.img.remove(); }
      P.img = c;
      P.imgZoom = z;
      P.sheet.appendChild(c);
      if (!P.text) {
        addLayers(P, page, this.view(page, 1), () => gen === this.gen && this.want.has(P) && rv === P.rv).then(() => {
          if (!P.text || gen !== this.gen) return;
          if (this.query) markHits(P, this.query);
          if (this.hooks.textReady) this.hooks.textReady(P);
        });
      }
    } catch (e) {
      c.width = 0;
      if (!e || e.name !== 'RenderingCancelledException') console.warn('page', P.n, e);
    } finally {
      P.task = null;
      this.busy--;
      if (gen === this.gen) this.pump();
    }
  }

  freeImage(P) {
    if (P.task) { try { P.task.cancel(); } catch (e) { /* already done */ } }
    if (P.img) { P.img.width = 0; P.img.height = 0; P.img.remove(); P.img = null; }
    P.imgZoom = 0;
    freeLayers(P);
    if (this.pdf) this.pdf.getPage(P.n).then((pg) => pg.cleanup()).catch(() => {});
  }

  /* ---------- links and search marks ---------- */

  async follow(a) {
    const n = this.currentPage(), last = this.pages.length;
    const to = a._action ? { NextPage: n + 1, PrevPage: n - 1, FirstPage: 1, LastPage: last }[a._action] : await this.resolveDest(a._dest);
    if (to) this.goTo(to);
  }

  /* a PDF destination (name or array) -> page number, or null */
  async resolveDest(dest) {
    const pdf = this.pdf;
    try {
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest)) return null;
      const ref = dest[0];
      if (typeof ref === 'number') return ref + 1;
      return (await pdf.getPageIndex(ref)) + 1;
    } catch (e) { return null; }
  }

  setQuery(q) {
    this.query = q;
    for (const P of this.pages) if (P.text) markHits(P, q);
  }

  /* how many page images and ink layers are alive (for the memory check) */
  stats() {
    let img = 0, ink = 0, px = 0, text = 0;
    for (const P of this.pages) {
      if (P.img) { img++; px += P.img.width * P.img.height; }
      if (P.text) text++;
      for (const c of [P.ink, P.hl]) if (c) { ink++; px += c.width * c.height; }
    }
    return { pages: this.pages.length, images: img, textLayers: text, inkLayers: ink, megapixels: Math.round(px / 1e6) };
  }
}
