// Pinned library versions. They are served from this site (app/vendor/), not a CDN, because school
// web filters sometimes block CDNs. To change a version: edit it here, then run python3 tools/vendor_libs.py
export const PDFJS_VERSION = '4.10.38';
export const PDFLIB_VERSION = '1.17.1';

const vendor = (path) => new URL('./vendor/' + path, import.meta.url).href;
const PDFJS_BASE = `pdfjs-dist@${PDFJS_VERSION}`;
export const PDFJS_URL = vendor(`${PDFJS_BASE}/pdf.min.mjs`);
export const PDFJS_WORKER_URL = vendor(`${PDFJS_BASE}/pdf.worker.min.mjs`);
export const PDFJS_CMAPS_URL = vendor(`${PDFJS_BASE}/cmaps/`);
export const PDFJS_FONTS_URL = vendor(`${PDFJS_BASE}/standard_fonts/`);
export const PDFLIB_URL = vendor(`pdf-lib@${PDFLIB_VERSION}/pdf-lib.esm.min.js`);

let pdfjsPromise = null;
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return lib;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

/* One PDF reader for every PDF this tab opens. Starting one means loading and starting the 1.4 MB
   pdf.worker file, so sharing it makes opening a PDF, Open again, and adding a notebook page faster.
   Closing a PDF doesn't stop it (PDF.js only stops readers it made itself). */
let worker = null;
export function pdfWorker(lib) {
  if (!worker || worker.destroyed) worker = new lib.PDFWorker({ name: 'overboard' });
  return worker;
}
export function dropPdfWorker() {   // after a PDF failed to open: the next one gets a fresh reader, in case this one broke
  if (worker) { try { worker.destroy(); } catch (e) { /* already gone */ } }
  worker = null;
}

/* get PDF.js and its reader ready while the start screen is up, so the first PDF opens sooner */
export function warmPdfjs() {
  const go = () => loadPdfjs().then(pdfWorker, () => {});
  if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 500);
}

let pdflibPromise = null;
export function loadPdfLib() {   // only needed for exporting and "Save ink into PDF", so it loads on first use
  if (!pdflibPromise) {
    pdflibPromise = import(PDFLIB_URL);
    pdflibPromise.catch(() => { pdflibPromise = null; });
  }
  return pdflibPromise;
}
