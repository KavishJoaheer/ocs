import { test, expect } from "@playwright/test";

const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;

for (const width of [390, 1440]) {
  test(`new supply request opens during a focus-triggered catalogue refresh at ${width}px`, async ({ page, request }) => {
    const response = await request.post(`${API}/auth/login`, {
      data: { username: "arun.dharee", password: "Welcome@123" },
    });
    expect(response.ok()).toBeTruthy();
    const { token } = await response.json();
    await page.addInitScript(value => localStorage.setItem("ocs_medecins_auth_token", value), token);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${STAFF}/supply-requests`);
    const create = page.getByRole("button", { name: "New supply request", exact: true });
    await expect(create).toBeEnabled();

    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route("**/api/inventory?*", async route => {
      const result = await route.fetch();
      await held;
      await route.fulfill({ response: result });
    });
    try {
      // Returning focus can refresh stock between pointer-down and pointer-up.
      await create.evaluate(button => button.addEventListener("pointerdown", () => {
        window.dispatchEvent(new Event("focus"));
      }, { once: true }));
      const catalogue = page.waitForRequest(next => new URL(next.url()).pathname === "/api/inventory");
      const bounds = await create.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await catalogue;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      await page.mouse.up();
      const modal = page.getByRole("dialog", { name: "Request Supply from OCS", exact: true });
      await expect(modal).toBeVisible({ timeout: 2000 });
      await modal.getByLabel("Search OCS stock by name").fill("gauze");
      await expect(modal.getByLabel("Search OCS stock by name")).toHaveValue("gauze");
    } finally {
      release();
      await page.mouse.up();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}
