import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1440, height: 1000 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: process.env.STUDYSPACE_E2E_PREVIEW === '1'
      ? 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 1420 --strictPort'
      : 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1420 --strictPort',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: process.env.STUDYSPACE_E2E_MANAGED_SERVER === '1' || !process.env.CI,
    timeout: 30_000,
  },
});
