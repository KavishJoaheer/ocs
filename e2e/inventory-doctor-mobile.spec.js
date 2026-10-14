import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
test.use({ isMobile: true, hasTouch: true });

async function session(request, username) {
  const response = await request.post(`${API}/auth/login`, { data: { username, password: "Welcome@123" } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
async function prepareBag(page, request, { expired = false, low = false } = {}) {
  const doctor = await session(request, "arun.dharee"); const operator = await session(request, "operator01");
  const headers = { Authorization: `Bearer ${operator.token}` };
  const catalogue = await (await request.get(`${API}/inventory`, { headers })).json();
  const name = `Mobile stock ${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const created = await request.post(`${API}/inventory/items`, { headers, data: { item_name: name, folder_id: catalogue.folders.find(f => f.name === "Consumable").id, quantity: 0, minimum_quantity: low ? 5 : 1, unit: "tablet", cost_price: 5, selling_price: 10 } });
  expect(created.ok(), await created.text()).toBeTruthy(); const source = (await created.json()).ocs_stock.find(row => row.item_name === name);
  const received = await request.post(`${API}/inventory/items/${source.id}/ocs-actions`, { headers, data: { action_type: "stock_in", quantity: 10, actual_batch_cost: 5, expiry_date: "2029-06-01", supplier_name: "Mobile stock supplier", received_date: new Date().toISOString().slice(0,10) } });
  expect(received.ok(), await received.text()).toBeTruthy();
  const transfer = await request.post(`${API}/inventory/restock`, { headers, data: { ocs_item_id: source.id, doctor_id: doctor.user.doctor_id, quantity: 3, confirm: true } });
  expect(transfer.ok(), await transfer.text()).toBeTruthy();
  const db = openE2eDb();
  const item = db.prepare("SELECT id FROM inventory WHERE owner_doctor_id=? AND item_name=? AND stock_scope='doctor'").get(doctor.user.doctor_id, name);
  if (expired) db.prepare("UPDATE inventory_batches SET expiry_date='2020-01-01' WHERE item_id=?").run(item.id);
  db.close();
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), doctor.token);
  return { doctor, source, item, name };
}

for (const width of [320,360,390,430]) {
  test(`doctor inventory has clear stock and service views with reachable search at ${width}px`, async ({ page, request }) => {
    const { name, source } = await prepareBag(page, request, { low: true });
    await page.setViewportSize({ width, height: 844 }); await page.goto(`${STAFF}/inventory`);
    await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "My bag", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Physical stock", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".doctor-inventory-card").filter({ hasText: "Selling price:" })).toHaveCount(0);
    await page.getByPlaceholder("Search items").fill(name);
    const card = page.locator(".doctor-inventory-card").filter({ hasText: name });
    await expect(card).toContainText("3 available · tablet"); await expect(card).toContainText("Minimum: 5"); await expect(card).toContainText("Expiry:");
    expect((await card.boundingBox()).y).toBeLessThan(450);
    await page.screenshot({ path: `/tmp/ocs-doctor-inventory-mobile-updated-${width}.png` });
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await page.getByRole("button", { name: /^Low stock:/ }).click();
    await expect(page.getByRole("button", { name: /^Low stock:/ })).toHaveAttribute("aria-pressed", "true");
    await expect(card).toBeVisible(); await page.getByRole("button", { name: /^Low stock:/ }).click();
    await page.getByRole("combobox", { name: "Inventory category" }).selectOption(String(source.folder_id)); await expect(card).toBeVisible();
    await page.getByRole("combobox", { name: "Inventory category" }).selectOption("all");
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: "instant" }));
    await expect.poll(async () => (await page.getByPlaceholder("Search items").boundingBox()).y).toBeLessThan(100);
    expect((await page.getByPlaceholder("Search items").boundingBox()).y).toBeGreaterThanOrEqual(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: "Services", exact: true }).click();
    await expect(page.getByText("Service prices for reference. Services do not use bag stock.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Request", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Request supply" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Stock alerts" })).toHaveCount(0);
    await expect(page.locator(".doctor-inventory-card").first()).toContainText(/Selling price:|Price not set/);
    await page.screenshot({ path: `/tmp/ocs-doctor-inventory-mobile-services-${width}.png` });
    await page.getByRole("button", { name: "OCS depot", exact: true }).click(); await expect(page.getByRole("button", { name: "Add to request", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Physical stock", exact: true }).click(); await page.getByPlaceholder("Search items").fill(name);
    await expect(page.getByRole("button", { name: "Add to request", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBeFalsy();
    await page.getByRole("button", { name: "Refresh inventory", exact: true }).click(); await expect(page.getByText("7 available · tablet")).toBeVisible();
    await page.getByRole("button", { name: "Add to request", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Request Supply from OCS", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`itemId=${source.id}`));
  });
}

test("mobile patient use needs a consultation and records stock against its bill", async ({ page, request }) => {
  const { doctor, item, name } = await prepareBag(page, request);
  const registration = await request.post(`${API}/patient-auth/register`, { data: { email: `mobile-stock-${Date.now()}@test.local`, password: "secret123", full_name: "Mobile stock patient", phone: "57001122", national_id: `MS-${Date.now()}` } });
  expect(registration.ok(), await registration.text()).toBeTruthy(); const patientId = (await registration.json()).user.patient_id;
  const db = openE2eDb(); const date = db.prepare("SELECT date('now', '+4 hours') AS value").get().value;
  db.prepare("UPDATE patients SET assigned_doctor_id=? WHERE id=?").run(doctor.user.doctor_id, patientId);
  const appointmentId = Number(db.prepare("INSERT INTO appointments(patient_id,doctor_id,appointment_date,appointment_time,status) VALUES (?,?,?,'10:00','completed')").run(patientId,doctor.user.doctor_id,date).lastInsertRowid);
  const consultationId = Number(db.prepare("INSERT INTO consultations(appointment_id,patient_id,doctor_id,consultation_date,doctor_notes) VALUES (?,?,?,?, 'Mobile inventory test')").run(appointmentId,patientId,doctor.user.doctor_id,date).lastInsertRowid);
  db.prepare("INSERT INTO billing(consultation_id,patient_id,items,total_amount,status) VALUES (?,?,'[]',0,'unpaid')").run(consultationId,patientId); db.close();
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${STAFF}/inventory`); await page.getByPlaceholder("Search items").fill(name);
  await page.getByRole("button", { name: "Use", exact: true }).click(); const sheet = page.getByRole("dialog", { name, exact: true });
  await expect(sheet.getByRole("button", { name: "Use for patient", exact: true })).toHaveAttribute("aria-pressed", "true");
  const confirm = sheet.getByRole("button", { name: "Confirm patient use", exact: true }); await expect(confirm).toBeDisabled();
  await sheet.getByLabel("Patient", { exact: true }).selectOption(String(patientId)); await expect(confirm).toBeDisabled();
  await sheet.getByLabel("Visit", { exact: true }).selectOption(String(consultationId)); await expect(confirm).toBeEnabled();
  await page.screenshot({ path: "/tmp/ocs-doctor-inventory-mobile-use-updated.png" });
  const deduction = page.waitForResponse(response => response.url().includes(`/inventory/items/${item.id}/actions`) && response.request().method() === "POST");
  await confirm.click(); const response = await deduction; expect(response.ok(), await response.text()).toBeTruthy(); await expect(sheet).toBeHidden();
  const check = openE2eDb(); expect(check.prepare("SELECT quantity FROM inventory WHERE id=?").get(item.id).quantity).toBe(2);
  const bill = check.prepare("SELECT items FROM billing WHERE consultation_id=?").get(consultationId); expect(bill).toBeTruthy(); expect(bill.items).toContain(name); check.close();
});

test("expired mobile stock can be written off without being used for a patient", async ({ page, request }) => {
  const { item, name } = await prepareBag(page, request, { expired: true });
  const before = openE2eDb(); const billCount = before.prepare("SELECT COUNT(*) AS count FROM billing").get().count; before.close();
  await page.setViewportSize({ width: 360, height: 844 }); await page.goto(`${STAFF}/inventory`);
  await page.getByRole("button", { name: /^Expired:/ }).click(); await page.getByPlaceholder("Search items").fill(name);
  await expect(page.getByText("0 available · tablet · 3 in stock")).toBeVisible();
  await page.getByRole("button", { name: "Use", exact: true }).click(); const sheet = page.getByRole("dialog", { name, exact: true });
  await expect(sheet.getByRole("button", { name: "Confirm patient use", exact: true })).toBeDisabled();
  await sheet.getByRole("button", { name: "Expired", exact: true }).click();
  const lot = sheet.getByLabel("Affected lot"); await expect(lot.locator("option")).toHaveCount(2); await lot.selectOption({ index: 1 });
  const confirm = sheet.getByRole("button", { name: "Confirm", exact: true }); await expect(confirm).toBeDisabled();
  await sheet.getByPlaceholder("Describe the wastage or expiry").fill("Expired batch removed from medical bag"); await expect(confirm).toBeEnabled();
  await confirm.click(); await expect(sheet).toBeHidden();
  const check = openE2eDb(); expect(check.prepare("SELECT quantity FROM inventory WHERE id=?").get(item.id).quantity).toBe(2);
  expect(check.prepare("SELECT COUNT(*) AS count FROM billing").get().count).toBe(billCount); check.close();
});
