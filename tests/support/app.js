// Shared setup for the PDF app tests.
const path = require('path');
const { expect } = require('@playwright/test');

const FIX = path.join(__dirname, '..', 'fixtures');
const fixture = (name) => path.join(FIX, name);

async function openApp(page, { fakeFs = false } = {}) {
  await page.addInitScript({ path: path.join(__dirname, 'pointer.js') });
  if (fakeFs) await page.addInitScript({ path: path.join(__dirname, 'fakefs.js') });
  await page.goto('app/');
  await page.waitForFunction(() => window.__overboard);   // the loader has started the app
}

async function openPdf(page, name) {
  await page.setInputFiles('#ob-file', name.includes('/') ? name : fixture(name));
  await page.waitForFunction(() => window.__overboard.viewer.stats().images >= 1);
}

const strokes = (page, period = 'P1') => page.evaluate((p) => window.__overboard.data.periods[p], period);
const last = async (page) => (await strokes(page)).slice(-1)[0];

/* run a File-menu command */
async function fileMenu(page, act) {
  if (await page.locator('#ob-filemenu').isHidden()) await page.click('[data-act="file"]');
  await page.click(`#ob-filemenu [data-act="${act}"]`);
}

async function download(page, action) {
  const [dl] = await Promise.all([page.waitForEvent('download'), action()]);
  return dl;
}

module.exports = { expect, fixture, openApp, openPdf, strokes, last, fileMenu, download };
