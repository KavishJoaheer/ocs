import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";

const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const requestIds = [];
const visitIds = [];
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });
test.afterEach(() => {
  const db = openE2eDb();
  try {
    for (const id of requestIds) db.prepare("DELETE FROM teleconsultation_requests WHERE id=?").run(id);
    for (const id of visitIds) db.prepare("DELETE FROM visit_requests WHERE id=?").run(id);
  }
  finally { requestIds.length = 0; visitIds.length = 0; db.close(); }
});

async function session(page, request) {
  const login = await request.post(`${API}/auth/login`, { data: { username: "operator01", password: "Welcome@123" } });
  expect(login.ok()).toBeTruthy();
  const actor = await login.json();
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), actor.token);
  return { actor, headers: { Authorization: `Bearer ${actor.token}` } };
}

test("desktop toolbar and policy lookup work at desktop and tablet widths", async ({ page, request }) => {
  await session(page, request);
  await page.route("**/api/teleconsultations", route => route.fulfill({ json: { requests: [] } }));
  for (const width of [1280, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${STAFF}/`);
    const workflow = page.getByRole("region", { name: "Operator workflows", exact: true });
    const notifications = page.getByRole("button", { name: "Notification settings: blocked", exact: true });
    await notifications.click();
    const notificationDialog = page.getByRole("dialog", { name: "Notification settings", exact: true });
    await expect(notificationDialog.getByRole("list")).toBeVisible();
    await notificationDialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(notificationDialog).toHaveCount(0);
    await expect(notifications).toBeFocused();
    await expect(workflow.getByRole("link")).toHaveCount(2);
    await workflow.getByRole("link", { name: "Add patient", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "ID type", exact: true })).toBeVisible();
    await page.goto(`${STAFF}/`);
    await workflow.getByRole("link", { name: /^Reviews/ }).click();
    await expect(page).toHaveURL(/\/operator\/long-term-review$/);
    await page.goto(`${STAFF}/`);
    const policy = page.getByRole("region", { name: "Verify policy", exact: true });
    await expect(policy).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/ocs-operator-desktop-redesign-${width}.png`, fullPage: true });
    let failLookup = true;
    await page.route("**/api/patients/insurance/policy-lookup?**", route => failLookup
      ? route.fulfill({ status: 503, json: { error: "Policy lookup unavailable" } })
      : route.fulfill({ json: { coverages: [{ coverage_status: "not_found", matched: false }] } }));
    await policy.getByRole("textbox", { name: "Policy number", exact: true }).fill("DESKTOP-TEST");
    await policy.getByRole("textbox", { name: "Mauritius ID number", exact: true }).fill("R0101901234567");
    await policy.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(policy.getByRole("alert")).toHaveText("Policy lookup unavailable");
    failLookup = false;
    const submitted = page.waitForRequest("**/api/patients/insurance/policy-lookup?**");
    await policy.getByRole("button", { name: "Verify", exact: true }).click();
    const url = new URL((await submitted).url());
    expect(url.searchParams.get("policy_number")).toBe("DESKTOP-TEST");
    expect(url.searchParams.get("national_id")).toBe("R0101901234567");
    await expect(policy.getByRole("status")).toContainText("No matching policy found");
    await expect(policy.getByRole("alert")).toHaveCount(0);
    await page.unroute("**/api/patients/insurance/policy-lookup?**");
  }
  await page.route("**/api/visit-requests?status=active", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto(`${STAFF}/`);
  const live = page.getByRole("region", { name: "Live requests", exact: true });
  await expect(live.getByRole("alert")).toContainText("Could not load home visits");
  await expect(live.getByLabel("0 active requests", { exact: true })).toHaveCount(0);
});

