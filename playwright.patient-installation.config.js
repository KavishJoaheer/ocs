import { defineConfig } from "@playwright/test";

const port = process.env.E2E_INSTALL_PORT || "4184";
process.env.E2E_INSTALL_PORT = port;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "patient-installation.spec.js",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 3,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run preview --prefix patient-portal -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
