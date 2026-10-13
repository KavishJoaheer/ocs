import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const patientIds = [], visitIds = [], callIds = [];
const appointmentSnapshots = [];
test.use({ actionTimeout: 15_000 });
test.afterEach(() => {
  const db = openE2eDb();
  try {
    for (const appointment of appointmentSnapshots) db.prepare("UPDATE appointments SET appointment_date=? WHERE id=?").run(appointment.appointment_date, appointment.id);
    appointmentSnapshots.length = 0;
    for (const id of visitIds) db.prepare("DELETE FROM visit_requests WHERE id=?").run(id);
    for (const id of callIds) db.prepare("DELETE FROM teleconsultation_requests WHERE id=?").run(id);
    for (const id of patientIds) db.prepare("UPDATE patients SET deleted_at=CURRENT_TIMESTAMP, is_under_review=0 WHERE id=?").run(id);
  } finally { db.close(); patientIds.length = 0; visitIds.length = 0; callIds.length = 0; }
});
async function prepare(page, request) {
  const login = await request.post(`${API}/auth/login`, { data: { username: "arun.dharee", password: "Welcome@123" } });
  expect(login.ok()).toBeTruthy();
  const actor = await login.json();
  const headers = { Authorization: `Bearer ${actor.token}` };
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), actor.token);
  const patients = [];
  for (const [first, last] of [["Anjali", "Devi"], ["Ravi", "Pillay"], ["Sarah", "Noel"], ["Other", "Doctor Patient"]]) {
    const response = await request.post(`${API}/patients`, { headers, data: {
      first_name: first, last_name: last, gender: "F", patient_id_type: "old_age", patient_contact_number: "57001122", address: "Moka", location: "Moka", location_tags: [{ category: "Village", name: "Moka" }],
    } });
    expect(response.ok(), await response.text()).toBeTruthy();
    const patient = await response.json(); patients.push(patient); patientIds.push(patient.id);
  }
  const db = openE2eDb();
  let visitId, callId;
  try {
    // Keep seeded appointments from becoming the next visit when this test runs before 09:30.
    appointmentSnapshots.push(...db.prepare("SELECT id, appointment_date FROM appointments WHERE doctor_id=? AND status='scheduled'").all(actor.user.doctor_id));
    db.prepare("UPDATE appointments SET appointment_date=date('now','+4 hours','+7 days') WHERE doctor_id=? AND status='scheduled'").run(actor.user.doctor_id);
    const assignedSlot = db.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status) VALUES (?, ?, date('now','+4 hours'), '23:59', 'scheduled')").run(patients[0].id, actor.user.doctor_id).lastInsertRowid;
    db.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status) VALUES (?, ?, date('now','+4 hours','+1 day'), '16:00', 'scheduled')").run(patients[2].id, actor.user.doctor_id);
    db.prepare("UPDATE patients SET is_under_review=1, review_assigned_doctor_id=?, review_due_date='2040-12-31' WHERE id=?").run(actor.user.doctor_id, patients[2].id);
    visitId = Number(db.prepare("INSERT INTO visit_requests (patient_id, assigned_doctor_id, status, address, reason, urgency, appointment_id) VALUES (?, ?, 'assigned', 'Moka', 'Fever and persistent cough', 'urgent', ?)").run(patients[0].id, actor.user.doctor_id, assignedSlot).lastInsertRowid); visitIds.push(visitId);
    visitIds.push(Number(db.prepare("INSERT INTO visit_requests (patient_id, assigned_doctor_id, status, address, reason, urgency) VALUES (?, ?, 'cancelled', 'Moka', 'Closed visit', 'routine')").run(patients[0].id, actor.user.doctor_id).lastInsertRowid));
    const patientUser = db.prepare("INSERT INTO patient_users (patient_id, full_name, phone) VALUES (?, ?, ?)").run(patients[1].id, patients[1].full_name, "57001123").lastInsertRowid;
    callId = Number(db.prepare("INSERT INTO teleconsultation_requests (patient_id, patient_user_id, reason, current_location, callback_number, status, consultation_code, consent_version, consent_snapshot, assigned_doctor_id, accepted_at) VALUES (?, ?, 'Medication review', 'Moka', '23057001123', 'assigned', '123456', 'test-v1', '[]', ?, CURRENT_TIMESTAMP)").run(patients[1].id, patientUser, actor.user.doctor_id).lastInsertRowid); callIds.push(callId);
    const otherDoctor = db.prepare("SELECT id FROM doctors WHERE id != ? AND deleted_at IS NULL LIMIT 1").get(actor.user.doctor_id).id;
    const otherUser = db.prepare("INSERT INTO patient_users (patient_id, full_name, phone) VALUES (?, ?, ?)").run(patients[3].id, patients[3].full_name, "57001124").lastInsertRowid;
    callIds.push(Number(db.prepare("INSERT INTO teleconsultation_requests (patient_id, patient_user_id, reason, current_location, callback_number, status, consultation_code, consent_version, consent_snapshot, assigned_doctor_id) VALUES (?, ?, 'Other doctor call', 'Moka', '23057001124', 'assigned', '654321', 'test-v1', '[]', ?)").run(patients[3].id, otherUser, otherDoctor).lastInsertRowid));
  } finally { db.close(); }
  return { actor, headers, visitId, callId, patients };
}

