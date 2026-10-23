// Clear ▸ (this page / all pages), File ▸ Clear all ink, and the overlay's − / Fit / + zoom.
// The PDF app and the HTML overlay must behave the same.
const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, strokes } = require('./support/app');
const { openOverlay, savedInk } = require('./support/overlay');

const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const menuOpen = (page, id) => page.locator('#' + id).isVisible();

test.describe('PDF app', () => {
  const drawOn = async (page, n, y) => {
    await page.evaluate((n) => __overboard.viewer.goTo(n), n);
    await page.waitForTimeout(300);
    await page.evaluate(([n, y]) => __t.stroke(n, __t.line(100, y, 300, y)), [n, y]);
  };
  const pagesWithInk = async (page) => [...new Set((await strokes(page)).map((s) => s.page))].sort((a, b) => a - b);
  const shown = (page) => page.evaluate(() => [...document.querySelectorAll('#ink-bar button')].filter((b) => !b.hidden && b.offsetParent).map((b) => b.dataset.act).filter((a) => /^(toc|clear)/.test(a)));

  test('no chapters: Clear page | Clear all, like the HTML overlay; Clear all asks first; Undo / Redo', async ({ page }) => {
    await openApp(page); await openPdf(page, 'worksheet.pdf');
    expect(await shown(page)).toEqual(['clear-page', 'clear-all']);
    await drawOn(page, 1, 200);
    await drawOn(page, 2, 200);
    const before = await strokes(page);
    await page.evaluate(() => __overboard.viewer.goTo(1));
    await page.waitForTimeout(300);
    await page.click('#ink-bar [data-act="clear-page"]');            // one tap; Undo brings it back
    expect(await pagesWithInk(page)).toEqual([2]);
    await page.click('[data-act="undo"]');
    expect(await strokes(page)).toEqual(before);                    // back in its old place
    await page.click('#ink-bar [data-act="clear-all"]');
    await expect(page.locator('#ink-bar [data-act="clear-all"]')).toHaveText('Sure?');
    expect(await strokes(page)).toHaveLength(2);
    await page.click('#ink-bar [data-act="clear-all"]');
    expect(await strokes(page)).toHaveLength(0);
    await page.click('[data-act="undo"]');
    expect(await strokes(page)).toEqual(before);
    await page.click('[data-act="redo"]');
    expect(await strokes(page)).toHaveLength(0);
    await page.click('[data-act="file"]');
    await expect(page.locator('#ob-filemenu [data-act="clear-all"]')).toHaveCount(0);   // not in File any more
  });

  test('with chapters: Chapters | Clear ▸, Clear on the side its menu opens; This page / All pages', async ({ page }) => {
    await openApp(page); await openPdf(page, 'book.pdf');
    await expect.poll(() => shown(page)).toEqual(['toc', 'clear']);
    const box = (sel) => page.locator(sel).boundingBox();
    expect((await box('[data-act="clear"]')).x).toBeGreaterThan((await box('[data-act="toc"]')).x);
    await drawOn(page, 1, 200);
    await drawOn(page, 2, 200);
    await page.evaluate(() => __overboard.viewer.goTo(1));
    await page.waitForTimeout(300);
    await page.click('[data-act="clear"]');
    expect(await menuOpen(page, 'ob-clearmenu')).toBe(true);
    await page.click('#ob-clearmenu [data-act="clear-page"]');
    expect(await pagesWithInk(page)).toEqual([2]);
    expect(await menuOpen(page, 'ob-clearmenu')).toBe(false);
    await page.click('[data-act="undo"]');
    await page.click('[data-act="clear"]');
    await page.click('#ob-clearmenu [data-act="clear-all"]');      // "Sure?" keeps the menu open
    expect(await menuOpen(page, 'ob-clearmenu')).toBe(true);
    await page.click('#ob-clearmenu [data-act="clear-all"]');
    expect(await strokes(page)).toHaveLength(0);
    await page.click('[data-act="undo"]');
    expect(await pagesWithInk(page)).toEqual([1, 2]);
    // toolbar on the right: the menu opens to the left, so Clear moves left of Chapters
    await page.click('[data-act="file"]');
    await page.click('#ob-filemenu [data-act="side"]');
    await page.keyboard.press('Escape');
    expect((await box('[data-act="clear"]')).x).toBeLessThan((await box('[data-act="toc"]')).x);
    await page.click('[data-act="clear"]');
    expect((await box('#ob-clearmenu')).x + (await box('#ob-clearmenu')).width).toBeLessThan((await box('[data-act="clear"]')).x);
  });
});

