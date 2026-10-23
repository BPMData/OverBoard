// Find text in the whole PDF. Browser find (Ctrl+F) only sees pages near the screen, because pages
// are built lazily, so this reads every page's text with PDF.js (getTextContent) and lists the hits.
// Page texts are kept as plain strings after the first search, so the next search is instant.

const MAX_HITS = 500;
const flat = (s) => s.replace(/\s+/g, ' ');

export class Finder {
  constructor(viewer, panel, setStatus, words) {
    this.words = words || (() => (k) => k);   // () => the current translator (shared/strings.js)
    this.v = viewer;
    this.panel = panel;
    this.input = panel.querySelector('input');
    this.list = panel.querySelector('ul');
    this.msg = panel.querySelector('.msg');
    this.setStatus = setStatus;
    this.texts = new Map();   // page -> text with runs of spaces collapsed
    this.token = 0;
    this.jumpTo = null;       // { n, k }: scroll to the k-th mark on page n once its text layer is ready
    panel.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); this.run(this.input.value); });
    let t = 0;
    this.input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.run(this.input.value), 350); });
  }

  reset() { this.token++; this.texts = new Map(); this.list.textContent = ''; this.msg.textContent = ''; this.input.value = ''; this.jumpTo = null; }

  open() {
    this.panel.hidden = false;
    this.input.focus(); this.input.select();
    if (this.input.value) this.v.setQuery(flat(this.input.value.trim().toLowerCase()));
  }
  close() { this.panel.hidden = true; this.token++; this.v.setQuery(''); }

  async pageText(n) {
    if (!this.texts.has(n)) {
      const tc = await (await this.v.pdf.getPage(n)).getTextContent();
      this.texts.set(n, flat(tc.items.map((i) => (i.str || '') + (i.hasEOL ? ' ' : '')).join('')));
    }
    return this.texts.get(n);
  }

  async run(raw) {
    const token = ++this.token, pdf = this.v.pdf;
    const q = flat(raw.trim().toLowerCase());
    this.list.textContent = '';
    this.v.setQuery(q);
    if (!q || !pdf) { this.msg.textContent = ''; return; }
    const N = this.v.pages.length;
    let hits = 0, pagesHit = 0;
    for (let n = 1; n <= N; n++) {
      let text;
      try { text = await this.pageText(n); } catch (e) { continue; }
      if (token !== this.token || pdf !== this.v.pdf) return;
      const low = text.toLowerCase(), same = low.length === text.length;
      let i = low.indexOf(q), k = 0;
      if (i >= 0) pagesHit++;
      while (i >= 0 && hits < MAX_HITS) {
        this.addHit(n, k, same ? text : low, i, q.length);
        hits++; k++;
        i = low.indexOf(q, i + q.length);
      }
      if (n % 25 === 0 || n === N) this.msg.textContent = (n < N ? this.words()('searching', { n, m: N }) : '') + summary(this.words(), hits, pagesHit);
      if (hits >= MAX_HITS) { this.msg.textContent = this.words()('first_matches', { n: MAX_HITS }); return; }
    }
  }

  addHit(n, k, text, i, len) {
    const li = document.createElement('li'), b = document.createElement('button');
    const t = document.createElement('span'), num = document.createElement('small');
    const from = Math.max(0, i - 40), to = Math.min(text.length, i + len + 40);
    const m = document.createElement('b');
    m.textContent = text.slice(i, i + len);
    t.append((from ? '…' : '') + text.slice(from, i), m, text.slice(i + len, to) + (to < text.length ? '…' : ''));
    num.textContent = this.words()('page_abbr', { n });
    b.append(t, num);
    b.addEventListener('click', () => {
      for (const x of this.list.querySelectorAll('.here')) x.classList.remove('here');
      b.classList.add('here');
      this.jumpTo = { n, k };
      this.v.goTo(n);
      if (window.innerWidth < 900) this.panel.hidden = true;
      this.showHit(this.v.pages[n - 1]);
    });
    li.appendChild(b);
    this.list.appendChild(li);
  }

  /* viewer hook: a page's text layer is ready; if we just jumped there, bring the match into view */
  showHit(P) {
    const j = this.jumpTo;
    if (!j || j.n !== P.n || !P.text) return;
    const marks = P.text.div.querySelectorAll('mark.hit');
    if (!marks.length) return;
    this.jumpTo = null;
    for (const x of document.querySelectorAll('mark.hit.cur')) x.classList.remove('cur');
    const m = marks[Math.min(j.k, marks.length - 1)];
    m.classList.add('cur');
    const r = m.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight - 60) window.scrollBy(0, r.top - window.innerHeight / 3);
  }
}

function summary(t, hits, pages) {
  if (!hits) return t('no_matches');
  return t(hits === 1 ? 'match_1' : pages === 1 ? 'matches_1_page' : 'matches', { n: hits, m: pages });
}
