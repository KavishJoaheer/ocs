import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const INSURANCE = `http://127.0.0.1:${process.env.E2E_INSURANCE_PORT || "4175"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
test.use({ actionTimeout: 15000 });
async function login(page, request, username, base, width) {
  await page.setViewportSize({ width, height: 900 });
  const response = await request.post(`${API}/auth/login`, { data: { username, password: "Welcome@123" } });
  expect(response.ok()).toBeTruthy();
  const { token } = await response.json();
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), token);
  await page.goto(base);
}
async function insideScreen(locator, width) {
  for (const rect of await locator.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; }).filter(rect => rect.width > 0))) {
    expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(width + 1);
  }
}
for (const width of [360, 390, 1440]) {
  test(`admin navigation, account search and appointments remain usable at ${width}px`, async ({ page, request }, testInfo) => {
    await login(page, request, "shravan.joaheer", STAFF, width);
    await expect(page.getByRole("heading", { name: /Shravan/ }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Live requests", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`admin-dashboard-${width}.png`), fullPage: true });
    const approvals = page.waitForResponse(response => response.url().includes("pendingApproval=1") && response.url().includes("limit=15"));
    await page.getByRole("link", { name: /^Patient approvals/ }).click();
    await approvals;
    await expect(page).toHaveURL(/patients\?tab=pending_approval/);
    await page.goto(STAFF);
    await page.getByRole("link", { name: /^Unpaid bills/ }).click();
    await expect(page).toHaveURL(/\/admin\/finance\?section=receivables&status=unpaid/);
    await expect(page.getByRole("combobox", { name: "Report", exact: true })).toHaveValue("receivables");
    await page.goto(`${STAFF}/appointments`);
    const heading = page.getByRole("heading", { name: "Appointments", exact: true });
    await expect(heading).toBeVisible();
    const box = await heading.boundingBox(); expect(box.height).toBeLessThan(65);
    await expect(page.getByRole("button", { name: "Agenda", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.goto(`${STAFF}/team-operations`);
    await expect(page.getByRole("heading", { name: "Team operations", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mobile & desktop alerts", exact: true })).toBeHidden();
    await page.getByRole("searchbox", { name: "Search team accounts", exact: true }).fill("arun.dharee");
    const table = page.locator(".responsive-record-table");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.getByText("Arun Dharee", { exact: true })).toBeVisible();
    await insideScreen(table.locator("td,button"), width);
    await page.screenshot({ path: testInfo.outputPath(`admin-team-${width}.png`), fullPage: true });
    if (width < 768) {
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Navigation menu", exact: true }).getByRole("link", { name: "Appointments", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await page.goto(`${STAFF}/admin/accounts`);
    await expect(page.getByRole("heading", { name: "Accounting", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("accounts");
    await expect(page.locator(".responsive-record-table tbody tr").first()).toBeVisible();
    await insideScreen(page.locator(".responsive-record-table td"), width);
    await page.goto(`${STAFF}/inventory?tab=stock`);
    await expect(page.getByRole("heading", { name: "OCS warehouse", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Supply requests", exact: true })).toBeHidden();
  });
}

for (const width of [360, 390, 820, 1440]) {
  test(`insurance patients, policies and claim actions remain usable at ${width}px`, async ({ page, request }, testInfo) => {
    const db = openE2eDb();
    const stamp = `${Date.now()}-${width}`;
    const policy = `UX-POLICY-WITH-A-LONG-NUMBER-${stamp}`;
    const patientName = "Amelia Marie Ramgoolam Insurance Preview";
    const nic = `J060591${String(Date.now()).slice(-6)}F`;
    let patientId, policyId;
    try {
      patientId = Number(db.prepare(`INSERT INTO patients (full_name, first_name, last_name, patient_identifier, patient_id_number, age, date_of_birth, gender, contact_number, address, insurance_provider, insurance_policy_number, link_status) VALUES (?, 'Amelia Marie', 'Ramgoolam Insurance Preview', ?, ?, 35, '1991-05-06', 'F', '57001122', 'Quatre Bornes', 'Linkham', ?, 'staff_created')`).run(patientName, `UX-${stamp}`, nic, policy).lastInsertRowid);
      policyId = Number(db.prepare(`INSERT INTO linkham_policies (policy_number, national_id, holder_name, coverage_status) VALUES (?, ?, ?, 'green')`).run(policy, nic, patientName).lastInsertRowid);
      await login(page, request, "linkham01", `${INSURANCE}/linkham/dashboard`, width);
      await expect(page.getByRole("heading", { name: "Today’s coverage work", exact: true })).toBeVisible();
      await insideScreen(page.locator("main section,main h1"), width);
      await page.screenshot({ path: testInfo.outputPath(`insurance-dashboard-${width}.png`), fullPage: true });
      await page.goto(`${INSURANCE}/linkham/patients?search=Amelia`);
      await expect(page.getByRole("heading", { name: patientName, exact: true })).toBeVisible();
      const card = page.locator(".insured-patient-card").filter({ hasText: patientName });
      await insideScreen(card.locator("h3,span,button"), width);
      await expect(card.getByRole("button", { name: "View details", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`insurance-patients-${width}.png`), fullPage: true });
      await page.goto(`${INSURANCE}/linkham/policies?search=${policy}`);
      await expect(page.getByRole("heading", { name: "Policy registry", exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Policy number *", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: `Edit policy ${policy}`, exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Policy number *", exact: true })).toHaveValue(policy);
      await page.getByRole("textbox", { name: "Policy-holder name", exact: true }).fill(`${patientName} Updated`);
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Policy number *", exact: true })).toHaveCount(0);
      expect(db.prepare("SELECT holder_name FROM linkham_policies WHERE id=?").get(policyId).holder_name).toBe(`${patientName} Updated`);
      let flagBody;
      const claim = { id: 987001, patient_name: patientName, policy_number: policy, id_short: "UX-CLAIM", visit_date: "2026-10-15", patient_copay_amount: 400, linkham_share_amount: 1600, linkham_claim_status: "pending", dispute_status: "Clean", copay_paid: true };
      await page.route("**/api/linkham/claims?*", route => route.fulfill({ json: { claims: [claim], pendingCount: 1, cleanPendingCount: 1, clearableBatchTotal: 1600 } }));
      await page.route("**/api/linkham/claims/987001/dispute", async route => { flagBody = route.request().postDataJSON(); await route.fulfill({ json: { claim: { ...claim, dispute_status: "Flagged_Review" } } }); });
      await page.goto(`${INSURANCE}/linkham/claims-clearance`);
      await expect(page.getByRole("heading", { name: "Claims clearance", exact: true })).toBeVisible();
      await insideScreen(page.locator(".insurance-claims-table td,.insurance-claims-table button"), width);
      await page.getByRole("button", { name: "Flag", exact: true }).click();
      await page.getByPlaceholder("What needs checking?").fill("Check this synthetic claim reference");
      await page.getByRole("button", { name: "Send flag", exact: true }).click();
      await expect.poll(() => flagBody?.reason).toBe("Check this synthetic claim reference");
      await page.screenshot({ path: testInfo.outputPath(`insurance-claims-${width}.png`), fullPage: true });
      if (width < 1024) {
        if (width < 768) await expect(page.getByRole("navigation", { name: "Primary navigation", exact: true }).getByRole("link")).toHaveText(["Home", "Patients", "Claims"]);
        await page.getByRole("button", { name: "Open menu", exact: true }).click();
        const menu = page.getByRole("dialog", { name: "Insurance navigation", exact: true });
        await expect(menu.getByRole("link")).toHaveText(width < 768 ? ["Policies", "Reports"] : ["Dashboard", "Patients", "Policies", "Claims", "Reports"]);
        await page.keyboard.press("Escape"); await expect(menu).toBeHidden();
        await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeFocused();
      }
    } finally {
      if (policyId) db.prepare("DELETE FROM linkham_policies WHERE id=?").run(policyId);
      if (patientId) db.prepare("DELETE FROM patients WHERE id=?").run(patientId);
      db.close();
    }
  });
}

test("insurance claims recover from a failed fetch without showing invented zero balances", async ({ page, request }) => {
  await login(page, request, "linkham01", `${INSURANCE}/linkham/dashboard`, 390);
  await page.route("**/api/linkham/claims?*", route => route.fulfill({ status: 503, json: { error: "Claims temporarily unavailable" } }));
  await page.goto(`${INSURANCE}/linkham/claims-clearance`);
  await expect(page.getByRole("alert")).toContainText("Claims temporarily unavailable");
  await expect(page.getByText("No claims in this filter.", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/linkham/claims?*");
  await page.getByRole("button", { name: "Retry claims", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Linkham 80% corporate claims", exact: true })).toBeVisible();
});

test("admin retains closed-visit editing in the shared dispatch workspace", async ({ page, request }) => {
  const db = openE2eDb();
  let visitId;
  try {
    const patient = db.prepare("SELECT id, full_name FROM patients WHERE deleted_at IS NULL AND insurance_provider != 'Linkham' ORDER BY id LIMIT 1").get();
    const doctor = db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL AND is_active=1 LIMIT 1").get();
    visitId = Number(db.prepare("INSERT INTO visit_requests (patient_id,assigned_doctor_id,status,address,reason,urgency,staff_notes) VALUES (?,?,'cancelled','Moka','Admin closed visit preview','routine','Original note')").run(patient.id, doctor.id).lastInsertRowid);
    await login(page, request, "shravan.joaheer", STAFF, 1440);
    await page.goto(`${STAFF}/visit-requests`);
    await page.getByRole("button", { name: /^History/ }).click();
    await page.getByRole("button", { name: `Open request for ${patient.full_name}`, exact: true }).click();
    const details = page.getByRole("complementary", { name: "Request details", exact: true });
    await details.getByText("ETA & team notes", { exact: true }).click();
    await details.getByRole("textbox", { name: "Team notes", exact: true }).fill("Admin corrected this closed visit note");
    await details.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.poll(() => db.prepare("SELECT staff_notes FROM visit_requests WHERE id=?").get(visitId)?.staff_notes).toBe("Admin corrected this closed visit note");
    expect(db.prepare("SELECT status FROM visit_requests WHERE id=?").get(visitId).status).toBe("cancelled");
  } finally { if (visitId) db.prepare("DELETE FROM visit_requests WHERE id=?").run(visitId); db.close(); }
});
