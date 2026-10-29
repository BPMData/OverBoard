// HTML overlay ▸ Settings & help ▸ Save ink into file (Chrome/Edge), including into a differently named board copy.
// The stand-in file handle behaves like Chrome: the browser only asks "allow writing?" right after a tap, and a
// question box (confirm) in between uses that tap up. Without the tap, it refuses without asking.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { overlayReady } = require('./support/overlay');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const url = (file) => '/' + path.relative(ROOT, file).split(path.sep).map(encodeURIComponent).join('/');
const DATA_RE = /(<script[^>]*id="ink-data"[^>]*>)([\s\S]*?)(<\/script>)/;
const inkIn = (html) => JSON.parse(DATA_RE.exec(html)[2]);
const withInk = (html, D) => html.replace(DATA_RE, (m, a, b, c) => a + JSON.stringify(D) + c);

async function fakePicker(page, name, text, refuse = 0) {
  await page.addInitScript(([name, text, refuse]) => {
    window.__file = text; window.__asked = 0;
    let perm = 'prompt', tapped = false, refusals = refuse;
    document.addEventListener('pointerdown', () => { tapped = true; }, true);   // a tap lets the browser ask once
    const ask = window.confirm.bind(window);
    window.confirm = (m) => { tapped = false; return ask(m); };   // a question box uses the tap up
    const h = {
      kind: 'file', name,
      async getFile() { return new File([window.__file], name, { type: 'text/html' }); },
      async createWritable() {
        if (perm !== 'granted') throw new DOMException('not allowed', 'NotAllowedError');
        const parts = []; return { async write(b) { parts.push(b); }, async close() { window.__file = parts.join(''); }, async abort() {} };
      },
      async queryPermission() { return perm; },
      async requestPermission() {
        if (!tapped || refusals-- > 0) { tapped = false; throw new DOMException('User activation is required to request permissions.', 'SecurityError'); }
        tapped = false; window.__asked++; perm = 'granted'; return perm;
      },
    };
    window.showOpenFilePicker = async () => [h];
  }, [name, text, refuse]);
}
async function draw(page, y = 300) {
  await page.evaluate(async (y) => {
    const c = document.getElementById('ink-canvas'), b = c.getBoundingClientRect();
    const ev = (t, x) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 3, buttons: t === 'pointerup' ? 0 : 1, button: 0, clientX: x, clientY: b.top + y }));
    ev('pointerdown', b.left + 700);
    for (let x = 710; x <= 900; x += 10) { await new Promise((r) => setTimeout(r, 4)); ev('pointermove', b.left + x); }
    await new Promise((r) => setTimeout(r, 20)); ev('pointerup', b.left + 900);
  }, y);
}
const saveBtn = (page) => page.locator('#ob-filemenu [data-act="savefile"]');
async function saveTap(page) {
  if (await page.locator('#ob-filemenu').isHidden()) await page.click('#ink-bar [data-act="file"]');
  await saveBtn(page).click();
}
async function open(page, file, again = false) {
  await page.setViewportSize({ width: 1400, height: 900 });
  // again: the file changed on disk; ask past the browser's cache (the test server only knows file times to the second)
  await page.goto(url(file) + (again ? '?' + Date.now() : '')); await overlayReady(page);
}

test('save ink into a differently named board copy: the browser asks before our "different file" question', async ({ page }, info) => {
  const inked = info.outputPath('pet_board_inked.html');
  fs.writeFileSync(inked, DEMO);
  await fakePicker(page, 'pet_board_clean.html', DEMO);
  await open(page, inked);
  await draw(page);
  await page.click('#ink-bar [data-period="P2"]');
  await draw(page, 400);
  let asked = '';
  page.on('dialog', (d) => { asked = d.message(); d.accept(); });
  await saveTap(page);   // the first tap explains
  await saveTap(page);   // the second opens the file window
  await expect(saveBtn(page)).toHaveText('Saved to file!');
  expect(asked).toContain('pet_board_clean.html');
  expect(await page.evaluate(() => window.__asked)).toBe(1);
  const ink = inkIn(await page.evaluate(() => window.__file));
  expect([ink.periods.P1.length, ink.periods.P2.length]).toEqual([1, 1]);   // every period's ink
  expect(ink.w).toBeGreaterThanOrEqual(ink.t);
});

test('when the browser still won\'t ask, the button says to tap again, and the next tap saves', async ({ page }, info) => {
  const inked = info.outputPath('pet_board.html');
  fs.writeFileSync(inked, DEMO);
  await fakePicker(page, 'pet_board.html', DEMO, 1);   // refuses the first time
  await open(page, inked);
  await draw(page);
  await saveTap(page);
  await saveTap(page);
  await expect(saveBtn(page)).toHaveText('Tap again to allow');
  await expect(page.locator('#ob-filemenu')).toBeVisible();   // still open, the button right there
  await saveBtn(page).click();
  await expect(saveBtn(page)).toHaveText('Saved to file!');
  expect(inkIn(await page.evaluate(() => window.__file)).periods.P1).toHaveLength(1);
});

test('ink written into a board copy shows, even if this browser used that copy more recently than the ink was drawn', async ({ page }, info) => {
  const clean = info.outputPath('pet_board_clean.html');
  fs.writeFileSync(clean, DEMO);
  await open(page, clean);
  await draw(page);   // try the clean copy out, then clear it: this browser now keeps an empty, newer copy
  await page.click('#ink-bar [data-act="clear-all"]'); await page.click('#ink-bar [data-act="clear-all"]');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(300);
  // another browser (Edge) wrote ink drawn an hour ago into this file, just now
  const now = Date.now(), stroke = { c: '#111', w: 3, e: 0, p: [100, 100, 300, 100] };
  fs.writeFileSync(clean, withInk(DEMO, { v: 2, t: now - 3600e3, w: now, active: 'P1', periods: { P1: [stroke], P2: [], P3: [], P4: [] } }));
  await open(page, clean, true);
  await expect(page.locator('#ink-status')).toContainText('ink loaded from file');
  await page.click('#ink-bar [data-act="undo"]');   // the file's ink is what's on screen: Undo takes its line away
  await expect(page.locator('#ink-bar [data-act="redo"]')).toBeEnabled();
});

test('a file without OverBoard in it: Not saved!, said plainly, and the browser never asks to edit it', async ({ page }, info) => {
  const inked = info.outputPath('pet_board.html');
  fs.writeFileSync(inked, DEMO);
  const plain = '<html><body><div class="page">Plain worksheet</div></body></html>';
  await fakePicker(page, 'pet.html', plain);
  await open(page, inked);
  await draw(page);
  page.on('dialog', (d) => d.accept());
  await saveTap(page);
  await saveTap(page);
  await expect(saveBtn(page)).toHaveText('Not saved!');
  await expect(page.locator('#ink-status')).toContainText("doesn't have OverBoard in it");
  expect(await page.evaluate(() => window.__asked)).toBe(0);
  expect(await page.evaluate(() => window.__file)).toBe(plain);   // untouched
});
