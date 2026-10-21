// The paste-in overlay on the demo page (index.html): it must keep working as one self-contained block.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('./');
});

async function stroke(page, pts, o = {}) {
  await page.evaluate(([pts, o]) => new Promise(async (res) => {
    const c = document.getElementById('ink-canvas');
    const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: o.type || 'pen', pointerId: 3, buttons: t === 'pointerup' ? 0 : (o.buttons || 1), button: 0, clientX: x, clientY: y, screenX: x, screenY: y }));
    ev('pointerdown', ...pts[0]);
    for (const p of pts.slice(1)) { await new Promise((r) => setTimeout(r, 4)); ev('pointermove', ...p); }
    await new Promise((r) => setTimeout(r, 20));
    ev('pointerup', ...pts[pts.length - 1]); res();
  }), [pts, o]);
}
const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const alpha = (page, x, y, id = 'ink-canvas') => page.evaluate(([x, y, id]) => {
  const c = document.getElementById(id), r = c.getBoundingClientRect(), s = c.width / r.width;
  return c.getContext('2d').getImageData(Math.round((x - r.left) * s), Math.round((y - r.top) * s), 1, 1).data[3];
}, [x, y, id]);
const on = (page) => page.evaluate(() => document.querySelector('#ink-bar [data-color].on').dataset.color);

test('demo page carries the current overlay', async ({ page }) => {
  const block = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'ink_overlay.html'), 'utf8').trim();
  expect(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')).toContain(block);
});

test('pen, highlighter colors, palm erase, finger scroll', async ({ page }) => {
  await stroke(page, line(500, 400, 800, 400));
  expect(await alpha(page, 650, 400)).toBeGreaterThan(200);
  await page.click('[data-color="#1565c0"]');
  await page.click('[data-act="hilite"]');
  expect(await on(page)).toBe('#fdd835');
  await stroke(page, line(500, 500, 800, 500));
  expect(await alpha(page, 650, 500, 'ink-hl')).toBeGreaterThan(200);
  await page.click('[data-act="hilite"]');
  expect(await on(page)).toBe('#1565c0');
  await stroke(page, line(650, 360, 650, 540), { buttons: 32 });
  expect(await alpha(page, 650, 400)).toBe(0);
  expect(await alpha(page, 650, 500, 'ink-hl')).toBe(0);
  expect(await alpha(page, 550, 400)).toBeGreaterThan(200);
  const y0 = await page.evaluate(() => scrollY);
  await stroke(page, [[600, 700], [600, 600], [600, 500]], { type: 'mouse' });
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(y0);
});

test('holding + keeps stepping, and ink saves in the browser', async ({ page }) => {
  const b = await page.locator('[data-act="thicker"]').boundingBox();
  await page.mouse.move(b.x + 10, b.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  expect(Number(await page.textContent('#ink-size .num'))).toBeGreaterThanOrEqual(5);   // 2.5 + several 0.5 steps
  await stroke(page, line(500, 400, 800, 400));
  await stroke(page, line(500, 450, 800, 450));
  await page.click('[data-act="undo"]');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const n = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ink-v2:')))).periods.P1.length);
  expect(n).toBe(1);
});
