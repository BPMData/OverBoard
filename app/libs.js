// Pinned library versions, loaded from jsDelivr. Change versions here only.
export const PDFJS_VERSION = '4.10.38';
export const PDFLIB_VERSION = '1.17.1';

const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
export const PDFJS_URL = `${PDFJS_BASE}/build/pdf.min.mjs`;
export const PDFJS_WORKER_URL = `${PDFJS_BASE}/build/pdf.worker.min.mjs`;
export const PDFJS_CMAPS_URL = `${PDFJS_BASE}/cmaps/`;
export const PDFJS_FONTS_URL = `${PDFJS_BASE}/standard_fonts/`;
export const PDFLIB_URL = `https://cdn.jsdelivr.net/npm/pdf-lib@${PDFLIB_VERSION}/dist/pdf-lib.esm.min.js`;

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

let pdflibPromise = null;
export function loadPdfLib() {   // only needed for "Export PDF", so it loads on first use
  if (!pdflibPromise) {
    pdflibPromise = import(PDFLIB_URL);
    pdflibPromise.catch(() => { pdflibPromise = null; });
  }
  return pdflibPromise;
}
