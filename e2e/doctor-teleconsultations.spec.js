import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const patientIds = [], requestIds = [];
test.afterEach(() => {
  const db = openE2eDb();
  try {
    for (const id of requestIds) db.prepare("DELETE FROM teleconsultation_requests WHERE id=?").run(id);
    for (const id of patientIds) db.prepare("UPDATE patients SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  } finally { db.close(); patientIds.length = 0; requestIds.length = 0; }
});
async function prepare(page, request) {
  const login = await request.post(`${API}/auth/login`, { data: { username: "arun.dharee", password: "Welcome@123" } });
  const actor = await login.json(); const headers = { Authorization: `Bearer ${actor.token}` };
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), actor.token);
  async function create(first, last, status, other = false) {
    const created = await request.post(`${API}/patients`, { headers, data: { first_name: first, last_name: last, gender: "F", patient_id_type: "old_age", patient_contact_number: "57001122", address: "Moka", location: "Moka", location_tags: [{ category: "Village", name: "Moka" }] } });
    expect(created.ok(), await created.text()).toBeTruthy(); const patient = await created.json(); patientIds.push(patient.id);
    const db = openE2eDb();
    try {
      const patientUser = db.prepare("INSERT INTO patient_users (patient_id,full_name,phone) VALUES (?,?,?)").run(patient.id, patient.full_name, "57001122").lastInsertRowid;
      const doctorId = other ? db.prepare("SELECT id FROM doctors WHERE id != ? AND deleted_at IS NULL LIMIT 1").get(actor.user.doctor_id).id : actor.user.doctor_id;
      const id = Number(db.prepare("INSERT INTO teleconsultation_requests (patient_id,patient_user_id,reason,current_location,callback_number,status,consultation_code,consent_version,consent_snapshot,assigned_doctor_id,accepted_at) VALUES (?,?, 'Fever and persistent cough since yesterday', '12 Avenue des Flamboyants, Quatre Bornes, Mauritius','23057001122',?,'123456','test-v1','[]',?,CURRENT_TIMESTAMP)").run(patient.id, patientUser, status, doctorId).lastInsertRowid);
      requestIds.push(id); return { id, name: patient.full_name };
    } finally { db.close(); }
  }
  const ready = await create("Amelia", "Marie Ramgoolam", "assigned");
  const ongoing = await create("Priya", "Bissoon", "in_consultation");
  await create("Other", "Doctor Patient", "assigned", true);
  await create("Previous", "Patient", "referred");
  return { actor, ready, ongoing };
}
for (const width of [360, 430, 820, 1440, 1920]) {
  test(`doctor teleconsultations keep a focused queue and verification workflow at ${width}px`, async ({ page, request }) => {
    const { ready, ongoing } = await prepare(page, request);
    await page.setViewportSize({ width, height: 932 });
    await page.goto(`${STAFF}/teleconsultations`);
    await expect(page.getByRole("heading", { name: "Teleconsultations", level: 1, exact: true })).toBeVisible();
    await expect(page.getByText("Dispatch desk", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Other Doctor Patient", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ready to call", exact: true })).toHaveAttribute("aria-pressed", "true");
    const queue = page.getByRole("region", { name: "Patient queue", exact: true });
    await expect(queue.getByRole("button")).toHaveCount(1);
    await page.screenshot({ path: `/tmp/ocs-doctor-tele-queue-${width}.png`, fullPage: true });
    if (width < 1024) await queue.getByRole("button", { name: `Open consultation for ${ready.name}` }).click();
    const card = page.getByRole("region", { name: `Consultation for ${ready.name}`, exact: true });
    await expect(card.getByLabel("Patient’s consultation code")).toBeVisible();
    await expect(card.getByText("123456", { exact: true })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Verify code & begin consultation" })).toBeDisabled();
    await card.getByLabel("Patient’s consultation code").fill("000000");
    await card.getByLabel("Identity, current location, callback, privacy, consent and clinical suitability confirmed.").check();
    await card.getByRole("button", { name: "Verify code & begin consultation" }).click();
    await expect(card.getByRole("alert")).toBeVisible();
    await card.getByLabel("Patient’s consultation code").fill("123456");
    await card.getByRole("button", { name: "Verify code & begin consultation" }).click();
    await expect(card.getByRole("heading", { name: "Consultation record", exact: true })).toBeVisible();
    const note = card.getByLabel("Consultation note (not visible to patient)", { exact: true });
    await note.fill("Unfinished private clinical draft");
    await expect(card.getByRole("status")).toContainText("not saved to patient record");
    expect(await page.evaluate(() => window.__OCS_UNSAVED_WORK__.has())).toBe(true);
    if (width < 1024) {
      await page.getByRole("button", { name: "Back to queue", exact: true }).click();
      await expect(queue.getByRole("button", { name: `Open consultation for ${ready.name}` })).toBeFocused();
    }
    await queue.getByRole("button", { name: `Open consultation for ${ongoing.name}` }).click();
    const other = page.getByRole("region", { name: `Consultation for ${ongoing.name}`, exact: true });
    await expect(other.getByLabel("Consultation note (not visible to patient)", { exact: true })).toHaveValue("");
    if (width < 1024) await page.getByRole("button", { name: "Back to queue", exact: true }).click();
    await queue.getByRole("button", { name: `Open consultation for ${ready.name}` }).click();
    await expect(note).toHaveValue("Unfinished private clinical draft");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/ocs-doctor-tele-workspace-${width}.png`, fullPage: true });
    await card.locator("summary").filter({ hasText: "Refer for in-person assessment" }).click();
    await card.getByLabel("Patient-facing reason").fill("An in-person assessment is needed");
    await card.getByLabel("Next step for patient").fill("Call OCS today to arrange a home visit");
    await page.route("**/api/teleconsultations/*/close", route => route.fulfill({ status: 503, json: { error: "Referral unavailable. Please retry." } }), { times: 1 });
    await card.getByRole("button", { name: "Refer for in-person assessment", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("Referral unavailable");
    await expect(note).toHaveValue("Unfinished private clinical draft");
    await card.getByRole("button", { name: "Refer for in-person assessment", exact: true }).click();
    await expect(card.getByRole("link", { name: "Open saved consultation", exact: true })).toHaveCount(0);
    await expect(card.getByText("Call OCS today to arrange a home visit", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "History", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.__OCS_UNSAVED_WORK__.has())).toBe(false);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("ocs-clinical-draft:")).length)).toBe(0);
  });
}

test("doctor drafts stay private, expire, and are removed on confirmed sign-out", async ({ page, request }) => {
  const { actor, ongoing } = await prepare(page, request);
  await page.setViewportSize({ width: 1440, height: 932 });
  await page.addInitScript(({ user, id }) => {
    sessionStorage.setItem(`ocs-clinical-draft:other-user:${user.doctor_id}:${id}`, JSON.stringify({ values: { note: "Another user's private note" }, at: Date.now() }));
    sessionStorage.setItem(`ocs-clinical-draft:${user.id}:${user.doctor_id}:${id}`, JSON.stringify({ values: { note: "Expired private note" }, at: Date.now() - 13 * 60 * 60 * 1000 }));
  }, { user: actor.user, id: ongoing.id });
  await page.goto(`${STAFF}/teleconsultations?request=${ongoing.id}`);
  const card = page.getByRole("region", { name: `Consultation for ${ongoing.name}`, exact: true });
  const note = card.getByLabel("Consultation note (not visible to patient)", { exact: true });
  await expect(note).toHaveValue("");
  await note.fill("Private note pending completion");
  const menu = page.getByRole("button", { name: /Open account menu/ });
  await menu.click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(note).toHaveValue("Private note pending completion");
  await menu.click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("ocs-clinical-draft:")).length)).toBe(0);
});

test("an external closure keeps the doctor's unfinished private draft recoverable", async ({ page, request }) => {
  const { ongoing } = await prepare(page, request);
  await page.goto(`${STAFF}/teleconsultations?request=${ongoing.id}`);
  const card = page.getByRole("region", { name: `Consultation for ${ongoing.name}`, exact: true });
  await card.getByLabel("Consultation note (not visible to patient)", { exact: true }).fill("Unfinished clinical reasoning");
  const db = openE2eDb();
  db.prepare("UPDATE teleconsultation_requests SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(ongoing.id);
  db.close();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: `Open consultation for ${ongoing.name}` }).click();
  await expect(card.getByRole("alert")).toContainText("closed elsewhere");
  await card.getByText("View unfinished draft", { exact: true }).click();
  await expect(card.getByLabel("Private clinical note", { exact: true })).toHaveValue("Unfinished clinical reasoning");
  await expect(card.getByLabel("Private clinical note", { exact: true })).toHaveJSProperty("readOnly", true);
  page.once("dialog", dialog => dialog.accept());
  await card.getByRole("button", { name: "Discard unfinished draft", exact: true }).click();
  await expect(card.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => window.__OCS_UNSAVED_WORK__.has())).toBe(false);
});

for (const width of [360, 1440]) {
  test(`an unavailable consultation link never opens another patient at ${width}px`, async ({ page, request }) => {
    const { ready } = await prepare(page, request);
    await page.setViewportSize({ width, height: 932 });
    await page.goto(`${STAFF}/teleconsultations?request=999999999`);
    await expect(page.getByRole("alert")).toContainText("no longer available in your queue");
    await expect(page.getByLabel("Patient’s consultation code")).toBeHidden();
    await page.getByRole("button", { name: `Open consultation for ${ready.name}` }).click();
    await expect(page.getByRole("region", { name: `Consultation for ${ready.name}`, exact: true }).getByLabel("Patient’s consultation code")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}
