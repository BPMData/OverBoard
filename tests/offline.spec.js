// Offline use (app/sw.js): after one online visit the app opens, opens PDFs and exports with no
// connection, and updates replace the whole app in one step. Each test serves its own copy of the site.
const { test, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { expect, fixture, fileMenu, download } = require('./support/app');
const { serveCopy, swReady, swUpdate, cacheNames } = require('./support/site');

test.use({ serviceWorkers: 'allow' });

let site;
test.afterEach(() => site && site.close());

async function visit(page) {
  await page.goto(site.url);
  await page.waitForFunction(() => window.__overboard);
}
/* one online visit (the offline copy downloads), then open the app again so the copy serves it */
async function firstVisit(page) {
  site = site || await serveCopy();
  await page.addInitScript({ path: path.join(__dirname, 'support', 'pointer.js') });
  await visit(page);
  await swReady(page);
  await visit(page);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
const appCss = (page) => page.evaluate(() => fetch('app.css').then((r) => r.text()));
function deploy() {   // a new version of the site, built the way a real release is
  site.write('app/app.css', site.read('app/app.css') + '/* v2 */\n');
  site.build();
}

test.beforeEach(() => { site = null; });

test('the manifest is valid and Chrome can install the app', async ({ page }) => {
  await firstVisit(page);
  const s = await page.context().newCDPSession(page);
  const m = await s.send('Page.getAppManifest');
  expect(m.errors).toEqual([]);
  const data = JSON.parse(m.data);
  expect(data.display).toBe('standalone');
  expect(data.icons.map((i) => i.purpose + ' ' + i.sizes)).toEqual(['any 192x192', 'any 512x512', 'maskable 512x512']);
  const { installabilityErrors } = await s.send('Page.getInstallabilityErrors');
  expect(installabilityErrors.filter((e) => e.errorId !== 'in-incognito')).toEqual([]);   // test browsers are always incognito
  // "Install app" appears only when the browser offers installing
  await expect(page.locator('#ob-install')).toBeHidden();
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__asked = true; }; window.dispatchEvent(e); });
  await expect(page.locator('#ob-install')).toBeVisible();
  await page.click('#ob-install button');
  expect(await page.evaluate(() => window.__asked)).toBe(true);
  await expect(page.locator('#ob-install')).toBeHidden();
});

test('after one visit the app opens with no connection', async ({ page, context }) => {
  await firstVisit(page);
  await context.setOffline(true);
  await visit(page);
  await expect(page.locator('#ob-drop')).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
});

test('offline, a PDF opens, takes ink and exports', async ({ page, context }) => {
  await firstVisit(page);
  await context.setOffline(true);
  await visit(page);
  await page.setInputFiles('#ob-file', fixture('book.pdf'));
  await page.waitForFunction(() => window.__overboard.viewer.stats().images >= 1);
  await page.evaluate(() => __t.stroke(1, __t.line(100, 100, 300, 100)));
  const dl = await download(page, () => fileMenu(page, 'export'));   // export.js and pdf-lib come from the offline copy
  expect(dl.suggestedFilename()).toBe('book_annotated_P1.pdf');
  expect((await fs.promises.readFile(await dl.path())).subarray(0, 5).toString()).toBe('%PDF-');
});

test('a new version downloads completely, then replaces the old one in one step', async ({ page, context }) => {
  await firstVisit(page);
  const v1 = site.swVersion();
  expect(await cacheNames(page)).toEqual(['overboard-' + v1]);
  deploy();
  const v2 = site.swVersion();
  expect(v2).not.toBe(v1);
  expect(await swUpdate(page)).toBe('installed');
  // the open page keeps the old version, and both copies exist while the new one waits
  expect(await appCss(page)).not.toContain('/* v2 */');
  expect((await cacheNames(page)).sort()).toEqual(['overboard-' + v1, 'overboard-' + v2].sort());
  // close OverBoard and open it again: all new files, and the old copy is gone
  await page.close();
  page = await context.newPage();
  await visit(page);
  expect(await appCss(page)).toContain('/* v2 */');
  await expect.poll(() => cacheNames(page)).toEqual(['overboard-' + v2]);
  const stamps = await page.evaluate(async () => [document.querySelector('meta[name="ob-version"]').content, (await (await fetch('version.json')).json()).v]);
  expect(stamps[0]).toBe(stamps[1]);
});

