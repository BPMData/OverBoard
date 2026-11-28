// Export PDF (with the warning about covers) and the .overboard.json ink file (Save ink / Load ink).

import { flashBtn } from '../shared/ink-core.js';
import { stripExt } from './image.js';
import * as store from './store.js';
import { ink, setStatus, viewer } from './core.js';
import { markDirty, writeNow } from './saving.js';
import { $, D, doc, setInkData, tr } from './state.js';
import { refreshRedo } from './toolbar.js';
import { refresh, renderPeriods } from './tools.js';

/* ---------- export annotated PDF ---------- */
const baseName = () => stripExt(doc.name);
// only the active period is exported, so the name says which: Moby_Dick_annotated_P1.pdf
const exportName = () => (baseName() + '_annotated_' + D.active).replace(/\s+/g, '_') + '.pdf';
const coverWarn = $('#ob-coverwarn');
function ask(dialog) {
  // resolves true for the dialog's "ok" button
  return new Promise((done) => {
    const onClick = (e) => {
      const b = e.target.closest('button');
      if (!b && e.target !== dialog) return;
      dialog.removeEventListener('click', onClick);
      dialog.close();
      done(!!b && b.value === 'ok');
    };
    dialog.addEventListener('click', onClick);
    dialog.addEventListener(
      'cancel',
      () => {
        dialog.removeEventListener('click', onClick);
        done(false);
      },
      { once: true }
    );
    dialog.showModal();
  });
}
export async function exportPdf(btn) {
  if (!doc) return;
  let covered = false;
  await writeNow();
  // an empty notebook still exports: printable paper
  // ... and so does a PDF with turned pages: a copy the right way up
  if (!ink.count() && !doc.notebook && !Object.keys(D.rot || {}).length) {
    flashBtn(btn, tr('no_ink_yet'), 'warn');
    setStatus(tr('st_no_ink_export', { p: D.active }));
    return;
  }
  btn.disabled = true;
  setStatus(tr('st_making_pdf'));
  try {
    const { exportAnnotatedPdf, hasCovers } = await import('./export.js');
    // covers hide answers in the PDF too, but the text under them is still in the file: say so plainly
    covered = hasCovers(ink.byPage);
    if (covered && !(await ask(coverWarn))) {
      setStatus(tr('st_export_cancelled', { p: D.active }));
      return;
    }
    const bytes = new Uint8Array(await doc.file.slice(0, doc.base).arrayBuffer()); // without the stored ink
    const out = await exportAnnotatedPdf(bytes, doc.pdf, ink.byPage, D.rot, (n) =>
      setStatus(tr('st_making_pdf_n', { n }))
    );
    store.download(new Blob([out], { type: 'application/pdf' }), exportName());
    setStatus(tr('st_pdf_downloaded', { p: D.active }) + (covered ? tr('st_covered_note') : ''));
    flashBtn(btn, tr('downloaded_flash'), 'good');
  } catch (e) {
    console.error(e);
    setStatus(tr('st_export_failed', { e: (e && e.message) || e }));
    flashBtn(btn, tr('not_saved'), 'warn');
  } finally {
    btn.disabled = false;
  }
}

/* ---------- ink sidecar file (.overboard.json) ---------- */
export async function saveInkFile(btn) {
  if (!doc) return;
  await writeNow();
  store.download(new Blob([store.makeSidecar(D, doc)], { type: 'application/json' }), baseName() + '.overboard.json');
  flashBtn(btn, tr('saved_flash'), 'good');
  setStatus(tr('st_ink_file_downloaded'));
}
export async function importInk(file) {
  try {
    const { data, pdf } = store.parseSidecar(await file.text());
    if (
      pdf.sha256 &&
      pdf.sha256 !== doc.hash &&
      !confirm(tr('confirm_other_pdf', { f: pdf.name || tr('another_pdf') }))
    )
      return;
    const has = Object.values(D.periods).some((l) => l.length);
    if (has && !confirm(tr('confirm_replace_ink', { f: file.name }))) return;
    setInkData(data);
    ink.setData(D);
    viewer.applyTurns();
    refreshRedo();
    renderPeriods();
    refresh();
    markDirty();
    await writeNow();
    setStatus(tr('st_ink_loaded_from', { f: file.name }));
  } catch (e) {
    setStatus(e.message || String(e));
  }
}
export function initExporting() {
  $('#ob-inkfile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f && doc) importInk(f);
  });
}
