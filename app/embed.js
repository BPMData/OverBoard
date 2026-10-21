// "Save ink into PDF" (opt-in): keep the ink inside a PDF file as an attached overboard-ink.json.
//
// The PDF's own bytes are never rewritten. The ink goes in one standard incremental update appended
// to the end of the file (new objects + an updated catalog + a cross-reference section pointing back
// to the original). Every save writes  original bytes + a fresh update,  so the file never keeps
// growing, and big books save quickly. The update's trailer records /OverBoardBase <length of the
// original>, so OverBoard can find the original bytes again (for hashing and for Export PDF).

import { loadPdfLib } from './libs.js';

export const INK_NAME = 'overboard-ink.json';
const MARK = '\n%OverBoardInk\n';
const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };

/* Length of the original PDF inside a file OverBoard saved ink into (or the whole length).
   Only trusted when our update is the last one in the file; if another app saved after us, the
   whole file counts as the original so its changes are kept. */
export function findBase(u8) {
  const n = u8.length, tail = latin1(u8.subarray(Math.max(0, n - 4096)));
  const ms = [...tail.matchAll(/\/OverBoardBase (\d+)/g)], m = ms[ms.length - 1];
  if (!m) return n;
  const base = +m[1], after = tail.slice(m.index);
  if (base <= 0 || base >= n || (after.match(/startxref/g) || []).length !== 1) return n;
  return latin1(u8.subarray(base, base + MARK.length)) === MARK ? base : n;
}

/* the ink stored inside an open PDF.js document, as sidecar text, or null */
export async function readEmbeddedInk(pdf) {
  let att = null;
  try { att = await pdf.getAttachments(); } catch (e) { return null; }
  if (!att) return null;
  const hit = att[INK_NAME] || Object.values(att).find((a) => a && a.filename === INK_NAME);
  return hit && hit.content ? new TextDecoder().decode(hit.content) : null;
}

