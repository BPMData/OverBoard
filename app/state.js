// The PDF app's settings, shared state and the toolbar's page elements (used by every other app/ module).

import { obLang, obT } from '../shared/strings.js';
import { hlInk, startPen } from '../shared/ink-core.js';
import { PDFJS_CMAPS_URL, PDFJS_FONTS_URL } from './libs.js';

/* ===== SETTINGS (same meaning as in the overlay) ===== */
export const PERIODS = ['P1', 'P2', 'P3', 'P4']; // until a list is set in File ▸ Settings… (shared with the overlay)
export const SAVE_DELAY_MS = 3000; // after you stop writing, wait this long, then save. Also saves when the tab is hidden or closed.
export const PDF_SAVE_DELAY_MS = 8000; // "Save ink into PDF" (when on) writes the file this long after you stop writing
export const FINGER_SCROLLS = true; // true = finger scrolls, pen writes. The toolbar button flips this (remembered per browser).
export const PALM_ERASER_W = 92; // eraser size (screen px) when you wipe with your palm, fist or side of hand
export const ERASER_W = 44; // eraser size (screen px) with the Eraser button
export const SMOOTHING = 3; // starting level 0-8
export const HIGHLIGHT_COLOR = '#fdd835'; // highlighter starts yellow; after that it remembers the last highlighter color you picked
export const HIGHLIGHT_W = 22; // starting highlighter width; the - / + buttons change it while the highlighter is on
export const HIGHLIGHT_STRENGTH = 50; // highlight strength in % (Highlighter ▾ slider, 10-100): 100 = the full color, 50 = halfway to white
export let tr = obT(obLang()); // OverBoard's words in the language picked in Settings (shared/strings.js); setLang() swaps it
export function setTr(t) {
  tr = t;
}
export const PEN_COLOR = '#e0218a'; // the pen starts Barbie pink (high visibility on the board) unless File ▸ Settings… picks another; the palette changes it
export const COVER_COLOR = '#111111'; // Highlighter ▾ Cover: an opaque stroke that hides answers (erase it to reveal them)
/* ===================== */

export const $ = (s, el = document) => el.querySelector(s);
export const bar = $('#ink-bar'),
  showBtn = $('#ink-show'),
  statusEl = $('#ink-status'),
  periodsEl = $('#ink-periods');
export const pagesEl = $('#ob-pages'),
  pageInput = $('#ob-page'),
  pagesTotal = $('#ob-pages-total');
export const picker = $('#ink-picker'),
  customFill = $('[data-act="custom"] .fill', bar);
export const sizeNum = $('#ink-size .num'),
  sizeDot = $('#ink-size .dot'),
  smoothNum = $('#ink-smooth .num');
export const pagesBtn = $('[data-act="pages"]', bar),
  addPageEl = $('#ob-addpage');
export const toc = $('#ob-toc'),
  tocBtn = $('[data-act="toc"]', bar),
  fitBtn = $('[data-act="zoom-fit"]', bar);

export function getLS(k) {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
export function setLS(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch (e) {
    /* private mode */
  }
}
export const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');

/* ---------- tool state (read by the ink layer) ---------- */
export const T = {
  typing: false,
  erasing: false,
  hiliting: false,
  covering: false, // covering: the highlighter is in Cover mode
  laser: false, // laser pointer: tap the selected color again, and marks fade away by themselves
  selecting: false, // the Select tool: the pen circles ink instead of writing
  penColor: PEN_COLOR,
  hlColor: HIGHLIGHT_COLOR,
  coverColor: COVER_COLOR, // pen, highlighter and cover each remember their own color
  color: PEN_COLOR,
  width: 2.5,
  hlWidth: HIGHLIGHT_W,
  smooth: SMOOTHING,
  fingerScrolls: FINGER_SCROLLS,
  customColor: '',
  PALM_ERASER_W,
  ERASER_W,
  hlStrength: HIGHLIGHT_STRENGTH,
  hlInk() {
    return hlInk(this.color, this.hlStrength);
  }, // mixed toward white; it multiplies, so text stays black
};
{
  const sw = parseFloat(getLS('ink-width'));
  if (sw >= 1 && sw <= 14) T.width = sw;
  const hw = parseFloat(getLS('ink-hl-width'));
  if (hw >= 8 && hw <= 40) T.hlWidth = hw;
  const hc = getLS('ink-hl-color');
  if (isHex(hc)) T.hlColor = hc;
  const cc = getLS('ink-custom');
  if (isHex(cc)) T.customColor = cc;
  T.covering = getLS('ink-hl-mode') === 'cover';
  const hs = parseInt(getLS('ink-hl-strength'), 10);
  if (hs >= 10 && hs <= 100) T.hlStrength = hs;
  const kc = getLS('ink-cover-color');
  if (isHex(kc)) T.coverColor = kc;
  const sl = getLS('ink-smooth');
  if (sl !== null && +sl >= 0 && +sl <= 8) T.smooth = +sl;
  const fm = getLS('ink-finger');
  if (fm) T.fingerScrolls = fm === 'scroll';
  T.penColor = T.color = startPen(PEN_COLOR);
}

/* ---------- the open document ---------- */
export let doc = null; // { hash, name, pages, file, pdf, notebook }
export let D = null; // ink data: { v: 3, t, active, at, periods: { P1: [strokes] }, rot: { page: 90 | 180 | 270 } (Turn page) }
export function setDoc(v) {
  doc = v;
}
export function setInkData(v) {
  D = v;
}
export const findPanel = $('#ob-find');
export const PDF_OPTS = {
  cMapUrl: PDFJS_CMAPS_URL,
  cMapPacked: true,
  standardFontDataUrl: PDFJS_FONTS_URL,
  isEvalSupported: false,
};
