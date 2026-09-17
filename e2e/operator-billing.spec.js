import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";

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
  const doctorResponse = await request.get(`${API_BASE}/billing/quick/picker-options`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(doctorResponse.ok(), await doctorResponse.text()).toBeTruthy();
  const doctors = (await doctorResponse.json()).doctors || [];
  let doctor = null;
  let patient = null;
  let visit = null;
  for (const candidate of doctors) {
    const pickerResponse = await request.get(
      `${API_BASE}/billing/quick/picker-options?doctorId=${candidate.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(pickerResponse.ok(), await pickerResponse.text()).toBeTruthy();
    const patients = (await pickerResponse.json()).patients || [];
    if (patients[0]?.visits?.[0]) {
      doctor = candidate;
      patient = patients[0];
      visit = patients[0].visits[0];
      break;
    }
  }
  expect(doctor).toBeTruthy();
  prepareCurrentTariffForE2e(visit);

  await page.getByLabel("Consultation doctor").selectOption(String(doctor.id));
  await page.getByRole("button", { name: /Select patient/i }).click();
  await page
    .getByRole("option", { name: new RegExp(escapeRegExp(patient.patient_name), "i") })
    .click();

  const consultationSelect = page.getByLabel("2. Consultation");
  await expect(consultationSelect).toBeEnabled();
  await consultationSelect.selectOption(String(visit.consultation_id));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Charges" })).toBeVisible();
  await page.getByRole("button").filter({ hasText: /Review/ }).click();
  await expect(page.getByRole("heading", { name: "Review billing" })).toBeVisible();
  return { doctor, patient, visit };
}

function prepareCurrentTariffForE2e(visit) {
  const db = openE2eDb();
  try {
    db.prepare(`
      UPDATE billing
      SET items = ?, total_amount = 2000, fee_review_required = 0,
          legacy_fee_review_required = 0, change_reason = 'E2E current tariff fixture'
      WHERE id = ?
    `).run(JSON.stringify([{
      description: "Day Consultation",
      amount: 2000,
      type: "Sale",
      quantity: 1,
      inventory_item_id: null,
      is_consultation_fee: true,
    }]), visit.bill_id);
  } finally {
    db.close();
  }
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
    await expect(page.getByLabel("Consultation doctor")).toBeVisible();
    await expect(page.getByText("Financial reconciliation", { exact: true })).toHaveCount(0);
    await advanceOperatorInvoiceToReview(page, request, operator.token);
    await expect(page.getByLabel("Paper invoice or photo reference")).toBeVisible();
    await expect(page.getByRole("button", { name: "Issue invoice", exact: true })).toBeVisible();
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

    await advanceOperatorInvoiceToReview(page, request, operator.token);
    await expect(page.getByLabel("Paper invoice or photo reference")).toBeVisible();
    await expect(page.getByText(/ready for payment recording/i)).toBeVisible();
  });

  test("pending-payment workspace opens the audited payment transaction form", async ({ page, request }) => {
    const operator = await loginOperator(request);
    await injectStaffSession(page, operator.token);
    await page.goto(`${STAFF_BASE}/billing`);
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible({ timeout: 20_000 });
    const workspaceResponse = await request.get(`${API_BASE}/dashboard/operator-workspace`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    expect(workspaceResponse.ok(), await workspaceResponse.text()).toBeTruthy();
    const workspace = await workspaceResponse.json();
    if (!(workspace.pendingPayments || []).length) {
      await advanceOperatorInvoiceToReview(page, request, operator.token);
      await page.getByLabel("Paper invoice or photo reference").fill(`E2E-PAY-${Date.now()}`);
      await page.getByRole("button", { name: "Issue invoice", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Invoice issued" })).toBeVisible({ timeout: 20_000 });
    }

    await page.goto(`${STAFF_BASE}/operator/pending-payment`);
    await expect(page).toHaveURL(/\/billing$/);

    const recordPayment = page.getByRole("button", { name: "Record payment" }).first();
    await expect(recordPayment).toBeVisible({ timeout: 20_000 });
    await recordPayment.click();
    await expect(page.getByRole("heading", { name: /Record payment/i })).toBeVisible();
    await expect(page.getByLabel("Amount received")).toBeVisible();
    await expect(page.getByLabel("Payment method")).toBeVisible();
    await expect(page.getByText(/immutable ledger/i)).toBeVisible();
  });
});
