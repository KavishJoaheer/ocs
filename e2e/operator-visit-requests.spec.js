import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const ids = [], patients = [];
test.use({ actionTimeout: 15_000 });
test.afterEach(() => {
  const db = openE2eDb();
  try {
    for (const id of ids) db.prepare("DELETE FROM visit_requests WHERE id=?").run(id);
    for (const id of patients) db.prepare("UPDATE patients SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  } finally { db.close(); ids.length = 0; patients.length = 0; }
});
async function prepare(page, request) {
  const login = await request.post(`${API}/auth/login`, { data: { username: "operator01", password: "Welcome@123" } });
  expect(login.ok()).toBeTruthy();
  const actor = await login.json();
  const headers = { Authorization: `Bearer ${actor.token}` };
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), actor.token);
  const rows = [
    ["Amelia", "Marie Ramgoolam", "pending", "urgent", "Fever and persistent cough since yesterday", "Quatre Bornes", 18],
    ["Ravi", "Pillay", "pending", "routine", "Back pain after lifting a heavy box", "Moka", 7],
    ["Sarah", "Noel", "pending", "urgent", "Abdominal pain and vomiting", "Curepipe", 32],
    ["Anjali", "Devi", "acknowledged", "routine", "Dizziness and headache", "Rose Hill", 24],
    ["Jean", "Dupont", "assigned", "routine", "Follow-up after recent treatment", "Port Louis", 42],
    ["Priya", "Bissoon", "en_route", "routine", "Fever and sore throat", "Phoenix", 55],
    ["David", "Wong", "arrived", "routine", "Wound dressing and review", "Vacoas", 62],
    ["Marie", "Joseph", "in_consultation", "routine", "Blood pressure review", "Beau Bassin", 75],
    ["Previous", "Patient", "cancelled", "routine", "Previous cancelled visit", "Moka", 90],
  ];
  const db = openE2eDb();
  const doctor = db.prepare("SELECT id,full_name FROM doctors WHERE deleted_at IS NULL AND is_active=1 ORDER BY full_name LIMIT 1").get();
  const visits = {};
  try {
    for (const [first, last, status, urgency, reason, location, age] of rows) {
      const response = await request.post(`${API}/patients`, { headers, data: { first_name: first, last_name: last, gender: "F", patient_id_type: "old_age", patient_contact_number: "57001122", address: location, location, location_tags: [{ category: "Village", name: location }] } });
      expect(response.ok(), await response.text()).toBeTruthy();
      const patient = await response.json(); patients.push(patient.id);
      const id = Number(db.prepare("INSERT INTO visit_requests (patient_id,assigned_doctor_id,status,address,reason,urgency,created_at,eta_minutes) VALUES (?,?,?,?,?,?,datetime('now',?),?)").run(patient.id,["pending","acknowledged"].includes(status)?null:doctor.id,status,`12 Avenue des Flamboyants, ${location}, Mauritius`,reason,urgency,`-${age} minutes`,["pending","acknowledged"].includes(status)?null:20).lastInsertRowid);
      ids.push(id); visits[first] = id;
    }
  } finally { db.close(); }
  return { headers, doctor, visits };
}
function list(page, name = "Requests needing attention") { return page.getByRole("list", { name, exact: true }); }
function details(page, width) { return page.getByRole(width < 1024 ? "dialog" : "complementary", { name: "Request details", exact: true }); }
async function open(page, name) { await page.getByRole("button", { name: `Open request for ${name}`, exact: true }).click(); }

