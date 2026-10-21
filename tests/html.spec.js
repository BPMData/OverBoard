// HTML worksheets dropped on the app: board copies like the Python installer makes.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('@playwright/test');
const { expect, fixture, openApp, openPdf, download } = require('./support/app');

const ROOT = path.join(__dirname, '..');
const overlay = () => fs.readFileSync(path.join(ROOT, 'overlay', 'ink_overlay.html'), 'utf8').trim();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { delete window.showSaveFilePicker; });   // the download path; the save window is tested below
  await openApp(page);
});

async function boardCopy(page, file, info) {
  const dl = await download(page, () => page.setInputFiles('#ob-file', file));
  const out = info.outputPath('from-app', dl.suggestedFilename());   // apart from the original, so the installer can't see it
  await dl.saveAs(out);
  await expect(page.locator('#ob-msg')).toBeVisible();
  return { name: dl.suggestedFilename(), file: out, text: fs.readFileSync(out, 'utf8'), msg: await page.textContent('#ob-msg') };
}

test('plain worksheet: same file the Python installer makes, no folder warning', async ({ page }, info) => {
  const src = info.outputPath('Lab 3.html');
  fs.writeFileSync(src, '<!doctype html><html><head><title>Lab</title></head><body><div class="page">Hello</div></body></html>');
  const r = await boardCopy(page, src, info);
  expect(r.name).toBe('Lab 3_board.html');
  expect(r.text).toContain(overlay());
  expect(fs.existsSync(info.outputPath('Lab 3_board.html'))).toBe(false);
  execFileSync('python3', [path.join(ROOT, 'overlay', 'ink_overlay_installer.py'), src]);
  expect(r.text).toBe(fs.readFileSync(info.outputPath('Lab 3_board.html'), 'utf8'));
  expect(r.msg).not.toContain('separately');
});

test('worksheet with separate picture files gets the folder warning', async ({ page }, info) => {
  const src = info.outputPath('Pics.html');
  fs.writeFileSync(src, '<html><body><div class="page"><img src="images/diagram.png"> Q1</div></body></html>');
  const r = await boardCopy(page, src, info);
  expect(r.msg).toContain("This worksheet uses files stored separately (like images/diagram.png). Put Pics_board.html in the same folder as Pics.html, or it won't show.");
});

test('older overlay is upgraded and its saved ink kept', async ({ page }, info) => {
  const r = await boardCopy(page, fixture('Old_v13.html'), info);
  expect(r.name).toBe('Old_v13_board.html');
  expect(r.text).not.toContain('(v13)');
  expect(r.text).toContain(overlay().split('\n')[0]);
  expect(r.text).toContain('"periods":{"P1":[{"c":"#111"');
  expect(r.msg).toMatch(/upgraded v13 → v\d+, saved ink kept/);
});

test('a board copy that is already current is left alone', async ({ page }, info) => {
  const r = await boardCopy(page, fixture('Old_v13.html'), info);
  await page.setInputFiles('#ob-file', r.file);
  await expect(page.locator('#ob-msg')).toContainText('already has the current overlay');
});

test('HTML dropped while a PDF is open still works', async ({ page }, info) => {
  await openPdf(page, 'worksheet.pdf');
  const src = info.outputPath('Quiz.html');
  fs.writeFileSync(src, '<html><body>Quiz</body></html>');
  const r = await boardCopy(page, src, info);
  expect(r.name).toBe('Quiz_board.html');
});

test('Chrome: saves through the save window with a suggested name', async ({ browser }) => {
  const page = await browser.newPage();
  await openApp(page, { fakeFs: true });
  await page.setInputFiles('#ob-file', fixture('Old_v13.html'));
  await expect(page.locator('#ob-msg')).toContainText('saved as Old_v13_board.html');
  expect(await page.evaluate(() => window.__pickOpts.suggestedName)).toBe('Old_v13_board.html');
  expect(await page.evaluate(async () => (await window.__files['Old_v13_board.html'].text()).includes('INK OVERLAY START'))).toBe(true);
});
