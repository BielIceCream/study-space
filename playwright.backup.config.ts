import { defineConfig } from '@playwright/test';
import original from './playwright.config';

const url = 'http://127.0.0.1:1431';
export default defineConfig({
  ...original,
  testMatch: ['backup-physical.spec.ts', 'recovery.spec.ts', 'study-tracks.spec.ts', 'planner.spec.ts', 'spaced-review.spec.ts', 'error-notebook.spec.ts', 'progress-practice.spec.ts'],
  outputDir: './test-results/backup',
  use: { ...original.use, baseURL: url, channel: process.env.STUDYSPACE_E2E_CHANNEL },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 1431 --strictPort',
    url,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
