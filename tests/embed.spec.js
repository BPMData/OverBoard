// "Save ink into PDF": opt-in, original bytes untouched, saves replace the tail, ink comes back anywhere.
// Chrome's save window and file handles are replaced by an in-memory stand-in (support/fakefs.js).
const fs = require('fs');
const { test } = require('@playwright/test');
const { expect, fixture, openApp, openPdf, strokes, fileMenu, download } = require('./support/app');
const { pdfPixels, white } = require('./support/render');

const line = (x0, y0, x1, y1) => Array.from({ length: 31 }, (_, i) => [x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30]);
const writes = (page) => page.evaluate(() => window.__writes || 0);
const fileBytes = async (page, name) => Buffer.from(await page.evaluate((n) => __fileBytes(n), name));

for (const name of ['worksheet.pdf', 'book.pdf']) {
  test(`save ink into a copy of ${name}`, async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openApp(page, { fakeFs: true });
    await openPdf(page, name);
    const key = await page.evaluate(() => __overboard.doc.hash);
    await page.evaluate((p) => __t.stroke(1, p), line(100, 190, 300, 190));
    expect(await writes(page)).toBe(0);                       // nothing written before opting in

    await fileMenu(page, 'pdf-link');
    await expect(page.locator('#ob-embed')).toBeVisible();     // explains first
    await page.click('#ob-embed [value="cancel"]');
    expect(await page.evaluate(() => window.__pickOpts)).toBeUndefined();

    await fileMenu(page, 'pdf-link');
    await page.click('#ob-embed [value="ok"]');
    await page.waitForFunction(() => window.__writes >= 1);
    const saved = await page.evaluate(() => window.__pickOpts.suggestedName);
    expect(saved).toBe(name.replace('.pdf', '_board.pdf'));
    await expect(page.locator('[data-act="pdf-link"]')).toHaveText('Saving into PDF ✓', { timeout: 5000 });

    await page.evaluate((p) => __t.stroke(1, p), line(100, 250, 300, 250));
    await page.waitForFunction(() => window.__writes >= 2, null, { timeout: 15000 });   // autosaves
    const orig = fs.readFileSync(fixture(name)), first = await fileBytes(page, saved);
    expect(first.subarray(0, orig.length).equals(orig)).toBe(true);   // the original bytes come first, untouched
    await page.evaluate((p) => __t.stroke(1, p), line(100, 300, 120, 300));
    await page.waitForFunction(() => window.__writes >= 3, null, { timeout: 15000 });
    const again = await fileBytes(page, saved);
    expect(Math.abs(again.length - first.length)).toBeLessThan(200);   // replaces the tail, doesn't grow
    const file = info.outputPath(saved);
    fs.writeFileSync(file, again);

    await page.click('[data-act="file"]');                    // turn it off (two taps)
    await page.click('#ob-filemenu [data-act="pdf-link"]');
    await page.click('#ob-filemenu [data-act="pdf-link"]');
    await expect(page.locator('[data-act="pdf-link"]')).toHaveText('Save ink into PDF…');
    const w = await writes(page);
    await page.evaluate((p) => __t.stroke(1, p), line(100, 350, 300, 350));
    await page.waitForTimeout(9500);
    expect(await writes(page)).toBe(w);

    // a fresh browser opens the board copy: the ink is back, under the same document key
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await openApp(p2);
    await openPdf(p2, file);
    await expect(p2.locator('#ink-status')).toContainText('inside the PDF');
    expect(await strokes(p2)).toHaveLength(3);
    expect(await p2.evaluate(() => __overboard.doc.hash)).toBe(key);
    const r = await pdfPixels(p2, file, 1, [[200, 190]]);
    expect(r.attachments).toContain('overboard-ink.json');
    expect(white(r.px[0])).toBe(true);                        // stored, not drawn: the page looks like the original
    const dl = await download(p2, () => fileMenu(p2, 'export'));
    const exp = info.outputPath('export.pdf');
    await dl.saveAs(exp);
    expect((await pdfPixels(p2, exp, 1, [[0, 0]])).attachments).not.toContain('overboard-ink.json');
    await ctx.close();
  });
}
