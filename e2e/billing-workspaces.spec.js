import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { openE2eDb } from "./e2eDb.cjs";

const STAFF_BASE = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API_BASE = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
let fixture;
test.use({ actionTimeout: 15_000 });

test.beforeEach(() => {
  const db = openE2eDb();
  try {
    const doctors = db.prepare(`SELECT d.id, u.username FROM doctors d JOIN users u ON u.doctor_id = d.id
      WHERE u.role = 'doctor' AND u.is_active = 1 AND u.deleted_at IS NULL AND d.is_active = 1 AND d.deleted_at IS NULL ORDER BY d.id LIMIT 2`).all();
    expect(doctors.length).toBe(2);
    const today = db.prepare("SELECT date('now', '+4 hours') AS value").get().value;
    const patientId = Number(db.prepare(`INSERT INTO patients
      (full_name, first_name, last_name, patient_identifier, age, contact_number, patient_contact_number, address, assigned_doctor_id)
      VALUES ('Billing Workspace Patient', 'Billing', 'Patient', ?, 42, '57000000', '57000000', 'Test address', ?)`)
      .run(`OCS-BILLING-${Date.now()}`, doctors[1].id).lastInsertRowid);
    const visits = doctors.map((doctor) => {
      const appointmentId = Number(db.prepare(`INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
        VALUES (?, ?, ?, '10:30', 'completed')`).run(patientId, doctor.id, today).lastInsertRowid);
      const consultationId = Number(db.prepare(`INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
        VALUES (?, ?, ?, ?, 'Billing workspace fixture')`).run(appointmentId, patientId, doctor.id, today).lastInsertRowid);
      db.prepare(`INSERT INTO billing (consultation_id, patient_id, doctor_id_snapshot, items, total_amount, status)
        VALUES (?, ?, ?, ?, 2000, 'unpaid')`).run(consultationId, patientId, doctor.id, JSON.stringify([
          { description: "Day Consultation", amount: 2000, type: "Sale", quantity: 1, inventory_item_id: null, is_consultation_fee: true },
        ]));
      return { consultationId, appointmentId, doctorId: doctor.id };
    });
    fixture = { patientId, doctors, visits };
  } finally { db.close(); }
});

test.afterEach(() => {
  const db = openE2eDb();
  try {
    if (fixture) db.prepare("UPDATE patients SET deleted_at = CURRENT_TIMESTAMP, is_under_review = 0 WHERE id = ?").run(fixture.patientId);
  } finally { db.close(); fixture = null; }
});

