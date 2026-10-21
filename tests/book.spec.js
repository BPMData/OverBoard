// PDF app on a 320-page book with an outline, a landscape page and a rotated page.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, fileMenu, download } = require('./support/app');
const { pdfPixels, dark, white } = require('./support/render');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openApp(page);
  await openPdf(page, 'book.pdf');
});

const current = (page) => page.evaluate(() => __overboard.viewer.currentPage());

test('chapters, page box and page buttons', async ({ page }) => {
  await expect(page.locator('#ob-pages-total')).toHaveText('of 320');
  await page.waitForFunction(() => [...document.querySelectorAll('#ob-toc small')].every((s) => s.textContent) && document.querySelectorAll('#ob-toc small').length);
  expect(await page.locator('#ob-toc li').count()).toBe(32);   // 16 chapters + 16 sections
  await page.click('[data-act="toc"]');
  await page.click('#ob-toc li:nth-child(8) > button');        // Chapter 8 starts on page 141
  await expect.poll(() => current(page)).toBe(141);
  await expect(page.locator('#ob-page')).toHaveValue('141');
  await page.click('[data-act="toc-close"]');
  await page.fill('#ob-page', '300');
  await page.press('#ob-page', 'Enter');
  await expect.poll(() => current(page)).toBe(300);
  await page.click('[data-act="next"]');
  await expect.poll(() => current(page)).toBe(301);
});

test('only pages near the screen keep images and text layers while scrolling the whole book', async ({ page }) => {
  let most = 0, mostText = 0, text = 0;
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => scrollBy(0, innerHeight * 1.5));
    await page.waitForTimeout(30);
    const s = await page.evaluate(() => ({ ...__overboard.viewer.stats(), dom: document.querySelectorAll('.textLayer').length }));
    most = Math.max(most, s.images);
    mostText = Math.max(mostText, s.textLayers, s.dom);
    text += s.textLayers;
  }
  expect(await current(page)).toBeGreaterThan(40);
  expect(most).toBeLessThanOrEqual(8);
  expect(text).toBeGreaterThan(0);              // text layers were made on the way
  expect(mostText).toBeLessThanOrEqual(8);      // and freed with the images
});

test('mixed page sizes and rotation; export puts ink in the right place', async ({ page }, info) => {
  await page.waitForFunction(() => __overboard.viewer.pages[12].sized);
  const sizes = await page.evaluate(() => [11, 12, 13].map((n) => { const P = __overboard.viewer.pages[n - 1]; return [Math.round(P.w), Math.round(P.h)]; }));
  expect(sizes).toEqual([[792, 612], [612, 792], [792, 612]]);   // landscape, portrait, rotated 90°
  for (const n of [11, 13]) {
    await page.evaluate(async (n) => { __overboard.viewer.goTo(n); await new Promise((r) => setTimeout(r, 300)); }, n);
    await page.evaluate((n) => __t.stroke(n, __t.line(100, 100, 400, 100)), n);
    await page.evaluate((n) => __t.stroke(n, __t.line(250, 60, 250, 140), { buttons: 32 }), n);
  }
  const dl = await download(page, () => fileMenu(page, 'export'));
  const file = info.outputPath('book.pdf');
  await dl.saveAs(file);
  for (const n of [11, 13]) {
    const r = await pdfPixels(page, file, n, [[150, 100], [390, 100], [250, 100], [200, 130]]);
    expect(dark(r.px[0]) && dark(r.px[1]), `page ${n} ink`).toBe(true);
    expect(white(r.px[2]), `page ${n} palm gap`).toBe(true);
    expect(white(r.px[3]), `page ${n} nothing below`).toBe(true);
  }
});
