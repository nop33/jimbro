import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'rows.perf.ts',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: process.env.PERF_BASE ?? 'http://127.0.0.1:4173'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
