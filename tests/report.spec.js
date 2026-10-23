// "Board not working?" (app/report/): the steps record whatever input arrives, sending, the fallback,
// and the File ▸ links in the PDF app and the HTML overlay.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, fileMenu, download } = require('./support/app');
const { openOverlay } = require('./support/overlay');

const RELAY = 'https://relay.example/exec';

async function openReport(page, query = '?from=app') {
  await page.addInitScript((url) => { window.__obReportRelay = url; }, RELAY);
  await page.goto('app/report/' + query);
  await expect(page.locator('[data-screen="welcome"]')).toBeVisible();
}
/* a button right after a screen changes is ignored for 450 ms (so a double tap or a palm can't skip a step) */
async function press(page, go) {
  await page.waitForTimeout(500);
  await page.click(`[data-go="${go}"]:visible`);
}
/* a line down the drawing area with synthetic pointer events, like the board sends them */
const line = (page, x, o = {}) => page.evaluate(({ x, o }) => {
  const pad = document.getElementById('pad'), r = pad.getBoundingClientRect();
  const type = o.type || 'pen', buttons = o.buttons || 1, w = o.w || 1;
  const ev = (t, cx, cy) => (document.elementFromPoint(cx, cy) || pad).dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true,
    pointerType: type, pointerId: o.id || 5, isPrimary: true, buttons: t === 'pointerup' ? 0 : buttons, button: t === 'pointermove' ? -1 : (buttons & 32 ? 5 : 0),
    clientX: cx, clientY: cy, width: w, height: w, pressure: 0.5 }));
  const X = r.left + x, Y = r.top + 30;
  ev('pointerdown', X, Y);
  for (let i = 1; i <= 30; i++) ev('pointermove', X, Y + i * 6);
  ev('pointerup', X, Y + 180);
}, { x, o });
const seen = (page) => page.locator('#seen .msg').textContent();
const title = (page) => page.locator('#steps .title').textContent();

test('each step records what actually arrives, even the wrong input, and Next always works', async ({ page }) => {
  await openReport(page);
  await press(page, 'start');
  await expect(page.locator('#steps .count')).toHaveText('Step 1 of 5');
  // the finger step gets the pen (a board that reports fingers as a pen)
  await line(page, 100); await line(page, 200);
  expect(await seen(page)).toBe('✓ Got it! I saw 2 lines.');
  await expect(page.locator('#seen .detail')).toHaveText('Your board said: pen ×2');
  await press(page, 'next');
  expect(await title(page)).toBe('Now draw 2 lines with the pen');
  await line(page, 300, { type: 'mouse' });   // the pen step gets a mouse
  await press(page, 'next');
  // the palm step gets nothing at all: still fine
  expect(await seen(page)).toBe('Waiting… touch the white area.');
  await press(page, 'next');
  await expect(page.locator('[data-go="skip"]')).toHaveText('My board has no eraser');
  await press(page, 'skip');
  // two fingers arrive as scrolling
  await page.evaluate(() => document.getElementById('pad').dispatchEvent(new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true })));
  expect(await seen(page)).toContain('Something happened, but not a line');
  await press(page, 'next');
  await expect(page.locator('[data-screen="questions"]')).toBeVisible();

  const r = await page.evaluate(() => window.__obReport());
  const step = (id) => r.steps.find((s) => s.id === id);
  expect(step('finger').seen).toMatchObject({ lines: 2, types: { pen: 2 }, kinds: { pen: 2 } });
  expect(step('pen').seen).toMatchObject({ lines: 1, types: { mouse: 1 }, kinds: { finger: 1 } });
  expect(step('palm').seen).toMatchObject({ downs: 0, lines: 0, buttonPresses: { mouse: 1 } });   // pressing Next isn't the step's input
  expect(step('palm').skipped).toBe(false);
  expect(step('eraser').skipped).toBe(true);
  expect(step('two').seen).toMatchObject({ wheel: 1, downs: 0 });
  expect(step('finger').events.find((e) => e.ev === 'pointerdown')).toMatchObject({ type: 'pen', on: 'pad', buttons: 1 });
  expect(r.startedWith.pointerType).toBe('mouse');
  expect(r.from).toBe('app');
  expect(r.release).toMatch(/^v\d+$/);
  expect(r.device.userAgent).toBeTruthy();
});

test('a palm sliding onto Next does not skip the step; the eraser button is counted', async ({ page }) => {
  await openReport(page);
  await press(page, 'start'); await press(page, 'next'); await press(page, 'next');
  expect(await title(page)).toBe('Wipe with your flat hand');
  await line(page, 150, { buttons: 32 });   // SMART: a palm is the pen with its eraser button
  await page.waitForTimeout(500);
  const next = await page.locator('[data-go="next"]').boundingBox();
  await page.evaluate(({ x, y }) => {
    const b = document.elementFromPoint(x, y);
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'pen', buttons: 32, button: 5, clientX: x, clientY: y }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'pen', buttons: 0, button: 5, clientX: x, clientY: y }));
    b.click();
  }, { x: next.x + next.width / 2, y: next.y + next.height / 2 });
  expect(await title(page)).toBe('Wipe with your flat hand');
  await expect(page.locator('#seen .detail')).toHaveText('Your board said: pen (eraser button)');
  const palm = (await page.evaluate(() => window.__obReport())).steps[2].seen;
  expect(palm).toMatchObject({ lines: 1, kinds: { palm: 1 } });
  expect(palm.eraserButton).toBeGreaterThan(10);
  // Start this step over forgets it
  await page.click('[data-go="redo"]');
  expect((await page.evaluate(() => window.__obReport())).steps[2].seen.downs).toBe(0);
});

