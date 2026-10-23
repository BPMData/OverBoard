// Highlighter ▾ Cover: an opaque stroke that blacks out answers and can be erased later.
// The menu is driven with real finger ("mouse") and pen taps, like the SMART Board sends them.
const fs = require('fs');
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, strokes, last, fileMenu, download, tap, tapOn } = require('./support/app');
const { pdfPixels, pdfText, white } = require('./support/render');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openApp(page);
  await openPdf(page, 'worksheet.pdf');
});

const px = (page, x, y, layer = 'ink') => page.evaluate(([x, y, l]) => __t.px(1, x, y, l), [x, y, layer]);
const draw = (page, pts, o) => page.evaluate(([pts, o]) => __t.stroke(1, pts, o), [pts, o]);
const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const menu = (page) => page.locator('#ob-hlmenu');
const hl = (page) => page.locator('#ink-bar [data-act="hilite"]');
// question 1's printed text sits around y = 120..136 (points from the top of the page)
const ANSWER = line(70, 128, 420, 128);

async function pickCover(page, how = 'pen', color = '#111111') {
  await tapOn(page, '[data-act="hl-menu"]', how);
  await tapOn(page, `#ob-hlmenu [data-cover="${color}"]`, how);
}

test('the ▾ menu opens with a finger or pen tap, stays open after lifting, and closes on a choice, outside tap or Escape', async ({ page }) => {
  // same row as Highlighter, big enough to hit
  const main = await hl(page).boundingBox(), caret = await page.locator('[data-act="hl-menu"]').boundingBox();
  expect(Math.abs(main.y - caret.y)).toBeLessThan(1);
  expect(caret.height).toBeGreaterThanOrEqual(56);
  expect(caret.width).toBeGreaterThanOrEqual(44);

  await tapOn(page, '[data-act="hl-menu"]', 'mouse');   // finger
  await expect(menu(page)).toBeVisible();
  await page.waitForTimeout(400);
  await expect(menu(page)).toBeVisible();              // lifting the finger didn't close it
  for (const b of await page.locator('#ob-hlmenu button').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(56);
  const box = await menu(page).boundingBox(), bar = await page.locator('#ink-bar').boundingBox();
  expect(box.x).toBeGreaterThan(bar.x + bar.width);    // beside the toolbar, like the File menu
  expect(box.y + box.height).toBeLessThanOrEqual(1000);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();

  await tapOn(page, '[data-act="hl-menu"]', 'pen');
  await expect(menu(page)).toBeVisible();
  await tap(page, 800, 500, 'mouse');                  // a tap anywhere else (on the page)
  await expect(menu(page)).toBeHidden();

  await pickCover(page, 'pen');                        // a choice closes it and turns the highlighter on in that mode
  await expect(menu(page)).toBeHidden();
  await expect(hl(page)).toHaveText('Cover');
  await expect(hl(page)).toHaveClass(/\bon\b/);
  await hl(page).click();                              // the main part still toggles it
  await expect(hl(page)).not.toHaveClass(/\bon\b/);
  await hl(page).click();
  await expect(hl(page)).toHaveText('Cover');
  await expect(hl(page)).toHaveClass(/\bon\b/);

  await tapOn(page, '[data-act="hl-menu"]', 'mouse');
  await tapOn(page, '#ob-hlmenu [data-mode="hl"]', 'mouse');
  await expect(hl(page)).toHaveText('Highlighter');
  await page.reload();                                 // the mode is remembered, like the colors
  await page.waitForFunction(() => window.__overboard);
  await expect(hl(page)).toHaveText('Highlighter');
});

test('a cover is opaque, drawn above the text, and removed by palm, eraser or Undo', async ({ page }) => {
  await page.click('[data-color="#1565c0"]');
  await pickCover(page);
  await draw(page, ANSWER);
  const s = await last(page);
  expect(s).toMatchObject({ h: 1, o: 1, c: '#111111' });
  expect(await px(page, 200, 128)).toEqual([17, 17, 17, 255]);   // solid, on the pen layer
  expect(await page.evaluate(() => __overboard.viewer.pages[0].hl)).toBeNull();   // nothing multiplied underneath
  // it sits above the PDF's text layer, so the text can't show through
  const order = await page.evaluate(() => { const P = __overboard.viewer.pages[0]; return P.sheet.compareDocumentPosition(P.ink) & Node.DOCUMENT_POSITION_FOLLOWING; });
  expect(order).toBeTruthy();

  await draw(page, line(200, 100, 200, 160), { buttons: 32 });   // palm reveals part of the answer
  expect((await px(page, 200, 128))[3]).toBe(0);
  expect((await px(page, 380, 128))[3]).toBe(255);
  await page.click('[data-act="undo"]');
  expect((await px(page, 200, 128))[3]).toBe(255);
  await page.click('[data-act="erase"]');
  await draw(page, line(300, 110, 300, 150));
  expect((await px(page, 300, 128))[3]).toBe(0);
  await page.click('[data-act="undo"]');
  await page.click('[data-act="undo"]');
  expect(await strokes(page)).toHaveLength(0);

  // picking a palette color while covering changes the cover's color only; the pen keeps blue
  await pickCover(page, 'mouse', '#a6a6a6');
  await page.click('[data-color="#ffffff"]');
  await draw(page, ANSWER);
  expect(await last(page)).toMatchObject({ o: 1, c: '#ffffff' });
  await hl(page).click();
  expect(await page.evaluate(() => document.querySelector('#ink-bar [data-color].on')?.dataset.color)).toBe('#1565c0');
});

test('old ink without the cover field still loads; covers load from ink files', async ({ page }, info) => {
  const file = info.outputPath('old.overboard.json');
  const old = { app: 'OverBoard', kind: 'pdf-ink', v: 3, pdf: {}, t: 1, active: 'P1', periods: { P1: [
    { page: 1, c: '#feec9a', w: 16.5, e: 0, h: 1, p: line(80, 300, 400, 300).flat() },
    { page: 1, c: '#111111', w: 2, e: 0, p: line(80, 400, 400, 400).flat() },
    { page: 1, c: '#111111', w: 16.5, e: 0, h: 1, o: 1, p: ANSWER.flat() },
  ] } };
  fs.writeFileSync(file, JSON.stringify(old));
  await page.setInputFiles('#ob-inkfile', file);
  await page.waitForFunction(() => __overboard.data.periods.P1.length === 3);
  expect((await px(page, 200, 300, 'hl'))[3]).toBeGreaterThan(200);   // old highlight: multiply layer
  expect((await px(page, 200, 300))[3]).toBe(0);
  expect((await px(page, 200, 400))[3]).toBeGreaterThan(200);
  expect(await px(page, 200, 128)).toEqual([17, 17, 17, 255]);       // cover: pen layer
});

test('Export PDF: covers look the same, the teacher is told the text can still be copied, and the text is kept', async ({ page }, info) => {
  await page.click('[data-act="hilite"]');
  await draw(page, line(80, 300, 400, 300));        // a normal highlight on question 4
  await pickCover(page);
  await draw(page, ANSWER);

  await fileMenu(page, 'export');                    // the notice comes first; Cancel stops the export
  await expect(page.locator('#ob-coverwarn')).toBeVisible();
  await expect(page.locator('#ob-coverwarn h2')).toHaveText('Covered answers can still be copied from this PDF');
  await page.click('#ob-coverwarn [value="cancel"]');
  await expect(page.locator('#ink-status')).toHaveText('P1 · export cancelled');

  const dl = await download(page, async () => { await fileMenu(page, 'export'); await page.click('#ob-coverwarn [value="ok"]'); });
  const file = info.outputPath('covered.pdf');
  await dl.saveAs(file);
  await expect(page.locator('#ink-status')).toContainText('Covered answers are hidden but can still be copied');
  const r = await pdfPixels(page, file, 1, [[100, 128], [250, 124], [400, 132], [300, 300], [300, 160]]);
  for (const p of r.px.slice(0, 3)) expect(p).toEqual([17, 17, 17]);   // opaque, over the printed text
  expect(r.px[3]).toEqual([254, 236, 154]);                             // the highlight still multiplies
  expect(white(r.px[4])).toBe(true);
  const t = await pdfText(page, file);
  expect(t.text[0]).toContain('1. Question text that a highlighter should cover nicely.');   // never deleted

  // all covers erased: no notice
  await draw(page, line(60, 128, 430, 128), { buttons: 32 });
  const dl2 = await download(page, () => fileMenu(page, 'export'));
  expect(dl2.suggestedFilename()).toBe('worksheet_annotated_P1.pdf');
  await expect(page.locator('#ob-coverwarn')).toBeHidden();
  await expect(page.locator('#ink-status')).toHaveText('P1 · PDF downloaded');
});

test('highlight strength slider (10-100%): finger or pen drag, menu stays open, ink and export follow it', async ({ page }, info) => {
  const drag = async (to, pointerType) => {   // a real drag on the slider, from its left end
    const b = await page.locator('#ob-hl-strength').boundingBox(), y = b.y + b.height / 2;
    const s = await page.context().newCDPSession(page);
    const ev = (type, x, buttons) => s.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, pointerType });
    await ev('mouseMoved', b.x + 4, 0); await ev('mousePressed', b.x + 4, 1);
    for (let i = 1; i <= 8; i++) await ev('mouseMoved', b.x + 4 + (b.width * to - 4) * i / 8, 1);
    await ev('mouseReleased', b.x + b.width * to, 0);
    await s.detach();
  };
  await pickCover(page);                                       // start in Cover: the slider switches back to Highlight
  await tapOn(page, '[data-act="hl-menu"]', 'mouse');
  await expect(page.locator('#ob-hl-pct')).toHaveText('50%');
  await drag(1.05, 'mouse');                                    // finger, all the way right
  await expect(page.locator('#ob-hl-pct')).toHaveText('100%');
  await expect(menu(page)).toBeVisible();                       // not a final choice: stays open
  await expect(hl(page)).toHaveText('Highlighter');
  await expect(hl(page)).toHaveClass(/\bon\b/);
  await page.keyboard.press('Escape');
  await draw(page, line(80, 300, 400, 300));
  expect(await last(page)).toMatchObject({ h: 1, c: '#fdd835' });   // full yellow; no cover flag
  expect((await last(page)).o).toBeUndefined();

  await tapOn(page, '[data-act="hl-menu"]', 'pen');
  await drag(-0.1, 'pen');                                      // pen, all the way left: the floor is 10%
  await expect(page.locator('#ob-hl-pct')).toHaveText('10%');
  await page.keyboard.press('Escape');
  await draw(page, line(80, 400, 400, 400));
  expect((await last(page)).c).toBe('#fffbeb');                 // yellow mixed 90% toward white

  const dl = await download(page, () => fileMenu(page, 'export'));   // no covers: no notice
  const file = info.outputPath('strength.pdf');
  await dl.saveAs(file);
  const r = await pdfPixels(page, file, 1, [[300, 300], [300, 400]]);
  expect(r.px[0]).toEqual([253, 216, 53]);
  expect(r.px[1]).toEqual([255, 251, 235]);

  await page.reload();                                          // remembered, like the colors
  await page.waitForFunction(() => window.__overboard);
  expect(await page.locator('#ob-hl-strength').inputValue()).toBe('10');
});
