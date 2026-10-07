import { defineConfig, devices } from '@playwright/test'
import { API_BASE } from './tests/localWorker'
import { PREVIEW_PORT, PREVIEW_URL } from './tests/preview'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // A test that passes only on a retry is flaky, so CI fails it instead of letting the retry hide it.
  failOnFlakyTests: !!process.env.CI,
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',
  // Starts the local worker (wrangler dev) that tests/sync.spec.ts talks to, on WORKER_PORT (default 8790).
  globalSetup: './tests/localWorker.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] }
    }
  ],
  webServer: [
    {
      command: 'vp run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_API_BASE: API_BASE
      }
    },
    {
      // The service worker exists only in a build, so tests/offline.spec.ts runs against the preview server.
      command: `vp build && vp preview --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_API_BASE: API_BASE
      }
    }
  ]
})
