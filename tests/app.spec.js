// PDF app on a 3-page worksheet: drawing, zoom, colors, palm, finger, undo/clear, periods, saving, ink files, export.
const fs = require('fs');
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, strokes, last, fileMenu, download } = require('./support/app');
const { pdfPixels, dark, white } = require('./support/render');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openApp(page);
  await openPdf(page, 'worksheet.pdf');
});

const px = (page, x, y, layer = 'ink') => page.evaluate(([x, y, l]) => __t.px(1, x, y, l), [x, y, layer]);
const draw = (page, n, pts, o) => page.evaluate(([n, pts, o]) => __t.stroke(n, pts, o), [n, pts, o]);
const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const top = (page, n = 1) => page.evaluate(async (n) => { __overboard.viewer.goTo(n); await new Promise((r) => setTimeout(r, 250)); }, n);

test('a pen stroke is stored in page points and drawn', async ({ page }) => {
  await draw(page, 1, line(100, 200, 300, 200));
  const s = await last(page);
  expect(s.page).toBe(1);
  expect(s.e).toBeFalsy();
  expect(s.p[0]).toBeCloseTo(100, 0);
  expect(s.p[1]).toBeCloseTo(200, 0);
  expect(s.p[s.p.length - 2]).toBeCloseTo(300, 0);
  expect((await px(page, 200, 200))[3]).toBeGreaterThan(200);
});

test('ink stays on the same spot of the page at any zoom', async ({ page }) => {
  await draw(page, 1, line(100, 200, 300, 200));
  for (const z of [2.5, 0.7, 'fit']) {
    await page.evaluate((z) => __overboard.viewer.setZoom(z), z);
    await top(page);
    expect((await px(page, 200, 200))[3], `zoom ${z}`).toBeGreaterThan(60);
    expect((await px(page, 200, 230))[3], `zoom ${z}`).toBe(0);
  }
});

test('highlighter keeps its own color, separate from the pen', async ({ page }) => {
  const on = () => page.evaluate(() => document.querySelector('#ink-bar [data-color].on')?.dataset.color);
  await page.click('[data-color="#1565c0"]');
  await page.click('[data-act="hilite"]');
  expect(await on()).toBe('#fdd835');
  await draw(page, 1, line(80, 300, 400, 300));
  const s = await last(page);
  expect(s.h).toBe(1);
  expect(s.c).toBe('#feec9a');   // yellow mixed halfway to white
  expect((await px(page, 200, 300, 'hl'))[3]).toBeGreaterThan(200);
  await page.click('[data-color="#d32f2f"]');
  await page.click('[data-act="hilite"]');
  expect(await on()).toBe('#1565c0');
  await page.click('[data-act="hilite"]');
  expect(await on()).toBe('#d32f2f');
  expect(await page.evaluate(() => localStorage.getItem('ink-hl-color'))).toBe('#d32f2f');
});

test('palm erases under the hand only, at screen size', async ({ page }) => {
  await draw(page, 1, line(100, 200, 300, 200));
  await draw(page, 1, line(150, 170, 150, 230), { buttons: 32 });
  const s = await last(page), z = await page.evaluate(() => __overboard.viewer.zoom);
  expect(s.e).toBe(1);
  expect(s.w).toBeCloseTo(92 / z, 1);
  expect((await px(page, 150, 200))[3]).toBe(0);
  expect((await px(page, 280, 200))[3]).toBeGreaterThan(200);
});

test('a finger scrolls and never draws', async ({ page }) => {
  const y0 = await page.evaluate(() => scrollY);
  await draw(page, 1, [[200, 600], [200, 500], [200, 400], [200, 300]], { type: 'mouse' });
  expect(await strokes(page)).toHaveLength(0);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(y0 + 100);
});

test('undo, clear page and undo-clear; periods keep separate ink', async ({ page }) => {
  await draw(page, 1, line(100, 200, 300, 200));
  await draw(page, 1, line(100, 250, 300, 250));
  await page.click('[data-act="undo"]');
  expect(await strokes(page)).toHaveLength(1);
  await page.click('[data-act="clear-page"]');                   // no chapters: Clear page | Clear all
  expect(await strokes(page)).toHaveLength(0);
  await page.click('[data-act="undo"]');
  expect(await strokes(page)).toHaveLength(1);
  await page.click('[data-period="P2"]');
  expect(await page.evaluate(() => __overboard.viewer.pages[0].ink)).toBeNull();
  await draw(page, 1, line(100, 100, 200, 150));
  expect(await strokes(page, 'P2')).toHaveLength(1);
  expect(await strokes(page, 'P1')).toHaveLength(1);
});

test('ink comes back after a reload, from "Open again"', async ({ page }) => {
  await draw(page, 1, line(100, 200, 300, 200));
  await page.evaluate(() => __overboard.flush());
  const before = JSON.stringify(await page.evaluate(() => __overboard.data.periods));
  await page.reload();
  await page.waitForSelector('#ob-recent li');
  await page.click('#ob-recent .open');
  await page.waitForFunction(() => window.__overboard.data && window.__overboard.viewer.stats().images >= 1);
  expect(JSON.stringify(await page.evaluate(() => __overboard.data.periods))).toBe(before);
});

test('ink file (.overboard.json) round-trips into a fresh browser', async ({ page, browser }, info) => {
  await draw(page, 1, line(100, 200, 300, 200));
  await page.click('[data-period="P2"]');
  await draw(page, 1, line(100, 300, 300, 300));
  const dl = await download(page, () => fileMenu(page, 'ink-save'));
  expect(dl.suggestedFilename()).toBe('worksheet.overboard.json');
  const file = info.outputPath('ink.overboard.json');
  await dl.saveAs(file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(j.kind).toBe('pdf-ink');
  expect(j.pdf.sha256).toHaveLength(64);
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await openApp(p2);
  await openPdf(p2, 'worksheet.pdf');
  await p2.setInputFiles('#ob-inkfile', file);
  await p2.waitForFunction(() => window.__overboard.data.periods.P2.length === 1);
  expect(await strokes(p2, 'P1')).toHaveLength(1);
  await ctx.close();
});

test('Export PDF draws the ink into the PDF, named for the period', async ({ page }, info) => {
  await page.click('[data-color="#111111"]');      // black, so the check below can look for dark ink (the pen starts pink)
  await draw(page, 1, line(100, 190, 300, 190));   // y = 190: a blank strip between the printed text and its underline
  await page.click('[data-act="hilite"]');
  await draw(page, 1, line(80, 300, 400, 300));
  await page.click('[data-act="hilite"]');
  await draw(page, 1, line(150, 160, 150, 220), { buttons: 32 });   // palm cut through the pen line
  const dl = await download(page, () => fileMenu(page, 'export'));
  expect(dl.suggestedFilename()).toBe('worksheet_annotated_P1.pdf');
  const file = info.outputPath('out.pdf');
  await dl.saveAs(file);
  const r = await pdfPixels(page, file, 1, [[250, 190], [150, 190], [300, 300], [300, 330]]);
  expect(r.pages).toBe(3);
  expect(dark(r.px[0])).toBe(true);    // pen ink
  expect(white(r.px[1])).toBe(true);   // erased by the palm
  expect(r.px[2]).toEqual([254, 236, 154]);   // highlight
  expect(white(r.px[3])).toBe(true);
  await page.click('[data-period="P2"]');
  await fileMenu(page, 'export');
  await expect(page.locator('#ink-status')).toHaveText('P2 has no ink to export');
});
