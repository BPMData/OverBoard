// "Export PDF": draw each page's ink into the original PDF as vector paths with pdf-lib.
// Ink coordinates are PDF points measured from the top-left of the page as shown
// (PDF.js viewport at scale 1), so each page maps them back with the inverse of that viewport's transform.

import { loadPdfLib } from './libs.js';
import { seeThrough } from '../shared/ink-core.js';
import { NB_RE } from './notebook.js';

/* The PDF has no "eraser". Apply erasers geometrically: drop the sample points of earlier strokes that the
   eraser passed over, and split those strokes where the gap is. Returns highlight and pen strokes in order. */
export function applyErasers(list) {
  let kept = [];
  for (const s of list) {
    if (!s.e) { kept.push(s); continue; }
    const r = s.w / 2, ep = s.p, box = bbox(ep, r);
    const next = [];
    for (const k of kept) {
      const pad = k.w / 2;
      if (!overlaps(box, bbox(k.p, pad))) { next.push(k); continue; }
      let run = [];
      const flush = () => {
        if (run.length >= 4 || (run.length === 2 && k.p.length === 2)) next.push({ ...k, p: run });
        run = [];
      };
      for (let i = 0; i < k.p.length; i += 2) {
        const x = k.p[i], y = k.p[i + 1];
        if (distToPath(x, y, ep) <= r + pad * 0.5) flush();
        else run.push(x, y);
      }
      flush();
    }
    kept = next;
  }
  return kept;
}

function bbox(p, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function distToPath(x, y, p) {
  if (p.length < 4) return Math.hypot(x - p[0], y - p[1]);
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? ((x - ax) * dx + (y - ay) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

function rgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/* same curve as paintStroke: quadratic curves through midpoints, written as cubic Béziers */
function strokeOps(L, s) {
  const p = s.p, ops = [];
  ops.push(L.setStrokingRgbColor(...rgb01(s.c)), L.setLineWidth(r3(s.w)));
  ops.push(L.moveTo(r3(p[0]), r3(p[1])));
  if (p.length < 4) { ops.push(L.lineTo(r3(p[0]), r3(p[1]))); }   // a dot: zero-length line with a round cap
  else {
    let x = p[0], y = p[1];
    for (let i = 2; i < p.length - 2; i += 2) {
      const qx = p[i], qy = p[i + 1], mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      ops.push(L.appendBezierCurve(
        r3(x + 2 / 3 * (qx - x)), r3(y + 2 / 3 * (qy - y)),
        r3(mx + 2 / 3 * (qx - mx)), r3(my + 2 / 3 * (qy - my)),
        r3(mx), r3(my)));
      x = mx; y = my;
    }
    ops.push(L.lineTo(r3(p[p.length - 2]), r3(p[p.length - 1])));
  }
  ops.push(L.stroke());
  return ops;
}

/* bytes: the original PDF. pdf: the open PDF.js document (for each page's viewport transform).
   byPage: Map(pageNumber -> strokes in drawing order). Returns the new PDF's bytes. */
/* true if any cover is still there after erasers (its text underneath stays in the PDF) */
export function hasCovers(byPage) {
  for (const list of byPage.values()) if (list.some((s) => s.o) && applyErasers(list).some((s) => s.o)) return true;
  return false;
}

export async function exportAnnotatedPdf(bytes, pdf, byPage, onProgress) {
  const L = await loadPdfLib();
  const out = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (NB_RE.test(out.getKeywords() || '')) out.setKeywords([]);   // an exported notebook is a plain PDF, not the notebook itself
  const pages = out.getPages();
  let done = 0;
  for (const [n, list] of byPage) {
    const page = pages[n - 1];
    if (!page || !list.length) continue;
    const drawn = applyErasers(list);
    if (!drawn.length) continue;
    const vp = (await pdf.getPage(n)).getViewport({ scale: 1 });
    const m = invert(vp.transform);            // page-as-shown points -> PDF user space
    const ops = [L.pushGraphicsState(), L.concatTransformationMatrix(...m.map(r3)),
      L.setLineCap(L.LineCapStyle.Round), L.setLineJoin(L.LineJoinStyle.Round)];
    // covers (o: 1) are opaque and drawn in order with the pen ink, over the page's text, like on screen
    const hl = drawn.filter(seeThrough), pen = drawn.filter((s) => !seeThrough(s));
    if (hl.length) {   // highlights go under the pen ink and multiply, so printed text stays readable
      const gs = page.doc.context.obj({ Type: 'ExtGState', BM: 'Multiply' });
      const key = page.node.newExtGState('GS', gs);
      ops.push(L.pushGraphicsState(), L.setGraphicsState(key));
      for (const s of hl) ops.push(...strokeOps(L, s));
      ops.push(L.popGraphicsState());
    }
    for (const s of pen) ops.push(...strokeOps(L, s));
    ops.push(L.popGraphicsState());
    page.pushOperators(...ops);
    done++;
    if (onProgress && done % 10 === 0) onProgress(done);
  }
  return out.save({ useObjectStreams: true });
}
