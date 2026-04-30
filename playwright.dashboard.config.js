const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: 'dashboard-smoke.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: [
    {
      command: 'npm run start:web',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: 'npm run start:dashboard:e2e',
      url: 'http://127.0.0.1:3001/live',
      reuseExistingServer: true,
      timeout: 120_000
    }
  ]
});
