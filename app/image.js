// Pictures (PNG, JPG, WebP, and GIF/BMP/AVIF where the browser reads them): OverBoard turns the picture into
// a one-page PDF, so the pens, periods, Export PDF and Open again all work the same as for any PDF.
//
// The picture's ID (the start of its SHA-256) goes in the PDF's keywords, and the ink is kept under that ID,
// so opening the same picture again brings back its ink even though each new PDF's bytes differ a little.

import { loadPdfLib } from './libs.js';

export const IMG_RE = /overboard-image-([0-9a-f]{32})/;   // in the PDF's Keywords
const EXT = /\.(png|jpe?g|jfif|webp|gif|bmp|avif)$/i;
const LONG = 792;      // the page's longer side, in points: the same as a US Letter page
const MAX_PX = 4096;   // pictures redrawn in the browser are shrunk to this, to keep memory low on board PCs

export const isImage = (f) => f.type !== 'application/pdf' && (/^image\//.test(f.type) || EXT.test(f.name));
export const stripExt = (name) => name.replace(/\.pdf$/i, '').replace(EXT, '');

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const isPng = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/* the picture drawn on a canvas, as PNG or JPEG bytes. The browser turns phone photos the right way up. */
async function redraw(file, asJpg) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_PX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d');
  if (asJpg) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise((ok) => c.toBlob(ok, asJpg ? 'image/jpeg' : 'image/png', 0.92));
  c.width = c.height = 0;
  if (!blob) throw new Error('could not read the picture');
  return new Uint8Array(await blob.arrayBuffer());
}

/* a picture file -> a File holding a one-page PDF of it (with the picture's own name) */
export async function imageToPdf(file) {
  const L = await loadPdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = hex(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 32);
  const pdf = await L.PDFDocument.create();
  pdf.setTitle(stripExt(file.name));
  pdf.setCreator('OverBoard');
  pdf.setKeywords(['overboard-image-' + id]);
  let img = null;
  // a PNG goes in as it is (no quality lost). A JPEG is redrawn, because phone photos are often stored
  // sideways with a note saying which way is up, and the PDF would ignore that note.
  if (isPng(bytes)) { try { img = await pdf.embedPng(bytes); } catch (e) { /* an unusual PNG: redraw it */ } }
  if (!img) img = isJpg(bytes) ? await pdf.embedJpg(await redraw(file, true)) : await pdf.embedPng(await redraw(file, false));
  const k = LONG / Math.max(img.width, img.height);
  const w = img.width * k, h = img.height * k;
  pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  const out = await pdf.save({ useObjectStreams: true });
  return new File([out], file.name, { type: 'application/pdf' });
}
