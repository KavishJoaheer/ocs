import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { openE2eDb } from "./e2eDb.cjs";

const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
let fixture;
test.use({ actionTimeout: 15000, timezoneId: "Indian/Mauritius" });
async function json(response) { expect(response.ok(), await response.text()).toBeTruthy(); return response.json(); }
async function login(request, username) { return json(await request.post(`${API}/auth/login`, { data: { username, password: "Welcome@123" } })); }
async function open(page, actor, path, width = 1440) {
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), actor.token);
  await page.setViewportSize({ width, height: 960 });
  await page.goto(STAFF + path);
}
async function fits(page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  const operator = await login(request, "operator01"), doctor = await login(request, "arun.dharee");
  const db = openE2eDb();
  const otherDoctor = db.prepare("SELECT id FROM doctors WHERE id != ? AND is_active=1 AND deleted_at IS NULL ORDER BY id LIMIT 1").get(doctor.user.doctor_id);
  const today = db.prepare("SELECT date('now', '+4 hours') AS value").get().value;
  const oldDate = db.prepare("SELECT date('now', '+4 hours', '-12 days') AS value").get().value;
  const suffix = Date.now();
  fixture = { operator, doctor, otherDoctorId: otherDoctor.id, today, oldDate, patients: [], visits: [], movementIds: [] };
  try {
    for (const [index, label] of ["Paid", "Pending", "Other doctor", "Older"].entries()) {
      const doctorId = index === 2 ? otherDoctor.id : doctor.user.doctor_id;
      const patientId = Number(db.prepare(`INSERT INTO patients (full_name, patient_identifier, age, contact_number, address, location, assigned_doctor_id)
        VALUES (?, ?, 42, '57000000', 'Moka', 'Moka', ?)`).run(`Finance ${label} ${suffix}`, `OCS-FIN-${suffix}-${index}`, doctorId).lastInsertRowid);
      fixture.patients.push(patientId);
      const appointmentId = Number(db.prepare(`INSERT INTO appointments (patient_id,doctor_id,appointment_date,appointment_time,status)
        VALUES (?, ?, ?, '10:30', 'completed')`).run(patientId,doctorId,today).lastInsertRowid);
      const consultationId = Number(db.prepare(`INSERT INTO consultations (appointment_id,patient_id,doctor_id,consultation_date,doctor_notes)
        VALUES (?, ?, ?, ?, 'Financial workspace fixture')`).run(appointmentId,patientId,doctorId,today).lastInsertRowid);
      fixture.visits.push({ patientId, appointmentId, consultationId, doctorId, name: `Finance ${label} ${suffix}` });
    }
    const items = db.prepare("SELECT id, item_name, owner_doctor_id FROM inventory WHERE stock_scope='doctor' AND owner_doctor_id IN (?, ?) ORDER BY id").all(doctor.user.doctor_id,otherDoctor.id);
    for (const doctorId of [doctor.user.doctor_id, otherDoctor.id]) {
      const item = items.find(value => value.owner_doctor_id === doctorId);
      expect(item).toBeTruthy();
      const mid = Number(db.prepare(`INSERT INTO inventory_movements (item_id,movement_type,quantity,previous_quantity,next_quantity,doctor_id,recorded_by_user_id,note,action_type,unit_cost_snapshot,unit_price_snapshot)
        VALUES (?, 'in', 5, 0, 5, ?, ?, 'Stock history test receipt', 'stock_in', 15, 25)`).run(item.id,doctorId,operator.user.id).lastInsertRowid);
      fixture.movementIds.push(mid);
      db.prepare(`INSERT INTO inventory_activity_history (movement_id,actor_user_id,actor_name,actor_role,action_type,item_name,quantity,direction,source_text,destination_text,batch_id)
        VALUES (?, ?, ?, 'operator', 'stock_in', ?, 5, 'in', 'OCS warehouse', ?, ?)`).run(mid,operator.user.id,operator.user.full_name,item.item_name,`Doctor bag ${doctorId}`,`FINANCE-LOT-${doctorId}-${suffix}`);
    }
  } finally { db.close(); }
  for (const [index, visit] of fixture.visits.entries()) {
    const result = await json(await request.post(`${API}/billing/quick/visits/${visit.consultationId}/capture`, { headers: { Authorization: `Bearer ${operator.token}` }, data: {
      operation_id: randomUUID(), doctor_id: visit.doctorId, record_payment: index === 0,
      payment_method: index === 0 ? "cash" : undefined, payment_date: today,
      consultation_fee: { type: "Day Consultation", amount: 2000 }, manual_consumables: true, items: [],
    } }));
    visit.billId = result.submission.bill_id;
    expect(visit.billId).toBeGreaterThan(0);
  }
  const edit = openE2eDb();
  try {
    const older = fixture.visits[3];
    edit.prepare("UPDATE appointments SET appointment_date=? WHERE id=?").run(oldDate,older.appointmentId);
    edit.prepare("UPDATE consultations SET consultation_date=? WHERE id=?").run(oldDate,older.consultationId);
    edit.prepare("UPDATE billing SET consultation_date_snapshot=? WHERE id=?").run(oldDate,older.billId);
  } finally { edit.close(); }
});

