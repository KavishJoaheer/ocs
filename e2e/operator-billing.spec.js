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

async function loginDoctorWithBillableVisit(request) {
  const db = openE2eDb();
  let doctors;
  try {
    doctors = db.prepare(`
      SELECT username
      FROM users
      WHERE role = 'doctor'
        AND is_active = 1
        AND deleted_at IS NULL
      ORDER BY id
    `).all();
  } finally {
    db.close();
  }

  for (const doctor of doctors) {
    const loginResponse = await request.post(`${API_BASE}/auth/login`, {
      data: { username: doctor.username, password: "Welcome@123" },
    });
    if (!loginResponse.ok()) continue;
    const session = await loginResponse.json();
    const pickerResponse = await request.get(`${API_BASE}/billing/quick/picker-options`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!pickerResponse.ok()) continue;
    const patients = (await pickerResponse.json()).patients || [];
    const patient = patients.find((candidate) => candidate.visits?.[0]);
    if (patient) return { session, patient, visit: patient.visits[0] };
  }

  throw new Error("No doctor with a billable visit was available for the mobile billing test.");
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

  const doctorPickerResponse = page.waitForResponse((response) =>
    response.url().includes("/billing/quick/picker-options") &&
    response.url().includes(`doctorId=${doctor.id}`) &&
    response.request().method() === "GET",
  );
  await page.getByLabel("Consultation doctor").selectOption(String(doctor.id));
  await doctorPickerResponse;
  const findAnotherVisit = page.getByRole("button", { name: "Find another visit", exact: true });
  if ((page.viewportSize()?.width || 0) < 768 && await findAnotherVisit.isVisible()) {
    await findAnotherVisit.click();
  }
  const patientPickerButton = page.getByRole("button", { name: /Select patient/i });
  await expect(patientPickerButton).toBeVisible();
  await patientPickerButton.click();
  await page
    .getByRole("option", { name: new RegExp(escapeRegExp(patient.patient_name), "i") })
    .click();

  const consultationSelect = page.getByLabel("2. Consultation");
  await expect(consultationSelect).toBeEnabled();
  await consultationSelect.selectOption(String(visit.consultation_id));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Charges" })).toBeVisible();
  await page.getByRole("button", { name: /Choose consumables/i }).click();
  await expect(page.getByRole("heading", { name: "Consumables used" })).toBeVisible();
  await page.getByRole("button", { name: /Review invoice/i }).click();
  await expect(page.getByRole("heading", { name: "Review invoice" })).toBeVisible();
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

for (const device of [
  { name: "Samsung-sized Android", width: 360, height: 800 },
  { name: "large iPhone", width: 430, height: 932 },
]) {
  test(`doctor billing stays reachable on ${device.name}`, async ({ page, request }) => {
    const { session, patient, visit } = await loginDoctorWithBillableVisit(request);
    prepareCurrentTariffForE2e(visit);
    await injectStaffSession(page, session.token);
    await page.setViewportSize({ width: device.width, height: device.height });
    await page.goto(`${STAFF_BASE}/billing`);

    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible({ timeout: 20_000 });
    const findAnotherVisit = page.getByRole("button", { name: "Find another visit", exact: true });
    if (await findAnotherVisit.isVisible()) await findAnotherVisit.click();
    await page.getByRole("button", { name: /Select patient/i }).click();

    const picker = page.locator(".billing-patient-picker-panel");
    await expect(picker).toBeVisible();
    await expect(picker).toHaveCSS("position", "fixed");
    const pickerBox = await picker.boundingBox();
    expect(pickerBox?.x).toBeGreaterThanOrEqual(0);
    expect((pickerBox?.x || 0) + (pickerBox?.width || 0)).toBeLessThanOrEqual(device.width);
    await page
      .getByRole("option", { name: new RegExp(escapeRegExp(patient.patient_name), "i") })
      .click();
    await page.getByLabel("2. Consultation").selectOption(String(visit.consultation_id));
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Charges" })).toBeVisible();

    const chooseConsumablesBar = page.locator(".billing-integrated-review-bar").filter({ hasText: "Choose consumables" });
    await expect(chooseConsumablesBar).toBeVisible();
    const chooseConsumablesBox = await chooseConsumablesBar.boundingBox();
    await expect(page.locator("#ocs-bottom-nav")).toBeHidden();
    expect((chooseConsumablesBox?.y || 0) + (chooseConsumablesBox?.height || 0)).toBeLessThanOrEqual(device.height);

    await chooseConsumablesBar.click();
    await expect(page.getByRole("heading", { name: "Consumables used" })).toBeVisible();
    const reviewBar = page.locator(".billing-integrated-review-bar").filter({ hasText: "Review invoice" });
    await expect(reviewBar).toBeVisible();
    const reviewBox = await reviewBar.boundingBox();
    expect((reviewBox?.y || 0) + (reviewBox?.height || 0)).toBeLessThanOrEqual(device.height);

    await reviewBar.click();
    await expect(page.getByRole("heading", { name: "Review invoice" })).toBeVisible();
    await expect(page.getByLabel("Consultation price")).toHaveCount(0);
    await page.getByRole("button", { name: "Adjust prices", exact: true }).click();
    await expect(page.getByLabel("Consultation price")).toHaveCount(1);
    const issueBar = page.getByRole("button", { name: /Issue invoice for Rs/i });
    await expect(issueBar).toBeVisible();
    const issueBox = await issueBar.boundingBox();
    expect((issueBox?.y || 0) + (issueBox?.height || 0)).toBeLessThanOrEqual(device.height);
  });
}

test.describe("operator billing", () => {
  test("desktop lets an operator choose unpaid follow-up or payment received", async ({ page, request }) => {
    const operator = await loginOperator(request);
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/billing`);

    await expect(page).toHaveURL(/\/billing/);
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Billing", exact: true })).toBeVisible();
    await expect(page.getByLabel("Consultation doctor")).toBeVisible();
    await expect(page.getByText("Financial reconciliation", { exact: true })).toHaveCount(0);
    const { patient, visit } = await advanceOperatorInvoiceToReview(page, request, operator.token);
    await expect(page.getByLabel("Receipt reference")).toBeVisible();
    await expect(page.getByRole("button", { name: /Issue as unpaid/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Payment received/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Issue unpaid invoice", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Payment received/i }).click();
    await expect(page.getByLabel("Payment method")).toBeVisible();
    await expect(page.getByLabel("Payment date")).toBeVisible();
    await expect(page.getByText(/operator account is recorded in the audit history/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Issue and record payment", exact: true })).toBeVisible();

    await page.goto(`${STAFF_BASE}/patients/${patient.patient_id}`);
    await page.getByRole("button", { name: "Open", exact: true }).first().click();
    await expect(page.getByRole("link", { name: "Attach manual invoice photo", exact: true })).toBeVisible();

    await page.goto(`${STAFF_BASE}/consultations/${visit.consultation_id}#manual-invoice-photos`);
    await expect(page.getByLabel("Manual invoice photo")).toBeVisible();
    await expect(page.getByRole("button", { name: "Attach photo", exact: true })).toBeVisible();
  });

  test("mobile keeps billing reachable while protecting the invoice form", async ({ page, request }) => {
    const operator = await loginOperator(request);
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STAFF_BASE}/billing`);

    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible({ timeout: 20_000 });
    const bottomNav = page.locator("#ocs-bottom-nav");
    await expect(bottomNav.getByRole("link")).toHaveCount(5);
    await expect(bottomNav.getByRole("link", { name: "Patients", exact: true })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Add patient", exact: true })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Visits", exact: true })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Billing", exact: true })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Reviews", exact: true })).toBeVisible();
    for (const hiddenDestination of ["Home", "Follow-up", "Inventory", "Stock history", "HCM news"]) {
      await expect(bottomNav.getByRole("link", { name: hiddenDestination, exact: true })).toHaveCount(0);
    }

    await advanceOperatorInvoiceToReview(page, request, operator.token);
    await expect(page.getByLabel("Receipt reference")).toBeVisible();
    await expect(page.getByText(/This invoice will appear in Payment follow-up/i)).toBeVisible();
    await page.getByRole("button", { name: /Payment received/i }).click();
    await expect(page.getByLabel("Payment method")).toBeVisible();
    await expect(page.getByText(/Payment is recorded when the invoice is issued/i)).toBeVisible();
  });

  test("operator issues the invoice and records the payment", async ({ page, request }) => {
    const operator = await loginOperator(request);
    await injectStaffSession(page, operator.token);
    await page.goto(`${STAFF_BASE}/billing`);
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible({ timeout: 20_000 });
    await advanceOperatorInvoiceToReview(page, request, operator.token);
    await page.getByLabel("Receipt reference").fill(`E2E-PAY-${Date.now()}`);
    await page.getByRole("button", { name: /Payment received/i }).click();
    await page.getByLabel("Payment method").selectOption("cash");
    await page.getByRole("button", { name: "Issue and record payment", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Invoice issued" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  });
});
