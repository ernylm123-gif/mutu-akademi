import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4173'
const local = baseURL.includes('localhost')

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobil', testIgnore: /(ios|shared)\.spec/, use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL || undefined } },
    { name: 'masaustu', testIgnore: /(ios|shared)\.spec/, use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } },
    // iPhone (WebKit motoru) ve Android Chrome açılış senaryoları
    { name: 'iphone-webkit', testMatch: /(ios|shared)\.spec/, use: { ...devices['iPhone 13'] } },
    { name: 'android-chrome', testMatch: /ios\.spec/, use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL || undefined } },
  ],
  webServer: local
    ? { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 180_000 }
    : undefined,
})