test.afterEach(() => {
  if (!fixture) return;
  const db = openE2eDb();
  try {
    for (const id of fixture.patients) db.prepare("UPDATE patients SET deleted_at=CURRENT_TIMESTAMP,is_under_review=0 WHERE id=?").run(id);
    for (const id of fixture.movementIds) {
      db.prepare("DELETE FROM inventory_activity_history WHERE movement_id=?").run(id);
      db.prepare("DELETE FROM inventory_movements WHERE id=?").run(id);
    }
  } finally { db.close(); fixture = null; }
});

test("operator filters outstanding invoices and records a partial payment safely", async ({ page }) => {
  await open(page,fixture.operator,"/operator/pending-payment",1280);
  await expect(page.getByRole("heading",{ name: "Payment follow-up", exact:true })).toBeVisible();
  await page.getByLabel("Invoice doctor").selectOption(String(fixture.doctor.user.doctor_id));
  await page.getByLabel("Invoice date range").selectOption("today");
  await page.getByLabel("Search invoices").fill("Finance");
  await expect(page.getByRole("table").getByText(fixture.visits[1].name,{ exact:true })).toBeVisible();
  await expect(page.getByRole("table").getByText(fixture.visits[2].name,{ exact:true })).toHaveCount(0);
  await expect(page.getByRole("table").getByText(fixture.visits[3].name,{ exact:true })).toHaveCount(0);
  await page.getByLabel("Invoice date range").selectOption("all");
  await page.getByLabel("Outstanding visit age").selectOption("days_8_30");
  await expect(page.getByRole("table").getByText(fixture.visits[3].name,{ exact:true })).toBeVisible();
  await expect(page.getByRole("table").getByText(fixture.visits[1].name,{ exact:true })).toHaveCount(0);
  await page.getByLabel("Outstanding visit age").selectOption("");
  await page.getByLabel("Search invoices").fill(fixture.visits[1].name);
  const row = page.getByRole("row").filter({hasText:fixture.visits[1].name});
  await expect(row.getByRole("button",{name:"Record payment",exact:true})).toBeVisible();
  await fits(page);
  await page.screenshot({path:"/tmp/ocs-payment-follow-up-improved-1280.png",animations:"disabled"});
  await row.getByRole("button",{name:"Record payment",exact:true}).click();
  const modal=page.getByRole("dialog"); await expect(modal).toBeVisible();
  expect((await modal.boundingBox()).width).toBeLessThanOrEqual(680);
  await modal.getByLabel("Amount received").fill("500");
  await modal.getByLabel("Payment method").selectOption("juice");
  await modal.getByLabel(/I confirm/).check();
  await expect(modal.getByRole("button",{name:"Record partial payment",exact:true})).toBeDisabled();
  await modal.getByLabel("Transaction reference").fill(`FIN-TEST-${Date.now()}`);
  await expect(modal.getByLabel(/I confirm/)).not.toBeChecked();
  await modal.getByLabel(/I confirm/).check();
  await page.screenshot({path:"/tmp/ocs-payment-form-improved.png",animations:"disabled"});
  await modal.getByRole("button",{name:"Record partial payment",exact:true}).click();
  await expect(modal).toBeHidden();
  await expect(row).toContainText("Rs 1,500.00");
  await expect(row).toContainText(/Part paid|Partial/i);
  await row.getByRole("link", { name: "View invoice", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invoice details", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Invoice doctor")).toHaveValue(String(fixture.doctor.user.doctor_id));
  await expect(page.getByLabel("Search invoices")).toHaveValue(fixture.visits[1].name);
  await expect(page.getByRole("row").filter({ hasText: fixture.visits[1].name })).toContainText("Rs 1,500.00");
});

