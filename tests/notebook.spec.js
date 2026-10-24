// Blank notebooks (app/notebook.js): start from blank / lined / graph / dot paper, add and remove pages.
const fs = require('fs');
const { test } = require('@playwright/test');
const { expect, openApp, strokes, fileMenu, download } = require('./support/app');
const { pdfPixels } = require('./support/render');

const draw = (page, n, pts) => page.evaluate(([n, pts]) => __t.stroke(n, pts), [n, pts]);
const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const pages = (page) => page.evaluate(() => __overboard.doc.pages);
const ready = (page, n) => page.waitForFunction((n) => __overboard.doc && __overboard.doc.pages === n && __overboard.viewer.pages.length === n && __overboard.viewer.stats().images >= 1, n);
const inkPages = async (page, p = 'P1') => (await strokes(page, p)).map((s) => s.page);

async function startBlank(page, paper) {
  await page.click(`#ob-blank [data-paper="${paper}"]`);
  await ready(page, 1);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openApp(page);
});

test('the start screen makes a one-page notebook of each paper', async ({ page }) => {
  for (const paper of ['blank', 'lined', 'graph', 'dots', 'iso']) {
    await startBlank(page, paper);
    await expect(page.locator('#ink-bar [data-act="pages"]')).toBeVisible();
    await expect(page.locator('#ob-addpage')).toBeVisible();
    await expect(page.locator('#ob-pages-total')).toHaveText('of 1');
    expect(await page.evaluate(() => __overboard.doc.name)).toMatch(/^Notebook .+\.pdf$/);
    await fileMenu(page, 'close');
    await expect(page.locator('#ob-start')).toBeVisible();
  }
  await expect(page.locator('#ob-recent li')).toHaveCount(5);
});

test('the paper is drawn into the PDF', async ({ page }, info) => {
  const out = {};
  for (const paper of ['lined', 'graph', 'blank', 'iso']) {
    const at = paper === 'iso' ? Array.from({ length: 40 }, (_, i) => [280 + i / 2, 400]) : [[300, 72], [72, 400], [300, 80], [90, 300], [300, 306]];
    await startBlank(page, paper);
    const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await __overboard.doc.file.arrayBuffer())));
    const f = info.outputPath(paper + '.pdf');
    fs.writeFileSync(f, Buffer.from(bytes));
    // lined: a line 72 pt from the top and the red margin 72 pt in; graph: a line every 18 pt
    out[paper] = (await pdfPixels(page, f, 1, at)).px;   // iso: a short row that crosses its lines
    await fileMenu(page, 'close');
  }
  const white = (p) => p.every((v) => v > 245), ink = (p) => !white(p);
  expect(ink(out.lined[0])).toBe(true);
  expect(out.lined[1][0]).toBeGreaterThan(out.lined[1][2]);   // the margin is red
  expect(white(out.lined[2])).toBe(true);
  expect(ink(out.graph[3]) && ink(out.graph[4])).toBe(true);
  expect(out.blank.every(white)).toBe(true);
  expect(out.iso.some((p) => p[0] < 235)).toBe(true);
});

test('adding and removing pages keeps the ink on its page, in every class period', async ({ page }) => {
  await startBlank(page, 'lined');
  await draw(page, 1, line(100, 200, 300, 200));
  await page.click('#ob-addpage [data-paper="graph"]');                        // under the last page: adds page 2
  await ready(page, 2);
  await expect(page.locator('#ink-status')).toHaveText('Page 2 added');
  await expect(page.locator('#ob-pages-total')).toHaveText('of 2');
  await expect(page.locator('#ink-bar [data-act="clear"]')).toBeVisible();   // Pages ▸ | Clear ▸ now
  await draw(page, 2, line(100, 300, 300, 300));
  await page.click('[data-period="P2"]');
  await draw(page, 2, line(100, 400, 300, 400));
  await page.click('[data-period="P1"]');
  await page.evaluate(() => __overboard.viewer.goTo(1));
  await page.waitForTimeout(250);
  await page.click('#ink-bar [data-act="pages"]');                              // Pages ▸ Dots: a new page 2
  await page.click('#ob-pagemenu [data-paper="dots"]');
  await ready(page, 3);
  expect(await inkPages(page)).toEqual([1, 3]);
  expect(await inkPages(page, 'P2')).toEqual([3]);
  await page.evaluate(() => __overboard.viewer.goTo(1));
  await page.waitForTimeout(250);
  await page.click('#ink-bar [data-act="pages"]');                              // remove page 1 (tap twice)
  await page.click('#ob-pagemenu [data-act="remove-page"]');
  await expect(page.locator('#ob-pagemenu [data-act="remove-page"]')).toHaveText('Sure?');
  await page.click('#ob-pagemenu [data-act="remove-page"]');
  await ready(page, 2);
  await expect(page.locator('#ink-status')).toHaveText('Page 1 removed');
  expect(await inkPages(page)).toEqual([2]);
  expect(await inkPages(page, 'P2')).toEqual([2]);
});

test('a notebook comes back after a reload with its pages, ink and ID', async ({ page }) => {
  await startBlank(page, 'dots');
  const hash = await page.evaluate(() => __overboard.doc.hash);
  expect(hash).toMatch(/^notebook-[0-9a-f]{16}$/);
  await page.click('#ob-addpage [data-paper="blank"]');
  await ready(page, 2);
  await draw(page, 2, line(100, 200, 300, 200));
  await page.evaluate(() => __overboard.flush());
  await page.reload();
  await page.waitForFunction(() => window.__overboard.doc);
  await ready(page, 2);
  expect(await page.evaluate(() => __overboard.doc.hash)).toBe(hash);
  expect(await inkPages(page)).toEqual([2]);
  await fileMenu(page, 'close');
  await expect(page.locator('#ob-recent li small').first()).toContainText('2 pages');
});

test('an empty notebook exports as printable paper', async ({ page }, info) => {
  await startBlank(page, 'graph');
  const dl = await download(page, () => fileMenu(page, 'export'));
  const f = info.outputPath('empty.pdf');
  await dl.saveAs(f);
  const r = await pdfPixels(page, f, 1, [[90, 300]]);
  expect(r.pages).toBe(1);
  expect(r.px[0].every((v) => v > 245)).toBe(false);   // the grid is there
});

test('the last page cannot be removed; Export PDF gives a plain PDF with the ink drawn in', async ({ page }, info) => {
  await startBlank(page, 'blank');
  await page.click('#ink-bar [data-act="pages"]');
  await page.click('#ob-pagemenu [data-act="remove-page"]');
  await expect(page.locator('#ink-status')).toHaveText('A notebook needs at least one page');
  expect(await pages(page)).toBe(1);
  await page.keyboard.press('Escape');
  await draw(page, 1, line(100, 200, 300, 200));
  const dl = await download(page, () => fileMenu(page, 'export'));
  const f = info.outputPath('export.pdf');
  await dl.saveAs(f);
  const kw = await page.evaluate(async (b64) => {
    const lib = await import(new URL('/app/vendor/pdfjs-dist@4.10.38/pdf.min.mjs', location.href).href);
    const pdf = await lib.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
    return (await pdf.getMetadata()).info.Keywords || '';
  }, fs.readFileSync(f).toString('base64'));
  expect(kw).not.toMatch(/overboard-notebook/);   // opening the export won't show the ink twice
  const r = await pdfPixels(page, f, 1, [[200, 200], [200, 260]]);
  expect(r.px[0][0]).toBeGreaterThan(r.px[0][1] + 60);   // the pink pen line, drawn into the PDF
  expect(r.px[1].every((v) => v > 245)).toBe(true);
});
