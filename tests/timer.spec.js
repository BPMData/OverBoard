// The ⏱ Timer (shared/ink-core.js makeTimer) and the swatches that change with the tool (setPalette),
// the same in the HTML overlay and the PDF app. Time is moved forward with Playwright's clock, and the
// browser's sound is a stand-in that counts what would have played.
const { test } = require('@playwright/test');
const { expect, openApp, openPdf } = require('./support/app');
const { openOverlay, savedInk } = require('./support/overlay');

/* a stand-in for the Web Audio API: counts contexts, resumes, chime tones and played sound files */
const FAKE_AUDIO = `
  window.__audio = { made: 0, resumed: 0, tones: 0, played: 0, decoded: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  window.AudioContext = class {
    constructor() { __audio.made++; this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
    resume() { __audio.resumed++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() { return { type: '', frequency: param(), connect() {}, start() { __audio.tones++; }, stop() {} }; }
    createGain() { return { gain: param(), connect() {} }; }
    createBufferSource() { return { buffer: null, connect() {}, start() { __audio.played++; }, stop() {} }; }
    decodeAudioData(data, ok) { __audio.decoded++; const b = { duration: 1 }; if (ok) ok(b); return Promise.resolve(b); }
  };`;
const audio = (page) => page.evaluate(() => ({ ...window.__audio }));

/* a tiny real .wav file (0.1 s of silence) */
function wav(samples = 800) {
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}

const face = (page) => page.locator('#ob-timer .ob-tm-face b');
const timerBtn = (page) => page.locator('#ink-bar [data-act="timer"]');
async function startTimer(page, min) {
  await timerBtn(page).click();
  await expect(page.locator('#ob-timerset')).toBeVisible();
  await page.click(`#ob-timerset [data-min="${min}"]`);
  await page.click('#ob-timerset [data-ts="start"]');
  await expect(page.locator('#ob-timerset')).toBeHidden();
  await expect(page.locator('#ob-timer')).toBeVisible();
}
const openSettings = async (page) => {
  if (await page.locator('#ob-filemenu').isHidden()) await page.click('#ink-bar [data-act="file"]');
  await page.click('#ob-filemenu [data-act="settings"]');
  await expect(page.locator('#ob-settings')).toBeVisible();
};
const soundInput = '#ob-settings .ob-tm-sound input[type="file"]';
const soundNow = (page) => page.locator('#ob-settings .ob-tm-now');
const swatches = (page) => page.locator('#ink-colors [data-color]').evaluateAll((bs) => bs.map((b) => b.dataset.color));
const onSwatch = (page) => page.evaluate(() => document.querySelector('#ink-colors [data-color].on')?.dataset.color);

/* the sound kept in a database's "ink" store, or undefined */
const keptSound = (page, db) => page.evaluate((db) => new Promise((res) => {
  const rq = indexedDB.open(db);
  rq.onsuccess = () => {
    const d = rq.result, g = d.transaction('ink').objectStore('ink').get('ob-timer-sound');
    g.onsuccess = () => { d.close(); res(g.result ? { name: g.result.name, bytes: g.result.data.byteLength } : undefined); };
  };
}), db);

