import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";

const STAFF_BASE = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API_BASE = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;

async function login(request, username) {
  const response = await request.post(`${API_BASE}/auth/login`, {
    data: { username, password: "Welcome@123" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function injectStaffSession(page, token) {
  await page.addInitScript((authToken) => {
    window.localStorage.setItem("ocs_medecins_auth_token", authToken);
  }, token);
}

async function apiJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function nextCollectionIso() {
  const start = new Date();
  for (let i = 1; i < 28; i += 1) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    const iso = date.toISOString().slice(0, 10);
    const day = date.getUTCDay();
    if ([1, 3, 5, 6].includes(day)) return iso;
  }
  throw new Error("Could not find a valid collection date.");
}

async function startStocktakeSession(request, operatorToken, { itemIds = [], folderId = null, confirmAll = false } = {}) {
  const qs = new URLSearchParams();
  if (folderId) qs.set("folder_id", String(folderId));
  if (itemIds.length) qs.set("item_ids", itemIds.join(","));
  const preview = await request.get(`${API_BASE}/inventory/stocktake/scope${qs.toString() ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${operatorToken}` },
  });
  expect(preview.ok(), await preview.text()).toBeTruthy();
  const previewBody = await apiJson(preview);
  return request.post(`${API_BASE}/inventory/stocktake/sessions`, {
    headers: { Authorization: `Bearer ${operatorToken}` },
    data: {
      item_ids: itemIds,
      folder_id: folderId,
      confirm_all: confirmAll,
      scope_token: previewBody.scope_token,
    },
  });
}

async function createStockedItem(request, { adminToken, operatorToken, name, quantity = 8, expiryDate = "2029-06-01", isNonExpiring = false, costPrice = 5 }) {
  const foldersRes = await request.get(`${API_BASE}/inventory`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const foldersBody = await apiJson(foldersRes);
  const consumable =
    (foldersBody.folders || []).find((row) => row.name === "Consumable") || foldersBody.folders?.[0];
  expect(consumable?.id).toBeTruthy();
  const created = await request.post(`${API_BASE}/inventory/items`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      item_name: name,
      folder_id: consumable.id,
      quantity: 0,
      minimum_quantity: 0,
      unit: "unit",
      cost_price: costPrice,
      selling_price: 10,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const afterCreate = await apiJson(created);
  const item = (afterCreate.ocs_stock || []).find((row) => row.item_name === name);
  expect(item?.id).toBeTruthy();
  if (quantity > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const expiry = expiryDate ? String(expiryDate).slice(0, 10) : "";
    const pastExpiry = Boolean(expiry && expiry < today);
    if (!isNonExpiring && (!expiry || pastExpiry)) {
      const db = openE2eDb();
      db.prepare(
        `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
         VALUES (?, ?, ?, 5, 0)`,
      ).run(item.id, quantity, expiry || null);
      db.prepare("UPDATE inventory SET quantity = ? WHERE id = ?").run(quantity, item.id);
      db.close();
    } else {
      const received = await request.post(`${API_BASE}/inventory/items/${item.id}/ocs-actions`, {
        headers: { Authorization: `Bearer ${operatorToken}` },
        data: {
          action_type: "stock_in",
          quantity,
          expiry_date: isNonExpiring ? null : expiryDate,
          is_non_expiring: isNonExpiring,
        },
      });
      expect(received.ok(), await received.text()).toBeTruthy();
    }
  }
  return { ...item, folder_id: consumable.id, folder_name: consumable.name };
}

async function openStockTab(page) {
  const tab = page.getByRole("tab", { name: /^(Warehouse stock|Stock)$/ });
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
}

async function pickRequest(request, operatorToken, requestId, { fulfilledQuantity, partialReason } = {}) {
  const fulfilment = await request.get(`${API_BASE}/restock-requests/${requestId}/fulfilment`, {
    headers: { Authorization: `Bearer ${operatorToken}` },
  });
  const fulfilmentBody = await apiJson(fulfilment);
  const lines = (fulfilmentBody.fulfilment?.items || []).map((line) => {
    const reserved = Number(line.reserved_quantity);
    const fulfilled = fulfilledQuantity == null ? reserved : fulfilledQuantity;
    return { id: line.id, picked_quantity: fulfilled, fulfilled_quantity: fulfilled };
  });
  const body = { lines };
  if (fulfilledQuantity != null) {
    body.partial_approved = true;
    body.partial_reason = partialReason || "Partial pack approved after a warehouse shortage";
  }
  const picked = await request.patch(`${API_BASE}/restock-requests/${requestId}/fulfilment`, {
    headers: { Authorization: `Bearer ${operatorToken}` },
    data: body,
  });
  expect(picked.ok(), await picked.text()).toBeTruthy();
  return apiJson(picked);
}

test.describe("Inventory workflow", () => {
  test("doctor to operator to collection lifecycle persists through the API and UI", async ({
    request,
    page,
  }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const itemName = `E2E Gauze ${Date.now()}`;
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: itemName,
      quantity: 8,
    });

    const beforeStock = await request.get(`${API_BASE}/inventory`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    const warehouseBefore = (await apiJson(beforeStock)).ocs_stock.find((row) => row.id === item.id);
    const warehouseQtyBefore = Number(warehouseBefore.quantity);

    const created = await request.post(`${API_BASE}/restock-requests`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "E2E request",
        items: [{ inventory_id: item.id, item_name: "Crafted name that must be ignored", quantity: 2 }],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const requestBody = await apiJson(created);
    const requestId = requestBody.request.id;
    expect(requestBody.request.items[0].item_name).toBe(itemName);

    const accepted = await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "accepted" },
    });
    expect(accepted.ok(), await accepted.text()).toBeTruthy();
    const acceptedBody = await apiJson(accepted);
    expect(acceptedBody.request.status).toBe("accepted");
    expect(acceptedBody.request.fulfilment.items[0].reserved_quantity).toBe(2);
    expect(acceptedBody.request.fulfilment.items[0].picked_batches.length).toBeGreaterThan(0);

    await pickRequest(request, operator.token, requestId);

    const ready = await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "ready" },
    });
    expect(ready.ok(), await ready.text()).toBeTruthy();

    await injectStaffSession(page, doctor.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await expect(page.getByRole("heading", { name: /My bag|OCS depot|OCS Stock/i })).toBeVisible({
      timeout: 25_000,
    });
    await page.getByRole("link", { name: /request supply/i }).first().click();
    await expect(page).toHaveURL(/\/supply-requests/);
    await expect(page.getByRole("button", { name: "New supply request" })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText("Supply Ready").first()).toBeVisible();
    await page.getByRole("button", { name: "Confirm collection" }).click();
    await expect(page.getByRole("heading", { name: "Confirm supplies collected" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm collection" }).last().click();
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByText("Supply Collected").first()).toBeVisible();

    const detail = await request.get(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    const detailBody = await apiJson(detail);
    expect(detailBody.request.status).toBe("completed");
    expect(detailBody.request.archived_at).toBeTruthy();
    expect(detailBody.request.transfer_transaction_id).toBeTruthy();
    expect(detailBody.request.accepted_by_name).toBeTruthy();
    expect(detailBody.request.completed_by_name).toBeTruthy();

    const afterStock = await request.get(`${API_BASE}/inventory`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    const warehouseAfter = (await apiJson(afterStock)).ocs_stock.find((row) => row.id === item.id);
    expect(Number(warehouseAfter.quantity)).toBe(warehouseQtyBefore - 2);

    const doctorStock = await request.get(`${API_BASE}/inventory`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
    });
    const bagItem = (await apiJson(doctorStock)).my_stock?.find((row) => row.item_name === itemName);
    expect(Number(bagItem?.quantity || 0)).toBeGreaterThanOrEqual(2);

    const receipt = await request.get(
      `${API_BASE}/inventory/receipts/${detailBody.request.transfer_transaction_id}`,
      { headers: { Authorization: `Bearer ${operator.token}` } },
    );
    expect(receipt.ok(), await receipt.text()).toBeTruthy();
    const receiptBody = await apiJson(receipt);
    expect(receiptBody.items[0].batch_id || receiptBody.items[0].batch_number).toBeTruthy();

    await injectStaffSession(page, operator.token);
    await page.goto(`${STAFF_BASE}/inventory`);
    await expect(page.getByRole("heading", { name: "OCS warehouse" })).toBeVisible();
    await page.getByRole("button", { name: /^History/ }).click();
    await expect(page.locator("span").filter({ hasText: /^Supply Dispatched$/ })).toBeVisible();
  });

  test("amendment accept and decline persist through the API", async ({ request }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Amend ${Date.now()}`,
      quantity: 12,
    });
    const created = await request.post(`${API_BASE}/restock-requests`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "amend",
        items: [{ inventory_id: item.id, item_name: item.item_name, quantity: 2 }],
      },
    });
    const requestId = (await apiJson(created)).request.id;
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "accepted" },
    });

    const rejectedSubmit = await request.post(`${API_BASE}/restock-requests/${requestId}/amendments`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "try more",
        items: [{ inventory_id: item.id, item_name: item.item_name, quantity: 9 }],
      },
    });
    const rejectedBody = await apiJson(rejectedSubmit);
    const declined = await request.patch(
      `${API_BASE}/restock-requests/${requestId}/amendments/${rejectedBody.amendment.id}`,
      {
        headers: { Authorization: `Bearer ${operator.token}` },
        data: { decision: "rejected", reason: "Keep original pack" },
      },
    );
    expect(declined.ok(), await declined.text()).toBeTruthy();
    const declinedBody = await apiJson(declined);
    expect(declinedBody.request.items[0].quantity).toBe(2);

    const acceptedSubmit = await request.post(`${API_BASE}/restock-requests/${requestId}/amendments`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "need five",
        items: [{ inventory_id: item.id, item_name: item.item_name, quantity: 5 }],
      },
    });
    const acceptedBody = await apiJson(acceptedSubmit);
    const accepted = await request.patch(
      `${API_BASE}/restock-requests/${requestId}/amendments/${acceptedBody.amendment.id}`,
      {
        headers: { Authorization: `Bearer ${operator.token}` },
        data: { decision: "accepted" },
      },
    );
    expect(accepted.ok(), await accepted.text()).toBeTruthy();
    const afterAccept = await apiJson(accepted);
    expect(afterAccept.request.items[0].quantity).toBe(5);
    expect(afterAccept.request.fulfilment.items[0].reserved_quantity).toBe(5);
  });

  test("shortage and approved partial fulfilment cannot bypass picked quantity", async ({ request }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Short ${Date.now()}`,
      quantity: 2,
    });
    const created = await request.post(`${API_BASE}/restock-requests`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "short",
        items: [{ inventory_id: item.id, item_name: item.item_name, quantity: 5 }],
      },
    });
    const requestId = (await apiJson(created)).request.id;
    const accepted = await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "accepted" },
    });
    const acceptedBody = await apiJson(accepted);
    expect(Number(acceptedBody.request.fulfilment.items[0].shortage_quantity)).toBeGreaterThan(0);

    const readyBlocked = await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "ready" },
    });
    expect(readyBlocked.status()).toBe(400);

    const overFulfil = await request.patch(`${API_BASE}/restock-requests/${requestId}/fulfilment`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: {
        lines: acceptedBody.request.fulfilment.items.map((line) => ({
          id: line.id,
          picked_quantity: 1,
          fulfilled_quantity: 2,
        })),
        partial_approved: true,
        partial_reason: "Partial pack approved after a warehouse shortage",
      },
    });
    expect(overFulfil.status()).toBe(400);

    await pickRequest(request, operator.token, requestId, {
      fulfilledQuantity: Number(acceptedBody.request.fulfilment.items[0].reserved_quantity),
    });
    const ready = await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "ready" },
    });
    expect(ready.ok(), await ready.text()).toBeTruthy();
  });

  test("legacy reconciliation returns fulfilment details for the operator UI", async ({ request }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Recon ${Date.now()}`,
      quantity: 4,
    });
    const created = await request.post(`${API_BASE}/restock-requests`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "recon",
        items: [{ inventory_id: item.id, item_name: item.item_name, quantity: 1 }],
      },
    });
    const requestId = (await apiJson(created)).request.id;
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "accepted" },
    });
    await pickRequest(request, operator.token, requestId);
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "ready" },
    });
    const preview = await request.get(`${API_BASE}/restock-requests/${requestId}/reconcile/preview`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    expect(preview.ok(), await preview.text()).toBeTruthy();
    const previewBody = await apiJson(preview);
    const recon = await request.post(`${API_BASE}/restock-requests/${requestId}/reconcile`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: {
        reason: "Operator reconciled legacy fulfilment quantities and batches.",
        preview_token: previewBody.preview_token,
      },
    });
    expect(recon.ok(), await recon.text()).toBeTruthy();
    const reconBody = await apiJson(recon);
    expect(reconBody.request || reconBody.fulfilment).toBeTruthy();
    expect(reconBody.outcome === "already_linked" || reconBody.fulfilment).toBeTruthy();
  });

  test("stocktake apply rejects a line after an intervening receipt", async ({ request }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Count ${Date.now()}`,
      quantity: 4,
    });
    const created = await startStocktakeSession(request, operator.token, { itemIds: [item.id] });
    expect(created.ok(), await created.text()).toBeTruthy();
    const session = (await apiJson(created)).session;
    expect(session.items[0].system_quantity).toBeNull();
    await request.patch(`${API_BASE}/inventory/stocktake/sessions/${session.id}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { lines: [{ id: session.items[0].id, physical_quantity: 5 }] },
    });
    await request.post(`${API_BASE}/inventory/stocktake/sessions/${session.id}/submit`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    await request.post(`${API_BASE}/inventory/stocktake/sessions/${session.id}/review`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { decision: "approved" },
    });
    await request.post(`${API_BASE}/inventory/items/${item.id}/ocs-actions`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { action_type: "stock_in", quantity: 2, expiry_date: "2029-06-01" },
    });
    const applied = await request.post(`${API_BASE}/inventory/stocktake/sessions/${session.id}/apply`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(applied.status()).toBe(409);
  });

  test("selected shipment release rejects empty selection and is idempotent", async ({ request }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const name = `E2E Ship ${Date.now()}`;
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name,
      quantity: 0,
    });
    const csv = [
      "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
      `${item.folder_name},${name},3,0,unit,1,2,2029-01-01`,
    ].join("\n");
    const imported = await request.post(`${API_BASE}/inventory/staging/import-csv`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { csv_text: csv, supplier: "E2E Supplier" },
    });
    expect(imported.ok(), await imported.text()).toBeTruthy();
    const importedBody = await apiJson(imported);
    const shipmentId = importedBody.import_summary.shipment_id;
    const lineId = importedBody.shipment.lines[0].id;

    const empty = await request.post(`${API_BASE}/inventory/shipments/${shipmentId}/release`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { mode: "selected", row_ids: [] },
    });
    expect(empty.status()).toBe(400);

    const released = await request.post(`${API_BASE}/inventory/shipments/${shipmentId}/release`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { mode: "selected", row_ids: [lineId] },
    });
    expect([200, 201]).toContain(released.status());
    const again = await request.post(`${API_BASE}/inventory/shipments/${shipmentId}/release`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { mode: "selected", row_ids: [lineId] },
    });
    expect((await apiJson(again)).idempotent).toBe(true);
  });

  test("permission boundaries and compact layouts keep inventory actions reachable", async ({
    request,
    page,
  }) => {
    const doctor = await login(request, "arun.dharee");
    const operator = await login(request, "operator01");
    const catalogue = await request.post(`${API_BASE}/inventory/items`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: { item_name: "Doctor should not create", folder_id: 1, quantity: 0, minimum_quantity: 0, unit: "unit" },
    });
    expect(catalogue.status()).toBe(403);

    const operatorCreate = await request.post(`${API_BASE}/inventory/items`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: {
        item_name: "Operator should not create",
        folder_id: 1,
        quantity: 0,
        minimum_quantity: 0,
        unit: "unit",
      },
    });
    expect(operatorCreate.status()).toBe(403);

    const deleteBlocked = await request.delete(`${API_BASE}/restock-requests/1`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    expect(deleteBlocked.status()).toBe(405);

    await injectStaffSession(page, operator.token);
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${STAFF_BASE}/inventory`);
      await expect(page.getByRole("heading", { name: "OCS warehouse" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /queues|stock|shipments|count/i }).first()).toBeVisible();
    }

    await injectStaffSession(page, doctor.token);
    for (const width of [768, 375, 320]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${STAFF_BASE}/supply-requests`);
      await expect(page.getByRole("button", { name: "New supply request" })).toBeVisible({ timeout: 20_000 });
    }
  });

  test("inventory tabs stay readable at phone and tablet widths", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    await injectStaffSession(page, operator.token);
    for (const size of [
      { width: 320, height: 720 },
      { width: 375, height: 812 },
      { width: 768, height: 900 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(`${STAFF_BASE}/inventory`);
      await expect(page.getByRole("tab", { name: "Shipments" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("tab", { name: "Count" })).toBeVisible();
      const box = await page.getByRole("tab", { name: "Shipments" }).boundingBox();
      expect(box?.width || 0).toBeGreaterThan(44);
    }
  });

  test("stocktake counting is completed through the inventory Count UI", async ({ request, page }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E UI Count ${Date.now()}`,
      quantity: 3,
    });
    const created = await startStocktakeSession(request, operator.token, { itemIds: [item.id] });
    expect(created.ok(), await created.text()).toBeTruthy();
    const session = (await apiJson(created)).session;

    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await page.getByRole("tab", { name: /^Count$/ }).click();
    await expect(page.getByRole("button", { name: new RegExp(`#${session.id}`) })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: new RegExp(`#${session.id}`) }).click();
    await expect(page.getByText(item.item_name)).toBeVisible();
    const countInput = page.locator("table input[type='number']").first();
    await countInput.fill("3");
    await page.getByRole("button", { name: /Save progress/ }).click();
    await expect(page.getByText(/Counts saved|Recount saved/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Submit counts" }).click();
    await expect(page.getByText(/Zero-variance session closed|Counts submitted for approval/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("stale clients see an update banner and do not auto-reload dirty forms", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    const deployedSha = `deployed-${Date.now()}`;
    await page.addInitScript(() => {
      window.__OCS_UPDATE_POLL_MS = 400;
    });
    await page.route("**/api/health", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, git_sha: deployedSha, version: deployedSha }),
      });
    });
    await injectStaffSession(page, operator.token);
    await page.goto(`${STAFF_BASE}/inventory`);
    await expect(page.getByText("Update available")).toBeVisible({ timeout: 20_000 });
    const embedded = await page.evaluate(() => window.__OCS_CLIENT_BUILD_SHA__);
    expect(embedded).toBeTruthy();
    expect(embedded).not.toBe(deployedSha);
    await page.evaluate(() => window.__OCS_UNSAVED_WORK__?.set("stocktake", true));
    await expect(page.getByRole("button", { name: /Reload requires confirmation/ })).toBeVisible();
    await page.getByRole("button", { name: /Reload requires confirmation/ }).click();
    await expect(page.getByRole("button", { name: "Confirm reload" })).toBeVisible();
    await expect(page).toHaveURL(/\/inventory/);
  });

  test("matching client and server SHAs hide the update banner", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    await injectStaffSession(page, operator.token);
    await page.goto(`${STAFF_BASE}/inventory`);
    const health = await request.get(`${API_BASE}/health`);
    const healthBody = await apiJson(health);
    await expect.poll(async () => page.evaluate(() => window.__OCS_CLIENT_BUILD_SHA__)).toBeTruthy();
    const embedded = await page.evaluate(() => window.__OCS_CLIENT_BUILD_SHA__);
    expect(String(healthBody.git_sha || healthBody.version || "")).toBe(embedded);
    await expect(page.getByText("Update available")).toHaveCount(0);
  });

  test("a live deployment, offline health, and successful reload keep the banner loop-free", async ({
    request,
    page,
  }) => {
    const operator = await login(request, "operator01");
    let deployedSha = null;
    let failHealth = false;
    await page.addInitScript(() => {
      window.__OCS_UPDATE_POLL_MS = 400;
    });
    await page.route("**/api/health", async (route) => {
      if (failHealth) {
        await route.abort("failed");
        return;
      }
      if (deployedSha) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, git_sha: deployedSha, version: deployedSha }),
        });
        return;
      }
      await route.continue();
    });
    await injectStaffSession(page, operator.token);
    await page.goto(`${STAFF_BASE}/inventory`);
    await expect.poll(async () => page.evaluate(() => window.__OCS_CLIENT_BUILD_SHA__)).toBeTruthy();
    const embedded = await page.evaluate(() => window.__OCS_CLIENT_BUILD_SHA__);
    await expect(page.getByText("Update available")).toHaveCount(0);
    deployedSha = `live-${Date.now()}`;
    await expect(page.getByText("Update available")).toBeVisible({ timeout: 10_000 });
    failHealth = true;
    await page.waitForTimeout(800);
    await expect(page.getByText("Update available")).toBeVisible();
    failHealth = false;
    deployedSha = embedded;
    await page.getByRole("button", { name: "Reload now" }).click();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Update available")).toHaveCount(0);
    expect(await page.evaluate(() => window.__OCS_CLIENT_BUILD_SHA__)).toBe(embedded);
  });

  test("exceptional correction previews unreserved, reserved, picked and ready stock", async ({
    request,
    page,
  }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");

    async function openCorrection(itemName) {
      await page.getByPlaceholder(/Search by item name/).fill(itemName);
      const stockTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Item Name" }) });
      const row = stockTable.locator("tbody tr").filter({ hasText: itemName }).filter({
        has: page.getByRole("button", { name: "Exceptional actions" }),
      });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
      await row.getByRole("button", { name: "Exceptional actions" }).click();
      await page.getByRole("menuitem", { name: "Exceptional inventory correction" }).click({ force: true });
      await expect(page.getByRole("heading", { name: /Exceptional inventory correction/ })).toBeVisible();
    }

    const freeItem = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Corr Free ${Date.now()}`,
      quantity: 8,
    });
    await injectStaffSession(page, admin.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await expect(page.getByRole("heading", { name: "OCS warehouse", exact: true })).toBeVisible({
      timeout: 25_000,
    });
    await openCorrection(freeItem.item_name);
    await page.getByRole("spinbutton", { name: "Corrected quantity" }).fill("7");
    await page.getByRole("textbox", { name: /Reason/ }).fill("Warehouse recount found extra units");
    await page.getByRole("button", { name: "Review correction" }).click();
    await expect(page.getByRole("dialog").getByText("Available to promise", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Apply correction" }).click();
    await expect(page.getByText("Exceptional correction applied.")).toBeVisible({ timeout: 15_000 });

    const reservedItem = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Corr Reserved ${Date.now()}`,
      quantity: 5,
    });
    const reservedReq = await request.post(`${API_BASE}/restock-requests`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "correction reserved",
        items: [{ inventory_id: reservedItem.id, item_name: reservedItem.item_name, quantity: 4 }],
      },
    });
    expect(reservedReq.ok(), await reservedReq.text()).toBeTruthy();
    const reservedId = (await apiJson(reservedReq)).request.id;
    const accepted = await request.patch(`${API_BASE}/restock-requests/${reservedId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "accepted" },
    });
    expect(accepted.ok(), await accepted.text()).toBeTruthy();

    await page.goto(`${STAFF_BASE}/inventory`);
    await openCorrection(reservedItem.item_name);
    await page.getByRole("spinbutton", { name: "Corrected quantity" }).fill("1");
    await page.getByRole("textbox", { name: /Reason/ }).fill("Warehouse recount found extra units");
    await page.getByRole("button", { name: "Review correction" }).click();
    await expect(page.getByText(/High risk: this will reduce reservations/)).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: "Review correction" })).toBeVisible();
    await page.getByRole("button", { name: "Review correction" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Reduce reservations and apply" }).click();
    await expect(page.getByText("Exceptional correction applied.")).toBeVisible({ timeout: 15_000 });

    const pickedItem = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Corr Picked ${Date.now()}`,
      quantity: 6,
    });
    const pickedCreated = await request.post(`${API_BASE}/restock-requests`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "correction picked",
        items: [{ inventory_id: pickedItem.id, item_name: pickedItem.item_name, quantity: 3 }],
      },
    });
    const pickedId = (await apiJson(pickedCreated)).request.id;
    await request.patch(`${API_BASE}/restock-requests/${pickedId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "accepted" },
    });
    await pickRequest(request, operator.token, pickedId, { fulfilledQuantity: 2 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await openCorrection(pickedItem.item_name);
    await page.getByRole("spinbutton", { name: "Corrected quantity" }).fill("1");
    await page.getByRole("textbox", { name: /Reason/ }).fill("Warehouse recount found extra units");
    await page.getByRole("button", { name: "Review correction" }).click();
    await expect(page.getByText("This correction is blocked.")).toBeVisible();
    await expect(page.getByText(new RegExp(`Request #${pickedId}`))).toBeVisible();

    const readyItem = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Corr Ready ${Date.now()}`,
      quantity: 6,
    });
    const readyCreated = await request.post(`${API_BASE}/restock-requests`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "correction ready",
        items: [{ inventory_id: readyItem.id, item_name: readyItem.item_name, quantity: 2 }],
      },
    });
    const readyId = (await apiJson(readyCreated)).request.id;
    await request.patch(`${API_BASE}/restock-requests/${readyId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "accepted" },
    });
    await pickRequest(request, operator.token, readyId);
    await request.patch(`${API_BASE}/restock-requests/${readyId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "ready" },
    });
    await page.goto(`${STAFF_BASE}/inventory`);
    await openCorrection(readyItem.item_name);
    await page.getByRole("spinbutton", { name: "Corrected quantity" }).fill("1");
    await page.getByRole("textbox", { name: /Reason/ }).fill("Warehouse recount found extra units");
    await page.getByRole("button", { name: "Review correction" }).click();
    await expect(page.getByText("This correction is blocked.")).toBeVisible();
    await expect(page.getByText(new RegExp(`Request #${readyId}`))).toBeVisible();
  });

  test("doctor history shows scoped frequency totals and CSV export", async ({ request, page }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Doc Hist ${Date.now()}`,
      quantity: 4,
    });
    const created = await request.post(`${API_BASE}/restock-requests`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "doctor history",
        items: [{ inventory_id: item.id, item_name: item.item_name, quantity: 2 }],
      },
    });
    const requestId = (await apiJson(created)).request.id;
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "accepted" },
    });
    await pickRequest(request, operator.token, requestId);
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "ready" },
    });
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: { status: "completed" },
    });

    await injectStaffSession(page, doctor.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/supply-requests`);
    await page.getByRole("button", { name: /^History/ }).click();
    await expect(page.getByText(/requests ·/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Most requested items")).toBeVisible();
    await expect(page.getByText(item.item_name, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    const csvBox = await page.getByRole("button", { name: "Export CSV" }).boundingBox();
    expect(csvBox?.height || 0).toBeGreaterThanOrEqual(44);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByText("Total", { exact: true })).toBeVisible();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  });

  test("operator history filters change displayed records, stats, and stay tappable", async ({
    request,
    page,
  }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Op Filter ${Date.now()}`,
      quantity: 4,
    });
    const created = await request.post(`${API_BASE}/restock-requests`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "operator filters",
        items: [{ inventory_id: item.id, item_name: item.item_name, quantity: 1 }],
      },
    });
    const requestId = (await apiJson(created)).request.id;
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "accepted" },
    });
    await pickRequest(request, operator.token, requestId);
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "ready" },
    });
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: { status: "completed" },
    });

    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await page.getByRole("button", { name: /^History/ }).click();
    await expect(page.getByLabel("Request #")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Operator")).toBeVisible();
    await expect(page.getByLabel("Folder / category")).toBeVisible();
    const categoryLabels = await page.getByLabel("Folder / category").locator("option").allTextContents();
    const visibleCategoryLabels = categoryLabels.filter((label) => label && label !== "All folders");
    expect(new Set(visibleCategoryLabels).size).toBe(visibleCategoryLabels.length);
    await page.getByLabel("Request #").fill(String(requestId));
    await expect(page.getByText("1 filter active")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByText("No history filters applied")).toBeVisible();
    await page.getByLabel("Item").fill(item.item_name);
    await expect(page.getByText(item.item_name).first()).toBeVisible({ timeout: 15_000 });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("button", { name: /Filters/ })).toBeVisible();
    await expect(page.getByLabel("Request #")).toHaveCount(0);
    await page.getByRole("button", { name: /Filters/ }).click();
    await expect(page.getByLabel("Request #")).toBeVisible();
    const requestBox = await page.getByLabel("Request #").boundingBox();
    expect(requestBox?.height || 0).toBeGreaterThanOrEqual(44);
    await page.getByLabel("Request #").fill("preserved-id");
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: /Filters/ }).click();
    await expect(page.getByLabel("Request #")).toHaveValue("preserved-id");
  });

  test("expired stock is badged and excluded from usable availability", async ({ request, page }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const name = `E2E Expired ${Date.now()}`;
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name,
      quantity: 5,
      expiryDate: "2020-01-01",
    });
    const stock = await request.get(`${API_BASE}/inventory`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    const row = (await apiJson(stock)).ocs_stock.find((entry) => entry.id === item.id);
    expect(Number(row.expired_quantity)).toBe(5);
    expect(Number(row.available_to_use)).toBe(0);
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await openStockTab(page);
    await page.getByPlaceholder(/Search by item name/).fill(name);
    const itemRow = page.getByRole("row").filter({ hasText: name }).first();
    await expect(itemRow).toBeVisible({ timeout: 20_000 });
    await expect(itemRow.getByLabel("Stock status: Expired")).toBeVisible();
    await expect(itemRow).toContainText(/ATP:\s*0/);
  });

  test("missing expiry and non-expiring stock use different labels", async ({ request, page }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const missingName = `E2E Missing ${Date.now()}`;
    const nonName = `E2E NonExp ${Date.now()}`;
    await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: missingName,
      quantity: 2,
      expiryDate: null,
    });
    await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: nonName,
      quantity: 2,
      isNonExpiring: true,
    });
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await openStockTab(page);
    await page.getByPlaceholder(/Search by item name/).fill(missingName);
    await expect(page.getByText(missingName).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Expiry missing").first()).toBeVisible();
    await page.getByPlaceholder(/Search by item name/).fill(nonName);
    await expect(page.getByText(nonName).first()).toBeVisible();
    await expect(page.getByText("Non-expiring").first()).toBeVisible();
    await expect(page.getByText("No expiry")).toHaveCount(0);
  });

  test("selected doctor bag summaries never use My Stock and stay consistent", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    const inventory = await request.get(`${API_BASE}/inventory`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    const doctors = (await apiJson(inventory)).doctors || [];
    const doctor = doctors.find((row) => /arun/i.test(row.full_name)) || doctors[0];
    expect(doctor?.id).toBeTruthy();
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await openStockTab(page);
    await page.getByLabel("Stock location").selectOption(String(doctor.id));
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`${doctor.full_name}'s bag`, "i") })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("My Stock")).toHaveCount(0);
    await expect(page.getByText(/Bag low stock|Bag value/i).first()).toBeVisible();
    const missingCard = page.getByRole("button", { name: /Bag missing expiry/i });
    const missingFilter = page.getByRole("button", { name: /Missing expiry \(/ });
    if (await missingCard.count()) {
      const cardText = await missingCard.innerText();
      const filterText = await missingFilter.innerText();
      const cardCount = cardText.match(/(\d+)/)?.[1];
      const filterCount = filterText.match(/(\d+)/)?.[1];
      expect(cardCount).toBe(filterCount);
    }
  });

  test("incomplete pricing is not shown as a complete Rs 0.00 valuation", async ({ request, page }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E Unpriced ${Date.now()}`,
      quantity: 3,
      costPrice: 0,
    });
    await injectStaffSession(page, admin.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await expect(page.getByText("Incomplete").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Warehouse value")).toBeVisible();
  });

  test("unreconciled legacy ready request cannot be collected", async ({ request, page }) => {
    const doctor = await login(request, "arun.dharee");
    const db = openE2eDb();
    const user = db.prepare("SELECT id, doctor_id FROM users WHERE username = 'arun.dharee'").get();
    const requestId = Number(
      db
        .prepare(
          `INSERT INTO restock_requests (doctor_id, requested_by_user_id, collection_date, collection_day, status, note, ready_at)
           VALUES (?, ?, ?, 1, 'ready', 'e2e-legacy-ready', CURRENT_TIMESTAMP)`,
        )
        .run(user.doctor_id, user.id, nextCollectionIso()).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO restock_request_items (request_id, inventory_id, item_name, quantity) VALUES (?, NULL, 'Legacy gauze', 2)`,
    ).run(requestId);
    db.close();
    await injectStaffSession(page, doctor.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STAFF_BASE}/supply-requests`);
    await expect(page.getByText("Legacy – reconciliation required").first()).toBeVisible({ timeout: 20_000 });
    const legacyCard = page.locator("article").filter({ hasText: "Legacy – reconciliation required" }).first();
    await expect(legacyCard.getByRole("button", { name: /Confirm collection|Supply Collected/i })).toHaveCount(0);
    const blocked = await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: { status: "completed" },
    });
    expect(blocked.status()).toBe(409);
  });

  test("admin exceptional actions require a reason and confirmation", async ({ request, page }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E AdminAct ${Date.now()}`,
      quantity: 4,
    });
    await injectStaffSession(page, admin.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await page.getByPlaceholder(/Search by item name/).fill(item.item_name);
    await expect(page.getByText(item.item_name).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Exceptional actions" }).first().click();
    await page.getByRole("menuitem", { name: "Admin override transfer" }).click({ force: true });
    await expect(page.getByText(/exceptional administrator transfer/i)).toBeVisible();
    await page.locator("div.max-h-44 button").first().click();
    await page.getByLabel(/operational override reason/i).fill("Need to move stock for a same-day visit");
    await page.getByRole("button", { name: "Review transfer" }).click();
    await expect(page.getByRole("button", { name: "Confirm admin override transfer" })).toBeVisible();
  });

  test("mobile shipment controls do not overlap", async ({ page, request }) => {
    const admin = await login(request, "shravan.joaheer");
    await injectStaffSession(page, admin.token);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await page.getByRole("tab", { name: /Shipments/i }).click();
    await expect(page.getByLabel(/CSV shipment data/i)).toBeVisible({ timeout: 20_000 });
    const paste = await page.getByLabel(/CSV shipment data/i).boundingBox();
    const override = page.getByText("Operational override reason");
    if (await override.count()) {
      const overrideBox = await override.boundingBox();
      expect((paste?.y || 0) + (paste?.height || 0)).toBeLessThan((overrideBox?.y || 9999) - 4);
    }
    await expect(page.getByRole("button", { name: "Validate preview" })).toBeVisible();
    const validate = await page.getByRole("button", { name: "Validate preview" }).boundingBox();
    expect(validate?.width || 0).toBeGreaterThan(200);
  });

  test("last inventory control scrolls above bottom navigation", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 390, height: 720 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await openStockTab(page);
    const next = page.getByTestId("inventory-pagination").getByRole("button", { name: "Next" });
    await next.scrollIntoViewIfNeeded();
    const box = await next.boundingBox();
    expect(box).toBeTruthy();
    expect((box?.y || 0) + (box?.height || 0)).toBeLessThan(720 - 56);
  });

  test("doctor-bag cards have visible accessible navigation", async ({ request, page }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const inventory = await request.get(`${API_BASE}/inventory`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    const body = await apiJson(inventory);
    const doctor = (body.doctors || []).find((row) => /arun/i.test(row.full_name)) || body.doctors?.[0];
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E BagCard ${Date.now()}`,
      quantity: 3,
    });
    const transferred = await request.post(`${API_BASE}/inventory/restock`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { ocs_item_id: item.id, doctor_id: doctor.id, quantity: 1, confirm: true },
    });
    expect(transferred.ok(), await transferred.text()).toBeTruthy();
    await injectStaffSession(page, admin.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await page.getByRole("tab", { name: /Bags/i }).click();
    const bagCard = page.getByRole("button", { name: /View .* bag/i }).first();
    await expect(bagCard).toBeVisible({ timeout: 20_000 });
    const box = await bagCard.boundingBox();
    expect((box?.height || 0)).toBeGreaterThanOrEqual(44);
    await bagCard.click();
    await expect(page.getByText("My Stock")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: /bag/i })).toBeVisible();
  });

  test("closed mobile navigation is not exposed as active navigation", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await expect(page.getByRole("navigation").getByRole("link", { name: "Inventory" })).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "Navigation menu" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Navigation menu" })).toHaveCount(0);
  });

  test("doctors can open stock history instead of being redirected", async ({ request, page }) => {
    const doctor = await login(request, "arun.dharee");
    await injectStaffSession(page, doctor.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/stock-history`);
    await expect(page).toHaveURL(/\/stock-history/);
    await expect(page.getByRole("heading", { name: "Stock history" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Download CSV" })).toBeVisible();
  });

  test("doctor restock controls are request actions and dirty drafts confirm before close", async ({ request, page }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E RequestPrefill ${Date.now()}`,
      quantity: 6,
    });
    await injectStaffSession(page, doctor.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await expect(page.getByRole("button", { name: "OCS depot" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "OCS depot" }).click();
    await page.getByPlaceholder("Search items").fill(item.item_name);
    await expect(page.getByText(item.item_name).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Restock", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Add to request" }).first().click();
    await expect(page).toHaveURL(/compose=1/);
    await expect(page.getByText(item.item_name).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/ATP/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Discard this request draft/i })).toBeVisible();
    await page.getByRole("button", { name: "Continue editing" }).click();
    await expect(page.getByText(item.item_name).first()).toBeVisible();
  });

  test("doctor bag and depot switching keeps bag-scoped metric labels", async ({ request, page }) => {
    const doctor = await login(request, "arun.dharee");
    await injectStaffSession(page, doctor.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await expect(page.getByRole("button", { name: /My bag at or below par/i })).toBeVisible({ timeout: 20_000 });
    const bagMetric = (await page.getByRole("button", { name: /My bag at or below par/i }).innerText()).replace(/\s+/g, " ");
    await page.getByRole("button", { name: "OCS depot", exact: true }).click();
    await expect(page.getByRole("heading", { name: "OCS depot" }).first()).toBeVisible();
    await expect(page.getByText("Loading inventory workspace")).toHaveCount(0);
    await expect(page.getByText("My bag at or below par")).toBeVisible();
    await expect(page.getByText("Depot can fill")).toBeVisible();
    const depotMetric = (await page.getByRole("button", { name: /My bag at or below par/i }).innerText()).replace(/\s+/g, " ");
    expect(depotMetric).toBe(bagMetric);
  });

  test("reconciliation review opens a preview without mutating stock", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    const admin = await login(request, "shravan.joaheer");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E PreviewRecon ${Date.now()}`,
      quantity: 6,
    });
    const db = openE2eDb();
    const doctorRow = db.prepare("SELECT id, doctor_id FROM users WHERE username = 'arun.dharee'").get();
    const requestId = Number(
      db
        .prepare(
          `INSERT INTO restock_requests (doctor_id, requested_by_user_id, collection_date, collection_day, status, note)
           VALUES (?, ?, ?, 1, 'accepted', 'e2e-preview')`,
        )
        .run(doctorRow.doctor_id, doctorRow.id, nextCollectionIso()).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO restock_request_items (request_id, inventory_id, item_name, quantity) VALUES (?, ?, ?, 2)`,
    ).run(requestId, item.id, item.item_name);
    const beforeEvents = db.prepare("SELECT COUNT(*) AS count FROM restock_request_events WHERE request_id = ?").get(requestId).count;
    db.close();
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await page.getByRole("tab", { name: /Work queues|Queues/i }).click();
    await page.getByRole("button", { name: /Reconciliation required/i }).click();
    await expect(page.getByRole("button", { name: /Open reconciliation|Review reconciliation/i }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Open reconciliation|Review reconciliation/i }).first().click();
    await expect(page.getByRole("button", { name: "Review reconciliation" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Review reconciliation" }).click();
    await expect(page.getByRole("heading", { name: /Review reconciliation/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Confirm reconciliation" })).toBeVisible();
    const dbAfter = openE2eDb();
    const afterEvents = dbAfter.prepare("SELECT COUNT(*) AS count FROM restock_request_events WHERE request_id = ?").get(requestId).count;
    const fulfilments = dbAfter.prepare("SELECT COUNT(*) AS count FROM restock_request_fulfillments WHERE request_id = ?").get(requestId).count;
    dbAfter.close();
    expect(afterEvents).toBe(beforeEvents);
    expect(fulfilments).toBe(0);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: /Review reconciliation/i })).toHaveCount(0);
  });

  test("ready requests hide Claim and editable fulfilment", async ({ request, page }) => {
    const admin = await login(request, "shravan.joaheer");
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const item = await createStockedItem(request, {
      adminToken: admin.token,
      operatorToken: operator.token,
      name: `E2E ReadyLock ${Date.now()}`,
      quantity: 4,
    });
    const created = await request.post(`${API_BASE}/restock-requests`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
      data: {
        collection_date: nextCollectionIso(),
        note: "ready lock",
        items: [{ inventory_id: item.id, item_name: item.item_name, quantity: 1 }],
      },
    });
    const requestId = (await apiJson(created)).request.id;
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "accepted" },
    });
    await pickRequest(request, operator.token, requestId);
    await request.patch(`${API_BASE}/restock-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operator.token}` },
      data: { status: "ready" },
    });
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await page.getByRole("tab", { name: /Work queues|Queues/i }).click();
    await page.getByRole("button", { name: /Awaiting collection/i }).click();
    await expect(page.getByRole("button", { name: "View details" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open fulfilment" })).toHaveCount(0);
  });

  test("mobile stock history renders movement cards", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STAFF_BASE}/stock-history`);
    await expect(page.getByRole("heading", { name: "Stock history" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("table")).toHaveCount(0);
    const card = page.locator("article").filter({ hasText: "Quantity change" }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(/Quantity change/i)).toBeVisible();
    await expect(card.locator("strong.tabular-nums").filter({ hasText: /^[+\u2212]\d+$/ })).toHaveCount(1);
    await expect(card.locator("span.sr-only")).toHaveText(/\((added|removed|unchanged)\)/);
    await expect(card.getByText(/Actor/i)).toBeVisible();
  });

  test("work queues count unique requests and select the first non-empty queue", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    const queues = await request.get(`${API_BASE}/restock-requests/queues`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    const body = await apiJson(queues);
    expect(body.counts.unique_requests).toBeDefined();
    const requestIds = [
      ...(body.new_requests || []),
      ...(body.changes || []),
      ...(body.shortages || []),
      ...(body.pick_today || []),
      ...(body.awaiting_collection || []),
      ...(body.reconciliation_required || []),
    ].map((row) => Number(row.id));
    expect(body.counts.unique_requests).toBe(new Set(requestIds).size);
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await page.getByRole("tab", { name: /Work queues|Queues/i }).click();
    const priority = [
      "Changes",
      "Reconciliation required",
      "Shortages",
      "New requests",
      "Pick today",
      "Awaiting collection",
      "Incoming shipments",
      "Count variances",
    ];
    const counts = body.counts;
    const keys = [
      "changes",
      "reconciliation_required",
      "shortages",
      "new_requests",
      "pick_today",
      "awaiting_collection",
      "incoming_shipments",
      "count_variances",
    ];
    const expected = priority[keys.findIndex((key) => Number(counts[key] || 0) > 0)] || "New requests";
    await expect(page.getByRole("button", { name: new RegExp(expected, "i") }).first()).toHaveAttribute("aria-pressed", "true");
  });

  test("shipment import has an accessible label and disabled import control", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await page.getByRole("tab", { name: /Shipments/i }).click();
    await expect(page.getByLabel(/CSV shipment data/i)).toBeVisible({ timeout: 20_000 });
    const importButton = page.getByRole("button", { name: "Import to staging" });
    await expect(importButton).toBeDisabled();
  });

  test("stocktake requires a chosen scope and confirms full-catalogue sessions", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${STAFF_BASE}/inventory`);
    await page.getByRole("tab", { name: /^Count$/i }).click();
    const start = page.getByRole("button", { name: "Start stocktake" });
    await expect(start).toBeDisabled();
    await page.getByLabel(/Folder \/ category/i).selectOption({ label: "All OCS folders" });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(page.getByRole("dialog").getByText(/blind stocktake session/i)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  });

  test("inventory tabs reveal overflow and keep the page from scrolling sideways", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(`${STAFF_BASE}/inventory`);
    const tablist = page.getByRole("tablist", { name: "Inventory sections" });
    await expect(tablist).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Next inventory tabs" })).toBeVisible();
    await page.getByRole("tab", { name: /Count/i }).click();
    const selected = tablist.getByRole("tab", { selected: true });
    await expect(selected).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBeFalsy();
  });

  test("mobile drawer traps focus and restores it to the menu button", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    await injectStaffSession(page, operator.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STAFF_BASE}/inventory`);
    const menu = page.getByRole("button", { name: "Open menu" });
    await menu.click();
    const dialog = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close menu" })).toBeFocused();
    await expect(page.locator("#ocs-app-main")).toHaveAttribute("inert", "");
    await expect(page.locator("#ocs-mobile-topbar")).toHaveAttribute("inert", "");
    await expect(page.locator("#ocs-app-main")).toHaveAttribute("aria-hidden", "true");
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(menu).toBeFocused();
    await expect(page.locator("#ocs-app-main")).not.toHaveAttribute("inert");
    await expect(page.locator("#ocs-mobile-topbar")).not.toHaveAttribute("inert");
    await menu.click();
    await expect(dialog).toBeVisible();
    await expect(page.locator("#ocs-app-main")).toHaveAttribute("inert", "");
    await page.keyboard.press("Escape");
    await expect(page.locator("#ocs-app-main")).not.toHaveAttribute("inert");
    await expect(page.locator("#ocs-app-main")).not.toHaveAttribute("aria-hidden");
    await menu.click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ocs-app-main")).not.toHaveAttribute("inert");
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    await expect(menu).toBeFocused();
  });

  test("fixed bottom navigation does not cover the last queue control", async ({ request, page }) => {
    const operator = await login(request, "operator01");
    await injectStaffSession(page, operator.token);
    for (const width of [320, 390, 500]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${STAFF_BASE}/inventory`);
      await page.getByRole("tab", { name: /Work queues|Queues/i }).click();
      const last = page.getByRole("button", { name: /History/i });
      await last.scrollIntoViewIfNeeded();
      const box = await last.boundingBox();
      const nav = page.getByRole("navigation").last();
      const navBox = await nav.boundingBox();
      expect(box).toBeTruthy();
      expect(navBox).toBeTruthy();
      expect((box.y || 0) + (box.height || 0)).toBeLessThanOrEqual((navBox.y || 0) + 1);
    }
  });
});
