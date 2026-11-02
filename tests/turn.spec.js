// Turn page (Settings & help ▸ ↻ Turn page / ↻ Turn all pages): for PDFs scanned upside down or sideways.
// The ink turns with the page, the turn is kept with the ink, and Export PDF comes out turned the same way.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, strokes, fileMenu, download } = require('./support/app');
const { pdfPixels, dark, white } = require('./support/render');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openApp(page);
  await openPdf(page, 'worksheet.pdf');
});

const draw = (page, n, pts) => page.evaluate(([n, pts]) => __t.stroke(n, pts), [n, pts]);
const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const size = (page, n) => page.evaluate((n) => { const P = __overboard.viewer.pages[n - 1]; return [P.w, P.h]; }, n);
const settle = (page) => page.waitForFunction(() => __overboard.viewer.pages[0].img);

test('Turn page turns the page and its ink; four turns bring it back', async ({ page }) => {
  const [w, h] = await size(page, 1);
  await draw(page, 1, line(100, 190, 300, 190));
  const before = (await strokes(page))[0].p.slice();
  await fileMenu(page, 'turn-page');
  await expect(page.locator('#ob-filemenu')).toBeVisible();   // stays open: tap again to keep turning
  expect(await size(page, 1)).toEqual([h, w]);
  expect(await size(page, 2)).toEqual([w, h]);                // only this page
  let p = (await strokes(page))[0].p;
  expect(p[0]).toBeCloseTo(h - before[1], 1);                 // a quarter turn clockwise: (x, y) -> (h - y, x)
  expect(p[1]).toBeCloseTo(before[0], 1);
  await fileMenu(page, 'turn-page');                          // upside down
  expect(await size(page, 1)).toEqual([w, h]);
  p = (await strokes(page))[0].p;
  expect(p[0]).toBeCloseTo(w - before[0], 1);
  expect(p[1]).toBeCloseTo(h - before[1], 1);
  expect(await page.evaluate(() => __overboard.data.rot)).toEqual({ 1: 180 });
  await settle(page);
  expect((await page.evaluate(([x, y]) => __t.px(1, x, y), [w - 200, h - 190]))[3]).toBeGreaterThan(200);
  await fileMenu(page, 'turn-page');
  await fileMenu(page, 'turn-page');
  expect((await strokes(page))[0].p).toEqual(before);
  expect(await page.evaluate(() => __overboard.data.rot)).toEqual({});
});

test('Turn all pages, then Export PDF comes out turned with the ink in place', async ({ page }, info) => {
  const [w, h] = await size(page, 1);
  await page.click('[data-color="#111111"]');
  await draw(page, 1, line(100, 190, 300, 190));
  await fileMenu(page, 'turn-all');
  await fileMenu(page, 'turn-all');
  for (const n of [1, 2, 3]) expect(await size(page, n)).toEqual([w, h]);
  expect(await page.evaluate(() => __overboard.data.rot)).toEqual({ 1: 180, 2: 180, 3: 180 });
  const dl = await download(page, () => fileMenu(page, 'export'));
  const file = info.outputPath('out.pdf');
  await dl.saveAs(file);
  const r = await pdfPixels(page, file, 1, [[w - 200, h - 190], [200, 190]]);
  expect(dark(r.px[0])).toBe(true);    // the ink, where it shows on screen
  expect(white(r.px[1])).toBe(true);   // not where it was before the turn
});

test('a turned PDF exports even with no ink, and the turn survives a reload', async ({ page }) => {
  await fileMenu(page, 'turn-page');
  await download(page, () => fileMenu(page, 'export'));
  await page.evaluate(() => __overboard.flush());
  await page.reload();
  await page.waitForFunction(() => window.__overboard && __overboard.viewer.stats().images >= 1);
  expect(await page.evaluate(() => __overboard.data.rot)).toEqual({ 1: 90 });
  const [w, h] = await size(page, 1), [w2, h2] = await size(page, 2);
  expect([w, h]).toEqual([h2, w2]);
});
