// Pictures (app/image.js): a PNG, JPG or WebP opens as a one-page PDF you can write on.
const { test } = require('@playwright/test');
const { expect, openApp, strokes, fileMenu } = require('./support/app');

const ready = (page) => page.waitForFunction(() => __overboard.doc && __overboard.viewer.pages.length === 1 && __overboard.viewer.stats().images >= 1);

/* a 400 x 200 picture, drawn in the browser, as a file for the file input */
async function picture(page, type, name) {
  const b64 = await page.evaluate((type) => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 200);
    g.fillStyle = '#c00'; g.fillRect(20, 20, 100, 100);
    return c.toDataURL(type).split(',')[1];
  }, type);
  return { name, mimeType: type, buffer: Buffer.from(b64, 'base64') };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openApp(page);
});

for (const [type, name] of [['image/png', 'diagram.png'], ['image/jpeg', 'photo.jpg'], ['image/webp', 'map.webp']]) {
  test(`a ${name.split('.')[1].toUpperCase()} opens as one page, and its ink comes back when it is opened again`, async ({ page }) => {
    const file = await picture(page, type, name);
    await page.setInputFiles('#ob-file', file);
    await ready(page);
    const doc = await page.evaluate(() => ({ hash: __overboard.doc.hash, name: __overboard.doc.name, pages: __overboard.doc.pages }));
    expect(doc.hash).toMatch(/^image-[0-9a-f]{32}$/);
    expect(doc).toMatchObject({ name, pages: 1 });
    await expect(page).toHaveTitle(name.replace(/\.\w+$/, '') + ' · OverBoard');
    // the page has the picture's shape (twice as wide as tall)
    const size = await page.evaluate(async () => { const p = await __overboard.doc.pdf.getPage(1); const v = p.getViewport({ scale: 1 }); return [v.width, v.height]; });
    expect(size[0] / size[1]).toBeCloseTo(2, 2);

    await page.evaluate(() => __t.stroke(1, Array.from({ length: 20 }, (_, i) => [100 + i * 10, 150])));
    await page.evaluate(() => __overboard.flush());
    await fileMenu(page, 'close');
    await page.setInputFiles('#ob-file', file);
    await ready(page);
    expect(await page.evaluate(() => __overboard.doc.hash)).toBe(doc.hash);
    expect((await strokes(page)).length).toBe(1);
  });
}

test('a file that is not a picture, PDF or worksheet still gets a clear message', async ({ page }) => {
  await page.setInputFiles('#ob-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(page.locator('#ob-error')).toContainText('is not a PDF, a picture or an HTML worksheet');
});
