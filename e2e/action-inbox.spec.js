import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";

const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const patients = [];
test.afterEach(() => {
  const db = openE2eDb();
  for (const id of patients) { db.prepare("UPDATE patients SET deleted_at=CURRENT_TIMESTAMP,is_under_review=0 WHERE id=?").run(id); }
  patients.length = 0; db.close();
});
async function json(response) { expect(response.ok(), await response.text()).toBeTruthy(); return response.json(); }
async function fixture(request, assigned = false) {
  const login = username => request.post(`${API}/auth/login`, { data: { username, password: "Welcome@123" } }).then(json);
  const operator = await login("operator01"), doctor = await login("arun.dharee"), admin = await login("shravan.joaheer");
  const oh = { Authorization: `Bearer ${operator.token}` }, dh = { Authorization: `Bearer ${doctor.token}` };
  const patient = await json(await request.post(`${API}/patients`, { headers: oh, data: {
    first_name: "Action", last_name: `Inbox ${Date.now()}`, gender: "F", patient_id_type: "old_age", patient_contact_number: "57001122", address: "Moka", location: "Moka",
  } }));
  patients.push(patient.id);
  const db = openE2eDb();
  const stamp = new Date(Date.now() - 20 * 60000).toISOString();
  const visitId = Number(db.prepare(`INSERT INTO visit_requests
    (patient_id,address,reason,status,assigned_doctor_id,dispatch_owner_user_id,created_at,updated_at)
    VALUES (?,'Test address','Workflow regression',?,?,?,?,?)`)
    .run(patient.id, assigned ? "assigned" : "pending", assigned ? doctor.user.doctor_id : null, operator.user.id, stamp, stamp).lastInsertRowid);
  db.close();
  const tasks = await json(await request.get(`${API}/operational-tasks`, { headers: assigned ? dh : oh }));
  const task = tasks.tasks.find(row => row.source_type === "visit" && row.source_id === visitId);
  expect(task).toBeTruthy();
  return { operator, doctor, admin, oh, dh, patient, visitId, task };
}
async function open(page, actor, width, task) {
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), actor.token);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${STAFF}/action-inbox?task=${task.id}`);
  await expect(page.getByRole("heading", { name: "Action inbox", exact: true })).toBeVisible();
  await page.getByLabel("Search actions").fill(`#${task.id}`);
  const row = page.getByRole("article", { name: `Action ${task.id}`, exact: true });
  await expect(row).toBeVisible();
  return row;
}

for (const width of [390, 1440]) {
  test(`operator inbox preserves open work after acknowledgement at ${width}px`, async ({ page, request }) => {
    const f = await fixture(request); const row = await open(page, f.operator, width, f.task);
    await expect(row).toContainText("Overdue"); await expect(row).toContainText("Escalated to supervisor");
    await row.getByRole("button", { name: "Acknowledge", exact: true }).click();
    await expect(row).toContainText("Acknowledged; work remains open");
    const current = (await json(await request.get(`${API}/operational-tasks`, { headers: f.oh }))).tasks.find(t => t.id === f.task.id);
    expect(current.status).toBe("acknowledged"); expect(current.resolved_at).toBeNull();
    await expect(row.getByRole("link", { name: "Open workflow", exact: true })).toHaveAttribute("href", `/visit-requests?request=${f.visitId}`);
    await page.screenshot({ path: `/tmp/ocs-action-inbox-operator-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBeFalsy();
    await json(await request.patch(`${API}/visit-requests/${f.visitId}`, { headers: f.oh, data: { status: "cancelled" } }));
    await page.getByRole("button", { name: "Refresh actions", exact: true }).click(); await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "Resolved", exact: true }).click(); await expect(row).toBeVisible(); await expect(row).toContainText("Resolved");
  });
  test(`doctor can acknowledge and return an assignment to dispatch at ${width}px`, async ({ page, request }) => {
    const f = await fixture(request, true); const row = await open(page, f.doctor, width, f.task);
    await row.getByRole("button", { name: "Acknowledge", exact: true }).click(); await expect(row).toContainText("Acknowledged; work remains open");
    await row.getByRole("button", { name: "Decline assignment", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Return assignment to dispatch", exact: true });
    await expect(modal.getByRole("button", { name: "Return to dispatch", exact: true })).toBeDisabled();
    await modal.getByLabel("Action note").fill("Please reassign; I cannot take this visit.");
    await modal.getByRole("button", { name: "Return to dispatch", exact: true }).click(); await expect(modal).toBeHidden(); await expect(row).toHaveCount(0);
    const dispatch = (await json(await request.get(`${API}/operational-tasks`, { headers: f.oh }))).tasks.find(t => t.source_id === f.visitId && t.kind === "dispatch");
    expect(dispatch).toBeTruthy(); expect(dispatch.status).toBe("open");
    expect((await json(await request.get(`${API}/visit-requests?status=all`, { headers: f.oh }))).visit_requests.find(v => v.id === f.visitId).assigned_doctor_id).toBeNull();
  });
}

test("administrator can change response targets; stale claims and finance access stay blocked", async ({ page, request }) => {
  const f = await fixture(request); await open(page, f.admin, 1440, f.task);
  await page.getByText("Response targets and escalation supervisor", { exact: true }).click();
  await page.getByLabel("Routine dispatch (minutes)", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Save response targets", exact: true }).click();
  await expect(page.getByText("Response targets saved. New work will use these targets.", { exact: true })).toBeVisible();
  expect((await json(await request.get(`${API}/operational-tasks/policy`, { headers: f.oh }))).policy.dispatch_minutes).toBe(20);
  const response = await request.patch(`${API}/operational-tasks/${f.task.id}`, { headers: f.oh, data: { action: "acknowledge", revision: f.task.revision } });
  expect(response.ok()).toBeTruthy();
  expect((await request.patch(`${API}/operational-tasks/${f.task.id}`, { headers: f.oh, data: { action: "acknowledge", revision: f.task.revision } })).status()).toBe(409);
  const finance = await json(await request.post(`${API}/auth/login`, { data: { username: "accountant01", password: "Welcome@123" } }));
  expect((await request.get(`${API}/operational-tasks`, { headers: { Authorization: `Bearer ${finance.token}` } })).status()).toBe(403);
  await json(await request.put(`${API}/operational-tasks/policy`, { headers: { Authorization: `Bearer ${f.admin.token}` }, data: { dispatch_minutes: 15 } }));
});
