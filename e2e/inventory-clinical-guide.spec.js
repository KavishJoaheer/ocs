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
  test(`catalogue Clinical guide saves and is readable from the doctor bag at ${width}px`, async ({ page, request, browser }) => {
    await page.setViewportSize({ width, height: 900 });
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const headers = { Authorization: `Bearer ${operator.token}` };
    const catalogue = await (await request.get(`${API}/inventory`, { headers })).json();
    const name = `Clinical guide ${width} ${Date.now()}`;
    const created = await request.post(`${API}/inventory/items`, { headers, data: {
      item_name: name, attributes: "Sample ingredient", folder_id: catalogue.folders.find(row => row.name === "Consumable").id,
      quantity: 0, minimum_quantity: 1, unit: "ampoule", cost_price: 5, selling_price: 10,
    } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const item = (await created.json()).ocs_stock.find(row => row.item_name === name);
    const received = await request.post(`${API}/inventory/items/${item.id}/ocs-actions`, { headers, data: {
      action_type: "stock_in", quantity: 5, actual_batch_cost: 5, expiry_date: "2029-06-01",
      supplier_name: "Clinical guide preview", received_date: new Date().toISOString().slice(0, 10),
    } });
    expect(received.ok(), await received.text()).toBeTruthy();
    const transferred = await request.post(`${API}/inventory/restock`, { headers, data: { ocs_item_id: item.id, doctor_id: doctor.user.doctor_id, quantity: 2, confirm: true } });
    expect(transferred.ok(), await transferred.text()).toBeTruthy();
    await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), operator.token);
    await page.goto(`${STAFF}/inventory?tab=stock`);
    if (width < 1024) await page.getByRole("combobox", { name: "Inventory section", exact: true }).selectOption("stock");
    else await page.getByRole("tab", { name: "Stock", exact: true }).click();
    await page.getByRole("textbox", { name: "Search stock items", exact: true }).fill(name);
    const guideButton = page.getByRole("button", { name: `Clinical guide for ${name}`, exact: true });
    await guideButton.click();
    let guide = page.getByRole("dialog", { name: "Clinical guide", exact: true });
    await expect(guide).toContainText("No clinical guide has been added yet.");
    await guide.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(guideButton).toBeFocused();
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole(width < 1024 ? "button" : "menuitem", { name: "Edit catalogue item", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit catalogue item", exact: true });
    await editor.getByRole("tab", { name: "Clinical guide", exact: true }).click();
    for (const [label, text] of [
      ["Strength / presentation", "Example presentation"], ["Patient group", "Adults"], ["Routes", "IM / IV"],
      ["Dose", "Reference dose"], ["Dose detail", "Formulation-specific detail"], ["Repeat interval", "Reference interval"],
      ["Maximum dose", "Reference maximum"], ["Administration cautions", "IV precautions\nIM precautions"],
      ["Contraindications", "Reference contraindications"], ["Indications", "Reference indications"],
      ["Side effects", "Reference side effects"], ["Drug class & pharmacology", "Reference pharmacology"],
      ["Source name", "Example product reference"], ["Source link (HTTPS)", "https://example.test/product"],
    ]) await editor.getByLabel(label, { exact: true }).fill(text);
    const saved = page.waitForResponse(response => response.url().includes(`/inventory/items/${item.id}`) && response.request().method() === "PUT");
    await editor.getByRole("button", { name: "Update item", exact: true }).click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBeTruthy();
    await expect(editor).toBeHidden();
    await guideButton.click();
    await expect(guide).toContainText("Reference dose");
    await expect(guide).toContainText("Draft · clinical review pending");
    await expect(guide.getByRole("link", { name: /Example product reference/ })).toHaveAttribute("href", "https://example.test/product");
    await page.keyboard.press("Escape");
    await expect(guide).toBeHidden();

    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      await context.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), doctor.token);
      const bag = await context.newPage();
      await bag.goto(`${STAFF}/inventory`);
      await bag.getByRole("textbox", { name: width < 1024 ? "Search inventory items" : "Search stock items", exact: true }).fill(name);
      await bag.getByRole("button", { name: `Clinical guide for ${name}`, exact: true }).click();
      guide = bag.getByRole("dialog", { name: "Clinical guide", exact: true });
      await expect(guide).toContainText("Reference dose");
      await expect(guide).toContainText("Reference contraindications");
      await expect(guide).toContainText("IV precautions\nIM precautions");
      await expect(guide.getByText("Reference side effects", { exact: true })).toBeHidden();
      await guide.locator("summary").filter({ hasText: "Side effects" }).click();
      await expect(guide.getByText("Reference side effects", { exact: true })).toBeVisible();
      expect(await bag.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const bounds = await guide.boundingBox();
      expect(bounds.width).toBeLessThanOrEqual(width);
      if (width < 1024) expect(Math.round(bounds.width)).toBe(width);
      else expect(Math.round(bounds.x + bounds.width)).toBe(width);
      await bag.screenshot({ path: `/tmp/ocs-clinical-guide-app-${width}.png`, fullPage: true });
      await bag.reload();
      await bag.getByRole("textbox", { name: width < 1024 ? "Search inventory items" : "Search stock items", exact: true }).fill(name);
      await bag.getByRole("button", { name: `Clinical guide for ${name}`, exact: true }).click();
      await expect(bag.getByRole("dialog", { name: "Clinical guide", exact: true })).toContainText("Reference maximum");
    } finally { await context.close(); }
    const after = await (await request.get(`${API}/inventory`, { headers })).json();
    expect(after.ocs_stock.find(row => row.id === item.id).quantity).toBe(3);
  });
}
