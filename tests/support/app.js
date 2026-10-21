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

/* real taps through Chrome's input pipeline (pointer events + click), like the SMART Board sends them:
   the pen tip is pointerType "pen", a finger is "mouse" */
async function tap(page, x, y, pointerType = 'pen') {
  const s = await page.context().newCDPSession(page);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType });
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType });
  await new Promise((r) => setTimeout(r, 40));   // the app drops sub-15 ms blips (hand/pen switching)
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType });
  await s.detach();
}
async function tapOn(page, selector, pointerType) {
  const b = await page.locator(selector).boundingBox();
  await tap(page, b.x + b.width / 2, b.y + b.height / 2, pointerType);
}
const penTap = (page, x, y) => tap(page, x, y, 'pen');

module.exports = { expect, fixture, openApp, openPdf, strokes, last, fileMenu, download, tap, tapOn, penTap };
