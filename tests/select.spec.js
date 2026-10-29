// Select (PDF app and HTML overlay): circle ink with the pen, then send a copy to another class period,
// copy and paste it, drag it, or delete it. Undo puts back a paste, a move or a delete.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, strokes } = require('./support/app');
const { openOverlay, savedInk } = require('./support/overlay');

const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const loop = (x0, y0, x1, y1) => [...line(x0, y0, x1, y0), ...line(x1, y0, x1, y1), ...line(x1, y1, x0, y1), ...line(x0, y1, x0, y0)];
const menu = (page) => page.locator('#ob-selmenu');

test.describe('PDF app', () => {
  const draw = (page, pts, o) => page.evaluate(([pts, o]) => __t.stroke(1, pts, o), [pts, o || {}]);
  test.beforeEach(async ({ page }) => {
    await openApp(page); await openPdf(page, 'worksheet.pdf');
    await draw(page, line(100, 200, 300, 200));
    await draw(page, line(100, 400, 300, 400));
  });

  test('circle ink, send a copy to another period: same spot, the original stays', async ({ page }) => {
    await page.click('[data-act="select"]');
    await expect(page.locator('[data-act="select"]')).toHaveClass(/on/);
    await draw(page, loop(80, 170, 320, 230));
    await expect(page.locator('.pg .ob-selbox')).toBeVisible();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page)).toContainText('1 mark selected');
    await expect(menu(page).locator('[data-to]')).toHaveText(['P2', 'P3', 'P4']);
    await menu(page).locator('[data-to="P3"]').click();
    const p1 = await strokes(page, 'P1'), p3 = await strokes(page, 'P3');
    expect(p1).toHaveLength(2);
    expect(p3).toEqual([p1[0]]);   // the same mark, page and points
    await expect(page.locator('#ink-status')).toContainText('P3');
    // the toolbar's Select button turns it off and lets the selection go
    await page.click('[data-act="select"]');
    await expect(page.locator('.ob-selbox')).toHaveCount(0);
    await expect(menu(page)).toBeHidden();
  });

  test('copy, switch period, tap and paste in the same spot; drag to move; Undo; Delete', async ({ page }) => {
    await page.click('[data-act="select"]');
    await draw(page, loop(80, 150, 320, 450));   // both lines
    await expect(menu(page)).toContainText('2 marks selected');
    await menu(page).locator('[data-sel="copy"]').click();
    await page.click('[data-period="P2"]');
    await expect(page.locator('.ob-selbox')).toHaveCount(0);
    await draw(page, [[450, 300]]);   // a tap on the page offers to paste
    await expect(menu(page)).toContainText('Paste 2 marks');
    await menu(page).locator('[data-sel="same"]').click();
    expect(await strokes(page, 'P2')).toEqual(await strokes(page, 'P1'));
    await expect(page.locator('.ob-selbox')).toBeVisible();   // what was pasted is selected
    // drag the selection 50 points down
    await draw(page, line(200, 300, 200, 350));
    const moved = await strokes(page, 'P2');
    expect(moved[0].p[1]).toBeCloseTo(250, 0);
    expect(moved[1].p[1]).toBeCloseTo(450, 0);
    await page.click('[data-act="undo"]');
    expect(await strokes(page, 'P2')).toEqual(await strokes(page, 'P1'));
    // tap one mark, then Delete; Undo brings it back
    await draw(page, [[200, 200]]);
    await expect(menu(page)).toContainText('1 mark selected');
    await menu(page).locator('[data-sel="delete"]').click();
    expect(await strokes(page, 'P2')).toHaveLength(1);
    await page.click('[data-act="undo"]');
    expect(await strokes(page, 'P2')).toHaveLength(2);
  });

  test('a copy looks like the ink on the page: erased parts stay erased', async ({ page }) => {
    await draw(page, line(200, 180, 200, 220), { type: 'pen', buttons: 32 });   // palm wipe across the middle of the top line
    await page.click('[data-act="select"]');
    await draw(page, loop(80, 170, 320, 230));
    await menu(page).locator('[data-to="P2"]').click();
    const p2 = await strokes(page, 'P2');
    expect(p2.length).toBe(2);   // the line, in two pieces, and no eraser
    expect(p2.every((s) => !s.e)).toBe(true);
    expect(Math.max(...p2[0].p.filter((_, i) => i % 2 === 0))).toBeLessThan(200);
    expect(Math.min(...p2[1].p.filter((_, i) => i % 2 === 0))).toBeGreaterThan(200);
  });

  test('right-click on the selection opens its menu; keyboard copy and paste', async ({ page }) => {
    await page.click('[data-act="select"]');
    await draw(page, loop(80, 170, 320, 230));
    await page.keyboard.press('Escape');
    await expect(page.locator('.ob-selbox')).toHaveCount(0);
    await draw(page, loop(80, 170, 320, 230));
    await page.mouse.click(0, 0);   // closes the menu, keeps the selection
    await expect(menu(page)).toBeHidden();
    const [x, y] = await page.evaluate(() => __t.client(1, 200, 200));
    await page.mouse.click(x, y, { button: 'right' });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Control+c');
    await page.click('[data-period="P4"]');
    await page.keyboard.press('Control+v');
    expect(await strokes(page, 'P4')).toEqual([(await strokes(page, 'P1'))[0]]);
  });
});

