import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";

const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const credentials = { doctor: "arun.dharee", operator: "operator01" };
test.use({ actionTimeout: 15_000 });

const patientIds = [];
test.afterEach(() => {
  const db = openE2eDb();
  try {
    // The CI suites share a database. Keep this suite's samples out of later directories and review queues.
    const retirePatient = db.prepare("UPDATE patients SET deleted_at=CURRENT_TIMESTAMP, is_under_review=0 WHERE id=?");
    db.transaction(() => {
      for (const id of patientIds) retirePatient.run(id);
    })();
  } finally {
    patientIds.length = 0;
    db.close();
  }
});

async function session(page, request, role) {
  const response = await request.post(`${API}/auth/login`, { data: { username: credentials[role], password: "Welcome@123" } });
  expect(response.ok()).toBeTruthy();
  const auth = await response.json();
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), auth.token);
  return { auth, headers: { Authorization: `Bearer ${auth.token}` } };
}

async function createPatient(request, headers, extra = {}) {
  const response = await request.post(`${API}/patients`, { headers, data: {
    first_name: "Workspace", last_name: "Raman", gender: "F", patient_id_type: "old_age",
    date_of_birth: "1960-04-29", patient_contact_number: "57001122", address: "Moka",
    location: "Moka", location_tags: [{ category: "Village", name: "Moka" }],
    ...extra,
  } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const patient = await response.json();
  patientIds.push(patient.id);
  return patient;
}

async function noOverflow(page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
}

for (const role of ["doctor", "operator"]) {
  for (const width of [320, 390, 820, 1280, 1440]) {
    test(`${role} patient workspaces preserve role actions and readable details at ${width}px`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      const { headers } = await session(page, request, role);
      const doctorResponse = await request.post(`${API}/auth/login`, { data: { username: credentials.doctor, password: "Welcome@123" } });
      const doctor = await doctorResponse.json();
      const patient = await createPatient(request, headers, {
        assigned_doctor_id: doctor.user.doctor_id,
        drug_allergy_history: "Penicillin allergy recorded.", past_medical_history: "Hypertension.",
        next_of_kin_name: "David Raman", next_of_kin_contact_number: "57001123",
      });
      const db = openE2eDb();
      try {
        db.prepare("UPDATE patients SET is_under_review=1, review_assigned_doctor_id=?, review_due_date='2026-10-20', review_appointment_time='10:30', review_reason_note='Review progress after treatment.' WHERE id=?").run(doctor.user.doctor_id, patient.id);
        const appointment = db.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status) VALUES (?, ?, '2026-10-10', '10:30', 'completed')").run(patient.id, doctor.user.doctor_id);
        const consultation = db.prepare("INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes) VALUES (?, ?, ?, '2026-10-10', 'Progress noted.')").run(appointment.lastInsertRowid, patient.id, doctor.user.doctor_id);
        db.prepare("INSERT INTO billing (consultation_id, patient_id, items, total_amount, status) VALUES (?, ?, ?, 1600, 'unpaid')").run(consultation.lastInsertRowid, patient.id, JSON.stringify([{ description: "Home consultation", amount: 1600, quantity: 1, unit_price: 1600 }]));
      } finally { db.close(); }
      await page.goto(`${STAFF}/patients/${patient.id}`);
      const workspace = page.locator(".patient-profile");
      await expect(workspace.getByRole("heading", { name: patient.full_name, exact: true })).toBeVisible();
      await expect(workspace.getByText("Penicillin allergy recorded.")).toBeVisible();
      await expect(page.getByTestId("patient-review-summary")).toHaveCount(1);
      await expect(page.getByTestId("patient-review-summary")).toContainText("10:30 AM");
      await expect(page.getByTestId("patient-review-summary")).toContainText(doctor.user.full_name);
      await expect(workspace.getByText("No identifier required", { exact: true })).toBeVisible();
      const history = workspace.locator("details").filter({ has: page.locator("summary", { hasText: "Clinical history" }) });
      await expect(history).not.toHaveAttribute("open", "");
      await history.locator("summary").click();
      await expect(history.getByText("Hypertension.", { exact: true })).toBeVisible();
      await history.locator("summary").click();
      if (role === "doctor") {
        await expect(workspace.getByRole("button", { name: "Add consultation note", exact: true })).toHaveCount(1);
        await expect(workspace.getByRole("button", { name: "Billing", exact: true })).toHaveCount(width < 768 ? 0 : 1);
      } else {
        await expect(workspace.getByRole("link", { name: "New bill", exact: true })).toBeVisible();
        await expect(workspace.getByRole("button", { name: "Add consultation note", exact: true })).toHaveCount(0);
        await expect(workspace.getByRole("button", { name: "Reports", exact: true })).toHaveCount(0);
      }
      await noOverflow(page);
      await page.screenshot({ path: `/tmp/ocs-patient-profile-${role}-${width}.png`, fullPage: true });
      await workspace.getByRole("button", { name: "Notes", exact: true }).click();
      await expect(workspace.getByText("Progress noted.", { exact: true })).toBeVisible();
      await expect(workspace.getByRole("button", { name: /^Edit(?: note)?$/, exact: true })).toHaveCount(role === "doctor" ? 1 : 0);
      if (role === "operator") {
        await workspace.getByRole("button", { name: "Billing", exact: true }).click();
        await expect(workspace.getByRole("link", { name: "Open bill", exact: true })).toBeVisible();
        if (width < 768) {
          await expect(workspace.getByText("Pay by", { exact: true })).toHaveCount(0);
          await workspace.locator("summary", { hasText: "Bill items" }).click();
          await expect(workspace.getByText(/Home consultation:/)).toBeVisible();
        }
        await noOverflow(page);
      }
      await workspace.getByRole("button", { name: "Summary", exact: true }).click();
      await workspace.locator("summary", { hasText: "More actions" }).click();
      await workspace.getByRole("button", { name: "Edit profile", exact: true }).click();
      await expect(page.locator('input[name="first_name"]')).toHaveValue(patient.first_name);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.goto(`${STAFF}/patients`);
      await expect(page.getByRole("heading", { name: "Patients", exact: true })).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: `/tmp/ocs-patients-${role}-${width}.png`, fullPage: true });
      if (role === "doctor") {
        await page.locator(".patient-workspace-header").getByRole("link", { name: "My patients", exact: true }).click();
        await expect(page.getByText("Filter Active: My Patients", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Clear my patients filter" }).click();
      }
      await page.locator(".patient-workspace-header").getByRole("link", { name: "Add patient", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "ID type", exact: true })).toBeVisible();
      await noOverflow(page);
      if (width >= 768) expect((await page.getByRole("dialog").boundingBox()).width).toBeLessThanOrEqual(1000);
      await page.screenshot({ path: `/tmp/ocs-patient-intake-${role}-${width}.png`, fullPage: true });
    });
  }
}

