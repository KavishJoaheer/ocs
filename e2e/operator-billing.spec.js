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
  // Several patients can share a name; the OCS number identifies this patient.
  expect(patient.patient_identifier).toBeTruthy();
  await page
    .getByRole("option")
    .filter({ has: page.getByText(patient.patient_identifier, { exact: true }) })
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
  test(`doctor billing is hidden on ${device.name}`, async ({ page, request }) => {
    const { session, patient } = await loginDoctorWithBillableVisit(request);
    await injectStaffSession(page, session.token);
    await page.setViewportSize({ width: device.width, height: device.height });
    await page.goto(`${STAFF_BASE}/billing`);

    await expect(page).toHaveURL(`${STAFF_BASE}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toHaveCount(0);
    const bottomNav = page.locator("#ocs-bottom-nav");
    await expect(bottomNav.getByRole("link")).toHaveCount(4);
    await expect(bottomNav.getByRole("link", { name: "Billing", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Billing", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto(`${STAFF_BASE}/patients/${patient.patient_id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Billing", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open billing workspace", exact: true })).toHaveCount(0);

    await page.goto(`${STAFF_BASE}/doctor/pending-payment`);
    await expect(page).toHaveURL(`${STAFF_BASE}/`);
  });
}

test("doctor billing remains available on desktop and closes when resized to mobile", async ({ page, request }) => {
  const { session, patient } = await loginDoctorWithBillableVisit(request);
  await injectStaffSession(page, session.token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${STAFF_BASE}/billing`);
  await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Billing", exact: true })).toBeVisible();

  await page.goto(`${STAFF_BASE}/patients/${patient.patient_id}`);
  await page.getByRole("button", { name: "Billing", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open billing workspace", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${STAFF_BASE}/billing`);
  await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
  await page.setViewportSize({ width: 767, height: 1024 });
  await expect(page).toHaveURL(`${STAFF_BASE}/`);
});

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
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "Open", exact: true }).first().click();
    await expect(page.getByRole("link", { name: "Attach manual invoice photo", exact: true })).toBeVisible();

    await page.goto(`${STAFF_BASE}/consultations/${visit.consultation_id}#manual-invoice-photos`);
    await expect(page.getByLabel("Manual invoice photo")).toBeVisible();
    await expect(page.getByRole("button", { name: "Attach photo", exact: true })).toBeVisible();
  });

  test("mobile billing keeps the operator navigation focused and protects the invoice form", async ({ page, request }) => {
    const operator = await loginOperator(request);
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STAFF_BASE}/billing`);

    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible({ timeout: 20_000 });
    const bottomNav = page.locator("#ocs-bottom-nav");
    await expect(bottomNav.getByRole("link")).toHaveCount(3);
    await expect(bottomNav.getByRole("link", { name: "Home", exact: true })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Add patient", exact: true })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Reviews", exact: true })).toBeVisible();
    for (const hiddenDestination of ["Patients", "Visits", "Billing", "Follow-up", "Inventory", "Stock history", "HCM news"]) {
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
