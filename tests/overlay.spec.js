// The paste-in overlay on the demo page (index.html): it must keep working as one self-contained block.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openOverlay, overlayReady, savedInk } = require('./support/overlay');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openOverlay(page);
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
  const n = (await savedInk(page)).periods.P1.length;
  expect(n).toBe(1);
});

/* ---- Highlighter ▾ in the overlay: the same shared menu as the PDF app (Cover + strength) ---- */
const { tapOn } = require('./support/app');
const rgba = (page, x, y, id) => page.evaluate(([x, y, id]) => {
  const c = document.getElementById(id) || document.querySelector(id), r = c.getBoundingClientRect();
  return Array.from(c.getContext('2d').getImageData(Math.round((x - r.left) * c.width / r.width), Math.round((y - r.top) * c.height / r.height), 1, 1).data);
}, [x, y, id]);

test('Cover: the ▾ menu works with pen and finger taps; covers are opaque on the top layer and erase with the palm', async ({ page }) => {
  await tapOn(page, '[data-act="hl-menu"]', 'mouse');            // finger
  await expect(page.locator('#ob-hlmenu')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('#ob-hlmenu')).toBeVisible();        // lifting didn't close it
  await tapOn(page, '#ob-hlmenu [data-cover="#111111"]', 'pen');
  await expect(page.locator('#ob-hlmenu')).toBeHidden();
  await expect(page.locator('[data-act="hilite"]')).toHaveText('Cover');
  await stroke(page, line(500, 400, 800, 400));
  expect(await rgba(page, 650, 400, 'ink-canvas')).toEqual([17, 17, 17, 255]);
  expect(await alpha(page, 650, 400, 'ink-hl')).toBe(0);
  await stroke(page, line(650, 360, 650, 440), { buttons: 32 });   // palm reveals
  expect(await alpha(page, 650, 400)).toBe(0);
  expect(await alpha(page, 550, 400)).toBe(255);
  const s = (await savedInk(page)).periods.P1;
  expect(s[0]).toMatchObject({ h: 1, o: 1, c: '#111111' });

  // strength slider: full-strength yellow on the multiply layer
  await tapOn(page, '[data-act="hl-menu"]', 'pen');
  await page.locator('#ob-hl-strength').fill('100');
  await expect(page.locator('#ob-hlmenu')).toBeVisible();        // the slider keeps it open
  await expect(page.locator('[data-act="hilite"]')).toHaveText('Highlighter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#ob-hlmenu')).toBeHidden();
  await page.click('[data-color="#fdd835"]');
  await stroke(page, line(500, 500, 800, 500));
  expect(await rgba(page, 650, 500, 'ink-hl')).toEqual([253, 216, 53, 255]);
});

const savePdf = async (page) => { await page.click('[data-act="file"]'); await page.click('#ob-filemenu [data-act="print"]'); };   // Save PDF is in the File menu

test('Save PDF with covers: the teacher is told the text can still be copied; covers print solid above the page', async ({ page }) => {
  await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const box = await page.locator('.page').first().boundingBox(), y = box.y + 200, x0 = box.x + 100;
  await stroke(page, line(x0, y, x0 + 300, y));                  // pen: no notice
  await savePdf(page);
  expect(await page.evaluate(() => window.__printed)).toBe(1);
  await tapOn(page, '[data-act="hl-menu"]', 'pen');
  await tapOn(page, '#ob-hlmenu [data-cover="#5f5f5f"]', 'pen');
  await stroke(page, line(x0, y + 60, x0 + 300, y + 60));
  let msg = '';
  page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
  await savePdf(page);
  expect(msg).toContain('still in it');
  expect(await page.evaluate(() => window.__printed)).toBe(1);   // cancelled
  page.once('dialog', (d) => d.accept());
  await savePdf(page);
  expect(await page.evaluate(() => window.__printed)).toBe(2);

  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const layers = await page.evaluate(() => [...document.querySelectorAll('.page')[0].querySelectorAll('canvas.ink-print')].map((c) => c.style.mixBlendMode));
  expect(layers).toEqual(['']);                                  // no highlights: one layer, covers on it
  expect(await rgba(page, x0 + 150, y + 60, '.page canvas.ink-print')).toEqual([95, 95, 95, 255]);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
});

/* ---- v21: the overlay keeps its ink in IndexedDB (no 5 MB localStorage limit) ---- */
const lsKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ink-v2:')));

test('ink comes back after a reload right after writing, and no copy is left in localStorage', async ({ page }) => {
  await stroke(page, line(500, 400, 800, 400));
  await page.reload();                                           // well inside the 5 s save wait
  await overlayReady(page);
  expect(await alpha(page, 650, 400)).toBeGreaterThan(200);
  await expect(page.locator('#ink-status')).toContainText('ink restored from this browser');
  expect((await savedInk(page)).periods.P1).toHaveLength(1);
  expect(await lsKeys(page)).toEqual([]);
});

test('if the database save is cut off as the tab closes, the localStorage backup keeps the stroke', async ({ page }) => {
  await stroke(page, line(500, 400, 800, 400));
  await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new Error('cut off'); }; });
  await page.reload();
  await overlayReady(page);
  expect(await alpha(page, 650, 400)).toBeGreaterThan(200);
  expect((await savedInk(page)).periods.P1).toHaveLength(1);    // moved into IndexedDB on opening
  expect(await lsKeys(page)).toEqual([]);
});

test('ink saved in localStorage by v20 and older moves to IndexedDB', async ({ page }) => {
  const old = { v: 2, t: Date.now(), active: 'P2', periods: { P1: [], P2: [{ c: '#1565c0', w: 4, p: [300, 400, 700, 400] }], P3: [], P4: [] } };
  await page.evaluate((old) => localStorage.setItem('ink-v2:' + location.pathname + ':' + document.title, JSON.stringify(old)), old);
  await page.reload();
  await overlayReady(page);
  await expect(page.locator('#ink-status')).toContainText('P2 · ink restored from this browser');
  await expect(page.locator('[data-period="P2"]')).toHaveClass(/on/);
  await expect.poll(() => lsKeys(page)).toEqual([]);
  expect((await savedInk(page)).periods.P2).toEqual(old.periods.P2);
});

test('more ink than localStorage could hold (about 8 MB) still saves', async ({ page }) => {
  const n = 10000;
  await page.evaluate(async (n) => {
    const key = 'ink-v2:' + location.pathname + ':' + document.title, p = [];
    for (let j = 0; j < 80; j++) p.push(3000 + j * 0.7, 5000.3 + j);   // off to the side, out of the way
    const D = { v: 2, t: Date.now(), active: 'P1', periods: { P1: Array.from({ length: n }, () => ({ c: '#111111', w: 2.5, p })), P2: [], P3: [], P4: [] } };
    if (JSON.stringify(D).length < 7e6) throw new Error('test ink too small');
    const db = await new Promise((res) => { const rq = indexedDB.open('ink-data'); rq.onsuccess = () => res(rq.result); });
    await new Promise((res) => { const tx = db.transaction('ink', 'readwrite'); tx.objectStore('ink').put(D, key); tx.oncomplete = res; });
    db.close();
  }, n);
  await page.reload();
  await overlayReady(page);
  await stroke(page, line(500, 400, 800, 400));
  expect((await savedInk(page)).periods.P1).toHaveLength(n + 1);
  await expect(page.locator('#ink-status')).not.toContainText('blocked');
});
