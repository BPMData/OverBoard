// OverBoard PDF: open a PDF, write on it with the overlay's toolbar, keep the ink, export an annotated PDF.
// Everything runs in this browser tab. Nothing is uploaded.

import { warmPdfjs } from './libs.js';
import { setupOffline } from './offline.js';
import { initCore } from './core.js';
import { initExporting } from './exporting.js';
import { initMenus } from './menus.js';
import { initNotebook } from './notebook-ui.js';
import { initOpen, inPdfStep, openFile, reopen } from './open.js';
import { initPageView } from './page-view.js';
import { initSaving, OPEN_KEY } from './saving.js';
import { initSettings, translateAll } from './settings.js';
import { initStartScreen, renderRecent } from './start-screen.js';
import { doc } from './state.js';
import { initToolbar } from './toolbar.js';
import { initPeriods, initTools, refresh } from './tools.js';

initCore();
initOpen();
initSaving();
initStartScreen();
initPageView();
initPeriods();
initSettings();
initTools();
initMenus();
initToolbar();
initNotebook();
initExporting();

/* ---------- start ---------- */
translateAll();
refresh();
renderRecent();
warmPdfjs();
setupOffline(openFile);
(() => {
  // reopen the PDF after a reload; typing or clicking the address shows the start screen
  const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  const how = nav ? nav.type : 'navigate';
  let hash = null;
  if (how === 'reload') {
    try {
      hash = sessionStorage.getItem(OPEN_KEY);
    } catch (e) {
      /* blocked */
    }
  } else if (how === 'back_forward' && inPdfStep()) hash = history.state.obPdf; // Back/Forward to where a PDF was open
  if (!hash && inPdfStep()) history.replaceState(null, '');
  if (hash && !doc) reopen(hash);
})();