async function login(page, request, username) {
  const response = await request.post(`${API_BASE}/auth/login`, { data: { username, password: "Welcome@123" } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { token } = await response.json();
  await page.addInitScript((authToken) => window.localStorage.setItem("ocs_medecins_auth_token", authToken), token);
  return token;
}

async function assertDesktopFits(page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const summary = page.getByRole("complementary", { name: "Invoice summary" });
  await expect(summary).toBeVisible();
  const action = summary.getByRole("button");
  const box = await action.boundingBox();
  expect(box.y + box.height).toBeLessThan(page.viewportSize().height);
}

for (const role of ["doctor", "operator"]) {
  test(`${role} desktop billing keeps patient, charges and the running total visible`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await login(page, request, role === "doctor" ? fixture.doctors[0].username : "operator01");
    const visit = fixture.visits[0];
    await page.goto(`${STAFF_BASE}/billing?consultationId=${visit.consultationId}&doctorId=${visit.doctorId}`);
    await expect(page.getByRole("heading", { name: "Charges", exact: true })).toBeVisible();
    await expect(page.locator(".billing-visit-identity")).toContainText("Billing Workspace Patient");
    await expect(page.getByRole("navigation", { name: "Billing progress" }).locator('[aria-current="step"]')).toContainText("Charges");
    const summary = page.getByRole("complementary", { name: "Invoice summary" });
    await expect(summary.locator(".billing-summary-total")).toContainText("Rs 2,000");
    const service = page.locator(".billing-catalog-item").filter({ has: page.getByText("Abdominal tapping", { exact: true }) });
    await service.getByRole("button", { name: "Add", exact: true }).click();
    await expect(summary.locator(".billing-summary-total")).toContainText("Rs 4,500");
    await service.getByRole("button", { name: "Remove one Abdominal tapping", exact: true }).click();
    await expect(summary.locator(".billing-summary-total")).toContainText("Rs 2,000");
    // A long invoice must not push the total or next action below the screen.
    const extraItems = page.locator(".billing-catalog-item").filter({ has: page.getByRole("button", { name: "Add", exact: true }) });
    for (let index = 0; index < 8; index += 1) await extraItems.first().getByRole("button", { name: "Add", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertDesktopFits(page);
    const selectedRows = page.locator(".billing-catalog-item").filter({ has: page.getByRole("button", { name: /^Remove (one )?/ }) });
    for (let index = 0; index < 8; index += 1) await selectedRows.first().getByRole("button", { name: /^Remove (one )?/ }).click();
    await expect(summary.locator(".billing-summary-total")).toContainText("Rs 2,000");
    for (const width of [1440, 1280, 768]) {
      await page.setViewportSize({ width, height: 960 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await assertDesktopFits(page);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ animations: "disabled", path: `/tmp/ocs-billing-${role}-desktop-charges.png` });
    await summary.getByRole("button", { name: "Choose consumables", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Consumables used", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Billing progress" }).locator('[aria-current="step"]')).toContainText("Consumables");
    await summary.getByRole("button", { name: "Review invoice", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review invoice", exact: true })).toBeVisible();
    await assertDesktopFits(page);
    await page.getByRole("button", { name: "Adjust prices", exact: true }).click();
    await page.getByLabel("Consultation price", { exact: true }).fill("1800");
    await expect(page.getByLabel("Reason for consultation price adjustment")).toBeVisible();
    await expect(summary.locator(".billing-summary-total")).toContainText("Rs 1,800");
    await page.getByLabel("Consultation price", { exact: true }).fill("2000");
    if (role === "operator") {
      await expect(summary.getByRole("button", { name: "Issue unpaid invoice", exact: true })).toBeVisible();
      await page.getByRole("button", { name: /Payment received/i }).click();
      await page.getByLabel("Payment method").selectOption("juice");
      await expect(page.getByLabel("Payment transaction reference")).toBeVisible();
      await expect(summary.getByRole("button", { name: "Issue and record payment", exact: true })).toBeVisible();
    }
    await page.screenshot({ animations: "disabled", path: `/tmp/ocs-billing-${role}-desktop-review.png` });
  });
}

test("operator profile billing retains the patient and resolves the consultation's actual doctor", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await login(page, request, "operator01");
  await page.goto(`${STAFF_BASE}/patients/${fixture.patientId}`);
  await page.getByRole("link", { name: "New bill", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.locator(".billing-profile-context")).toContainText("Billing Workspace Patient");
  const patientButton = page.locator('[aria-haspopup="listbox"]');
  await expect(patientButton).toContainText("Billing Workspace Patient");
  await expect(page.getByLabel("Consultation doctor")).toHaveValue("");
  await page.getByLabel("2. Consultation").selectOption(String(fixture.visits[0].consultationId));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Charges", exact: true })).toBeVisible();
  await expect(page.locator(".billing-visit-identity")).toContainText(`V-${String(fixture.visits[0].consultationId).padStart(6, "0")}`);
  await page.getByRole("complementary", { name: "Invoice summary" }).getByRole("button", { name: "Choose consumables" }).click();
  await page.getByRole("complementary", { name: "Invoice summary" }).getByRole("button", { name: "Review invoice" }).click();
  const capture = page.waitForRequest((req) => req.url().includes(`/quick/visits/${fixture.visits[0].consultationId}/capture`));
  await page.getByRole("complementary", { name: "Invoice summary" }).getByRole("button", { name: "Issue unpaid invoice" }).click();
  expect((await capture).postDataJSON().doctor_id).toBe(fixture.visits[0].doctorId);
  await expect(page.getByRole("heading", { name: "Invoice issued", exact: true })).toBeVisible();
});

test("operator profile billing preselects a single eligible visit and can return to all patients", async ({ page, request }) => {
  const db = openE2eDb();
  try { db.prepare("UPDATE consultations SET voided_at = CURRENT_TIMESTAMP WHERE id = ?").run(fixture.visits[1].consultationId); }
  finally { db.close(); }
  await page.setViewportSize({ width: 1280, height: 960 });
  await login(page, request, "operator01");
  await page.goto(`${STAFF_BASE}/billing?patientId=${fixture.patientId}&create=1`);
  await expect(page.getByLabel("Consultation doctor")).toHaveValue(String(fixture.visits[0].doctorId));
  await expect(page.getByLabel("2. Consultation")).toHaveValue(String(fixture.visits[0].consultationId));
  await page.screenshot({ animations: "disabled", path: "/tmp/ocs-billing-operator-desktop-entry.png" });
  await page.getByRole("button", { name: "All patients", exact: true }).click();
  await expect(page.locator(".billing-profile-context")).toHaveCount(0);
  await expect(page.locator('[aria-haspopup="listbox"]')).toContainText("Select patient");
  await page.getByRole("button", { name: /Updates/i }).click();
  await expect(page.getByRole("heading", { name: "Billing updates", exact: true })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: "/tmp/ocs-billing-operator-desktop-updates.png" });
});

test("doctor billing updates show invoice totals and open requested clarifications", async ({ page, request }) => {
  const db = openE2eDb();
  const visit = fixture.visits[0];
  try {
    const bill = db.prepare("SELECT id FROM billing WHERE consultation_id = ?").get(visit.consultationId);
    db.prepare(`INSERT INTO billing_lite_submissions
      (consultation_id, doctor_id, billing_id, submitted_by_user_id, operation_id, item_count, items_json, amount_added, workflow_status, workflow_note)
      VALUES (?, ?, ?, ?, ?, 0, '[]', 0, 'needs_doctor', 'Please confirm the treatment supplies used')`)
      .run(visit.consultationId, visit.doctorId, bill.id,
        db.prepare("SELECT id FROM users WHERE doctor_id = ? AND role = 'doctor'").get(visit.doctorId).id, randomUUID());
  } finally { db.close(); }
  await page.setViewportSize({ width: 1440, height: 960 });
  await login(page, request, fixture.doctors[0].username);
  await page.goto(`${STAFF_BASE}/billing?view=status&submissionConsultationId=${visit.consultationId}`);
  await expect(page.getByRole("heading", { name: "Billing updates", exact: true })).toBeVisible();
  const row = page.locator(".billing-update-row").filter({ hasText: `V-${String(visit.consultationId).padStart(6, "0")}` });
  await expect(row).toContainText("Needs clarification");
  await expect(row.locator(".billing-update-amount")).toContainText("Rs 2,000");
  for (const width of [1440, 1280, 768]) {
    await page.setViewportSize({ width, height: 960 });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    const heading = await page.getByRole("heading", { name: "Billing updates", exact: true }).boundingBox();
    const header = await page.locator(".billing-backdrop").boundingBox();
    expect(heading.y + heading.height).toBeLessThanOrEqual(header.y + header.height);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ animations: "disabled", path: "/tmp/ocs-billing-doctor-desktop-updates.png" });
  await row.getByRole("button", { name: "Review clarification", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Charges", exact: true })).toBeVisible();
  await expect(page.getByText("Replace the earlier submission", { exact: true })).toBeVisible();
});