test.describe('HTML overlay', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1400, height: 900 }); await openOverlay(page); });
  const stroke = (page, pts) => page.evaluate((pts) => new Promise(async (res) => {
    const c = document.getElementById('ink-canvas');
    const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 3, buttons: t === 'pointerup' ? 0 : 1, button: 0, clientX: x, clientY: y }));
    ev('pointerdown', ...pts[0]);
    for (const p of pts.slice(1)) { await new Promise((r) => setTimeout(r, 4)); ev('pointermove', ...p); }
    await new Promise((r) => setTimeout(r, 20));
    ev('pointerup', ...pts[pts.length - 1]); res();
  }), pts);
  const ink = async (page) => { const d = await savedInk(page); return d.periods[d.active]; };
  const pageBox = (page, i) => page.locator('.page').nth(i).boundingBox();
  const centerPage = (page, i) => page.evaluate((i) => { const p = document.querySelectorAll('.page')[i], r = p.getBoundingClientRect(); scrollBy(0, r.top + r.height / 2 - innerHeight / 2); }, i);

  test('Clear page clears only the page in the middle of the screen; Clear all asks first; Undo / Redo', async ({ page }) => {
    let b = await pageBox(page, 0);
    await stroke(page, line(b.x + 100, b.y + 300, b.x + 400, b.y + 300));
    await centerPage(page, 1);
    b = await pageBox(page, 1);
    await stroke(page, line(b.x + 100, b.y + 300, b.x + 400, b.y + 300));
    const both = await ink(page);
    expect(both).toHaveLength(2);
    await page.click('[data-act="clear-page"]');
    expect(await ink(page)).toEqual([both[0]]);                    // page 2's stroke is gone, page 1's stays
    await page.click('[data-act="undo"]');
    expect(await ink(page)).toEqual(both);
    await page.click('[data-act="redo"]');
    expect(await ink(page)).toEqual([both[0]]);
    await page.click('[data-act="undo"]');
    await page.click('[data-act="clear-all"]');
    await expect(page.locator('[data-act="clear-all"]')).toHaveText('Sure?');
    expect(await ink(page)).toHaveLength(2);
    await page.click('[data-act="clear-all"]');
    expect(await ink(page)).toHaveLength(0);
    await page.click('[data-act="undo"]');
    expect(await ink(page)).toEqual(both);
  });

  test('a worksheet without pages: one Clear button (tap twice)', async ({ page }) => {
    const block = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'ink_overlay.html'), 'utf8');
    await page.route('**/nopages.html', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>No pages</title><body><p style="height:1500px">Notes</p>' + block + '</body>' }));
    await openOverlay(page, 'nopages.html');
    await stroke(page, line(500, 300, 800, 300));
    await expect(page.locator('[data-act="clear-page"]')).toBeHidden();
    const clear = page.locator('[data-act="clear-all"]');
    await expect(clear).toHaveText('Clear');
    await clear.click();
    await expect(clear).toHaveText('Sure?');
    await clear.click();
    expect(await ink(page)).toHaveLength(0);
  });

  test('File ▸ holds Save PDF, Save ink into file, Change linked file and Move toolbar; the toolbar fits 1080p', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 950 });   // Chrome's page area on a 1920x1080 screen
    const bar = await page.evaluate(() => { const b = document.getElementById('ink-bar'); return { scroll: b.scrollHeight, client: b.clientHeight }; });
    expect(bar.scroll).toBeLessThanOrEqual(bar.client);
    for (const act of ['print', 'savefile', 'pickfile', 'side']) await expect(page.locator(`#ink-bar [data-act="${act}"]`)).toHaveCount(0);
    await page.click('[data-act="file"]');
    for (const act of ['print', 'savefile', 'pickfile', 'side']) await expect(page.locator(`#ob-filemenu [data-act="${act}"]`)).toBeVisible();
    await expect(page.locator('#ob-filemenu [data-act="clear-all"]')).toHaveCount(0);
    const m = await page.locator('#ob-filemenu').boundingBox(), t = await page.locator('#ink-bar').boundingBox();
    expect(m.x).toBeGreaterThan(t.x + t.width);
    await page.click('#ob-filemenu [data-act="side"]');                  // Move toolbar: menu stays open and follows
    expect(await page.evaluate(() => document.getElementById('ink-bar').classList.contains('right'))).toBe(true);
    const m2 = await page.locator('#ob-filemenu').boundingBox(), t2 = await page.locator('#ink-bar').boundingBox();
    expect(m2.x + m2.width).toBeLessThan(t2.x);
    await page.keyboard.press('Escape');
    expect(await menuOpen(page, 'ob-filemenu')).toBe(false);
  });

  test('zoom − / Fit / +: the worksheet zooms, the toolbar does not, and ink stays on the same spot', async ({ page }) => {
    const fit = page.locator('[data-act="zoom-fit"]');
    await expect(fit).toHaveText('100%');
    const barW = (await page.locator('#ink-bar').boundingBox()).width;
    let b = await pageBox(page, 0);
    await stroke(page, line(b.x + 100, b.y + 200, b.x + 300, b.y + 200));
    const at100 = (await ink(page))[0].p;
    await page.click('[data-act="undo"]');

    for (let i = 0; i < 3; i++) await page.click('[data-act="zoom-in"]');
    await expect(fit).toHaveText('133%');
    const z = 1.1 ** 3;
    b = await pageBox(page, 0);
    expect(b.width).toBeCloseTo(816 * z, 0);
    expect((await page.locator('#ink-bar').boundingBox()).width).toBeCloseTo(barW, 0);   // the toolbar keeps its size
    // the same spot on the page, now further from the corner on screen, stores the same ink coordinates
    await stroke(page, line(b.x + 100 * z, b.y + 200 * z, b.x + 300 * z, b.y + 200 * z));
    const at133 = (await ink(page))[0].p;
    for (let i = 0; i < 4; i++) expect(at133[i]).toBeCloseTo(at100[i], 0);
    const alpha = await page.evaluate(([x, y]) => {
      const c = document.getElementById('ink-canvas'), r = c.getBoundingClientRect(), s = c.width / r.width;
      return c.getContext('2d').getImageData(Math.round((x - r.left) * s), Math.round((y - r.top) * s), 1, 1).data[3];
    }, [b.x + 200 * z, b.y + 200 * z]);
    expect(alpha).toBeGreaterThan(200);                                       // drawn where the pen was

    await fit.click();                                                         // Fit: the page fills the space beside the toolbar
    await expect(fit).toHaveText('Fit');
    b = await pageBox(page, 0);
    expect(b.width).toBeCloseTo(await page.evaluate((w) => document.documentElement.clientWidth - 2 * (w + 20), barW), 0);
    // printing happens at 100%, then the zoom comes back
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    expect(await page.evaluate(() => document.documentElement.style.zoom)).toBe('');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(fit).toHaveText('Fit');
    expect((await pageBox(page, 0)).width).toBeCloseTo(b.width, 0);
    // Ctrl + wheel (trackpad pinch) zooms the worksheet too
    await page.mouse.move(700, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');
    await expect(fit).not.toHaveText('Fit');
  });
});

/* a laptop screen: the toolbar shrinks to fit instead of scrolling, and the zoom number isn't cut off */
for (const where of ['PDF app', 'HTML overlay']) {
  test(`${where}: on a short screen the toolbar shrinks to fit, with every button and the zoom % readable`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    if (where === 'PDF app') { await openApp(page); await openPdf(page, 'book.pdf'); } else await openOverlay(page);
    const check = () => page.evaluate(() => {
      const b = document.getElementById('ink-bar'), r = b.getBoundingClientRect(), z = b.querySelector('[data-act="zoom-fit"]');
      return { scrolls: b.scrollHeight > b.clientHeight + 1, top: r.top, bottom: r.bottom, label: z.textContent, cut: z.scrollWidth > z.clientWidth };
    });
    let c = await check();
    expect(c.scrolls).toBe(false);
    expect(c.top).toBeGreaterThanOrEqual(0);
    expect(c.bottom).toBeLessThanOrEqual(700);
    expect(c.cut).toBe(false);
    await page.click('[data-act="zoom-in"]');
    c = await check();
    expect(c.label).toMatch(/%$/);
    expect(c.cut).toBe(false);
    // a full-height window: full size again
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.getElementById('ink-bar').getBoundingClientRect().width)).toBe(176);
  });
}
