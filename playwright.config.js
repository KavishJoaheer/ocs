import { defineConfig, devices } from "@playwright/test";

const API_PORT = process.env.E2E_API_PORT || "3001";
const STAFF_PORT = process.env.E2E_STAFF_PORT || "4173";
const PATIENT_PORT = process.env.E2E_PATIENT_PORT || "4174";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node src/index.js",
      cwd: "server",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: API_PORT,
        NODE_ENV: "test",
        DB_PATH: process.env.E2E_DB_PATH || `/tmp/ocs-e2e-${process.pid}.db`,
        CLIENT_ORIGINS: `http://127.0.0.1:${STAFF_PORT},http://127.0.0.1:${PATIENT_PORT},http://localhost:${STAFF_PORT},http://localhost:${PATIENT_PORT}`,
      },
    },
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${STAFF_PORT}`,
      cwd: "client",
      url: `http://127.0.0.1:${STAFF_PORT}`,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VITE_PREVIEW_API: `http://127.0.0.1:${API_PORT}`,
      },
    },
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${PATIENT_PORT}`,
      cwd: "patient-portal",
      url: `http://127.0.0.1:${PATIENT_PORT}`,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VITE_PREVIEW_API: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
