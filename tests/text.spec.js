// Selectable text and links over the page images: alignment at any zoom and rotation, input rules,
// links, search, and exports that keep the original text.
// links.pdf is like an OCR'd scan: dark "scanned" headings with invisible text on top, a contents page
// with internal links and one external link, a landscape page (3) and a rotated page (4).
const fs = require('fs');
const { test } = require('@playwright/test');
const { expect, fixture, openApp, openPdf, strokes, fileMenu, download, penTap } = require('./support/app');
const { pdfText } = require('./support/render');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
});

const textReady = (page, n) => page.waitForFunction((n) => {
  const v = __overboard.viewer, P = v.pages[n - 1];
  return P.text && P.text.div.querySelector('.endOfContent') && P.imgZoom === v.zoom;
}, n);
const go = async (page, n) => { await page.evaluate((n) => __overboard.viewer.goTo(n), n); await textReady(page, n); };

/* where a text span is on screen: its rect, and screen points 10%/50%/90% along its text */
const span = (page, n, start) => page.evaluate(([n, start]) => {
  const P = __overboard.viewer.pages[n - 1];
  const el = [...P.text.div.querySelectorAll('span')].find((s) => s.textContent.startsWith(start));
  const r = el.getBoundingClientRect();
  const along = (f) => r.width > r.height ? [r.left + f * r.width, r.top + r.height / 2] : [r.left + r.width / 2, r.top + f * r.height];
  return { w: r.width, h: r.height, pts: [0.1, 0.5, 0.9].map(along) };
}, [n, start]);

/* brightness of the rendered page image under a screen point */
const imgAt = (page, n, [x, y]) => page.evaluate(([n, x, y]) => {
  const P = __overboard.viewer.pages[n - 1], r = P.sheet.getBoundingClientRect();
  const d = P.img.getContext('2d').getImageData(Math.floor((x - r.left) * P.img.width / r.width), Math.floor((y - r.top) * P.img.height / r.height), 1, 1).data;
  return d[0] + d[1] + d[2];
}, [n, x, y]);

const linkCenter = async (page, i) => {
  await page.waitForFunction(() => __overboard.viewer.pages[0].text?.links);
  return page.evaluate((i) => {
  const r = __overboard.viewer.pages[0].text.links.children[i].getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
  }, i);
};

test('text lines up with the page image at every zoom, on portrait, landscape and rotated pages', async ({ page }) => {
  await openApp(page);
  await openPdf(page, 'links.pdf');
  for (const z of ['fit', 2.5, 0.7]) {
    await page.evaluate((z) => __overboard.viewer.setZoom(z), z);
    for (const n of [2, 3, 4]) {
      await go(page, n);
      const s = await span(page, n, 'Scanned heading');
      const zoom = await page.evaluate(() => __overboard.viewer.zoom);
      const long = Math.max(s.w, s.h);
      expect(long / zoom, `page ${n} zoom ${z}: text length in points`).toBeGreaterThan(150);
      expect(long / zoom, `page ${n} zoom ${z}: text length in points`).toBeLessThan(260);
      expect(s.h > s.w, `page ${n}: runs down the page only when rotated`).toBe(n === 4);
      for (const p of s.pts) expect(await imgAt(page, n, p), `page ${n} zoom ${z}: over the scanned heading`).toBeLessThan(200);
    }
  }
});

test('Write mode: the text never takes the pen; Scroll mode: it does', async ({ page }) => {
  await openApp(page);
  await openPdf(page, 'links.pdf');
  await go(page, 2);
  const [x, y] = (await span(page, 2, 'Answer key line 1')).pts[1];
  const onText = () => page.evaluate(([x, y]) => !!document.elementFromPoint(x, y).closest('.textLayer'), [x, y]);
  expect(await onText()).toBe(false);
  await page.evaluate(() => __t.stroke(2, __t.line(80, 170, 400, 170)));   // right across the text
  expect(await strokes(page)).toHaveLength(1);
  await page.evaluate(() => __t.stroke(2, __t.line(200, 150, 200, 200), { buttons: 32 }));   // palm
  expect((await strokes(page)).slice(-1)[0].e).toBe(1);
  await page.click('[data-act="scroll"]');
  expect(await onText()).toBe(true);
  await page.click('[data-act="write"]');
  expect(await onText()).toBe(false);
});

test('Scroll mode: a drag on text selects it (no ink, no scrolling); a tap beside it clears it', async ({ page }) => {
  await openApp(page);
  await openPdf(page, 'links.pdf');
  await go(page, 2);
  await page.click('[data-act="scroll"]');
  const s = await span(page, 2, 'Answer key line 1:');
  const y0 = await page.evaluate(() => scrollY);
  await page.mouse.move(s.pts[0][0] - 0.08 * s.w, s.pts[0][1]);
  await page.mouse.down();
  await page.mouse.move(s.pts[1][0], s.pts[1][1], { steps: 5 });
  await page.mouse.move(s.pts[2][0] + 0.09 * s.w, s.pts[2][1], { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection().toString())).toContain('Answer key line 1');
  expect(await page.evaluate(() => scrollY)).toBe(y0);
  expect(await strokes(page)).toHaveLength(0);
  const g = await page.evaluate(() => { const r = __overboard.viewer.pages[1].el.getBoundingClientRect(); return [r.left + 10, r.top + 300]; });
  await page.mouse.click(g[0], g[1]);   // the writable gutter beside the page
  expect(await page.evaluate(() => getSelection().toString())).toBe('');
});

