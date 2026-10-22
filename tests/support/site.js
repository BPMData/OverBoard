// A private copy of the site on its own port, for the offline tests: each test gets its own origin
// (so its own service worker and cache) and can "deploy" a new version without touching the repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

async function serveCopy(handlers = {}) {   // handlers: { '/path': (url, res) => ... } for test-only endpoints
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overboard-'));
  for (const p of ['app', 'shared', 'tools', 'overlay', 'index.html']) fs.cpSync(path.join(ROOT, p), path.join(dir, p), { recursive: true });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (handlers[u.pathname]) return handlers[u.pathname](u, res);
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(dir, path.normalize(p));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const site = {
    dir,
    url: `http://127.0.0.1:${server.address().port}/app/`,
    read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    write: (rel, text) => fs.writeFileSync(path.join(dir, rel), text),
    build: () => execFileSync('python3', [path.join(dir, 'tools', 'build.py')], { stdio: 'pipe' }),
    swVersion: () => /const VERSION = '(\w+)'/.exec(site.read('app/sw.js'))[1],
    close: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); },
  };
  return site;
}

/* in the page: wait until a service worker version is active (its download finished) */
const swReady = (page) => page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.active.scriptURL));

/* in the page: check for a new version and wait for its download to finish or fail */
const swUpdate = (page) => page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const found = new Promise((res) => reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w.addEventListener('statechange', () => { if (w.state === 'installed' || w.state === 'redundant') res(w.state); });
  }, { once: true }));
  await reg.update();
  return found;
});

const cacheNames = (page) => page.evaluate(() => caches.keys());

module.exports = { serveCopy, swReady, swUpdate, cacheNames };
