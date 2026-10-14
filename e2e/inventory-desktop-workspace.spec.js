import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
async function login(request, role) {
  const response = await request.post(`${API}/auth/login`, { data: { username: role === "doctor" ? "arun.dharee" : "operator01", password: "Welcome@123" } });
  expect(response.ok()).toBeTruthy(); return response.json();
}
for (const role of ["doctor", "operator"]) {
  for (const width of [1280,1440,1920]) {
    test(`inventory keeps stock, services and locations clear for ${role} at ${width}px`, async ({ page, request }) => {
      const actor = await login(request, role);
      await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), actor.token);
      await page.setViewportSize({ width, height: 900 }); await page.goto(`${STAFF}/inventory`);
      await expect(page.getByRole("button", { name: "Refresh inventory", exact: true })).toBeVisible();
      if (role === "operator") {
        const nav = page.getByRole("tablist", { name: "Inventory sections" });
        const initial = await nav.boundingBox();
        await page.getByRole("tab", { name: "Stock", exact: true }).click();
        await expect(page.getByRole("heading", { level: 1, name: "OCS warehouse", exact: true })).toBeVisible();
        expect((await nav.boundingBox()).y).toBe(initial.y);
      } else {
        await expect(page.getByRole("region", { name: "My bag stock health", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "My bag", exact: true })).toHaveAttribute("aria-pressed", "true");
      }
      const types = page.getByRole("navigation", { name: "Inventory item type" });
      await expect(types.getByRole("button", { name: /^Physical stock/ })).toHaveAttribute("aria-pressed", "true");
      const table = page.getByRole("table");
      await expect(table.getByRole("columnheader", { name: "Available", exact: true })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Expiry", exact: true })).toBeVisible();
      await expect(table.getByText("Available in billing", { exact: true })).toHaveCount(0);
      await expect(table.getByRole("button", { name: "Edit service price", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const box = await table.boundingBox();
      expect(box.y).toBeLessThan(610);
      await page.screenshot({ path: `/tmp/ocs-inventory-updated-${role}-${width}.png` });
      await types.getByRole("button", { name: /^Services/ }).click();
      await expect(table.getByRole("columnheader", { name: "Selling price", exact: true })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Available", exact: true })).toHaveCount(0);
      await expect(table.getByRole("columnheader", { name: "Expiry", exact: true })).toHaveCount(0);
      await expect(table.getByRole("button", { name: "Use", exact: true })).toHaveCount(0);
      await expect(table.getByRole("button", { name: "Receive stock", exact: true })).toHaveCount(0);
      await page.screenshot({ path: `/tmp/ocs-inventory-services-${role}-${width}.png` });
      await types.getByRole("button", { name: /^Physical stock/ }).click();
      if (role === "doctor") {
        await page.getByRole("button", { name: "OCS depot", exact: true }).click();
        await expect(page.getByRole("region", { name: "OCS depot stock health", exact: true })).toBeVisible();
        await expect(page.getByRole("region", { name: "My bag stock health", exact: true })).toHaveCount(0);
        await page.getByRole("textbox", { name: "Search stock items" }).fill("Adult Face Mask");
        await expect(table.getByRole("button", { name: "Add to request", exact: true })).toBeVisible();
        await table.getByRole("button", { name: "Add to request", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Request Supply from OCS", exact: true })).toBeVisible();
        await expect(page).toHaveURL(/\/supply-requests\?compose=1/);
      } else {
        await page.getByRole("tab", { name: "Stock Count", exact: true }).click();
        await expect(page.getByRole("button", { name: "Start Stock Count", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Start Stock Count", exact: true })).toBeDisabled();
      }
    });
  }
}

test("receiving stock gives neutral guidance first and keeps review and retry protections", async ({ page, request }) => {
  const actor = await login(request, "operator"); const headers = { Authorization: `Bearer ${actor.token}` };
  const inventory = await (await request.get(`${API}/inventory`, { headers })).json();
  const folder = inventory.folders.find(row => row.name === "Consumable");
  const name = `Desktop receive ${Date.now()}`;
  const created = await request.post(`${API}/inventory/items`, { headers, data: { item_name: name, folder_id: folder.id, quantity: 0, minimum_quantity: 3, unit: "unit", cost_price: 5, selling_price: 10 } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = await created.json(); const item = body.ocs_stock.find(row => row.item_name === name);
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), actor.token);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${STAFF}/inventory?tab=stock`);
  await page.getByRole("textbox", { name: "Search stock items" }).fill(name);
  await page.getByRole("button", { name: "Receive stock", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByText("Enter the expiry date from the batch label, or choose non-expiring.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Review receive", exact: true })).toBeDisabled();
  await dialog.getByLabel("Batch expiry date", { exact: true }).focus();
  await dialog.getByLabel("Supplier", { exact: true }).focus();
  await expect(dialog.getByRole("alert")).toContainText("Set a batch expiry date");
  await dialog.getByLabel("Supplier", { exact: true }).fill("Desktop supplier");
  await dialog.getByLabel("Quantity to receive", { exact: true }).fill("3");
  await dialog.getByLabel("Batch expiry date", { exact: true }).fill("2020-01-01");
  await dialog.getByLabel("Unit cost (Rs)", { exact: true }).focus();
  await expect(dialog.getByRole("alert")).toContainText("Expiry must be today or a future date");
  await expect(dialog.getByRole("button", { name: "Review receive", exact: true })).toBeDisabled();
  await dialog.getByLabel("Batch expiry date", { exact: true }).fill("2029-06-01");
  await dialog.getByLabel("Unit cost (Rs)", { exact: true }).fill("0");
  await dialog.getByLabel("Supplier", { exact: true }).focus();
  await expect(dialog.getByRole("alert")).toContainText("Enter the actual batch cost above Rs 0");
  await expect(dialog.getByRole("button", { name: "Review receive", exact: true })).toBeDisabled();
  await dialog.getByLabel("Unit cost (Rs)", { exact: true }).fill("5");
  await dialog.getByRole("button", { name: "Review receive", exact: true }).click();
  await expect(dialog.getByText("Resulting on-hand", { exact: true })).toBeVisible();
  const before = await (await request.get(`${API}/inventory`, { headers })).json();
  expect(before.ocs_stock.find(row => row.id === item.id).quantity).toBe(0);
  await page.route(`**/api/inventory/items/${item.id}/ocs-actions**`, route => route.fulfill({ status: 503, json: { error: "Receipt unavailable. Please retry." } }), { times: 1 });
  await dialog.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(page.getByText("Receipt unavailable. Please retry.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Receive", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = await (await request.get(`${API}/inventory`, { headers })).json();
  expect(after.ocs_stock.find(row => row.id === item.id).quantity).toBe(3);
});

test("doctors can record expired bag stock as a loss while patient use stays blocked", async ({ page, request }) => {
  const operator = await login(request, "operator");
  const doctor = await login(request, "doctor");
  const headers = { Authorization: `Bearer ${operator.token}` };
  const inventory = await (await request.get(`${API}/inventory`, { headers })).json();
  const name = `Expired bag stock ${Date.now()}`;
  const created = await request.post(`${API}/inventory/items`, { headers, data: { item_name: name, folder_id: inventory.folders.find(row => row.name === "Consumable").id, quantity: 0, minimum_quantity: 3, unit: "unit", cost_price: 5, selling_price: 10 } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const item = (await created.json()).ocs_stock.find(row => row.item_name === name);
  const received = await request.post(`${API}/inventory/items/${item.id}/ocs-actions`, { headers, data: { action_type: "stock_in", quantity: 4, actual_batch_cost: 5, expiry_date: "2029-06-01", supplier_name: "Expiry review supplier", received_date: new Date().toISOString().slice(0,10) } });
  expect(received.ok(), await received.text()).toBeTruthy();
  const transfer = await request.post(`${API}/inventory/restock`, { headers, data: { ocs_item_id: item.id, doctor_id: doctor.user.doctor_id, quantity: 2, confirm: true } });
  expect(transfer.ok(), await transfer.text()).toBeTruthy();
  const db = openE2eDb();
  const bag = db.prepare("SELECT id FROM inventory WHERE owner_doctor_id=? AND item_name=? AND stock_scope='doctor'").get(doctor.user.doctor_id, name);
  db.prepare("UPDATE inventory_batches SET expiry_date='2020-01-01' WHERE item_id=?").run(bag.id);
  const lot = db.prepare("SELECT id FROM inventory_batches WHERE item_id=? AND quantity_remaining>0").get(bag.id);
  const billsBefore = db.prepare("SELECT COUNT(*) AS count FROM billing").get().count;
  db.close();
  const doctorHeaders = { Authorization: `Bearer ${doctor.token}` };
  const before = await (await request.get(`${API}/inventory?context=my`, { headers: doctorHeaders })).json();
  expect(before.my_stock.find(row => row.id === bag.id).available_to_use).toBe(0);
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), doctor.token);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${STAFF}/inventory`);
  await page.getByRole("textbox", { name: "Search stock items" }).fill(name);
  await page.getByRole("button", { name: "Use", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Use from bag", exact: true });
  await expect(dialog.getByRole("button", { name: "Confirm sale", exact: true })).toBeDisabled();
  await dialog.getByLabel("Reason", { exact: true }).selectOption("Expired");
  await dialog.getByLabel("Affected lot", { exact: true }).selectOption(String(lot.id));
  await dialog.getByPlaceholder("Describe why this stock is wasted or expired").fill("Expired batch removed from medical bag");
  await dialog.getByRole("button", { name: "Confirm use", exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = await (await request.get(`${API}/inventory?context=my`, { headers: doctorHeaders })).json();
  expect(after.my_stock.find(row => row.id === bag.id).quantity).toBe(1);
  const check = openE2eDb();
  expect(check.prepare("SELECT COUNT(*) AS count FROM billing").get().count).toBe(billsBefore);
  const movement = check.prepare("SELECT meta_json FROM inventory_movements WHERE item_id=? ORDER BY id DESC LIMIT 1").get(bag.id);
  expect(JSON.parse(movement.meta_json).stock_out_reason).toBe("Expired");
  check.close();
});
