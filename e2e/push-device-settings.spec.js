import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";

const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
test.use({ actionTimeout: 15000, navigationTimeout: 20000 });

for (const role of ["doctor", "operator"]) {
  test(`${role} notification settings require receipt confirmation and disable only this device`, async ({ page, request }, testInfo) => {
    const login = await request.post(`${API}/auth/login`, { data: { username: role === "doctor" ? "arun.dharee" : "operator01", password: "Welcome@123" } });
    expect(login.ok()).toBeTruthy();
    const actor = await login.json();
    await page.context().addCookies((await request.storageState()).cookies);
    const phone = `https://example.invalid/${role}-phone-${Date.now()}`;
    const desktop = `${phone}-desktop`;
    const db = openE2eDb();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(({ endpoint }) => {
      const makeSubscription = () => ({ endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "test", auth: "test" } }), unsubscribe: async () => { subscription = null; return true; } });
      let subscription = makeSubscription();
      const active = { state: "activated", postMessage() {} };
      const registration = { scope: `${location.origin}/`, active, waiting: null, installing: null, addEventListener() {}, update: async () => {},
        pushManager: { getSubscription: async () => subscription, subscribe: async () => (subscription = makeSubscription()) } };
      Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "granted", requestPermission: async () => "granted" } });
      Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve(registration), controller: active,
        getRegistration: async () => registration, register: async () => registration, addEventListener() {}, removeEventListener() {} } });
    }, { endpoint: phone });
    const tests = [];
    await page.route("**/api/push/test-device", async route => {
      tests.push(route.request().postDataJSON());
      await route.fulfill({ json: { accepted: true, message: "Test accepted by the push service. Confirm that the alert appeared on this device; acceptance alone does not prove delivery." } });
    });
    try {
      const otherDevice = await request.post(`${API}/push/subscribe`, { data: { subscription: { endpoint: desktop, keys: { p256dh: "test", auth: "test" } } } });
      expect(otherDevice.ok()).toBeTruthy();
      await page.goto(STAFF);
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const menu = page.getByRole("dialog", { name: "Navigation menu", exact: true });
      await expect(menu.getByText("Enabled on this device", { exact: true })).toBeVisible();
      await expect(page.getByText("Working on this device", { exact: true })).toHaveCount(0);
      await expect.poll(() => db.prepare("SELECT COUNT(*) AS count FROM user_push_subscriptions WHERE user_id=? AND endpoint IN (?,?)").get(actor.user.id, phone, desktop).count).toBe(2);
      await menu.getByRole("button", { name: "Test this device", exact: true }).click();
      await expect(menu.getByText("Did the test alert appear on this device?", { exact: true })).toBeVisible();
      await expect(menu.getByText("You confirmed that this device received the test alert.", { exact: true })).toHaveCount(0);
      await menu.getByRole("button", { name: "I did not receive it", exact: true }).click();
      await expect(menu.getByRole("status")).toContainText("Delivery is not confirmed");
      await menu.getByRole("button", { name: "Test this device", exact: true }).click();
      await menu.getByRole("button", { name: "I received the alert", exact: true }).click();
      await expect(menu.getByRole("status")).toHaveText("You confirmed that this device received the test alert.");
      expect(tests).toEqual([{ endpoint: phone }, { endpoint: phone }]);
      await page.screenshot({ path: testInfo.outputPath(`${role}-device-alert-confirmation.png`) });
      const removals = [];
      page.on("request", next => { if (next.url().endsWith("/api/push/subscribe") && next.method() === "DELETE") removals.push(next.postDataJSON()); });
      // The input is visually hidden; users click its visible switch label.
      await menu.getByRole("checkbox", { name: "Toggle push notifications", exact: true }).locator("..").click();
      await expect.poll(() => removals).toEqual([{ endpoint: phone }]);
      await expect.poll(() => db.prepare("SELECT endpoint FROM user_push_subscriptions WHERE user_id=? AND endpoint IN (?,?)").all(actor.user.id, phone, desktop).map(row => row.endpoint)).toEqual([desktop]);
      await expect(menu.getByRole("checkbox", { name: "Toggle push notifications", exact: true })).not.toBeChecked();
    } finally {
      db.prepare("DELETE FROM user_push_subscriptions WHERE user_id=? AND endpoint IN (?,?)").run(actor.user.id, phone, desktop);
      db.close();
    }
  });
}
