// Languages (Settings ▸ Language, shared/strings.js) and tooltips, in the HTML overlay and the PDF app.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf, fileMenu } = require('./support/app');
const { openOverlay } = require('./support/overlay');

const LANGS = ['en', 'es', 'zh', 'tl', 'vi', 'fr', 'pt', 'ar'];

async function pickLang(page, code) {
  if (await page.locator('#ob-settings').isHidden()) {
    if (await page.locator('#ob-filemenu').isHidden()) await page.click('#ink-bar [data-act="file"]');
    await page.click('#ob-filemenu [data-act="settings"]');
  }
  await page.click(`#ob-settings [data-lang="${code}"]`);
}
const closeSettings = (page) => page.click('#ob-settings [data-s="done"]');

/* the toolbar fits a 1080p board in this language: no scrolling, no stretching, no clipped words */
const fits = (page) => page.evaluate(() => {
  const b = document.getElementById('ink-bar');
  const clipped = [...b.querySelectorAll('button')].filter((x) => x.offsetParent && x.textContent.trim() && x.scrollWidth > x.clientWidth + 1)
    .map((x) => x.textContent.trim());
  return { scroll: b.scrollHeight <= b.clientHeight, wide: b.scrollWidth <= b.clientWidth, clipped };
});

test('every translation is filled in and keeps the {placeholders} of the English', async ({ page }) => {
  await openOverlay(page);
  const bad = await page.evaluate(() => {
    const out = [], all = window.__obStrings();
    const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    for (const [key, row] of Object.entries(all)) {
      if (row.length !== 8) out.push(key + ': ' + row.length + ' languages');
      row.forEach((s, i) => { if (!s || vars(s) !== vars(row[0])) out.push(key + ' [' + i + ']'); });
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test.describe('HTML overlay', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1920, height: 950 }); await openOverlay(page); });

  test('Settings ▸ Language changes the toolbar, menus, tooltips and messages at once, and is remembered', async ({ page }) => {
    await expect(page.locator('#ink-bar [data-act="file"]')).toHaveText('Settings & help ▸');
    await pickLang(page, 'es');
    await expect(page.locator('#ob-settings [data-lang="es"]')).toHaveClass(/on/);
    await expect(page.locator('#ob-settings .ob-head strong')).toHaveText('Ajustes');
    await expect(page.locator('#ob-settings .ob-count b')).toHaveText('4 clases');
    await closeSettings(page);
    await expect(page.locator('#ink-bar [data-act="write"]')).toHaveText('Escribir');
    await expect(page.locator('#ink-bar [data-act="file"]')).toHaveText('Ajustes y ayuda ▸');
    await expect(page.locator('#ink-bar [data-act="finger"]')).toHaveText('Dedo: desplaza');
    await expect(page.locator('#ink-smooth .val')).toHaveAttribute('title', /^El suavizado/);
    await expect(page.locator('#ink-status')).toHaveText('P1 · listo');
    await page.click('#ink-bar [data-act="file"]');
    await expect(page.locator('#ob-filemenu [data-act="print"]')).toHaveText('Guardar PDF');
    await page.keyboard.press('Escape');
    await page.click('#ink-bar [data-act="hl-menu"]');
    await expect(page.locator('#ob-hlmenu [data-mode="hl"]')).toContainText('Resaltar');
    await page.keyboard.press('Escape');
    await page.click('#ink-bar [data-act="clear-all"]');
    await expect(page.locator('#ink-bar [data-act="clear-all"]')).toHaveText('¿Seguro?');
    await page.reload(); await page.waitForSelector('#ink-bar[data-ready]', { state: 'attached' });
    await expect(page.locator('#ink-bar [data-act="write"]')).toHaveText('Escribir');
    await pickLang(page, 'en');
    await closeSettings(page);
    await expect(page.locator('#ink-bar [data-act="write"]')).toHaveText('Write');
  });

  test('every language fits a 1080p board', async ({ page }) => {
    for (const code of LANGS) {
      await pickLang(page, code);
      await closeSettings(page);
      expect({ code, ...(await fits(page)) }).toEqual({ code, scroll: true, wide: true, clipped: [] });
    }
  });

  test('Arabic reads right to left in the menus and Settings; the toolbar layout stays put', async ({ page }) => {
    await pickLang(page, 'ar');
    await expect(page.locator('#ob-settings')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#ink-bar')).not.toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#ink-bar')).toHaveAttribute('lang', 'ar');
    await pickLang(page, 'zh');
    await expect(page.locator('#ob-settings')).not.toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#ink-bar')).toHaveAttribute('lang', 'zh-CN');
  });

  test('every toolbar control has a tooltip', async ({ page }) => {
    const missing = await page.evaluate(() => [...document.querySelectorAll('#ink-bar button, #ink-bar .val, #ink-bar .lbl, #ink-status')]
      .filter((e) => e.offsetParent && !e.dataset.period && !e.title).map((e) => e.outerHTML.slice(0, 80)));
    expect(missing).toEqual([]);
  });
});

test.describe('in a Spanish browser', () => {
  test.use({ locale: 'es-MX' });
  test('OverBoard starts in Spanish until another language is picked', async ({ page }) => {
    await openOverlay(page);
    await expect(page.locator('#ink-bar [data-act="write"]')).toHaveText('Escribir');
    await openApp(page);
    await expect(page.locator('#ob-drop strong')).toHaveText('Suelta un PDF aquí');
  });
});

test.describe('PDF app', () => {
  test('the 🌐 list on the start screen and Settings ▸ Language translate the app', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 950 });
    await openApp(page);
    await page.selectOption('#ob-lang', 'fr');
    await expect(page.locator('#ob-drop strong')).toHaveText('Déposez un PDF ici');
    await expect(page.locator('#ob-recent h2')).toHaveText('Rouvrir');
    await openPdf(page, 'book.pdf');
    await expect(page.locator('#ink-bar [data-act="write"]')).toHaveText('Écrire');
    await expect(page.locator('#ob-pages-total')).toHaveText(/^sur \d+$/);
    await expect(page.locator('#ink-bar [data-act="clear"]')).toHaveText('Effacer ▸');
    await fileMenu(page, 'find');
    await page.fill('#ob-find-q', 'zzzzqqqq');
    await expect(page.locator('#ob-find .msg')).toHaveText('Aucun résultat.');
    for (const code of LANGS) {
      await pickLang(page, code);
      await closeSettings(page);
      expect({ code, ...(await fits(page)) }).toEqual({ code, scroll: true, wide: true, clipped: [] });
    }
    await expect(page.locator('#ink-bar [data-act="write"]')).toHaveText('كتابة');
    await pickLang(page, 'en');
    await closeSettings(page);
    await expect(page.locator('#ink-bar [data-act="file"]')).toHaveText('Settings & help ▸');
    await expect(page.locator('#ink-status')).toHaveText('P1 · ready');
  });

  test('every toolbar control has a tooltip', async ({ page }) => {
    await openApp(page);
    await openPdf(page, 'book.pdf');
    const missing = await page.evaluate(() => [...document.querySelectorAll('#ink-bar button, #ink-bar .val, #ink-bar .lbl, #ink-status')]
      .filter((e) => e.offsetParent && !e.dataset.period && !e.title).map((e) => e.outerHTML.slice(0, 80)));
    expect(missing).toEqual([]);
  });
});