for (const role of ["doctor", "operator"]) {
  test(`${role} stock history shows six readable columns and complete expandable details`, async ({page}) => {
    await open(page,fixture[role],"/stock-history",1280);
    await expect(page.getByRole("heading",{name:"Stock history",exact:true})).toBeVisible();
    const table=page.getByRole("table",{name:"Stock movements"});
    await expect(table.locator("thead th")).toHaveCount(6);
    await expect(table.getByRole("button",{name:"Details",exact:true}).first()).toBeVisible();
    await expect(page.getByText("Dispatch desk",{exact:true})).toHaveCount(0);
    if(role==="doctor") await expect(table).not.toContainText(`Doctor bag ${fixture.otherDoctorId}`);
    await table.getByRole("button",{name:"Details",exact:true}).first().click();
    await expect(table.locator(".stock-movement-details")).toContainText("FINANCE-LOT-");
    await expect(table.locator(".stock-movement-details")).toContainText("Resulting balance");
    await fits(page);
    expect(await table.evaluate(el=>el.scrollWidth <= el.clientWidth+1)).toBeTruthy();
    await page.screenshot({path:`/tmp/ocs-stock-history-${role}-improved-1280.png`,animations:"disabled"});
    await page.setViewportSize({width:1440,height:960}); await fits(page);
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Download CSV",exact:true}).click();
    expect((await download).suggestedFilename()).toMatch(/stock-activity.*\.csv/);
    await page.setViewportSize({width:390,height:844});
    await expect(page.locator("table")).toHaveCount(0);
    const card=page.locator("article").filter({hasText:"Quantity change"}).first();
    await expect(card).toBeVisible();
    await expect(card.locator("strong.tabular-nums").filter({hasText:/^[+\u2212]\d+$/})).toHaveCount(1);
    await expect(card.getByText(/Actor/i)).toBeVisible();
    await fits(page);
  });
}

test("doctor revenue opens the actual paid invoice and scopes the outstanding list", async ({page,request}) => {
  await open(page,fixture.doctor,"/live-report?period=daily&date="+fixture.today,1280);
  await expect(page.getByRole("heading",{name:"Revenue Report",exact:true})).toBeVisible();
  await expect(page.getByRole("button").filter({hasText:fixture.visits[0].name})).toBeVisible();
  await fits(page);
  await page.screenshot({path:"/tmp/ocs-revenue-report-improved-1280.png",animations:"disabled"});
  await page.getByRole("button").filter({hasText:fixture.visits[0].name}).click();
  await expect(page.getByRole("heading",{name:"Invoice details",exact:true})).toBeVisible();
  await expect(page.getByText(fixture.visits[0].name,{exact:true})).toBeVisible();
  await expect(page.getByText("No eligible consultations for this patient and doctor.")).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"Payment history",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"Record payment",exact:true})).toHaveCount(0);
  await page.screenshot({path:"/tmp/ocs-invoice-detail-improved.png",animations:"disabled"});
  const download=page.waitForEvent("download"); await page.getByRole("button",{name:"Download invoice",exact:true}).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByRole("button",{name:"Back",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/live-report\\?period=daily&date=${fixture.today}`));
  await page.getByRole("link").filter({hasText:/Unpaid/}).first().click();
  await expect(page.getByRole("heading",{name:"Issued invoices",exact:true})).toBeVisible();
  await expect(page.getByRole("table").getByText(fixture.visits[1].name,{exact:true})).toBeVisible();
  await expect(page.getByRole("table").getByText(fixture.visits[2].name,{exact:true})).toHaveCount(0);
  await expect(page.getByRole("table").getByText(fixture.visits[3].name,{exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Record payment",exact:true})).toHaveCount(0);
  const blocked=await request.get(`${API}/billing/${fixture.visits[2].billId}`,{headers:{Authorization:`Bearer ${fixture.doctor.token}`}});
  expect(blocked.status()).toBe(403);
  await page.goto(`${STAFF}/billing?billId=${fixture.visits[2].billId}`);
  await expect(page.getByRole("alert")).toContainText("You can only view billing linked to your own consultations");
  await expect(page.getByText(fixture.visits[2].name,{exact:true})).toHaveCount(0);
});

test("revenue values remain contained at desktop widths and operator access stays restricted", async ({page}) => {
  await page.route("**/api/dashboard/live-report?*",async route=>{
    const response=await route.fetch(); const payload=await response.json();
    payload.revenueStatement={...payload.revenueStatement,paidRevenue:987654321.99,unpaidRevenue:123456789.99,doctorNetRevenue:456789123.99};
    await route.fulfill({response,json:payload});
  });
  await open(page,fixture.doctor,"/live-report",1280);
  await expect(page.getByRole("heading",{name:"Revenue Report",exact:true})).toBeVisible();
  for (const width of [1280,1440]) {
    await page.setViewportSize({width,height:960}); await fits(page);
    const metrics=page.locator(".revenue-statement-metrics:visible .revenue-statement-stat");
    await expect(metrics).toHaveCount(4);
    expect(await metrics.evaluateAll(nodes=>nodes.every(node=>node.scrollWidth <= node.clientWidth+1))).toBeTruthy();
  }
  await page.unroute("**/api/dashboard/live-report?*");
  await open(page,fixture.operator,"/live-report");
  await expect(page).not.toHaveURL(/\/live-report/);
  await expect(page.getByRole("link",{name:"Revenue Report",exact:true})).toHaveCount(0);
});
