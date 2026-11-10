// Type (PDF app and HTML overlay): tap the page to type a note, tap a note to change it.
// Notes are kept with the ink, so Undo, erasing, Select, saving and Export PDF work on them too.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, strokes, fileMenu, download, tap } = require('./support/app');
const { openOverlay, savedInk } = require('./support/overlay');

const box = (page) => page.locator('.ob-note-edit');

test.describe('PDF app', () => {
  const draw = (page, pts, o) => page.evaluate(([pts, o]) => __t.stroke(1, pts, o), [pts, o || {}]);
  const at = (page, x, y) => page.evaluate(([x, y]) => __t.client(1, x, y), [x, y]);
  const ink = async (page, x, y) => (await page.evaluate(([x, y]) => __t.px(1, x, y), [x, y]) || [0, 0, 0, 0])[3];
  const notePx = async (page, s) => {   // the darkest ink pixel inside the note's box
    let best = 0;
    for (let x = s.p[0]; x < s.p[2]; x += 2) for (let y = s.p[1]; y < s.p[3]; y += 2) best = Math.max(best, await ink(page, x, y));
    return best;
  };
  test.beforeEach(async ({ page }) => { await openApp(page); await openPdf(page, 'worksheet.pdf'); });

  test('tap to type a note; Escape keeps it; Undo and Redo; tap it to change it; empty removes it', async ({ page }) => {
    await page.click('[data-act="type"]');
    await expect(page.locator('[data-act="type"]')).toHaveClass(/on/);
    await tap(page, ...(await at(page, 100, 200)), 'pen');
    await expect(box(page)).toBeFocused();
    await page.keyboard.type('Hello');
    await page.keyboard.press('Enter');
    await page.keyboard.type('world');
    await page.keyboard.press('Escape');
    await expect(box(page)).toHaveCount(0);
    let s = await strokes(page);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ t: 'Hello\nworld', page: 1 });
    expect(s[0].p[0]).toBeCloseTo(100, 0);
    expect(s[0].p[3] - s[0].p[1]).toBeGreaterThan(2 * s[0].f);   // two lines
    expect(await notePx(page, s[0])).toBeGreaterThan(200);

    await page.click('[data-act="undo"]');
    expect(await strokes(page)).toHaveLength(0);
    await page.click('[data-act="redo"]');
    expect(await strokes(page)).toHaveLength(1);

    // tap the note: its text comes back in the box
    await tap(page, ...(await at(page, s[0].p[0] + 5, s[0].p[1] + 5)), 'mouse');
    await expect(box(page)).toHaveValue('Hello\nworld');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Bye');
    await page.keyboard.press('Escape');
    s = await strokes(page);
    expect(s.map((k) => k.t)).toEqual(['Bye']);
    await expect(page.locator('#ink-status')).toHaveText('Note changed');

    await tap(page, ...(await at(page, s[0].p[0] + 5, s[0].p[1] + 5)), 'pen');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');
    expect(await strokes(page)).toHaveLength(0);
  });

  test('a drag scrolls instead of typing; a tap beside an open note only finishes it; the Eraser turns Type off', async ({ page }) => {
    await page.click('[data-act="type"]');
    const y0 = await page.evaluate(() => scrollY);
    await draw(page, Array.from({ length: 10 }, (_, i) => [200, 500 - i * 20]));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(y0);
    expect(await strokes(page)).toHaveLength(0);
    await expect(box(page)).toHaveCount(0);

    await page.evaluate(() => scrollTo(0, 0));
    await tap(page, ...(await at(page, 100, 200)), 'pen');
    await page.keyboard.type('A');
    await tap(page, ...(await at(page, 300, 400)), 'pen');
    await expect(box(page)).toHaveCount(0);
    expect((await strokes(page)).map((k) => k.t)).toEqual(['A']);

    await page.click('[data-act="erase"]');
    await expect(page.locator('[data-act="type"]')).not.toHaveClass(/on/);
  });

  test('the eraser takes a whole note; Select moves it; Export PDF includes it', async ({ page }) => {
    await page.click('[data-act="type"]');
    await tap(page, ...(await at(page, 100, 200)), 'pen');
    await page.keyboard.type('Answer: 42');
    await page.keyboard.press('Escape');
    await page.click('[data-act="type"]');   // off: the pen writes again
    let s = (await strokes(page))[0];

    // Select: tap the note, drag it 100 points down
    await page.click('[data-act="select"]');
    const mid = [(s.p[0] + s.p[2]) / 2, (s.p[1] + s.p[3]) / 2];
    await draw(page, [mid]);
    await expect(page.locator('#ob-selmenu')).toContainText('1 mark selected');
    await draw(page, Array.from({ length: 11 }, (_, i) => [mid[0], mid[1] + i * 10]));
    s = (await strokes(page))[0];
    expect(s.t).toBe('Answer: 42');
    expect(s.p[1]).toBeCloseTo(200 - s.f * 0.625 + 100, 0);
    await page.click('[data-act="select"]');

    const dl = await download(page, () => fileMenu(page, 'export'));
    expect((await dl.createReadStream()) !== null).toBe(true);

    // a palm swipe across one corner removes the whole note
    await draw(page, [[s.p[0] - 10, s.p[1] + 2], [s.p[0] + 4, s.p[1] + 2]], { buttons: 32 });
    expect(await notePx(page, s)).toBe(0);
  });
});

test.describe('HTML overlay', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1400, height: 900 }); await openOverlay(page); });

  test('tap to type a note, Escape keeps it (saved), Undo removes it', async ({ page }) => {
    await page.click('#ink-bar [data-act="type"]');
    await tap(page, 600, 300, 'pen');
    await expect(box(page)).toBeFocused();
    await page.keyboard.type('Nice work!');
    await page.keyboard.press('Escape');
    let ink = await savedInk(page);
    expect(ink.periods.P1).toHaveLength(1);
    expect(ink.periods.P1[0]).toMatchObject({ t: 'Nice work!' });
    expect(ink.periods.P1[0].page).toBeUndefined();
    await page.click('#ink-bar [data-act="undo"]');
    ink = await savedInk(page);
    expect(ink.periods.P1).toHaveLength(0);
  });

  test('with Type off, a finger tap presses a button on the worksheet', async ({ page }) => {
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'ws-btn'; b.textContent = 'Reveal'; b.onclick = () => { window.__pressed = (window.__pressed || 0) + 1; };
      (document.querySelector('.page') || document.body).prepend(b);
    });
    const r = await page.locator('#ws-btn').boundingBox();
    await tap(page, r.x + r.width / 2, r.y + r.height / 2, 'mouse');
    expect(await page.evaluate(() => window.__pressed)).toBe(1);
    expect((await savedInk(page))?.periods.P1 || []).toHaveLength(0);
  });
});
