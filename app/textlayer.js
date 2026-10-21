// Selectable text and clickable links over each page image, so OCR'd and digital PDFs keep their text.
// Built and freed together with the page image (see viewer.js), so a long book stays light.
// Both layers are laid out at scale 1 in % of the page; the CSS variable --scale-factor (set per page
// to the zoom) sizes the text, so zooming never rebuilds them. Rotated pages: PDF.js's TextLayer marks
// the layer with data-main-rotation and app.css turns it; link boxes come from the rotated viewport.
// Input: these layers only take pointer events in Scroll mode (app.css), so pens never hit them in Write mode.

import { loadPdfjs } from './libs.js';

/* add the text and link layers to page P (a PDF.js page proxy). Resolves once the text is in place. */
export async function addLayers(P, page, isCurrent) {
  const lib = await loadPdfjs();
  if (!isCurrent() || P.text) return;   // freed meanwhile, or another build got there first
  const vp = page.getViewport({ scale: 1 });
  const div = document.createElement('div');
  div.className = 'textLayer';
  const layer = new lib.TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
    container: div, viewport: vp,
  });
  const T = { div, layer, links: null };
  P.text = T;
  P.sheet.appendChild(div);
  try {
    await layer.render();
  } catch (e) {
    if (!e || e.name !== 'AbortException') console.warn('text layer', P.n, e);
    return;
  }
  if (P.text !== T) return;
  const end = document.createElement('div');   // fills the gaps between words while selecting, so the selection doesn't jump
  end.className = 'endOfContent';
  div.appendChild(end);
  let annots = [];
  try { annots = await page.getAnnotations({ intent: 'display' }); } catch (e) { /* no annotations */ }
  if (P.text !== T) return;
  const links = linkLayer(annots, vp);
  if (links) { T.links = links; P.sheet.appendChild(links); }
}

export function freeLayers(P) {
  const T = P.text;
  if (!T) return;
  P.text = null;
  try { T.layer.cancel(); } catch (e) { /* already done */ }
  T.div.remove();
  if (T.links) T.links.remove();
}

/* Link annotations as <a> boxes in % of the page as shown. External links open in a new tab;
   internal ones (contents pages) carry their destination and are followed by the viewer. */
function linkLayer(annots, vp) {
  const box = document.createElement('div');
  box.className = 'links';
  for (const a of annots) {
    if (a.subtype !== 'Link' || !a.rect) continue;
    const el = document.createElement('a');
    el.className = 'ob-link';
    if (a.url) {   // PDF.js only fills url for safe schemes (http, https, mailto, ...)
      el.href = a.url; el.target = '_blank'; el.rel = 'noopener noreferrer';
      el.title = a.url;
    } else if (a.dest) {
      el.href = '#';
      el._dest = a.dest;
      el.title = 'Go to this part of the PDF';
    } else if (/^(NextPage|PrevPage|FirstPage|LastPage)$/.test(a.action || '')) {
      el.href = '#';
      el._action = a.action;
    } else continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
    const l = Math.min(x1, x2), t = Math.min(y1, y2);
    Object.assign(el.style, {
      left: (100 * l / vp.width) + '%', top: (100 * t / vp.height) + '%',
      width: (100 * Math.abs(x2 - x1) / vp.width) + '%', height: (100 * Math.abs(y2 - y1) / vp.height) + '%',
    });
    box.appendChild(el);
  }
  return box.childNodes.length ? box : null;
}

/* mark matches of a search inside one page's text (q is lower case; '' clears the marks) */
export function markHits(P, q) {
  if (!P.text) return;
  for (const span of P.text.layer.textDivs) {
    if (span._plain !== undefined) { span.textContent = span._plain; delete span._plain; }
    if (!q) continue;
    const s = span.textContent, low = s.toLowerCase();
    let i = low.indexOf(q);
    if (i < 0 || low.length !== s.length) continue;
    span._plain = s;
    const frag = document.createDocumentFragment();
    let at = 0;
    while (i >= 0) {
      frag.append(s.slice(at, i));
      const m = document.createElement('mark');
      m.className = 'hit'; m.textContent = s.slice(i, i + q.length);
      frag.append(m);
      at = i + q.length;
      i = low.indexOf(q, at);
    }
    frag.append(s.slice(at));
    span.textContent = '';
    span.append(frag);
  }
}