/* Read what the update needs from the original PDF (once per linked file). */
export async function inspectBase(baseBytes) {
  const L = await loadPdfLib();
  const tail = latin1(baseBytes.subarray(Math.max(0, baseBytes.length - 4096)));
  const sx = [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!sx) throw new Error('this PDF has no cross-reference table OverBoard can follow');
  const prev = +sx[1];
  const xrefIsStream = !latin1(baseBytes.subarray(prev, prev + 4)).startsWith('xref');
  const doc = await L.PDFDocument.load(baseBytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const ctx = doc.context, t = ctx.trailerInfo;
  if (doc.isEncrypted || t.Encrypt) throw new Error('this PDF is password-protected or encrypted, so ink can’t be stored inside it. Use Save ink instead.');
  if (!t.Root) throw new Error('this PDF has no catalog');
  const N = (k) => L.PDFName.of(k);
  const catalog = ctx.lookup(t.Root, L.PDFDict);
  const entries = (dict, skip) => dict ? dict.entries().filter(([k]) => k !== N(skip)).map(([k, v]) => k.toString() + ' ' + v.toString()).join('\n') : '';
  const names = catalog.lookupMaybe(N('Names'), L.PDFDict);
  const files = [];   // existing attachments, kept as they are
  const walk = (node, depth) => {
    if (!node || depth > 20) return;
    const arr = node.lookupMaybe(N('Names'), L.PDFArray);
    if (arr) for (let i = 0; i + 1 < arr.size(); i += 2) {
      const key = ctx.lookup(arr.get(i));
      const text = key && key.decodeText ? key.decodeText() : String(key);
      if (text !== INK_NAME) files.push([text, key.toString(), arr.get(i + 1).toString()]);
    }
    const kids = node.lookupMaybe(N('Kids'), L.PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookupMaybe(i, L.PDFDict), depth + 1);
  };
  if (names) walk(names.lookupMaybe(N('EmbeddedFiles'), L.PDFDict), 0);
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const sizeM = [...tail.matchAll(/\/Size\s+(\d+)/g)].pop();
  return {
    prev, xrefIsStream,
    size: Math.max(ctx.largestObjectNumber + 1, sizeM ? +sizeM[1] : 0),
    root: [t.Root.objectNumber, t.Root.generationNumber],
    catalog: entries(catalog, 'Names'),
    names: entries(names, 'EmbeddedFiles'),
    files,
    extra: (t.Info ? '/Info ' + t.Info.toString() + ' ' : '') + (t.ID ? '/ID ' + t.ID.toString() : ''),
  };
}

async function deflate(u8) {   // zlib format = PDF FlateDecode
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function pdfDate(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return 'D:' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}

/* The bytes to append after the original PDF (baseLen bytes long). */
export async function buildUpdate(info, baseLen, json) {
  const raw = new TextEncoder().encode(json), comp = await deflate(raw);
  const chunks = [], offsets = {};
  let pos = 0;
  const put = (x) => { const b = typeof x === 'string' ? Uint8Array.from(x, (c) => c.charCodeAt(0) & 255) : x; chunks.push(b); pos += b.length; };
  const obj = (num, gen, body) => { offsets[num] = [baseLen + pos, gen]; put(num + ' ' + gen + ' obj\n'); put(body); put('\nendobj\n'); };
  let n = info.size;
  const A = n++, B = n++, C = n++, Dn = n++;
  const [rootNum, rootGen] = info.root;
  put(MARK);
  offsets[A] = [baseLen + pos, 0];
  put(A + ' 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fjson /Filter /FlateDecode /Length ' + comp.length +
    ' /Params << /Size ' + raw.length + ' /ModDate (' + pdfDate(new Date()) + ') >> >>\nstream\n');
  put(comp); put('\nendstream\nendobj\n');
  obj(B, 0, '<< /Type /Filespec /F (' + INK_NAME + ') /UF (' + INK_NAME + ') /EF << /F ' + A + ' 0 R >> /AFRelationship /Data' +
    ' /Desc (OverBoard ink. Open this PDF at bpmdata.github.io/OverBoard/app to keep writing on it.) >>');
  const pairs = [...info.files, [INK_NAME, '(' + INK_NAME + ')', B + ' 0 R']].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  obj(C, 0, '<< /Names [' + pairs.map((p) => p[1] + ' ' + p[2]).join(' ') + '] >>');
  obj(Dn, 0, '<<\n' + (info.names ? info.names + '\n' : '') + '/EmbeddedFiles ' + C + ' 0 R\n>>');
  obj(rootNum, rootGen, '<<\n' + info.catalog + '\n/Names ' + Dn + ' 0 R\n>>');
  const trailerKeys = '/Root ' + rootNum + ' ' + rootGen + ' R ' + info.extra + ' /Prev ' + info.prev + ' /OverBoardBase ' + baseLen;
  const xrefAt = baseLen + pos;
  if (info.xrefIsStream) {   // match the original: cross-reference stream
    const E = n++;
    offsets[E] = [xrefAt, 0];
    const nums = [rootNum, A, B, C, Dn, E], data = new Uint8Array(nums.length * 7);
    nums.forEach((k, i) => {
      const [off, gen] = offsets[k], o = i * 7;
      data[o] = 1; data[o + 1] = off >>> 24; data[o + 2] = (off >>> 16) & 255; data[o + 3] = (off >>> 8) & 255; data[o + 4] = off & 255;
      data[o + 5] = gen >> 8; data[o + 6] = gen & 255;
    });
    put(E + ' 0 obj\n<< /Type /XRef /Size ' + n + ' /W [1 4 2] /Index [' + rootNum + ' 1 ' + A + ' 5] ' + trailerKeys + ' /Length ' + data.length + ' >>\nstream\n');
    put(data); put('\nendstream\nendobj\n');
  } else {                   // classic cross-reference table
    const row = (k) => String(offsets[k][0]).padStart(10, '0') + ' ' + String(offsets[k][1]).padStart(5, '0') + ' n\r\n';
    put('xref\n0 1\n0000000000 65535 f\r\n' + rootNum + ' 1\n' + row(rootNum) + A + ' 4\n' + row(A) + row(B) + row(C) + row(Dn));
    put('trailer\n<< /Size ' + n + ' ' + trailerKeys + ' >>\n');
  }
  put('startxref\n' + xrefAt + '\n%%EOF\n');
  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/* Write original + update into a file the teacher chose. Never leaves the file half-written. */
export async function writeInto(handle, baseBlob, update) {
  const w = await handle.createWritable();
  try { await w.write(new Blob([baseBlob, update], { type: 'application/pdf' })); await w.close(); }
  catch (e) { try { await w.abort(); } catch (_) { /* ignore */ } throw e; }
}