for (const width of [360, 430, 1440]) {
  test(`doctor dashboard prioritises assigned care and supports the clinical flow at ${width}px`, async ({ page, request }) => {
    const { headers, visitId, callId } = await prepare(page, request);
    await page.setViewportSize({ width, height: 932 });
    await page.goto(`${STAFF}/`);
    const doctor = page.getByRole("region", { name: "Doctor dashboard", exact: true });
    const care = doctor.getByRole("region", { name: "Assigned care", exact: true });
    const visit = care.getByRole("listitem", { name: "Home visit for Anjali Devi", exact: true });
    await expect(visit).toBeVisible();
    await expect(care.getByLabel("2 active assignments", { exact: true })).toHaveText("2");
    await expect(care.getByRole("listitem", { name: "Teleconsultation for Ravi Pillay", exact: true })).toBeVisible();
    await expect(doctor.getByText("Other Doctor Patient", { exact: true })).toHaveCount(0);
    await expect(doctor.getByRole("button", { name: /Accept/ })).toHaveCount(0);
    await expect(doctor.getByText("Closed visit", { exact: true })).toHaveCount(0);
    await expect(doctor.getByRole("region", { name: "Next scheduled visit", exact: true }).getByText("Sarah Noel", { exact: true })).toBeVisible();
    const followUps = doctor.getByRole("link", { name: /^Review appointments/ });
    await expect(followUps).toContainText("1");
    await expect(doctor.getByText("Reviews due", { exact: true })).toHaveCount(0);
    await expect(visit.getByRole("link", { name: "Call Anjali Devi", exact: true })).toHaveAttribute("href", "tel:57001122");
    await expect(visit.getByRole("link", { name: "Directions", exact: true })).toHaveAttribute("href", /google.com\/maps\/search/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/ocs-doctor-dashboard-${width}.png`, fullPage: true });
    if (width < 768) {
      const bottom = page.locator("#ocs-bottom-nav");
      await expect(bottom.getByRole("link")).toHaveText(["Home", "Patients", "Home visits", "Inventory"]);
      await doctor.getByRole("combobox", { name: "Availability", exact: true }).selectOption("offline");
      await expect(doctor.getByRole("combobox", { name: "Availability", exact: true })).toHaveValue("offline");
      await doctor.getByRole("combobox", { name: "Availability", exact: true }).selectOption("available");
      await expect(doctor.getByRole("combobox", { name: "Availability", exact: true })).toHaveValue("available");
      await bottom.getByRole("link", { name: "Home visits", exact: true }).click();
      await expect(page).toHaveURL(/\/visit-requests$/);
      await bottom.getByRole("link", { name: "Home", exact: true }).click();
    } else {
      await doctor.getByRole("button", { name: "Offline", exact: true }).click();
      await expect(doctor.getByRole("button", { name: "Offline", exact: true })).toBeDisabled();
      await doctor.getByRole("button", { name: "Available", exact: true }).click();
      await expect(doctor.getByRole("button", { name: "Available", exact: true })).toBeDisabled();
    }
    await page.reload();
    if (width < 768) await expect(doctor.getByRole("combobox", { name: "Availability", exact: true })).toHaveValue("available");
    else await expect(doctor.getByRole("button", { name: "Available", exact: true })).toBeDisabled();
    await followUps.click();
    await expect(page).toHaveURL(/\/doctor\/long-term-review$/);
    await expect(page.getByRole("heading", { name: "Your review appointments", exact: true })).toBeVisible();
    await expect(page.getByText("Sarah Noel", { exact: true })).toBeVisible();
    await page.goto(`${STAFF}/`);
    await care.getByRole("link", { name: "Open call for Ravi Pillay", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/teleconsultations\\?request=${callId}$`));
    const call = page.locator("section").filter({ has: page.getByRole("link", { name: "Ravi Pillay", exact: true }) });
    await expect(call.getByRole("button", { name: "Hide details", exact: true })).toBeVisible();
    await expect(call.getByText(/code/i).first()).toBeVisible();
    await page.goto(`${STAFF}/`);
    await page.route(`**/api/visit-requests/${visitId}`, route => route.fulfill({ status: 503, json: { error: "Visit update unavailable" } }), { times: 1 });
    await visit.getByRole("button", { name: "I'm on my way", exact: true }).click();
    await expect(page.getByText("Visit update unavailable", { exact: true })).toBeVisible();
    await expect(visit.getByRole("button", { name: "I'm on my way", exact: true })).toBeEnabled();
    for (const label of ["I'm on my way", "I've arrived", "Start consultation", "Complete visit"]) {
      await visit.getByRole("button", { name: label, exact: true }).click();
    }
    await expect(page).toHaveURL(/\/consultations\/\d+/);
    const completed = await request.get(`${API}/visit-requests?status=completed`, { headers });
    expect((await completed.json()).visit_requests.some(row => row.id === visitId)).toBeTruthy();
    await page.goto(`${STAFF}/`);
    await expect(visit).toHaveCount(0);
    await expect(care.getByLabel("1 active assignments", { exact: true })).toHaveText("1");
    const closed = await request.post(`${API}/teleconsultations/${callId}/close`, { headers, data: { outcome: "referred", outcome_note: "Patient requires in-person assessment", follow_up: "OCS dispatch will arrange a home visit" } });
    expect(closed.ok()).toBeTruthy();
    await expect(care.getByText("Ravi Pillay", { exact: true })).toHaveCount(0, { timeout: 20_000 });
  });
}

