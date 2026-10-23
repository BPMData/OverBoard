// File ▸ Settings… (shared/ink-core.js makeSettings) and the Class period row (makePeriodPicker),
// the same in the HTML overlay and the PDF app.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, fileMenu } = require('./support/app');
const { openOverlay, savedInk } = require('./support/overlay');

const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const stroke = (page, pts) => page.evaluate((pts) => new Promise(async (res) => {
  const c = document.getElementById('ink-canvas');
  const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 3, buttons: t === 'pointerup' ? 0 : 1, button: 0, clientX: x, clientY: y }));
  ev('pointerdown', ...pts[0]);
  for (const p of pts.slice(1)) { await new Promise((r) => setTimeout(r, 4)); ev('pointermove', ...p); }
  await new Promise((r) => setTimeout(r, 20));
  ev('pointerup', ...pts[pts.length - 1]); res();
}), pts);
const periodButtons = (page) => page.locator('#ink-periods button').allTextContents();
const openSettings = async (page) => { await fileMenu(page, 'settings'); await expect(page.locator('#ob-settings')).toBeVisible(); };
const done = (page) => page.click('#ob-settings [data-s="done"]');

test.describe('HTML overlay', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1400, height: 900 }); await openOverlay(page); });

  test('a name style and more periods: 5 periods become one "▾" button with a list', async ({ page }) => {
    await openSettings(page);
    await page.click('#ob-settings [data-style="block"]');
    await page.click('#ob-settings [data-s="more"]');
    await expect(page.locator('#ob-settings .ob-count b')).toHaveText('5 periods');
    await expect(page.locator('#ob-settings .ob-names input')).toHaveCount(5);
    await expect(page.locator('#ob-settings .ob-names input').nth(4)).toHaveValue('Block E');
    await done(page);
    await expect(page.locator('#ob-settings')).toBeHidden();
    expect(await periodButtons(page)).toEqual(['Block A ▾']);
    await page.click('#ink-periods [data-act="period-menu"]');
    await expect(page.locator('#ob-permenu button')).toHaveText(['Block A', 'Block B', 'Block C', 'Block D', 'Block E']);
    await page.click('#ob-permenu [data-period="Block C"]');
    await expect(page.locator('#ob-permenu')).toBeHidden();
    expect(await periodButtons(page)).toEqual(['Block C ▾']);
    await stroke(page, line(500, 400, 800, 400));
    const d = await savedInk(page);
    expect(Object.keys(d.periods)).toEqual(['Block A', 'Block B', 'Block C', 'Block D', 'Block E']);
    expect(d.periods['Block C']).toHaveLength(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ob-periods')))).toEqual(Object.keys(d.periods));
    // the toolbar still fits a 1080p board
    await page.setViewportSize({ width: 1920, height: 950 });
    expect(await page.evaluate(() => { const b = document.getElementById('ink-bar'); return b.scrollHeight <= b.clientHeight; })).toBe(true);
  });

  test('renaming a period keeps its ink; typing does not undo ink', async ({ page }) => {
    await stroke(page, line(500, 400, 800, 400));
    await openSettings(page);
    const first = page.locator('#ob-settings .ob-names input').first();
    await first.fill('Gold');
    await first.press('Control+z');                                // the text box's own undo, not the ink's
    await first.fill('Gold');
    await done(page);
    expect(await periodButtons(page)).toEqual(['Gold', 'P2', 'P3', 'P4']);
    const d = await savedInk(page);
    expect(d.active).toBe('Gold');
    expect(d.periods.Gold).toHaveLength(1);
  });

  test('two periods with the same name are refused', async ({ page }) => {
    await openSettings(page);
    await page.locator('#ob-settings .ob-names input').nth(1).fill('p1');
    await done(page);
    await expect(page.locator('#ob-settings .ob-err')).toBeVisible();
    await expect(page.locator('#ob-settings')).toBeVisible();
    expect(await periodButtons(page)).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  test('removing a period that has ink asks first', async ({ page }) => {
    await page.click('[data-period="P4"]');
    await stroke(page, line(500, 400, 800, 400));
    await openSettings(page);
    await page.click('#ob-settings [data-s="fewer"]');
    page.once('dialog', (d) => d.dismiss());
    await done(page);
    await expect(page.locator('#ob-settings')).toBeVisible();      // said no: nothing changed
    expect(await periodButtons(page)).toEqual(['P1', 'P2', 'P3', 'P4']);
    page.once('dialog', (d) => d.accept());
    await done(page);
    await expect(page.locator('#ob-settings')).toBeHidden();
    expect(await periodButtons(page)).toEqual(['P1', 'P2', 'P3']);
    expect(Object.keys((await savedInk(page)).periods)).toEqual(['P1', 'P2', 'P3']);
  });

  test('pen color at start is remembered; Reset tools puts the toolbar back', async ({ page }) => {
    await page.click('[data-act="thicker"]');
    await page.click('[data-act="finger"]');
    await openSettings(page);
    await expect(page.locator('#ob-settings .ob-tools')).toContainText('Finger draws · Pen size 3');
    await page.click('#ob-settings [data-pen="#1565c0"]');
    await expect(page.locator('#ink-colors button.on')).toHaveAttribute('data-color', '#1565c0');
    await done(page);
    await page.reload();
    await page.waitForSelector('#ink-bar[data-ready]', { state: 'attached' });
    await expect(page.locator('#ink-colors button.on')).toHaveAttribute('data-color', '#1565c0');
    await openSettings(page);
    await page.click('#ob-settings [data-s="reset"]');
    await expect(page.locator('#ob-settings [data-s="reset"]')).toHaveText('Sure?');
    await page.click('#ob-settings [data-s="reset"]');
    await expect(page.locator('#ob-settings .ob-tools')).toContainText('Finger scrolls · Pen size 2.5 · Smoothing 3');
    await done(page);
    await expect(page.locator('#ink-size .num')).toHaveText('2.5');
    await expect(page.locator('[data-act="finger"]')).toHaveText('Finger: scrolls');
    await expect(page.locator('#ink-colors button.on')).toHaveAttribute('data-color', '#e0218a');
  });

  test('Escape or a tap outside the box closes Settings', async ({ page }) => {
    await openSettings(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#ob-settings')).toBeHidden();
    await openSettings(page);
    await page.mouse.click(10, 10);
    await expect(page.locator('#ob-settings')).toBeHidden();
  });
});

test('PDF app: the same Settings in File ▸; new PDFs start with the saved periods', async ({ page }) => {
  await openApp(page);
  await openPdf(page, 'worksheet.pdf');
  await openSettings(page);
  await page.click('#ob-settings [data-style="ab"]');
  await done(page);
  expect(await periodButtons(page)).toEqual(['A1', 'A2', 'B1', 'B2']);
  expect(await page.evaluate(() => Object.keys(window.__overboard.data.periods))).toEqual(['A1', 'A2', 'B1', 'B2']);
  await page.click('[data-period="B1"]');
  expect(await page.evaluate(() => window.__overboard.data.active)).toBe('B1');
  await fileMenu(page, 'close');
  await openPdf(page, 'book.pdf');                                 // a PDF opened for the first time
  expect(await periodButtons(page)).toEqual(['A1', 'A2', 'B1', 'B2']);
});