test('links: contents entries jump inside the PDF, web links open a new tab, Write mode ignores them', async ({ page, context }) => {
  await context.route('https://example.org/**', (r) => r.fulfill({ body: 'ok' }));
  await openApp(page);
  await openPdf(page, 'links.pdf');
  await textReady(page, 1);
  await page.waitForFunction(() => __overboard.viewer.pages[0].text.links);
  expect(await page.evaluate(() => __overboard.viewer.pages[0].text.links.children.length)).toBe(4);
  const current = () => page.evaluate(() => __overboard.viewer.currentPage());

  // Write mode: a pen tap on a link is just a dot of ink
  await penTap(page, ...(await linkCenter(page, 1)));
  expect(await strokes(page)).toHaveLength(1);
  expect(await current(page)).toBe(1);
  await page.click('[data-act="undo"]');

  await page.click('[data-act="scroll"]');
  await page.mouse.click(...(await linkCenter(page, 1)));   // finger (the board sends "mouse"): Chapter 2 -> page 3
  await expect.poll(current).toBe(3);
  await go(page, 1);
  await penTap(page, ...(await linkCenter(page, 2)));        // pen: Chapter 3 -> page 4
  await expect.poll(current).toBe(4);
  await go(page, 1);
  const [tab] = await Promise.all([context.waitForEvent('page'), penTap(page, ...(await linkCenter(page, 3)))]);
  expect(tab.url()).toBe('https://example.org/overboard');
  expect(await strokes(page)).toHaveLength(0);
});

test('Export PDF and Save ink into PDF keep the original text and links', async ({ page }, info) => {
  await openApp(page, { fakeFs: true });
  await openPdf(page, 'links.pdf');
  const orig = await pdfText(page, fixture('links.pdf'));
  expect(orig.text[1]).toContain('Answer key line 1: photosynthesis 2x1');
  await page.evaluate(() => __t.stroke(2, __t.line(80, 170, 400, 170)));
  await go(page, 4);
  await page.evaluate(() => __t.stroke(4, __t.line(80, 170, 400, 170)));
  await page.click('[data-act="hilite"]');
  await page.evaluate(() => __t.stroke(4, __t.line(80, 200, 400, 200)));

  const dl = await download(page, () => fileMenu(page, 'export'));
  const file = info.outputPath('export.pdf');
  await dl.saveAs(file);
  expect(await pdfText(page, file)).toEqual(orig);

  await fileMenu(page, 'pdf-link');
  await page.click('#ob-embed [value="ok"]');
  await page.waitForFunction(() => window.__writes >= 1);
  const board = info.outputPath('board.pdf');
  fs.writeFileSync(board, Buffer.from(await page.evaluate(() => __fileBytes('links_board.pdf'))));
  expect(await pdfText(page, board)).toEqual(orig);
});

test('Export PDF keeps the text of a normal worksheet', async ({ page }, info) => {
  await openApp(page);
  await openPdf(page, 'worksheet.pdf');
  await page.evaluate(() => __t.stroke(1, __t.line(100, 190, 300, 190)));
  const dl = await download(page, () => fileMenu(page, 'export'));
  const file = info.outputPath('export.pdf');
  await dl.saveAs(file);
  const r = await pdfText(page, file);
  expect(r.text[0]).toContain('1. Question text that a highlighter should cover nicely.');
  expect(r.text[2]).toContain('Worksheet page 3');
});

test('Find text searches the whole book and jumps to the match', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openApp(page);
  await openPdf(page, 'book.pdf');
  await page.keyboard.press('Control+f');
  await expect(page.locator('#ob-find')).toBeVisible();
  await expect(page.locator('#ob-find-q')).toBeFocused();
  await page.fill('#ob-find-q', 'Line 7 of page 250,');
  await page.press('#ob-find-q', 'Enter');
  await expect(page.locator('#ob-find .msg')).toHaveText('1 match on 1 page.', { timeout: 30000 });
  await expect(page.locator('#ob-find li')).toHaveCount(1);
  await page.click('#ob-find li button');
  await expect.poll(() => page.evaluate(() => __overboard.viewer.currentPage())).toBe(250);
  await page.waitForFunction(() => document.querySelector('.pg[data-n="250"] mark.hit.cur'));
  const box = await page.locator('.pg[data-n="250"] mark.hit.cur').boundingBox();
  expect(box.y).toBeGreaterThan(0);
  expect(box.y).toBeLessThan(1080);
  await page.keyboard.press('Escape');
  await expect(page.locator('#ob-find')).toBeHidden();
  expect(await page.locator('mark.hit').count()).toBe(0);

  await fileMenu(page, 'find');                                // also in the File menu
  await page.fill('#ob-find-q', 'chapter 16. lorem');
  await expect(page.locator('#ob-find .msg')).toHaveText('Showing the first 500 matches. Try more words.', { timeout: 30000 });   // 600 in chapter 16
});
