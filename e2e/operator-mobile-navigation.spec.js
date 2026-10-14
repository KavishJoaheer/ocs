import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";

const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const visitIds = [];
const callIds = [];
test.use({ actionTimeout: 15_000 });

test.afterEach(() => {
  const db = openE2eDb();
  try {
    for (const id of visitIds) db.prepare("DELETE FROM visit_requests WHERE id = ?").run(id);
    for (const id of callIds) db.prepare("DELETE FROM teleconsultation_requests WHERE id = ?").run(id);
  }
  finally { visitIds.length = 0; callIds.length = 0; db.close(); }
});

async function operatorSession(page, request) {
  const login = await request.post(`${API}/auth/login`, { data: { username: "operator01", password: "Welcome@123" } });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), session.token);
  return { Authorization: `Bearer ${session.token}` };
}

for (const width of [360, 430]) {
  test(`operator Home shows live requests and mobile navigation works at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const headers = await operatorSession(page, request);
    const patientName = "Asha Rao";
    const created = await request.post(`${API}/patients`, { headers, data: {
      first_name: "Asha", last_name: "Rao", gender: "F", patient_id_type: "old_age",
      patient_contact_number: "57001122", address: "Moka", location: "Moka",
      location_tags: [{ category: "Village", name: "Moka" }],
    } });
    expect(created.ok()).toBeTruthy();
    const patient = await created.json();
    const callPatientResponse = await request.post(`${API}/patients`, { headers, data: {
      first_name: "David", last_name: "Pillay", gender: "M", patient_id_type: "old_age",
      patient_contact_number: "57001123", address: "Moka", location: "Moka",
      location_tags: [{ category: "Village", name: "Moka" }],
    } });
    expect(callPatientResponse.ok()).toBeTruthy();
    const callPatient = await callPatientResponse.json();
    const db = openE2eDb();
    let visitId;
    try {
      const insert = db.prepare("INSERT INTO visit_requests (patient_id, status, address, reason, urgency) VALUES (?, ?, ?, ?, ?)");
      visitId = Number(insert.run(patient.id, "pending", "Moka", "Fever and body aches", "urgent").lastInsertRowid);
      visitIds.push(visitId);
      visitIds.push(Number(insert.run(patient.id, "completed", "Moka", "Completed request should stay off Home", "routine").lastInsertRowid));
      const patientUserId = db.prepare("INSERT INTO patient_users (patient_id, full_name, phone) VALUES (?, ?, ?)").run(callPatient.id, callPatient.full_name, "57001123").lastInsertRowid;
      callIds.push(Number(db.prepare(`INSERT INTO teleconsultation_requests
        (patient_id, patient_user_id, reason, current_location, callback_number, status, consultation_code, consent_version, consent_snapshot)
        VALUES (?, ?, 'Follow-up consultation', 'Moka', '23057001123', 'pending', '123456', 'test-v1', '[]')`).run(callPatient.id, patientUserId).lastInsertRowid));
    } finally { db.close(); }
    await page.goto(`${STAFF}/patients`);
    const bottom = page.locator("#ocs-bottom-nav");
    await expect(bottom.getByRole("link")).toHaveText(["Home", "Add patient", "Reviews"]);
    for (const label of ["Patients", "Visits", "Billing"]) await expect(bottom.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    await bottom.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(`${STAFF}/`);
    await expect(bottom.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
    const live = page.getByRole("region", { name: "Live requests", exact: true });
    await expect(live.getByText(patientName, { exact: true })).toBeVisible();
    await expect(live.getByText("Request received", { exact: true })).toBeVisible();
    await expect(live.getByText("David Pillay", { exact: true })).toBeVisible();
    await expect(live.getByLabel("2 active requests", { exact: true })).toHaveText("2");
    await expect(live.getByText("Completed request should stay off Home")).toHaveCount(0);
    await page.getByRole("link", { name: "Manage teleconsultations", exact: true }).click();
    await expect(page).toHaveURL(/\/teleconsultations$/);
    await expect(page.getByRole("heading", { name: "Teleconsultations", exact: true })).toBeVisible();
    await bottom.getByRole("link", { name: "Home", exact: true }).click();
    await expect(live).toBeVisible();
    await live.getByRole("link", { name: "View requests", exact: true }).click();
    await expect(page).toHaveURL(/\/visit-requests$/);
    await bottom.getByRole("link", { name: "Home", exact: true }).click();
    await expect(live.getByText("Request received", { exact: true })).toBeVisible();
    const updated = await request.patch(`${API}/visit-requests/${visitId}`, { headers, data: { status: "acknowledged" } });
    expect(updated.ok()).toBeTruthy();
    await expect(live.getByText("Care team reviewing", { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/ocs-operator-home-${width}.png`, fullPage: true });
    await expect(page.getByRole("textbox", { name: "Policy number", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Verify policy", exact: true }).click();
    const policyDialog = page.getByRole("dialog", { name: "Verify policy", exact: true });
    await expect(policyDialog.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
    await policyDialog.getByRole("textbox", { name: "Policy number", exact: true }).fill("TEST-POLICY");
    await policyDialog.getByRole("textbox", { name: "Mauritius ID number", exact: true }).fill("R0101901234567");
    await page.route("**/api/patients/insurance/policy-lookup?**", route => route.fulfill({ json: { coverages: [{ matched: true, coverage_status: "green", policy_number: "TEST-POLICY", national_id: "R0101901234567", holder_name: patientName }] } }));
    const lookupRequest = page.waitForRequest("**/api/patients/insurance/policy-lookup?**");
    await policyDialog.getByRole("button", { name: "Verify", exact: true }).click();
    const lookupUrl = new URL((await lookupRequest).url());
    expect(lookupUrl.searchParams.get("policy_number")).toBe("TEST-POLICY");
    expect(lookupUrl.searchParams.get("national_id")).toBe("R0101901234567");
    await expect(policyDialog.getByRole("status")).toContainText("Eligible for OCS services");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/ocs-operator-policy-${width}.png`, fullPage: true });
    await policyDialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(policyDialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Verify policy", exact: true })).toBeFocused();
    await page.getByRole("link", { name: "Find patient", exact: true }).click();
    await expect(page).toHaveURL(/\/patients$/);
    await bottom.getByRole("link", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: /^Open profile menu/ }).click();
    const profileMenu = page.getByRole("dialog", { name: "Navigation menu", exact: true });
    await expect(profileMenu).toBeVisible();
    await profileMenu.getByRole("button", { name: "Close menu", exact: true }).click();
    await bottom.getByRole("link", { name: "Add patient", exact: true }).click();
    await expect(page).toHaveURL(/\/patients\/add$/);
    await expect(page.getByRole("combobox", { name: "ID type", exact: true })).toBeVisible();
    const firstName = page.locator('input[name="first_name"]');
    await expect(firstName).toBeFocused();
    await firstName.blur();
    await bottom.getByRole("link", { name: "Reviews", exact: true }).click();
    await expect(page).toHaveURL(/\/operator\/long-term-review$/);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Navigation menu", exact: true });
    await expect(menu.getByRole("link", { name: "Teleconsultations", exact: true })).toBeVisible();
    await page.screenshot({ path: `/tmp/ocs-operator-menu-${width}.png`, fullPage: true });
    await menu.getByRole("link", { name: "Teleconsultations", exact: true }).click();
    await expect(page).toHaveURL(/\/teleconsultations$/);
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Teleconsultations", exact: true })).toBeVisible();
    await bottom.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(`${STAFF}/`);
    await expect(live).toBeVisible();
  });
}

test("operator Home has a live-request empty state", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await operatorSession(page, request);
  await page.route("**/api/visit-requests?status=active", route => route.fulfill({ json: { visit_requests: [], active_count: 0 } }));
  await page.goto(`${STAFF}/`);
  const live = page.getByRole("region", { name: "Live requests", exact: true });
  await expect(live.getByText("No active home visits", { exact: true })).toBeVisible();
  await expect(live.getByRole("link", { name: "View requests", exact: true })).toBeVisible();
});