test.describe('HTML overlay', () => {
  async function stroke(page, pts) {
    await page.evaluate((pts) => new Promise(async (res) => {
      const c = document.getElementById('ink-canvas');
      const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 3, buttons: t === 'pointerup' ? 0 : 1, button: 0, clientX: x, clientY: y, screenX: x, screenY: y }));
      ev('pointerdown', ...pts[0]);
      for (const p of pts.slice(1)) { await new Promise((r) => setTimeout(r, 4)); ev('pointermove', ...p); }
      await new Promise((r) => setTimeout(r, 20));
      ev('pointerup', ...pts[pts.length - 1]); res();
    }), pts);
  }
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openOverlay(page);
    await stroke(page, line(500, 300, 800, 300));
    await stroke(page, line(500, 500, 800, 500));
  });

  test('send a copy to another period, drag to move, Undo', async ({ page }) => {
    await page.click('#ink-bar [data-act="select"]');
    await stroke(page, loop(480, 270, 820, 330));
    await expect(page.locator('#ob-selhost .ob-selbox')).toBeVisible();
    await expect(menu(page)).toContainText('1 mark selected');
    await menu(page).locator('[data-to="P2"]').click();
    let ink = await savedInk(page);
    expect(ink.periods.P2).toEqual([ink.periods.P1[0]]);
    // drag it 100 px down, onto the other line's row
    const before = ink.periods.P1;
    await stroke(page, line(650, 300, 650, 400));
    ink = await savedInk(page);
    expect(ink.periods.P1).toHaveLength(2);
    expect(ink.periods.P1[1].p[1]).toBeCloseTo(before[0].p[1] + 100, 0);
    await page.click('#ink-bar [data-act="undo"]');
    ink = await savedInk(page);
    expect(ink.periods.P1).toEqual(before);
  });

  test('copy, switch period, paste here; Delete key', async ({ page }) => {
    await page.click('#ink-bar [data-act="select"]');
    await stroke(page, loop(480, 270, 820, 330));
    await menu(page).locator('[data-sel="copy"]').click();
    await page.click('#ink-bar [data-period="P3"]');
    await stroke(page, [[650, 700]]);
    await menu(page).locator('[data-sel="here"]').click();
    let ink = await savedInk(page);
    expect(ink.periods.P3).toHaveLength(1);
    const ys = ink.periods.P3[0].p.filter((_, i) => i % 2 === 1);
    expect(Math.abs(ys[0] - (ink.periods.P1[0].p[1] + 400))).toBeLessThan(2);   // centered where the tap was
    await page.keyboard.press('Delete');
    ink = await savedInk(page);
    expect(ink.periods.P3).toHaveLength(0);
  });
});