async function seedRequest(request, actor, headers, name, status = "pending", accepted = false) {
  const created = await request.post(`${API}/patients`, { headers, data: {
    first_name: "Dashboard", last_name: name, gender: "F", patient_id_type: "old_age",
    patient_contact_number: "52520142", address: "Moka", location: "Moka", location_tags: [{ category: "Village", name: "Moka" }],
  } });
  expect(created.ok()).toBeTruthy();
  const patient = await created.json();
  const db = openE2eDb();
  try {
    const userId = db.prepare("INSERT INTO patient_users (patient_id, full_name, phone) VALUES (?, ?, ?)").run(patient.id, patient.full_name, "52520142").lastInsertRowid;
    const doctorId = status === "assigned" ? db.prepare("SELECT doctor_id FROM users WHERE role='doctor' AND is_active=1 AND doctor_id IS NOT NULL LIMIT 1").get().doctor_id : null;
    const id = Number(db.prepare(`INSERT INTO teleconsultation_requests
      (patient_id, patient_user_id, reason, current_location, callback_number, status, consultation_code, consent_version, consent_snapshot, accepted_by, accepted_at, assigned_doctor_id)
      VALUES (?, ?, ?, 'Moka', '23052520142', ?, '123456', 'test-v1', '[]', ?, ?, ?)`)
      .run(patient.id, userId, `Review request for ${patient.full_name}`, status, accepted ? actor.user.id : null, accepted ? "2026-10-13 10:00:00" : null, doctorId).lastInsertRowid);
    requestIds.push(id);
    return { id, name: patient.full_name, patientId: patient.id };
  } finally { db.close(); }
}

