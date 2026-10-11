import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  webServer: {
    command: 'npx ng serve --port 4200',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120000,
  },
  use: {
    baseURL: 'http://localhost:4200',
  },
});
