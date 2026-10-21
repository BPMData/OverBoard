// Site-level checks: matching file versions, no other sites contacted, toolbar fits a 1080p board.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, fileMenu, download } = require('./support/app');
const version = require('../app/version.json');

test('every app module loads at the current version', async ({ page }) => {
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  await openApp(page);
  const mods = urls.filter((u) => /\/(app|shared)\/[\w-]+\.js(\?|$)/.test(u));
  expect(mods.length).toBeGreaterThanOrEqual(version.js.length - 1);   // export.js loads on first export
  for (const u of mods) expect(u).toMatch(new RegExp(`\\?v=${version.v}$`));
});

test('an older cached copy of the page reloads once, then runs', async ({ page }) => {
  let loads = 0;
  await page.route('**/app/', async (route) => {
    loads++;
    const r = await route.fetch();
    route.fulfill({ response: r, body: (await r.text()).replace(/(name="ob-version" content=")[^"]*/, '$1old') });
  });
  await openApp(page);
  await page.waitForTimeout(500);
  expect(loads).toBe(2);
});

test('the app still starts if version.json cannot be read', async ({ page }) => {
  await page.route('**/version.json', (r) => r.abort());
  await openApp(page);
});

test('opening and exporting a PDF contacts no other site', async ({ page }) => {
  const outside = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { outside.push(r.request().url()); r.abort(); });
  await openApp(page);
  await openPdf(page, 'book.pdf');
  await page.evaluate(() => __t.stroke(1, __t.line(100, 100, 300, 100)));
  const dl = await download(page, () => fileMenu(page, 'export'));
  expect(dl.suggestedFilename()).toBe('book_annotated_P1.pdf');
  expect(outside).toEqual([]);
});

test('the toolbar fits a 1080p board without scrolling; File menu opens beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 950 });   // Chrome's page area on a 1920x1080 screen
  await openApp(page);
  await openPdf(page, 'book.pdf');
  const bar = await page.evaluate(() => { const b = document.getElementById('ink-bar'); return { scroll: b.scrollHeight, client: b.clientHeight }; });
  expect(bar.scroll).toBeLessThanOrEqual(bar.client);
  await page.click('[data-act="file"]');
  const box = await page.locator('#ob-filemenu').boundingBox(), barBox = await page.locator('#ink-bar').boundingBox();
  expect(box.x).toBeGreaterThan(barBox.x + barBox.width);
  expect(box.y + box.height).toBeLessThanOrEqual(950);
  await page.mouse.click(1000, 500);
  await expect(page.locator('#ob-filemenu')).toBeHidden();
});
