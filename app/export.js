// "Export PDF": draw each page's ink into the original PDF as vector paths with pdf-lib.
// Ink coordinates are PDF points measured from the top-left of the page as shown
// (PDF.js viewport at scale 1), so each page maps them back with the inverse of that viewport's transform.

import { loadPdfLib } from './libs.js';
import { seeThrough, applyErasers } from '../shared/ink-core.js';
import { NB_RE } from './notebook.js';

// The PDF has no "eraser": applyErasers (shared/ink-core.js, also used by Select) cuts the erased parts out of the strokes.
export { applyErasers };

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
