import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration against the REAL stack: the Vite dev server on
 * http://localhost:5173 proxying /api to the backend on http://localhost:8080.
 *
 * There is deliberately NO `webServer` block. Both services must already be
 * running before `npx playwright test`; the suite never boots or stops them, so
 * a run can never hide a down backend behind a fixture server.
 *
 * One worker keeps the real requests serialized: these scenarios drive a shared
 * backend state (emergencies, requests), so parallel workers would race.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'on',
    video: 'retain-on-failure',
    // Geolocation is granted at the context level so the citizen screen keeps a
    // real position and the "Permiso de ubicación" modal never covers the action
    // rail. The coordinates sit inside the seeded Suba zone.
    permissions: ['geolocation'],
    geolocation: { latitude: 4.728, longitude: -74.078 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