test('a half-finished update on the site is not used; the old version stays', async ({ page }) => {
  await firstVisit(page);
  const v1 = site.swVersion(), css = site.read('app/app.css');
  deploy();
  site.write('app/app.css', css);   // sw.js is new but app.css is still the old file
  expect(await swUpdate(page)).toBe('redundant');
  expect(await cacheNames(page)).toEqual(['overboard-' + v1]);
  await visit(page);
  expect(await appCss(page)).toBe(css);
  expect(await cacheNames(page)).toEqual(['overboard-' + v1]);
});

test('with a second OverBoard page open, reloading keeps the current version', async ({ page, context }) => {
  await firstVisit(page);
  const other = await context.newPage();
  await other.goto(site.url);
  await other.waitForFunction(() => window.__overboard);
  deploy();
  expect(await swUpdate(page)).toBe('installed');
  await visit(page);   // the other page still uses the current version, so no switch
  expect(await appCss(page)).not.toContain('/* v2 */');
  expect(await appCss(other)).not.toContain('/* v2 */');
});

/* Reopening the app while the browser is still open switches at load, before the app starts.
   Playwright's debugger, attached to every service worker, can hold that switch back, so this runs
   in a plain headless Chrome: a page on the site drives the app in a frame and reports back. */
test('reopening the app switches to a downloaded update before the app starts (plain Chrome)', async () => {
  let report, chrome;
  const got = new Promise((r) => { report = r; });
  site = await serveCopy({
    '/__deploy': (u, res) => { deploy(); res.end('ok'); },
    '/__report': (u, res) => { res.end('ok'); report(JSON.parse(u.searchParams.get('r'))); },
  });
  site.write('driver.html', `<!doctype html><iframe id="f" width="900" height="700"></iframe><script>
    const f = document.getElementById('f'), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function until(fn) { for (let t = Date.now(); Date.now() - t < 20000; await sleep(50)) { try { const v = await fn(); if (v) return v; } catch (e) {} } return null; }
    async function open() { f.src = 'app/?' + Math.random(); await sleep(50); return until(() => f.contentWindow.__overboard); }
    const css = () => f.contentWindow.fetch('app.css').then((r) => r.text());
    (async () => {
      const r = {};
      await open();
      r.installed = !!(await until(() => f.contentWindow.navigator.serviceWorker.getRegistration().then((g) => g && g.active)));
      await open();
      r.controlled = !!f.contentWindow.navigator.serviceWorker.controller;
      await fetch('__deploy');
      const reg = await f.contentWindow.navigator.serviceWorker.getRegistration();
      reg.update();
      r.waiting = !!(await until(() => reg.waiting));
      r.oldBefore = !(await css()).includes('/* v2 */');
      await open();   // the loader asks the new version to switch, then reloads
      r.newAfter = (await css()).includes('/* v2 */');
      // the old copy is deleted just after the switch (the activate step), so wait for it
      r.caches = (await until(async () => { const k = await caches.keys(); return k.length === 1 && k; })) || await caches.keys();
      fetch('__report?r=' + encodeURIComponent(JSON.stringify(r)));
    })();
  </script>`);
  const profile = path.join(site.dir, 'profile');
  chrome = spawn(process.env.PW_CHROMIUM || chromium.executablePath(), ['--headless=new', '--no-sandbox', '--no-first-run',
    '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, site.url.replace('app/', 'driver.html')], { stdio: 'ignore' });
  try {
    const r = await got;
    expect(r).toEqual({ installed: true, controlled: true, waiting: true, oldBefore: true, newAfter: true, caches: ['overboard-' + site.swVersion()] });
  } finally {
    chrome.kill();
    await new Promise((r) => chrome.once('exit', r));
  }
});
