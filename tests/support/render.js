// Render a PDF (e.g. an exported one) in the test page with the app's own PDF.js and read pixels.
// Points are in PDF points from the top-left of the page as shown.
const fs = require('fs');

async function pdfPixels(page, file, pageNo, points) {
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate(async ({ b64, pageNo, points }) => {
    const lib = await import(new URL('vendor/pdfjs-dist@4.10.38/pdf.min.mjs', new URL('/app/', location.href)).href);
    lib.GlobalWorkerOptions.workerSrc = new URL('/app/vendor/pdfjs-dist@4.10.38/pdf.worker.min.mjs', location.href).href;
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pdf = await lib.getDocument({ data }).promise;
    const pg = await pdf.getPage(pageNo), vp = pg.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    await pg.render({ canvasContext: g, viewport: vp }).promise;
    const out = points.map(([x, y]) => Array.from(g.getImageData(Math.round(x * 2), Math.round(y * 2), 1, 1).data.slice(0, 3)));
    const attachments = await pdf.getAttachments();
    await pdf.destroy();
    return { pages: pdf.numPages, px: out, attachments: attachments ? Object.keys(attachments) : [] };
  }, { b64, pageNo, points });
}

/* the text (per page) and link annotations a PDF file carries, read with PDF.js like any PDF reader would */
async function pdfText(page, file) {
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate(async (b64) => {
    const lib = await import(new URL('vendor/pdfjs-dist@4.10.38/pdf.min.mjs', new URL('/app/', location.href)).href);
    lib.GlobalWorkerOptions.workerSrc = new URL('/app/vendor/pdfjs-dist@4.10.38/pdf.worker.min.mjs', location.href).href;
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pdf = await lib.getDocument({ data }).promise;
    const text = [], links = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const pg = await pdf.getPage(n);
      text.push((await pg.getTextContent()).items.map((i) => i.str).join(' '));
      for (const a of await pg.getAnnotations()) if (a.subtype === 'Link') links.push({ page: n, url: a.url || null, dest: !!a.dest });
    }
    await pdf.destroy();
    return { text, links };
  }, b64);
}

const dark = ([r, g, b]) => r + g + b < 200;
const white = ([r, g, b]) => r + g + b > 740;

module.exports = { pdfPixels, pdfText, dark, white };