async function toReview(page) {
  await press(page, 'start');
  await line(page, 100, { type: 'mouse' });
  for (let i = 0; i < 5; i++) await press(page, 'next');
  await page.click('[data-brand="promethean"]');
  await page.fill('#model', 'ActivPanel 9');
  await page.check('#problems input[value="palm-draws"]');
  await page.fill('#comments', 'Room 12, the palm draws');
  await page.fill('#email', 'teacher@example.com');
  await press(page, 'review');
  await expect(page.locator('#summary')).toContainText('Promethean · ActivPanel 9');
  await expect(page.locator('#summary')).toContainText('1 line, seen as mouse');
}

test('Send posts the report to the relay and says thank you', async ({ page }) => {
  let body = null;
  await page.route(RELAY, async (route) => {
    body = JSON.parse(route.request().postData());
    route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, issue: 12, url: 'https://github.com/BPMData/OverBoard/issues/12' }) });
  });
  await openReport(page, '?from=overlay&ov=v19');
  await toReview(page);
  await press(page, 'send');
  await expect(page.locator('[data-screen="done"]')).toBeVisible();
  await expect(page.locator('[data-screen="done"] .issue')).toHaveAttribute('href', 'https://github.com/BPMData/OverBoard/issues/12');
  expect(body).toMatchObject({ app: 'OverBoard', kind: 'board-report', from: 'overlay', overlayVersion: 'v19', website: '',
    answers: { brand: 'promethean', model: 'ActivPanel 9', problems: ['palm-draws'] },
    private: { email: 'teacher@example.com', comments: 'Room 12, the palm draws' } });
  expect(body.steps.map((s) => s.id)).toEqual(['finger', 'pen', 'palm', 'eraser', 'two']);
  expect(body.system.browser).toMatch(/\d/);
});

test('when sending fails: download, copy, or email the report; no other site is contacted', async ({ page }) => {
  const outside = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { outside.push(r.request().url()); r.abort(); });
  await openReport(page);
  await toReview(page);
  expect(outside).toEqual([]);
  await press(page, 'send');
  await expect(page.locator('#fallback')).toBeVisible();
  expect(outside).toEqual([RELAY]);
  await expect(page.locator('#fallback .mail')).toContainText('overboard.reporting@gmail.com');
  await expect(page.locator('[data-go="send"]')).toHaveText('Try sending again');
  const dl = await download(page, () => page.click('[data-go="download"]'));
  expect(dl.suggestedFilename()).toBe('OverBoard-board-report.json');
  const saved = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  expect(saved.answers.brand).toBe('promethean');
});

test('PDF app: File ▸ Board not working? and the start screen link open the report page', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#ob-start a[href="report/?from=start&lang=en"]')).toHaveText('Board not working?');
  await openPdf(page, 'book.pdf');
  const [popup] = await Promise.all([page.waitForEvent('popup'), fileMenu(page, 'report')]);
  await popup.waitForLoadState();
  expect(popup.url()).toMatch(/\/app\/report\/\?from=app&lang=en$/);
  await expect(popup.locator('[data-screen="welcome"] h1')).toHaveText('Is OverBoard not working on your board?');
  await expect(page.locator('#ob-filemenu')).toBeHidden();
});

test('HTML overlay: File ▸ Board not working? opens the website page with the overlay version', async ({ page }) => {
  await openOverlay(page);
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await page.click('#ink-bar [data-act="file"]');
  await page.click('#ob-filemenu [data-act="report"]');
  const v = (await page.content()).match(/INK OVERLAY START \((v\d+)\)/)[1];
  expect(await page.evaluate(() => window.__opened)).toEqual(['https://bpmdata.github.io/OverBoard/app/report/?from=overlay&ov=' + v + '&lang=en']);
  await expect(page.locator('#ob-filemenu')).toBeHidden();
});

test('the page speaks the language it was opened in, switches from its 🌐 list, and sends the language with the report', async ({ page }) => {
  let body = null;
  await page.route(RELAY, async (route) => {
    body = JSON.parse(route.request().postData());
    route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, issue: 3, url: 'https://github.com/BPMData/OverBoard/issues/3' }) });
  });
  await openReport(page, '?from=overlay&ov=v24&lang=es');
  await expect(page.locator('[data-screen="welcome"] h1')).toHaveText('¿OverBoard no funciona en tu pizarra?');
  await expect(page.locator('#lang')).toHaveValue('es');
  // the 🌐 list is on the first screen; switching changes every word at once
  await page.selectOption('#lang', 'fr');
  await expect(page.locator('[data-screen="welcome"] h1')).toHaveText('OverBoard ne fonctionne pas sur votre tableau ?');
  await expect(page.locator('[data-go="start"]')).toHaveText('Commencer');
  await page.selectOption('#lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.selectOption('#lang', 'es');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await press(page, 'start');
  await expect(page.locator('#steps .count')).toHaveText('Paso 1 de 5');
  await line(page, 100, { type: 'mouse' });
  expect(await seen(page)).toBe('✓ ¡Listo! Vi 1 línea.');
  for (let i = 0; i < 5; i++) await press(page, 'next');
  await expect(page.locator('[data-brand="unknown"]')).toHaveText('No lo sé');
  await page.click('[data-brand="unknown"]');
  await press(page, 'review');
  await expect(page.locator('#summary')).toContainText('1 línea, detectado como mouse');
  await expect(page.locator('#summary')).toContainText('No lo sé');
  await expect(page.locator('[data-go="send"]')).toHaveText('Enviar');
  await press(page, 'send');
  await expect(page.locator('[data-screen="done"] h1')).toHaveText('¡Gracias!');
  expect(body.lang).toBe('es');
  expect(body.steps[0].asked).toBe('Draw 2 lines with your finger');   // the report itself stays in English for us
});