test("doctor dashboard distinguishes unavailable data and respects blocked insurance", async ({ page, request }) => {
  await prepare(page, request);
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.route("**/api/teleconsultations", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.route("**/api/inventory?**", route => route.fulfill({ status: 503, json: { error: "Stock unavailable" } }));
  await page.route("**/api/visit-requests?status=active", async route => {
    const response = await route.fetch(); const data = await response.json();
    data.visit_requests.forEach(visit => { visit.insurance_coverage = { is_linkham: true, allowed: false }; });
    await route.fulfill({ json: data });
  });
  await page.goto(`${STAFF}/`);
  const care = page.getByRole("region", { name: "Assigned care", exact: true });
  await expect(care.getByRole("region", { name: "Assigned teleconsultations", exact: true }).getByRole("alert")).toContainText("Could not refresh teleconsultations");
  await expect(care.getByText("No assigned teleconsultations", { exact: true })).toHaveCount(0);
  await expect(care.getByRole("button", { name: "I'm on my way", exact: true })).toBeDisabled();
  await expect(care.getByText(/Contact dispatch to confirm insurance/)).toBeVisible();
  await expect(page.getByText("Status unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Bag ready", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/teleconsultations");
  await care.getByRole("button", { name: "Retry assigned care", exact: true }).click();
  await expect(care.getByText("Ravi Pillay", { exact: true })).toBeVisible();
  await page.unroute("**/api/inventory?**");
  await page.getByRole("button", { name: "Retry bag stock", exact: true }).click();
  await expect(page.getByText("Status unavailable", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(820);
  await page.screenshot({ path: "/tmp/ocs-doctor-dashboard-820.png", fullPage: true });
});

test("compact doctor update notice keeps reload confirmation for unsaved work", async ({ page, request }) => {
  await prepare(page, request);
  await page.setViewportSize({ width: 430, height: 932 });
  await page.route("**/api/health", route => route.fulfill({ json: { git_sha: "doctor-dashboard-new-version" } }));
  await page.goto(`${STAFF}/`);
  await page.getByRole("button", { name: "App update available", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "App update available", exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.__OCS_UNSAVED_WORK__.set("doctor-dashboard-test", true));
  await dialog.getByRole("button", { name: "Reload requires confirmation", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Confirm reload", exact: true })).toBeVisible();
  await expect(dialog).toContainText("Confirm reload to discard unsaved work");
  await dialog.getByRole("button", { name: "Later", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => window.__OCS_UNSAVED_WORK__.set("doctor-dashboard-test", false));
  await expect(page.getByRole("button", { name: "App update available", exact: true })).toHaveCount(0);
});
