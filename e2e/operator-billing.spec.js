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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function advanceOperatorInvoiceToReview(page, request, token) {
  const response = await request.get(`${API_BASE}/billing/consultation-options`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const visits = await response.json();
  expect(visits.length).toBeGreaterThan(0);
  const visit = visits[0];
  const dialog = page.getByRole("dialog");

  const doctorSelect = dialog.locator("select:visible").first();
  await expect(doctorSelect).toBeEnabled();
  await doctorSelect.selectOption(String(visit.doctor_id));

  await dialog.locator("button:visible").filter({ hasText: /Search.*patient/i }).click();
  await page
    .getByRole("button", { name: new RegExp(escapeRegExp(visit.patient_name), "i") })
    .click();

  const consultationSelect = dialog.locator("select:visible").nth(1);
  await expect(consultationSelect).toBeEnabled();
  await consultationSelect.selectOption(String(visit.id));
  await dialog.getByRole("button", { name: "Continue to charges", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Add service / non-stock charge", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Review bill", exact: true }).click();
}

test.describe("operator billing", () => {
  test("desktop exposes paper-invoice transcription without admin controls", async ({ page, request }) => {
    const operator = await loginOperator(request);
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/billing`);

    await expect(page).toHaveURL(/\/billing/);
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Billing", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Issue invoice", exact: true })).toBeVisible();
    await expect(page.getByText("Financial reconciliation", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Issue invoice", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Issue invoice" })).toBeVisible();
    await advanceOperatorInvoiceToReview(page, request, operator.token);
    await expect(page.getByText("Issued as unpaid", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Paper invoice reference")).toBeVisible();
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
    await advanceOperatorInvoiceToReview(page, request, operator.token);
    await expect(page.getByText("Issued as unpaid", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Paper invoice reference")).toBeVisible();
    await expect(page.getByText(/use Record payment to confirm/i)).toBeVisible();
  });
});
