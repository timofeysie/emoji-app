import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3100;
const CLIENT_PORT = 5210;
const STUB_LRS_PORT = 3101;
const API_URL = `http://localhost:${API_PORT}`;
const STUB_LRS_URL = `http://localhost:${STUB_LRS_PORT}`;
const MONGODB_URI = 'mongodb://127.0.0.1:27017/emoji-app-e2e?directConnection=true';

/**
 * E2E tests against a real server and the local Mongo replica set
 * (docs/testing/playwright-plan.md). Own ports and an own database, so a run
 * never touches the dev server (3000/5200) or the `emoji-app` database.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  // Live station state is in memory and shared; one worker until tests prove independent.
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // At 1280px wide the chat panel leaves the rounds column too narrow to show round text.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: `node playwright/stub-lrs-server.mjs`,
      cwd: '..',
      url: `${STUB_LRS_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { STUB_LRS_PORT: String(STUB_LRS_PORT) },
    },
    {
      command: `node playwright/reset-e2e-db.mjs && npm run build:server && node dist/server/main.js`,
      cwd: '..',
      url: `${API_URL}/api/version`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        PORT: String(API_PORT),
        MONGODB_URI,
        DISABLE_AUTH: 'true',
        NODE_ENV: 'test',
        OPENAI_API_KEY: 'e2e-dummy',
        // Step 1c export (docs/xAPI/xapi-export-plan.md); stub LRS, not Veracity (Phase 4).
        XAPI_LRS_ENDPOINT: `${STUB_LRS_URL}/xapi/`,
        XAPI_LRS_KEY: 'e2e-stub-key',
        XAPI_LRS_SECRET: 'e2e-stub-secret',
      },
    },
    {
      command: `npx vite --config client/vite.config.ts --port ${CLIENT_PORT} --strictPort`,
      cwd: '..',
      url: `http://localhost:${CLIENT_PORT}`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: {
        VITE_API_TARGET: API_URL,
        VITE_WS_URL: `ws://localhost:${API_PORT}/ws`,
        VITE_DISABLE_AUTH: 'true',
      },
    },
  ],
});
