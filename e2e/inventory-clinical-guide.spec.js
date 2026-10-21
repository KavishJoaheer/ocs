import { test, expect } from "@playwright/test";

const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
test.use({ actionTimeout: 15000 });

async function login(request, username) {
  const response = await request.post(`${API}/auth/login`, { data: { username, password: "Welcome@123" } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

for (const width of [390, 1280]) {
  test(`Buscopan backend Clinical guide is read-only in warehouse and doctor bag at ${width}px`, async ({ page, request, browser }) => {
    await page.setViewportSize({ width, height: 900 });
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const headers = { Authorization: `Bearer ${operator.token}` };
    const catalogue = await (await request.get(`${API}/inventory`, { headers })).json();
    const name = "Buscopan 20mg (IM/IV)";
    let item = catalogue.ocs_stock.find(row => row.item_name === name);
    if (!item) {
      const created = await request.post(`${API}/inventory/items`, { headers, data: {
        item_name: name, attributes: "Hyoscine Butylbromide", folder_id: catalogue.folders.find(row => row.name === "Consumable").id,
        quantity: 0, minimum_quantity: 1, unit: "ampoule", cost_price: 5, selling_price: 10,
      } });
      expect(created.ok(), await created.text()).toBeTruthy();
      item = (await created.json()).ocs_stock.find(row => row.item_name === name);
    }
    expect(item.clinical_guide.dose).toBe("20 mg");
    const received = await request.post(`${API}/inventory/items/${item.id}/ocs-actions`, { headers, data: {
      action_type: "stock_in", quantity: 5, actual_batch_cost: 5, expiry_date: "2029-06-01",
      supplier_name: "Clinical guide preview", received_date: new Date().toISOString().slice(0, 10),
    } });
    expect(received.ok(), await received.text()).toBeTruthy();
    const transferred = await request.post(`${API}/inventory/restock`, { headers, data: { ocs_item_id: item.id, doctor_id: doctor.user.doctor_id, quantity: 2, confirm: true } });
    expect(transferred.ok(), await transferred.text()).toBeTruthy();
    const before = (await transferred.json()).ocs_stock.find(row => row.id === item.id);
    await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), operator.token);
    await page.goto(`${STAFF}/inventory?tab=stock`);
    if (width < 1024) await page.getByRole("combobox", { name: "Inventory section", exact: true }).selectOption("stock");
    else await page.getByRole("tab", { name: "Stock", exact: true }).click();
    await page.getByRole("textbox", { name: "Search stock items", exact: true }).fill(name);
    const guideButton = page.getByRole("button", { name: `Clinical guide for ${name}`, exact: true });
    await guideButton.click();
    const guide = page.getByRole("dialog", { name: "Clinical guide", exact: true });
    await expect(guide.getByText("20 mg", { exact: true })).toBeVisible();
    await expect(guide).toContainText("100 mg / 24 h");
    await expect(guide).toContainText("Source updated 5 Jan 2026.");
    await expect(guide.getByRole("textbox")).toHaveCount(0);
    await guide.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(guideButton).toBeFocused();
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole(width < 1024 ? "button" : "menuitem", { name: "Edit catalogue item", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit catalogue item", exact: true });
    await expect(editor.getByRole("tab", { name: "Clinical guide", exact: true })).toHaveCount(0);
    await expect(editor.getByLabel("Dose", { exact: true })).toHaveCount(0);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();

    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      await context.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), doctor.token);
      const bag = await context.newPage();
      await bag.goto(`${STAFF}/inventory`);
      const searchLabel = width < 1024 ? "Search inventory items" : "Search stock items";
      await bag.getByRole("textbox", { name: searchLabel, exact: true }).fill(name);
      await bag.getByRole("button", { name: `Clinical guide for ${name}`, exact: true }).click();
      const bagGuide = bag.getByRole("dialog", { name: "Clinical guide", exact: true });
      await expect(bagGuide.getByText("20 mg", { exact: true })).toBeVisible();
      await expect(bagGuide).toContainText("After 30 minutes");
      await expect(bagGuide).toContainText("do not administer to patients taking anticoagulants");
      await expect(bagGuide).toContainText("Draft · clinical review pending");
      await expect(bagGuide.getByRole("link", { name: /Buscopan Ampoules/ })).toHaveAttribute("href", "https://www.medicines.org.uk/emc/product/890/smpc");
      await expect(bagGuide.getByRole("textbox")).toHaveCount(0);
      await expect(bagGuide.getByText("Dry mouth, blurred vision, tachycardia, constipation and urinary retention.", { exact: true })).toBeHidden();
      await bagGuide.locator("summary").filter({ hasText: "Side effects" }).click();
      await expect(bagGuide.getByText("Dry mouth, blurred vision, tachycardia, constipation and urinary retention.", { exact: true })).toBeVisible();
      expect(await bag.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const bounds = await bagGuide.boundingBox();
      if (width < 1024) expect(Math.round(bounds.width)).toBe(width);
      else expect(Math.round(bounds.x + bounds.width)).toBe(width);
      await bag.screenshot({ path: `/tmp/ocs-buscopan-backend-guide-${width}.png`, fullPage: true });
      await bag.reload();
      await bag.getByRole("textbox", { name: searchLabel, exact: true }).fill(name);
      await bag.getByRole("button", { name: `Clinical guide for ${name}`, exact: true }).click();
      await expect(bag.getByRole("dialog", { name: "Clinical guide", exact: true })).toContainText("100 mg / 24 h");
    } finally { await context.close(); }
    const after = await (await request.get(`${API}/inventory`, { headers })).json();
    expect(after.ocs_stock.find(row => row.id === item.id).quantity).toBe(before.quantity);
  });
}