for (const width of [390, 1280]) {
  test(`optional intake can save and recover a failed save without losing the draft at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await session(page, request, "operator");
    await page.goto(`${STAFF}/patients/add`);
    await page.locator('input[name="first_name"]').fill("Draft");
    await page.locator('input[name="last_name"]').fill("Recovery");
    await page.locator('input[name="patient_contact_number"]').fill("57001122");
    await page.locator('textarea[name="address"]').fill("Moka");
    await page.locator('select').filter({ has: page.locator('option[value="Medic World"]') }).selectOption("Medic World");
    await page.getByRole("button", { name: /^Next(?::.*)?$/ }).click();
    await expect(page.getByRole("combobox", { name: "ID type", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "ID type", exact: true }).selectOption("old_age");
    await page.getByRole("button", { name: /^Next(?::.*)?$/ }).click();
    await expect(page.getByRole("button", { name: "Skip for now — save patient", exact: true })).toBeVisible();
    await page.route("**/api/patients", async route => {
      if (route.request().method() === "POST") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary save failure" }) });
      else await route.continue();
    });
    await page.getByRole("button", { name: "Skip for now — save patient", exact: true }).click();
    await expect(page.getByText("Temporary save failure", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ocs_patient_draft")).first_name)).toBe("Draft");
    await page.unroute("**/api/patients");
    await page.reload();
    await expect(page.locator('input[name="first_name"]')).toHaveValue("Draft");
    await expect(page.getByRole("combobox", { name: "ID type", exact: true })).toHaveValue("old_age");
    await page.getByRole("button", { name: /^Next(?::.*)?$/ }).click();
    const saved = page.waitForResponse(response => response.url().endsWith("/api/patients") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Skip for now — save patient", exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    patientIds.push((await response.json()).id);
    await expect(page).toHaveURL(/\/patients\/\d+$/);
    expect(await page.evaluate(() => localStorage.getItem("ocs_patient_draft"))).toBeNull();
  });
}

for (const width of [390, 1440]) {
  test(`patient directory search, status, page and scroll survive a profile round trip at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const { headers } = await session(page, request, "operator");
    const unique = `Return${width}${Date.now()}`;
    for (let index = 0; index < 18; index++) await createPatient(request, headers, { first_name: unique, last_name: `Record${index}` });
    await page.goto(`${STAFF}/patients`);
    await page.getByRole("textbox", { name: "Search patients" }).fill(unique);
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await expect(page.getByText(/Page 1 of 2/)).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo({ top: 100, behavior: "instant" }));
    const scrollY = await page.evaluate(() => window.scrollY);
    if (width < 768) await page.locator('.patient-directory-list a[href^="/patients/"]').first().click();
    else await page.locator('.patient-directory-list tbody tr[tabindex="0"]').first().click();
    await expect(page.locator(".patient-profile")).toBeVisible();
    await page.getByRole("link", { name: "Back to patients", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Search patients" })).toHaveValue(unique);
    await expect(page.getByRole("button", { name: "Active", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);
    if (width < 768) await page.locator('.patient-directory-list a[href^="/patients/"]').first().click();
    else await page.locator('.patient-directory-list tbody tr[tabindex="0"]').first().click();
    await expect(page.locator(".patient-profile")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("textbox", { name: "Search patients" })).toHaveValue(unique);
    await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);
  });
}

test("newer directory searches stay visible when an older response arrives late", async ({ page, request }) => {
  const { headers } = await session(page, request, "operator");
  const slowPatient = await createPatient(request, headers, { first_name: "Slowsearch", last_name: "Result" });
  const fastPatient = await createPatient(request, headers, { first_name: "Fastsearch", last_name: "Result" });
  await page.goto(`${STAFF}/patients`);
  const input = page.getByRole("textbox", { name: "Search patients" });
  await expect(input).toBeVisible();
  let releaseOlder;
  const olderGate = new Promise(resolve => { releaseOlder = resolve; });
  await page.route("**/api/patients?**", async route => {
    if (new URL(route.request().url()).searchParams.get("search") === "Slowsearch") {
      const response = await route.fetch();
      await olderGate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  const olderRequested = page.waitForRequest(request => new URL(request.url()).searchParams.get("search") === "Slowsearch");
  await input.fill("Slowsearch");
  await olderRequested;
  await input.fill("Fastsearch");
  await expect(page.locator(".patient-directory-list").getByText(fastPatient.full_name, { exact: true })).toBeVisible();
  const olderArrived = page.waitForResponse(response => new URL(response.url()).searchParams.get("search") === "Slowsearch");
  releaseOlder();
  await olderArrived;
  await expect(page.locator(".patient-directory-list").getByText(fastPatient.full_name, { exact: true })).toBeVisible();
  await expect(page.locator(".patient-directory-list").getByText(slowPatient.full_name, { exact: true })).toHaveCount(0);
});
