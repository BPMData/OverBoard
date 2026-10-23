// Undo / Redo and keyboard safety, the same in the PDF app and the HTML overlay:
// Ctrl/⌘+Z undo; Ctrl/⌘+Y, Ctrl/⌘+R or Ctrl/⌘+Shift+Z redo; reloading from the keyboard is off.
// A reload (from the browser's button) never loses ink and reopens the PDF; a fresh visit or Back shows the start screen.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, strokes } = require('./support/app');
const { openOverlay, savedInk } = require('./support/overlay');

const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const draw = (page, n, pts) => page.evaluate(([n, pts]) => __t.stroke(n, pts), [n, pts]);
const redo = (page) => page.locator('[data-act="redo"]');

/* which of these keys the page stopped (a later listener sees defaultPrevented) */
async function stopped(page, keys) {
  await page.evaluate(() => { window.__stopped = []; window.addEventListener('keydown', (e) => { if (e.defaultPrevented) window.__stopped.push(e.key + (e.shiftKey ? '+shift' : '')); }); });
  for (const k of keys) await page.keyboard.press(k);
  return page.evaluate(() => window.__stopped);
}

test.describe('PDF app', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); await openPdf(page, 'worksheet.pdf'); });

  test('Redo puts back what Undo took, from the button or the keyboard', async ({ page }) => {
    await expect(redo(page)).toBeDisabled();
    await draw(page, 1, line(100, 200, 300, 200));
    await draw(page, 1, line(100, 250, 300, 250));
    const both = await strokes(page);
    await page.click('[data-act="undo"]');
    await page.keyboard.press('Control+z');
    expect(await strokes(page)).toHaveLength(0);
    await expect(redo(page)).toBeEnabled();
    await page.click('[data-act="redo"]');
    expect(await strokes(page)).toHaveLength(1);
    await page.keyboard.press('Control+r');
    expect(await strokes(page)).toEqual(both);   // same strokes, same order
    await expect(redo(page)).toBeDisabled();
    for (const k of ['Control+y', 'Control+Shift+z', 'Meta+r']) {
      await page.keyboard.press('Control+z');
      await page.keyboard.press(k);
      expect(await strokes(page)).toHaveLength(2);
    }
    // new ink starts a new history
    await page.keyboard.press('Control+z');
    await draw(page, 1, line(100, 300, 300, 300));
    await expect(redo(page)).toBeDisabled();
  });

  test('Redo after undoing Clear page clears it again; switching period forgets redo', async ({ page }) => {
    await draw(page, 1, line(100, 200, 300, 200));
    await page.click('[data-act="clear-page"]');
    await page.click('[data-act="undo"]');
    expect(await strokes(page)).toHaveLength(1);
    await page.click('[data-act="redo"]');
    expect(await strokes(page)).toHaveLength(0);
    await page.click('[data-act="undo"]');   // and Undo still brings it back
    expect(await strokes(page)).toHaveLength(1);
    await page.click('[data-act="undo"]');
    await expect(redo(page)).toBeEnabled();
    await page.click('[data-period="P2"]');
    await expect(redo(page)).toBeDisabled();
  });

  test('keyboard reload is off; text boxes keep their own undo', async ({ page }) => {
    expect(await stopped(page, ['F5', 'Control+Shift+R', 'Meta+Shift+R'])).toEqual(['F5', 'R+shift', 'R+shift']);
    await draw(page, 1, line(100, 200, 300, 200));
    await page.click('#ob-page');
    await page.keyboard.press('Control+z');
    expect(await strokes(page)).toHaveLength(1);
  });

  test('reloading right after writing keeps the ink and reopens the PDF', async ({ page }) => {
    await draw(page, 1, line(100, 200, 300, 200));
    const before = await strokes(page);
    await page.reload();   // well inside the 3-second autosave delay
    await page.waitForFunction(() => window.__overboard && window.__overboard.doc && window.__overboard.viewer.stats().images >= 1);
    expect(await strokes(page)).toEqual(before);
    // after closing the PDF, a reload shows the start screen
    await page.click('[data-act="file"]');
    await page.click('#ob-filemenu [data-act="close"]');
    await page.reload();
    await page.waitForFunction(() => window.__overboard);
    await page.waitForTimeout(500);
    await expect(page.locator('#ob-start')).toBeVisible();
  });
});