test.describe('HTML overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(FAKE_AUDIO);
    await page.clock.install();
    await page.setViewportSize({ width: 1400, height: 900 });
    await openOverlay(page);
  });

  test('big taps set the time, holding + speeds up, and Start turns on sound and counts down to an alert', async ({ page }) => {
    await expect(timerBtn(page)).toHaveText('⏱ Timer');
    await timerBtn(page).click();
    const val = page.locator('#ob-timerset .ob-tm-val');
    await expect(val).toHaveText('5:00');                                   // the first time: 5 minutes
    await expect(page.locator('#ob-timerset [data-min="5"]')).toHaveClass(/\bon\b/);
    await expect(page.locator('#ob-timerset [data-min]')).toHaveText(['1 min', '2 min', '3 min', '5 min', '10 min', '15 min']);
    await page.click('#ob-timerset [data-min="2"]');
    await expect(val).toHaveText('2:00');
    await page.click('#ob-timerset [data-ts="more"]');                      // one tap = one minute
    await expect(val).toHaveText('3:00');
    await page.click('#ob-timerset [data-ts="less"]');
    await expect(val).toHaveText('2:00');
    // hold + : it keeps going, faster after a few steps
    const more = await page.locator('#ob-timerset [data-ts="more"]').boundingBox();
    await page.mouse.move(more.x + more.width / 2, more.y + more.height / 2);
    await page.mouse.down();
    await page.clock.runFor(1500);
    await page.mouse.up();
    expect(parseInt(await val.textContent(), 10)).toBeGreaterThanOrEqual(12);
    expect(await audio(page)).toMatchObject({ made: 0 });                   // nothing about sound loads until Start

    await page.click('#ob-timerset [data-min="1"]');
    await page.click('#ob-timerset [data-ts="start"]');
    await expect(page.locator('#ob-timer')).toBeVisible();
    const a = await audio(page);
    expect(a.made).toBe(1);                                                 // tapping Start made and switched on the sound
    expect(a.resumed).toBeGreaterThanOrEqual(1);
    await expect(face(page)).toHaveText(/^(1:00|0:5\d)$/);
    await expect(timerBtn(page)).toHaveText(/^⏱ (1:00|0:5\d)$/);           // the toolbar button shows the time left

    await page.clock.runFor(20000);
    await expect(face(page)).toHaveText(/^0:(40|3\d)$/);
    await page.click('#ob-timer [data-tm="pause"]');
    await expect(page.locator('#ob-timer [data-tm="pause"]')).toHaveText('Resume');
    const paused = await face(page).textContent();
    await page.clock.runFor(10000);
    await expect(face(page)).toHaveText(paused);                            // paused: no time passes
    await page.click('#ob-timer [data-tm="pause"]');
    await expect(page.locator('#ob-timer [data-tm="pause"]')).toHaveText('Pause');
    await page.click('#ob-timer [data-tm="plus"]');                         // +1 minute
    await expect(face(page)).toHaveText(/^1:[34]\d$/);

    await page.clock.runFor(101000);
    await expect(page.locator('#ob-timer')).toHaveClass(/\bup\b/);          // zero: the box flashes and says so
    await expect(page.locator('#ob-timer .ob-tm-msg')).toBeVisible();
    await expect(page.locator('#ob-timer .ob-tm-msg')).toHaveText("Time's up!");
    await expect(face(page)).toHaveText('0:00');
    expect((await audio(page)).tones).toBeGreaterThan(0);                   // the built-in chime played
    await page.click('#ob-timer .ob-tm-face');                              // a tap stops the alert
    await expect(page.locator('#ob-timer')).not.toHaveClass(/\bup\b/);
    await expect(face(page)).toHaveText('1:00');
    await expect(page.locator('#ob-timer [data-tm="pause"]')).toHaveText('Start');
    await page.click('#ob-timer [data-tm="close"]');                        // not running: closes at once
    await expect(page.locator('#ob-timer')).toBeHidden();
    await expect(timerBtn(page)).toHaveText('⏱ Timer');
    // next time it starts at the last time used
    await timerBtn(page).click();
    await expect(val).toHaveText('1:00');
  });

  test('closing a running timer takes two taps; Reset goes back to the start time', async ({ page }) => {
    await startTimer(page, 3);
    await page.clock.runFor(30000);
    await page.click('#ob-timer [data-tm="reset"]');
    await expect(face(page)).toHaveText('3:00');
    await expect(page.locator('#ob-timer [data-tm="pause"]')).toHaveText('Start');
    await page.click('#ob-timer [data-tm="pause"]');
    await page.click('#ob-timer [data-tm="close"]');
    await expect(page.locator('#ob-timer [data-tm="close"]')).toHaveText('Sure?');
    await expect(page.locator('#ob-timer')).toBeVisible();
    await page.click('#ob-timer [data-tm="close"]');
    await expect(page.locator('#ob-timer')).toBeHidden();
  });

  test('the timer stays out of the ink: it can be dragged and made small, and drawing still works', async ({ page }) => {
    await startTimer(page, 5);
    const before = await page.locator('#ob-timer').boundingBox();
    expect(before.x + before.width).toBeGreaterThan(1300);                  // starts in the top corner away from the toolbar
    expect(before.y).toBeLessThan(60);
    // drag the numbers with a finger
    const f = await face(page).boundingBox();
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
    await page.mouse.down();
    await page.mouse.move(f.x + f.width / 2 - 500, f.y + f.height / 2 + 300, { steps: 6 });
    await page.mouse.up();
    const after = await page.locator('#ob-timer').boundingBox();
    expect(after.x).toBeLessThan(before.x - 450);
    expect(after.y).toBeGreaterThan(before.y + 250);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ob-timer-pos')))).toMatchObject({ x: Math.round(after.x) });
    // small, then a tap makes it big again
    await page.click('#ob-timer [data-tm="small"]');
    await expect(page.locator('#ob-timer')).toHaveClass(/\bsmall\b/);
    expect((await page.locator('#ob-timer').boundingBox()).width).toBeLessThan(250);
    await expect(page.locator('#ob-timer [data-tm="pause"]')).toBeHidden();
    await page.click('#ob-timer .ob-tm-face');
    await expect(page.locator('#ob-timer')).not.toHaveClass(/\bsmall\b/);
    // at zero a small timer comes back big
    await page.click('#ob-timer [data-tm="small"]');
    await page.clock.runFor(5 * 60000 + 1000);
    await expect(page.locator('#ob-timer')).toHaveClass(/\bup\b/);
    await expect(page.locator('#ob-timer')).not.toHaveClass(/\bsmall\b/);
    // a pen stroke on the page still writes while the timer is up
    const t = await page.locator('#ob-timer').boundingBox();
    await page.evaluate(([x0, x1, y]) => new Promise(async (res) => {
      const c = document.getElementById('ink-canvas');
      const ev = (type, x) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 3, buttons: type === 'pointerup' ? 0 : 1, button: 0, clientX: x, clientY: y }));
      ev('pointerdown', x0);
      for (let i = 1; i <= 30; i++) { await new Promise((r) => setTimeout(r, 4)); ev('pointermove', x0 + (x1 - x0) * i / 30); }
      ev('pointerup', x1); res();
    }), [t.x - 200, t.x + 100, t.y + t.height / 2]);
    await page.clock.runFor(100);
    const d = await savedInk(page);
    expect(d.periods.P1).toHaveLength(1);
  });

  test('Settings ▸ Timer sound: your own .wav, Test sound, kept after a reload, back to the chime', async ({ page }) => {
    await openSettings(page);
    await expect(soundNow(page)).toHaveText('At zero it plays: the built-in chime');
    await expect(page.locator('#ob-settings [data-snd="chime"]')).toBeHidden();
    await page.click('#ob-settings [data-snd="test"]');
    expect(await audio(page)).toMatchObject({ made: 1 });
    await expect.poll(async () => (await audio(page)).tones).toBeGreaterThan(0);   // Test sound plays the chime

    await page.setInputFiles(soundInput, { name: 'bell.wav', mimeType: 'audio/wav', buffer: wav() });
    await expect(soundNow(page)).toHaveText('At zero it plays: bell.wav');
    await expect(page.locator('#ob-settings [data-snd="chime"]')).toBeVisible();
    expect(await keptSound(page, 'ink-data')).toEqual({ name: 'bell.wav', bytes: wav().length });
    await page.click('#ob-settings [data-snd="test"]');
    await expect.poll(async () => (await audio(page)).played).toBe(1);

    await page.reload();
    await page.waitForSelector('#ink-bar[data-ready]', { state: 'attached' });
    await openSettings(page);
    await expect(soundNow(page)).toHaveText('At zero it plays: bell.wav');
    await page.click('#ob-settings [data-s="done"]');
    await startTimer(page, 1);
    await page.clock.runFor(61000);
    await expect(page.locator('#ob-timer')).toHaveClass(/\bup\b/);
    expect(await audio(page)).toMatchObject({ played: 1, tones: 0 });      // your sound, not the chime

    await openSettings(page);
    await page.click('#ob-settings [data-snd="chime"]');
    await expect(soundNow(page)).toHaveText('At zero it plays: the built-in chime');
    expect(await keptSound(page, 'ink-data')).toBeUndefined();
  });

  test('a sound file that is too big, or not a sound, is refused with a message', async ({ page }) => {
    await openSettings(page);
    await page.setInputFiles(soundInput, { name: 'long.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
    await expect(page.locator('#ob-settings .ob-tm-sound .ob-err')).toHaveText('That file is over 5 MB. Pick a shorter sound.');
    await page.setInputFiles(soundInput, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.locator('#ob-settings .ob-tm-sound .ob-err')).toHaveText("That file can't be played. Pick a .wav or .mp3.");
    await expect(soundNow(page)).toHaveText('At zero it plays: the built-in chime');
    expect(await keptSound(page, 'ink-data')).toBeUndefined();
  });

  test('the swatches change with the tool: pen, highlighter, cover', async ({ page }) => {
    expect(await swatches(page)).toEqual(['#111111', '#1565c0', '#d32f2f', '#e0218a', '#2e7d32']);
    expect(await onSwatch(page)).toBe('#e0218a');                           // the pen starts pink
    await page.click('#ink-bar [data-act="hilite"]');
    expect(await swatches(page)).toEqual(['#fdd835', '#2e7d32', '#e0218a', '#1565c0', '#e8441a']);
    expect(await onSwatch(page)).toBe('#fdd835');                           // the highlighter starts yellow
    await expect(page.locator('#ink-colors [data-color="#fdd835"]')).toHaveAttribute('title', 'Yellow');
    await page.click('#ink-bar [data-act="hl-menu"]');
    await page.click('#ob-hlmenu [data-mode="cover"][data-cover="#111111"]');
    expect(await swatches(page)).toEqual(['#111111', '#a6a6a6', '#ffffff', '#fdd835', '#e0218a']);
    await page.click('#ink-colors [data-color="#ffffff"]');
    expect(await onSwatch(page)).toBe('#ffffff');
    await expect(page.locator('#ink-colors [data-color="#ffffff"]')).toHaveAttribute('title', 'Cover: white');
    await page.click('#ink-bar [data-act="hilite"]');                      // back to the pen: its own colors and its own color
    expect(await swatches(page)).toEqual(['#111111', '#1565c0', '#d32f2f', '#e0218a', '#2e7d32']);
    expect(await onSwatch(page)).toBe('#e0218a');
  });

  test('the timer fits in every language', async ({ page }) => {
    for (const code of ['en', 'es', 'zh', 'tl', 'vi', 'fr', 'pt', 'ar']) {
      await page.evaluate((c) => localStorage.setItem('ob-lang', c), code);
      await page.reload();
      await page.waitForSelector('#ink-bar[data-ready]', { state: 'attached' });
      await timerBtn(page).click();
      await page.click('#ob-timerset [data-ts="start"]');
      const clipped = await page.evaluate(() => [...document.querySelectorAll('#ob-timer button, #ob-timerset button')]
        .filter((b) => b.offsetParent && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
      expect({ code, clipped }).toEqual({ code, clipped: [] });
      await timerBtn(page).click();                                         // the setup box, over the running timer
      const clippedSet = await page.evaluate(() => [...document.querySelectorAll('#ob-timerset button')]
        .filter((b) => b.offsetParent && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
      expect({ code, clippedSet }).toEqual({ code, clippedSet: [] });
      await page.keyboard.press('Escape');
    }
  });
});

test.describe('PDF app', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(FAKE_AUDIO);
    await page.clock.install();
    await page.setViewportSize({ width: 1400, height: 900 });
    await openApp(page);
    await openPdf(page, 'book.pdf');
  });

  test('the same timer, with the alert and chime at zero', async ({ page }) => {
    await startTimer(page, 2);
    await expect(face(page)).toHaveText(/^(2:00|1:5\d)$/);
    expect((await audio(page)).made).toBe(1);
    await page.clock.runFor(121000);
    await expect(page.locator('#ob-timer')).toHaveClass(/\bup\b/);
    expect((await audio(page)).tones).toBeGreaterThan(0);
    await page.click('#ob-timer .ob-tm-face');
    await expect(page.locator('#ob-timer')).not.toHaveClass(/\bup\b/);
  });

  test('its own sound is kept in the app\'s database', async ({ page }) => {
    await openSettings(page);
    await page.setInputFiles(soundInput, { name: 'gong.wav', mimeType: 'audio/wav', buffer: wav() });
    await expect(soundNow(page)).toHaveText('At zero it plays: gong.wav');
    expect(await keptSound(page, 'overboard')).toEqual({ name: 'gong.wav', bytes: wav().length });
    await page.click('#ob-settings [data-snd="chime"]');
    expect(await keptSound(page, 'overboard')).toBeUndefined();
  });

  test('the swatches change with the tool', async ({ page }) => {
    expect(await swatches(page)).toEqual(['#111111', '#1565c0', '#d32f2f', '#e0218a', '#2e7d32']);
    await page.click('#ink-bar [data-act="hilite"]');
    expect(await swatches(page)).toEqual(['#fdd835', '#2e7d32', '#e0218a', '#1565c0', '#e8441a']);
    expect(await onSwatch(page)).toBe('#fdd835');
  });
});
