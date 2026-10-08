import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// The preinstalled Chromium is used when present (cloud sandboxes); otherwise Playwright's own.
const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    launchOptions: existsSync(preinstalled) ? { executablePath: preinstalled, args: ['--no-sandbox'] } : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'tsx e2e/start.ts',
    url: 'http://127.0.0.1:3100/login',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
