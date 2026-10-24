// Blank notebooks: a PDF that OverBoard makes itself, one page of blank, lined, graph or dot paper,
// with pages added or removed later. The paper is drawn into the PDF (thin vector lines), so it
// prints and exports like any other PDF.
//
// A notebook keeps one ID for its whole life, written in the PDF's keywords. The app keys its ink by
// that ID instead of the file's SHA-256, because the file's bytes change every time a page is added.

import { loadPdfLib } from './libs.js';

export const PAPERS = ['blank', 'lined', 'graph', 'dots', 'iso'];
export const NB_RE = /overboard-notebook-([0-9a-f]{16})/;   // in the PDF's Keywords
const W = 612, H = 792;            // US Letter, portrait, in points (72 per inch)
const STEP = 18;                   // graph squares and dot spacing: 1/4 inch
const LINE = 24.75;                // lined paper: wide ruled (11/32 inch), easy to see on a board
const TOP = 72, MARGIN = 72;       // lined paper: room for a heading, and the red margin line, 1 inch in

const hex = (c) => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];

/* the paper's lines as PDF drawing operators (PDF y goes up from the bottom) */
function paperOps(L, paper) {
  const ops = [];
  const pen = (color, width) => ops.push(L.setStrokingRgbColor(...hex(color)), L.setLineWidth(width));
  const seg = (x0, y0, x1, y1) => ops.push(L.moveTo(x0, y0), L.lineTo(x1, y1));
  if (paper === 'lined') {
    pen('#9ec5e8', 0.75);
    for (let y = H - TOP; y >= 36; y -= LINE) seg(0, y, W, y);
    ops.push(L.stroke());
    pen('#e57373', 0.75);
    seg(MARGIN, 0, MARGIN, H);
    ops.push(L.stroke());
  } else if (paper === 'graph') {
    for (const major of [false, true]) {   // a slightly darker line every inch
      pen(major ? '#8fb3d9' : '#c3d8ec', major ? 0.75 : 0.5);
      for (let i = 1; i * STEP < W; i++) if ((i % 4 === 0) === major) seg(i * STEP, 0, i * STEP, H);
      for (let i = 1; i * STEP < H; i++) if ((i % 4 === 0) === major) seg(0, H - i * STEP, W, H - i * STEP);
      ops.push(L.stroke());
    }
  } else if (paper === 'iso') {   // isometric: triangles 1/4 inch on a side (vertical lines and lines at ±30°)
    const s = STEP, h = s * Math.sqrt(3) / 2, rise = W / Math.sqrt(3);
    pen('#b0c9e3', 0.5);
    for (let x = h; x < W; x += h) seg(x, 0, x, H);
    for (let c = -Math.ceil(rise / s) * s; c <= H + rise; c += s) { seg(0, c, W, c + rise); seg(0, c, W, c - rise); }
    ops.push(L.stroke());
  } else if (paper === 'dots') {
    pen('#8a9bb0', 2.4);
    ops.push(L.setLineCap(L.LineCapStyle.Round));   // a zero-length line with a round cap is a dot
    for (let x = STEP; x < W; x += STEP) for (let y = STEP; y < H; y += STEP) seg(x, H - y, x, H - y);
    ops.push(L.stroke());
  }
  return ops.length ? [L.pushGraphicsState(), ...ops, L.popGraphicsState()] : [];
}

function addPaper(L, pdf, paper, index) {
  const page = pdf.insertPage(index, [W, H]);
  const ops = paperOps(L, paper);
  if (ops.length) page.pushOperators(...ops);
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/* a new one-page notebook: returns the PDF's bytes */
export async function newNotebook(paper, title) {
  const L = await loadPdfLib();
  const pdf = await L.PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('OverBoard');
  pdf.setKeywords(['overboard-notebook-' + newId()]);
  addPaper(L, pdf, paper, 0);
  return pdf.save({ useObjectStreams: true });
}

/* a copy of the notebook with a new page of `paper` after page `after` (0 = at the start) */
export async function addPage(bytes, paper, after) {
  const L = await loadPdfLib();
  const pdf = await L.PDFDocument.load(bytes, { updateMetadata: false });
  addPaper(L, pdf, paper, Math.min(Math.max(0, after), pdf.getPageCount()));
  return pdf.save({ useObjectStreams: true });
}

/* a copy of the notebook without page n (counting from 1) */
export async function removePage(bytes, n) {
  const L = await loadPdfLib();
  const pdf = await L.PDFDocument.load(bytes, { updateMetadata: false });
  if (pdf.getPageCount() <= 1) throw new Error('a notebook needs at least one page');
  pdf.removePage(n - 1);
  return pdf.save({ useObjectStreams: true });
}

/* Ink after a page was added (by = 1, the new page is `at`) or removed (by = -1, page `at` is gone),
   in every class period, so it stays on the page it was written on. */
export function shiftInk(periods, at, by) {
  for (const name of Object.keys(periods)) {
    periods[name] = periods[name]
      .filter((s) => !(by < 0 && s.page === at))
      .map((s) => (s.page >= at ? { ...s, page: s.page + by } : s));
  }
}