test.describe('PDF app: coming back to the app', () => {
  const pdfOpen = (page) => page.waitForFunction(() => window.__overboard.doc && window.__overboard.viewer.stats().images >= 1);
  const startScreen = (page) => expect(page.locator('#ob-start')).toBeVisible();

  test("typing or clicking the app's address shows the start screen, not the last PDF", async ({ page }) => {
    await openApp(page);
    await openPdf(page, 'worksheet.pdf');
    await draw(page, 1, line(100, 200, 300, 200));
    const before = await strokes(page);
    await page.goto('app/');   // same tab, a fresh visit (not a reload)
    await page.waitForFunction(() => window.__overboard);
    await page.waitForTimeout(500);
    await startScreen(page);
    await openPdf(page, 'worksheet.pdf');   // its ink was kept
    expect(await strokes(page)).toEqual(before);
  });

  test('Back from a PDF goes to the start screen and Forward opens it again; Open another PDF never needs Back twice', async ({ page }) => {
    await page.goto('./');   // a page before the app, so a second Back has somewhere to go
    await openApp(page);
    await openPdf(page, 'worksheet.pdf');
    await page.goBack();
    await startScreen(page);
    await page.goForward();
    await pdfOpen(page);
    expect(await page.evaluate(() => window.__overboard.doc.name)).toBe('worksheet.pdf');
    await page.click('[data-act="file"]');
    await page.click('#ob-filemenu [data-act="close"]');   // Open another PDF
    await startScreen(page);
    await openPdf(page, 'book.pdf');
    await page.goBack();
    await startScreen(page);
    expect(page.url()).toMatch(/\/app\/$/);
    await page.goBack();   // the start screen was one step: this leaves the app
    expect(page.url()).not.toMatch(/\/app\//);
  });
});

test.describe('HTML overlay', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1400, height: 900 }); await openOverlay(page); });
  const ostroke = (page, pts) => page.evaluate((pts) => new Promise(async (res) => {
    const c = document.getElementById('ink-canvas');
    const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 3, buttons: t === 'pointerup' ? 0 : 1, button: 0, clientX: x, clientY: y }));
    ev('pointerdown', ...pts[0]);
    for (const p of pts.slice(1)) { await new Promise((r) => setTimeout(r, 4)); ev('pointermove', ...p); }
    await new Promise((r) => setTimeout(r, 20));
    ev('pointerup', ...pts[pts.length - 1]); res();
  }), pts);
  const count = async (page) => { const d = await savedInk(page); return d.periods[d.active].length; };

  test('the same Undo / Redo button and keys', async ({ page }) => {
    await expect(redo(page)).toBeDisabled();
    await ostroke(page, line(500, 400, 800, 400));
    await ostroke(page, line(500, 450, 800, 450));
    await page.click('[data-act="undo"]');
    await page.keyboard.press('Control+z');
    expect(await count(page)).toBe(0);
    await page.click('[data-act="redo"]');
    await page.keyboard.press('Control+r');
    expect(await count(page)).toBe(2);
    await expect(redo(page)).toBeDisabled();
    await page.keyboard.press('Meta+z');
    await page.keyboard.press('Control+y');
    expect(await count(page)).toBe(2);
    // Clear, Undo, Redo clears again
    await page.click('[data-act="clear-all"]');
    await page.click('[data-act="clear-all"]');   // "Sure?"
    await page.click('[data-act="undo"]');
    expect(await count(page)).toBe(2);
    await page.click('[data-act="redo"]');
    expect(await count(page)).toBe(0);
  });

  test('keyboard reload is off', async ({ page }) => {
    expect(await stopped(page, ['F5', 'Control+Shift+R', 'Control+r'])).toEqual(['F5', 'R+shift', 'r']);
  });
});

/* the pen starts Barbie pink in both apps (high visibility on the board) */
test('the pen starts Barbie pink, in the PDF app and the HTML overlay', async ({ page }) => {
  await openApp(page); await openPdf(page, 'worksheet.pdf');
  await expect(page.locator('#ink-colors button.on')).toHaveAttribute('data-color', '#e0218a');
  await draw(page, 1, line(100, 200, 300, 200));
  expect((await strokes(page))[0].c).toBe('#e0218a');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('./');
  await expect(page.locator('#ink-colors button.on')).toHaveAttribute('data-color', '#e0218a');
});
