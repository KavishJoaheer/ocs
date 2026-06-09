import { defineConfig, devices } from "@playwright/test";

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
      url: "http://127.0.0.1:3001/api/health",
      reuseExistingServer: false,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "3001",
        NODE_ENV: "test",
        DB_PATH: process.env.E2E_DB_PATH || `/tmp/ocs-e2e-${process.pid}.db`,
        CLIENT_ORIGINS:
          "http://127.0.0.1:4173,http://127.0.0.1:4174,http://localhost:4173,http://localhost:4174",
      },
    },
    {
      command: "npm run preview -- --host 127.0.0.1 --port 4173",
      cwd: "client",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
    },
    {
      command: "npm run preview -- --host 127.0.0.1 --port 4174",
      cwd: "patient-portal",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: false,
    },
  ],
});
