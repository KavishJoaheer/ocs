import { test, expect } from "@playwright/test";

const STAFF_BASE = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API_BASE = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;

async function loginOperator(request) {
  const response = await request.post(`${API_BASE}/auth/login`, {
    data: { username: "operator01", password: "Welcome@123" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function injectStaffSession(page, token) {
  await page.addInitScript((authToken) => {
    window.localStorage.setItem("ocs_medecins_auth_token", authToken);
  }, token);
}

test.describe("operator billing", () => {
  test("desktop exposes invoice issue controls without finance actions", async ({ page, request }) => {
    const operator = await loginOperator(request);
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/billing`);

    await expect(page).toHaveURL(/\/billing/);
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Billing", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Issue invoice", exact: true })).toBeVisible();
    await expect(page.getByText("Financial reconciliation", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Record payment/i })).toHaveCount(0);

    await page.getByRole("button", { name: "Issue invoice", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Issue invoice" })).toBeVisible();
    await expect(page.getByText("Issued as unpaid", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add manual item/i })).toHaveCount(0);
  });

  test("mobile has a tailored billing destination and protected invoice form", async ({ page, request }) => {
    const operator = await loginOperator(request);
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STAFF_BASE}/billing`);

    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible({ timeout: 20_000 });
    const bottomNav = page.locator("#ocs-bottom-nav");
    await expect(bottomNav.getByRole("link", { name: "Home", exact: true })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Visits", exact: true })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Billing", exact: true })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Inventory", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Issue invoice", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Issue invoice" })).toBeVisible();
    await expect(page.getByText("Issued as unpaid", { exact: true })).toBeVisible();
    await expect(page.getByText(/Payment recording and invoice corrections remain/i)).toBeVisible();
  });
});
