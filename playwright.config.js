// @ts-check
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PORT) || 4190;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    headless: true,
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve.mjs',
    port: PORT,
    reuseExistingServer: false,
    env: { PORT: String(PORT) },
  },
});