for (const width of [360, 430, 820, 1440]) {
  test(`operator dispatch list and full visit workflow at ${width}px`, async ({ page, request }) => {
    const { headers, doctor, visits } = await prepare(page, request);
    await page.setViewportSize({ width, height: 932 });
    await page.goto(`${STAFF}/visit-requests`);
    await expect(page.getByRole("heading", { name: "Home Visit Request", exact: true })).toBeVisible();
    const queue = list(page);
    await expect(queue.getByRole("listitem")).toHaveCount(4);
    await expect(queue.getByRole("listitem").first()).toContainText("Sarah Noel");
    await expect(page.getByLabel("From", { exact: true })).toBeHidden();
    await expect(page.locator('[draggable="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const box of await queue.getByRole("button").evaluateAll(nodes => nodes.map(node => { const b=node.getBoundingClientRect(); return {left:b.left,right:b.right}; }))) {
      expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: `/tmp/ocs-operator-visit-requests-${width}.png`, fullPage: true });
    await page.screenshot({ path: `/tmp/ocs-operator-visit-requests-viewport-${width}.png` });
    await open(page, "Amelia Marie Ramgoolam");
    const panel = details(page, width);
    await expect(panel.getByRole("link", { name: "Call Amelia Marie Ramgoolam", exact: true })).toHaveAttribute("href", "tel:57001122");
    await expect(panel.getByRole("link", { name: "Directions", exact: true })).toHaveAttribute("href", /google.com\/maps\/search/);
    await panel.getByText("ETA & team notes", { exact: true }).click();
    await panel.getByLabel("Team notes", { exact: true }).fill("Patient called. Entrance beside the pharmacy.");
    await panel.getByLabel("ETA in minutes", { exact: true }).fill("25");
    // A realtime refresh must keep the open sheet/panel and unsaved coordination draft.
    const refreshed = page.waitForResponse(response => response.url().includes("/api/visit-requests?status=active"));
    await page.evaluate(() => window.dispatchEvent(new Event("patients-live-updated")));
    await refreshed;
    await expect(panel.getByLabel("Team notes", { exact: true })).toHaveValue("Patient called. Entrance beside the pharmacy.");
    if (width < 1024) {
      await panel.getByRole("button", { name: "Close dialog", exact: true }).click();
    } else {
      await open(page, "Ravi Pillay");
    }
    await expect(page.getByRole("dialog", { name: "Discard visit changes?", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue editing", exact: true }).click();
    await expect(panel.getByLabel("Team notes", { exact: true })).toHaveValue("Patient called. Entrance beside the pharmacy.");
    await panel.getByLabel("Assign doctor", { exact: true }).selectOption(String(doctor.id));
    let patchCalls = 0;
    await page.route(`**/api/visit-requests/${visits.Amelia}`, async route => {
      patchCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 200));
      await route.fulfill({ status: 503, json: { error: "Assignment unavailable. Please retry." } });
    }, { times: 1 });
    await panel.getByRole("button", { name: "Assign doctor", exact: true }).click();
    await expect(panel.getByText("Assignment unavailable. Please retry.", { exact: true })).toBeVisible();
    expect(patchCalls).toBe(1);
    await expect(panel.getByLabel("Team notes", { exact: true })).toHaveValue("Patient called. Entrance beside the pharmacy.");
    await expect(queue.getByRole("button", { name: "Open request for Amelia Marie Ramgoolam", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Assign doctor", exact: true }).click();
    await expect(queue.getByRole("button", { name: "Open request for Amelia Marie Ramgoolam", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^In progress/ }).click();
    await open(page, "Amelia Marie Ramgoolam");
    await expect(panel.getByRole("heading", { name: "Amelia Marie Ramgoolam", exact: true })).toBeVisible();
    await panel.getByText("ETA & team notes", { exact: true }).click();
    await expect(panel.getByLabel("Team notes", { exact: true })).toHaveValue("Patient called. Entrance beside the pharmacy.");
    await expect(panel.getByLabel("ETA in minutes", { exact: true })).toHaveValue("25");
    for (const name of ["Mark en route", "Mark arrived", "Start consultation", "Complete visit"]) {
      await panel.getByRole("button", { name, exact: true }).click();
      if (name !== "Complete visit") await expect(panel.getByRole("button", { name: name === "Mark en route" ? "Mark arrived" : name === "Mark arrived" ? "Start consultation" : "Complete visit", exact: true })).toBeEnabled();
    }
    await expect(list(page, "Visits in progress").getByRole("button", { name: "Open request for Amelia Marie Ramgoolam", exact: true })).toHaveCount(0);
    const completed = await request.get(`${API}/visit-requests?status=completed`, { headers });
    const saved = (await completed.json()).visit_requests.find(row => row.id === visits.Amelia);
    expect(saved.appointment_id).toBeTruthy();
    expect(saved.eta_minutes).toBe(25);
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(list(page,"Visit history").getByText("Amelia Marie Ramgoolam", { exact: true })).toBeVisible();
    await open(page,"Amelia Marie Ramgoolam");
    await expect(panel.getByText("Visit closed · Only an admin can edit this visit.", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
    if (width < 1024) await panel.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.getByLabel("History status", { exact: true }).selectOption("cancelled");
    await expect(list(page,"Visit history").getByText("Previous Patient", { exact: true })).toBeVisible();
    await expect(list(page,"Visit history").getByText("Amelia Marie Ramgoolam", { exact: true })).toHaveCount(0);
    // Moving off a success toast resumes its dismissal timer. At tablet width
    // the transient notice can cover Filters and otherwise pause while hovered.
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-rht-toaster] [role="status"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("From", { exact: true }).fill("2040-01-02");
    await page.getByLabel("To", { exact: true }).fill("2040-01-01");
    await page.getByRole("button", { name: "Apply dates", exact: true }).click();
    await expect(page.getByText("The start date must be on or before the end date.", { exact: true })).toBeVisible();
    await page.getByLabel("To", { exact: true }).fill("2040-01-03");
    await page.getByRole("button", { name: "Apply dates", exact: true }).click();
    await expect(page.getByText("No visits match these dates", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear dates", exact: true }).click();
    await expect(list(page,"Visit history").getByText("Previous Patient", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Changes/ }).click();
    await expect(page.getByRole("heading", { name: /Appointment change/i })).toBeVisible();
  });
}

test("operator dispatch keeps insurance blocks, dirty drafts and stale-data errors clear", async ({ page, request }) => {
  await prepare(page, request);
  await page.setViewportSize({ width: 1440, height: 932 });
  const block = async route => {
    const response = await route.fetch(); const body = await response.json();
    body.visit_requests = body.visit_requests.map(row => row.patient_name === "Sarah Noel" ? { ...row, insurance_coverage: { is_linkham: true, allowed: false, coverage_status: "red" } } : row);
    await route.fulfill({ response, json: body });
  };
  await page.route("**/api/visit-requests?status=active", block);
  await page.route("**/api/doctors", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto(`${STAFF}/visit-requests`);
  const panel = details(page,1440);
  await expect(panel.getByRole("button", { name: "Assign doctor", exact: true })).toBeDisabled();
  await expect(panel.getByText(/Insurance coverage must be confirmed/)).toBeVisible();
  await expect(panel.getByText("Could not load doctors.", { exact: false })).toBeVisible();
  await page.unroute("**/api/doctors");
  await panel.getByRole("button", { name: "Retry doctors", exact: true }).click();
  await expect(panel.getByLabel("Assign doctor", { exact: true }).locator("option")).not.toHaveCount(1);
  await panel.getByText("ETA & team notes", { exact: true }).click();
  await panel.getByLabel("Team notes", { exact: true }).fill("Unsaved coverage coordination note");
  await open(page,"Ravi Pillay");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await open(page,"Sarah Noel");
  await panel.getByText("ETA & team notes", { exact: true }).click();
  await expect(panel.getByLabel("Team notes", { exact: true })).toHaveValue("");
  await page.unroute("**/api/visit-requests?status=active", block);
  await page.route("**/api/visit-requests?status=active", route => route.fulfill({ status: 503, json: { error: "Live requests unavailable" } }));
  await page.getByRole("button", { name: "Refresh visit requests", exact: true }).click();
  await expect(page.getByText("Connection issue", { exact: true })).toBeVisible();
  await expect(page.getByText(/Showing the last loaded requests/)).toBeVisible();
  await expect(list(page).getByRole("listitem")).toHaveCount(4);
  await expect(panel.getByLabel("Team notes", { exact: true })).toHaveValue("");
  await page.unroute("**/api/visit-requests?status=active");
  await page.getByRole("button", { name: "Retry requests", exact: true }).click();
  await expect(page.getByText("Connection issue", { exact: true })).toHaveCount(0);
});
