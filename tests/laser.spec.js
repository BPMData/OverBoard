// Laser pointer (PDF app and HTML overlay): tap the selected color again, and what you draw fades away and is never ink.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, strokes } = require('./support/app');
const { openOverlay, savedInk } = require('./support/overlay');

const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const swatch = (page, c) => page.locator(`#ink-colors [data-color="${c}"]`);
/* how solid the laser canvas is at this spot on the screen (0 = nothing there) */
const glow = (page, x, y) => page.evaluate(([x, y]) => {
  const c = document.getElementById('ob-laser');
  if (!c || c.hidden) return 0;
  const k = c.width / innerWidth;
  return c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data[3];
}, [x, y]);
const ring = (page, c) => swatch(page, c).evaluate((b) => { const s = getComputedStyle(b); return [s.borderTopColor, s.boxShadow]; });

async function checksRing(page, pen) {
  await expect(swatch(page, pen)).toHaveClass(/\bon\b/);
  await expect(swatch(page, pen)).not.toHaveClass(/laser/);
  await swatch(page, pen).click();
  await expect(swatch(page, pen)).toHaveClass(/laser/);
  const [border, shadow] = await ring(page, pen);
  expect(border).toBe('rgb(0, 0, 0)');
  expect(shadow).toContain('rgb(255, 26, 26)');
}

test.describe('HTML overlay', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1400, height: 900 }); await openOverlay(page); });
  const draw = (page, pts) => page.evaluate((pts) => new Promise(async (res) => {
    const c = document.getElementById('ink-canvas');
    const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 3, buttons: t === 'pointerup' ? 0 : 1, button: 0, clientX: x, clientY: y, screenX: x, screenY: y }));
    ev('pointerdown', ...pts[0]);
    for (const p of pts.slice(1)) { await new Promise((r) => setTimeout(r, 4)); ev('pointermove', ...p); }
    await new Promise((r) => setTimeout(r, 20));
    ev('pointerup', ...pts[pts.length - 1]); res();
  }), pts);

  test('tap the selected color: a black-red-black ring, marks that fade, and no ink', async ({ page }) => {
    await checksRing(page, '#e0218a');
    await draw(page, line(500, 400, 800, 400));
    await expect.poll(() => glow(page, 650, 400)).toBeGreaterThan(200);
    await expect(page.locator('#ob-laser')).toBeHidden({ timeout: 6000 });
    expect((await savedInk(page))?.periods.P1 || []).toHaveLength(0);
  });

  test('a short sound plays when the laser turns on, and not when it turns off', async ({ page }) => {
    await page.evaluate(() => {
      const make = BaseAudioContext.prototype.createOscillator;
      window.__tones = 0;
      BaseAudioContext.prototype.createOscillator = function () { window.__tones++; return make.call(this); };
    });
    const tones = () => page.evaluate(() => window.__tones);
    await swatch(page, '#1565c0').click();                     // just picking a color is silent
    expect(await tones()).toBe(0);
    await swatch(page, '#1565c0').click();                     // on
    expect(await tones()).toBe(1);
    await swatch(page, '#1565c0').click();                     // off
    expect(await tones()).toBe(1);
  });

  test('tap again, another color or another tool goes back to writing', async ({ page }) => {
    await swatch(page, '#e0218a').click();
    await swatch(page, '#e0218a').click();
    await expect(swatch(page, '#e0218a')).not.toHaveClass(/laser/);
    await swatch(page, '#e0218a').click();
    await swatch(page, '#1565c0').click();
    await expect(page.locator('#ink-colors .laser')).toHaveCount(0);
    await swatch(page, '#1565c0').click();
    await page.click('#ink-bar [data-act="erase"]');
    await expect(page.locator('#ink-colors .laser')).toHaveCount(0);
  });

  test('the highlighter has a laser too, but a cover does not', async ({ page }) => {
    await page.click('#ink-bar [data-act="hilite"]');
    await checksRing(page, '#fdd835');
    await page.click('#ink-bar [data-act="hl-menu"]');
    await page.click('#ob-hlmenu [data-cover="#111111"]');
    await swatch(page, '#111111').click();
    await expect(page.locator('#ink-colors .laser')).toHaveCount(0);
  });
});

test.describe('PDF app', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); await openPdf(page, 'worksheet.pdf'); });

  test('tap the selected color: a black-red-black ring, marks that fade, and no ink', async ({ page }) => {
    await checksRing(page, '#e0218a');
    await page.evaluate((pts) => __t.stroke(1, pts), line(100, 200, 300, 200));
    const [x, y] = await page.evaluate(() => __t.client(1, 200, 200));
    await expect.poll(() => glow(page, x, y)).toBeGreaterThan(200);
    await expect(page.locator('#ob-laser')).toBeHidden({ timeout: 6000 });
    expect(await strokes(page)).toHaveLength(0);
    await swatch(page, '#e0218a').click();                     // back to writing
    await page.evaluate((pts) => __t.stroke(1, pts), line(100, 200, 300, 200));
    expect(await strokes(page)).toHaveLength(1);
  });
});
