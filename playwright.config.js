// Browser tests: npm install, npx playwright install chromium, then npm test.
// The site is served as plain files, the same way GitHub Pages serves it.
const { defineConfig } = require('@playwright/test');

const PORT = 4173;
module.exports = defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    acceptDownloads: true,
    // set PW_CHROMIUM to use an already-installed Chromium instead of Playwright's download
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/app/`,
    reuseExistingServer: !process.env.CI,
  },
});