for (const width of [1440, 390]) {
test(`operator dashboard accepts and follows teleconsultations at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 900 });
  const { actor, headers } = await session(page, request);
  const first = await seedRequest(request, actor, headers, "First Patient");
  const second = await seedRequest(request, actor, headers, "Second Patient");
  const accepted = await seedRequest(request, actor, headers, "Accepted Patient", "pending", true);
  const assigned = await seedRequest(request, actor, headers, "Assigned Patient", "assigned", true);
  const completed = await seedRequest(request, actor, headers, "Completed Patient", "completed", true);
  const db = openE2eDb();
  let visitId;
  let ongoingVisitId;
  try {
    visitId = Number(db.prepare("INSERT INTO visit_requests (patient_id, status, address, reason, urgency) VALUES (?, 'pending', 'Moka', 'Home visit needed', 'routine')").run(first.patientId).lastInsertRowid);
    visitIds.push(visitId);
    const doctorId = db.prepare("SELECT doctor_id FROM users WHERE role='doctor' AND is_active=1 AND doctor_id IS NOT NULL LIMIT 1").get().doctor_id;
    ongoingVisitId = Number(db.prepare("INSERT INTO visit_requests (patient_id, status, address, reason, urgency, assigned_doctor_id) VALUES (?, 'assigned', 'Quatre Bornes', 'Post-discharge review', 'routine', ?)").run(second.patientId, doctorId).lastInsertRowid);
    visitIds.push(ongoingVisitId);
  } finally { db.close(); }
  await page.goto(`${STAFF}/`);
  const visits = page.getByRole("region", { name: width < 768 ? "Home visit requests" : "Home visits", exact: true });
  await expect(visits.getByText(first.name, { exact: true })).toBeVisible();
  await expect(visits.getByText(second.name, { exact: true })).toBeVisible();
  const workspace = page.getByRole("region", { name: "Live requests", exact: true });
  await expect(workspace.getByLabel("6 active requests", { exact: true })).toHaveText("6");
  if (width >= 768) {
    await visits.getByRole("link", { name: `Assign home visit for ${first.name}`, exact: true }).click();
    await expect(page).toHaveURL(/\/visit-requests$/);
    await page.goto(`${STAFF}/`);
  }
  const cancelledVisit = await request.patch(`${API}/visit-requests/${visitId}`, { headers, data: { status: "cancelled" } });
  expect(cancelledVisit.ok()).toBeTruthy();
  await expect(visits.getByText(first.name, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(visits.getByText(second.name, { exact: true })).toBeVisible();
  await expect(workspace.getByLabel("5 active requests", { exact: true })).toHaveText("5");
  const queue = page.getByRole("region", { name: /^Teleconsultations/ });
  if (width < 768) await expect(page.getByRole("region", { name: "Live requests", exact: true }).getByRole("region", { name: /^Teleconsultations/ })).toBeVisible();
  await expect(queue.getByText(first.name, { exact: true })).toBeVisible();
  await expect(queue.getByText(second.name, { exact: true })).toBeVisible();
  await expect(queue.getByText(accepted.name, { exact: true })).toBeVisible();
  await expect(queue.getByText(assigned.name, { exact: true })).toBeVisible();
  await expect(queue.getByText(completed.name, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Teleconsultation request alerts" })).toHaveCount(0);
  const row = queue.getByRole("listitem").filter({ hasText: first.name });
  await page.route(`**/api/teleconsultations/${first.id}/accept`, route => route.fulfill({ status: 503, json: { error: "Acceptance temporarily unavailable" } }));
  await row.getByRole("button", { name: `Accept request for ${first.name}`, exact: true }).click();
  await expect(page.getByText("Acceptance temporarily unavailable", { exact: true })).toBeVisible();
  await expect(row.getByText("Awaiting acceptance", { exact: true })).toBeVisible();
  await page.unroute(`**/api/teleconsultations/${first.id}/accept`);
  await row.getByRole("button", { name: `Accept request for ${first.name}`, exact: true }).click();
  await expect(row.getByText("Awaiting doctor assignment", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: `Accept request for ${first.name}`, exact: true })).toHaveCount(0);
  await row.getByRole("link", { name: `Manage teleconsultation for ${first.name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/teleconsultations\\?request=${first.id}$`));
  const details = page.getByRole(width < 1024 ? "dialog" : "complementary", { name: "Request details", exact: true });
  await expect(details.getByRole("link", { name: first.name, exact: true })).toBeVisible();
  await expect(details.getByRole("group", { name: "Assign a doctor", exact: true })).toBeVisible();
  await page.goto(`${STAFF}/`);
  await expect(queue.getByText(first.name, { exact: true })).toBeVisible();
  const closed = await request.post(`${API}/teleconsultations/${first.id}/close`, { headers, data: { outcome: "cancelled", outcome_note: "Patient requested cancellation", follow_up: "Contact OCS if further care is required" } });
  expect(closed.ok()).toBeTruthy();
  await expect(queue.getByText(first.name, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(queue.getByText(second.name, { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/ocs-dashboard-teleconsultations-${width}.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  const mobileAlerts = page.getByRole("complementary", { name: "Teleconsultation request alerts" });
  await expect(mobileAlerts).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Live requests", exact: true }).getByRole("region", { name: /^Teleconsultations/ }).getByText(second.name, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto(`${STAFF}/patients`);
  await expect(mobileAlerts).toContainText(second.name);
  await expect(queue).toHaveCount(0);
});

test(`teleconsultation queue supports error recovery at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 900 });
  await session(page, request);
  await page.route("**/api/teleconsultations", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto(`${STAFF}/`);
  const queue = page.getByRole("region", { name: /^Teleconsultations/ });
  await expect(queue.getByRole("alert")).toContainText("Could not refresh teleconsultations");
  await expect(queue.getByText("No active teleconsultations", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/teleconsultations");
  await queue.getByRole("button", { name: "Retry teleconsultations", exact: true }).click();
  await expect(queue.getByRole("alert")).toHaveCount(0);
  await expect(queue.getByText("No active teleconsultations", { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/ocs-operator-minimal-panels-${width}.png`, fullPage: true });
  if (width >= 768) {
    await queue.getByRole("link", { name: "Manage teleconsultations", exact: true }).click();
    await expect(page).toHaveURL(/\/teleconsultations$/);
    await page.goto(`${STAFF}/`);
    await page.getByRole("link", { name: "View visits", exact: true }).click();
    await expect(page).toHaveURL(/\/visit-requests$/);
  }
});
}
