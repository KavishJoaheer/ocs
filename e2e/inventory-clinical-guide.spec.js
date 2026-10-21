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
  test(`Tramadol and Valium guides keep adult and paediatric instructions separate at ${width}px`, async ({ page, request }) => {
    // Keep screenshot capture independent of external font-service availability.
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.setViewportSize({ width, height: 900 });
    const operator = await login(request, "operator01");
    const headers = { Authorization: `Bearer ${operator.token}` };
    const catalogue = await (await request.get(`${API}/inventory`, { headers })).json();
    await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), operator.token);
    for (const [name, ingredient, adultLabel, paediatricLabel, warningText] of [
      ["Tramadol 100mg/2ml", "Tramadol hydrochloride", "Post-operative loading · monitored protocol only", "Adolescents older than 12 years · UK injection reference", "Under 12 years"],
      ["Valium", "Diazepam", "Delirium tremens", "Seizures · 1 month–11 years · IV", "Neonates: no routine quick-card dose"],
    ]) {
      if (!catalogue.ocs_stock.some(row => row.item_name === name)) {
        const created = await request.post(`${API}/inventory/items`, { headers, data: {
          item_name: name, attributes: "", folder_id: catalogue.folders.find(row => row.name === "IM Drugs").id,
          quantity: 0, minimum_quantity: 1, unit: "ampoule", cost_price: 5, selling_price: 10,
        } });
        expect(created.ok(), await created.text()).toBeTruthy();
      }
      await page.goto(`${STAFF}/inventory?tab=stock`);
      if (width < 1024) await page.getByRole("combobox", { name: "Inventory section", exact: true }).selectOption("stock");
      else await page.getByRole("tab", { name: "Stock", exact: true }).click();
      await page.getByRole("textbox", { name: "Search stock items", exact: true }).fill(name);
      await page.getByRole("button", { name: `Clinical guide for ${name}`, exact: true }).click();
      const guide = page.getByRole("dialog", { name: "Clinical guide", exact: true });
      await expect(guide.getByText(ingredient, { exact: true })).toBeVisible();
      await expect(guide.getByRole("region", { name: adultLabel, exact: true })).toBeVisible();
      await expect(guide.getByRole("textbox")).toHaveCount(0);
      await expect(guide).toContainText("Draft · clinical review pending");
      await guide.getByRole("button", { name: "Paediatrics", exact: true }).click();
      await expect(guide.getByRole("region", { name: adultLabel, exact: true })).toHaveCount(0);
      await expect(guide.getByRole("region", { name: paediatricLabel, exact: true })).toBeVisible();
      const warning = guide.getByRole("region", { name: "Critical safety warnings", exact: true });
      await expect(warning).toContainText(warningText);
      expect((await warning.boundingBox()).y).toBeLessThan((await guide.getByRole("region", { name: "Dosing reference", exact: true }).boundingBox()).y);
      if (name === "Valium") {
        await expect(guide).toContainText("this injection card does not supply rectal dosing");
        await expect(guide).toContainText("Flumazenil is not routine rescue");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await guide.screenshot({ path: `/tmp/ocs-${name === "Valium" ? "diazepam" : "tramadol"}-paediatric-guide-${width}.png` });
      await guide.getByRole("button", { name: "Adults", exact: true }).click();
      await expect(guide.getByRole("region", { name: adultLabel, exact: true })).toBeVisible();
      await expect(guide.getByRole("region", { name: paediatricLabel, exact: true })).toHaveCount(0);
      await guide.getByRole("button", { name: "Close dialog", exact: true }).click();
    }
  });
}

for (const width of [390, 1280]) {
  test(`Phenergan guide shows UK dosing and critical warnings before dosing at ${width}px`, async ({ page, request, browser }) => {
    await page.setViewportSize({ width, height: 900 });
    const operator = await login(request, "operator01");
    const doctor = await login(request, "arun.dharee");
    const headers = { Authorization: `Bearer ${operator.token}` };
    const catalogue = await (await request.get(`${API}/inventory`, { headers })).json();
    const name = "Phenergan 50mg/2ml (IM/IV)";
    let item = catalogue.ocs_stock.find(row => row.item_name === name);
    if (!item) {
      const created = await request.post(`${API}/inventory/items`, { headers, data: {
        item_name: name, attributes: "", folder_id: catalogue.folders.find(row => row.name === "Consumable").id,
        quantity: 0, minimum_quantity: 1, unit: "ampoule", cost_price: 5, selling_price: 10,
      } });
      expect(created.ok(), await created.text()).toBeTruthy();
      item = (await created.json()).ocs_stock.find(row => row.item_name === name);
    }
    const received = await request.post(`${API}/inventory/items/${item.id}/ocs-actions`, { headers, data: {
      action_type: "stock_in", quantity: 5, actual_batch_cost: 5, expiry_date: "2029-06-01",
      supplier_name: "Clinical guide test", received_date: new Date().toISOString().slice(0, 10),
    } });
    expect(received.ok(), await received.text()).toBeTruthy();
    const transferred = await request.post(`${API}/inventory/restock`, { headers, data: { ocs_item_id: item.id, doctor_id: doctor.user.doctor_id, quantity: 2, confirm: true } });
    expect(transferred.ok(), await transferred.text()).toBeTruthy();
    await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), operator.token);
    await page.goto(`${STAFF}/inventory?tab=stock`);
    if (width < 1024) await page.getByRole("combobox", { name: "Inventory section", exact: true }).selectOption("stock");
    else await page.getByRole("tab", { name: "Stock", exact: true }).click();
    await page.getByRole("textbox", { name: "Search stock items", exact: true }).fill(name);
    if (width < 1024) await expect(page.getByText("Promethazine", { exact: true })).toBeVisible();
    else {
      await page.getByRole("button", { name: `Show details for ${name}`, exact: true }).click();
      await expect(page.getByText("Attributes: Promethazine", { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: `Clinical guide for ${name}`, exact: true }).click();
    const guide = page.getByRole("dialog", { name: "Clinical guide", exact: true });
    await expect(guide.getByText("Promethazine", { exact: true })).toBeVisible();
    const warning = guide.getByRole("region", { name: "Critical safety warnings", exact: true });
    await expect(warning).toContainText("Stop IV injection immediately if pain occurs");
    await expect(guide.getByText("25–50 mg", { exact: true })).toBeVisible();
    expect((await warning.boundingBox()).y).toBeLessThan((await guide.getByRole("region", { name: "Dosing reference", exact: true }).boundingBox()).y);
    await expect(guide).toContainText("10 times the original volume with water for injections");
    await expect(guide).toContainText("IM adrenaline is first-line");
    await expect(guide.getByRole("textbox")).toHaveCount(0);
    await expect(guide.getByRole("link", { name: "Phenergan injection · UK SmPC ↗", exact: true })).toHaveAttribute("href", "https://www.medicines.org.uk/emc/product/1100/smpc");
    await guide.getByRole("button", { name: "Paediatrics", exact: true }).click();
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("Under 2 years: CONTRAINDICATED");
    await expect(warning).toContainText("potentially fatal respiratory depression");
    await expect(guide.getByRole("region", { name: "5–10 years · UK injection guidance", exact: true })).toContainText("6.25–12.5 mg");
    await expect(guide.getByRole("region", { name: "Over 10 years · UK injection leaflet", exact: true })).toContainText("25–50 mg");
    await expect(guide).toContainText("Age 2–4 years: no dose supplied");
    await expect(guide).not.toContainText("10 times the original volume");
    await expect(guide.getByRole("link", { name: /Paediatric age bands/ })).toHaveAttribute("href", "https://www.medicines.org.uk/emc/product/1100/pil");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await guide.screenshot({ path: `/tmp/ocs-phenergan-paediatric-guide-${width}.png` });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      await context.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), doctor.token);
      const bag = await context.newPage();
      await bag.goto(`${STAFF}/inventory`);
      await bag.getByRole("textbox", { name: width < 1024 ? "Search inventory items" : "Search stock items", exact: true }).fill(name);
      await bag.getByRole("button", { name: `Clinical guide for ${name}`, exact: true }).click();
      const bagGuide = bag.getByRole("dialog", { name: "Clinical guide", exact: true });
      await expect(bagGuide.getByText("Promethazine", { exact: true })).toBeVisible();
      await expect(bagGuide).toContainText("Severe tissue injury");
      await bagGuide.getByRole("button", { name: "Paediatrics", exact: true }).click();
      await expect(bagGuide).toContainText("Under 2 years: CONTRAINDICATED");
      await expect(bagGuide.getByRole("textbox")).toHaveCount(0);
    } finally { await context.close(); }
  });

  test(`Emetino guide separates adult indications and dose limits at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const operator = await login(request, "operator01");
    const headers = { Authorization: `Bearer ${operator.token}` };
    const catalogue = await (await request.get(`${API}/inventory`, { headers })).json();
    const name = "Emetino 4mg (IV/IM) box of 10";
    if (!catalogue.ocs_stock.some(row => row.item_name === name)) {
      const created = await request.post(`${API}/inventory/items`, { headers, data: {
        item_name: name, attributes: "Ondansetron", folder_id: catalogue.folders.find(row => row.name === "Consumable").id,
        quantity: 0, minimum_quantity: 1, unit: "ampoule", cost_price: 5, selling_price: 10,
      } });
      expect(created.ok(), await created.text()).toBeTruthy();
    }
    await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), operator.token);
    await page.goto(`${STAFF}/inventory?tab=stock`);
    if (width < 1024) await page.getByRole("combobox", { name: "Inventory section", exact: true }).selectOption("stock");
    else await page.getByRole("tab", { name: "Stock", exact: true }).click();
    await page.getByRole("textbox", { name: "Search stock items", exact: true }).fill(name);
    await page.getByRole("button", { name: `Clinical guide for ${name}`, exact: true }).click();
    const guide = page.getByRole("dialog", { name: "Clinical guide", exact: true });
    await expect(guide.getByRole("region", { name: "Post-operative nausea & vomiting (PONV)", exact: true })).toContainText("4 mg");
    await expect(guide.getByRole("region", { name: "Chemotherapy / radiotherapy (CINV/RINV)", exact: true })).toContainText("8 mg");
    await expect(guide.getByRole("region", { name: "Highly emetogenic chemotherapy", exact: true })).toContainText("IV infusion over at least 15 minutes");
    await expect(guide).toContainText("Moderate or severe hepatic impairment: maximum 8 mg total / 24 h");
    await expect(guide).toContainText("Age 75+ with CINV/RINV: initial IV dose must not exceed 8 mg");
    await expect(guide).toContainText("concomitant apomorphine");
    await expect(guide.getByText(/QT prolongation: avoid/)).toBeVisible();
    await expect(guide.getByRole("textbox")).toHaveCount(0);
    await expect(guide).toContainText("Draft · clinical review pending");
    await expect(guide.getByRole("link", { name: /Ondansetron injection/ })).toHaveAttribute("href", "https://www.medicines.org.uk/emc/product/13193/smpc");
    await guide.locator("summary").filter({ hasText: "Side effects" }).click();
    await expect(guide.getByText(/Headache, constipation and warmth/)).toBeVisible();
    await guide.getByRole("button", { name: "Paediatrics", exact: true }).click();
    await expect(guide.getByRole("button", { name: "Paediatrics", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(guide.getByRole("heading", { name: "Dose · Paediatrics", exact: true })).toBeVisible();
    await expect(guide.getByRole("region", { name: "PONV · 1 month–17 years", exact: true })).toContainText("0.1 mg/kg");
    await expect(guide.getByRole("region", { name: "CINV · 6 months–17 years", exact: true })).toContainText("maximum 8 mg per dose");
    await expect(guide.getByRole("region", { name: /Acute emesis/ })).toHaveCount(0);
    await expect(guide).toContainText("Gastroenteritis is an off-label indication");
    await expect(guide).toContainText("no general IV gastroenteritis dose is supplied here");
    await expect(guide.getByRole("region", { name: "Highly emetogenic chemotherapy", exact: true })).toHaveCount(0);
    await expect(guide).not.toContainText("Age 75+");
    await expect(guide.getByText(/Doses above 8 mg, or any IV dose/)).toHaveCount(0);
    await expect(guide.getByText(/Headache, constipation and warmth/)).toBeHidden();
    await expect(guide.getByRole("link", { name: /NICE ESUOM34/ })).toHaveAttribute("href", /www.nice.org.uk\/advice\/esuom34/);
    await expect(guide).not.toContainText("Queensland");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await guide.screenshot({ path: `/tmp/ocs-emetino-paediatric-guide-${width}.png` });
    await guide.getByRole("button", { name: "Adults", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(guide.getByRole("button", { name: "Adults", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(guide.getByRole("heading", { name: "Dose · Adults", exact: true })).toBeVisible();
    await expect(guide.getByRole("region", { name: "PONV · 1 month–17 years", exact: true })).toHaveCount(0);
    await expect(guide.getByRole("link", { name: /NICE ESUOM34/ })).toHaveCount(0);
    await guide.getByRole("heading", { name: "Dose · Adults", exact: true }).scrollIntoViewIfNeeded();
    await guide.screenshot({ path: `/tmp/ocs-emetino-backend-guide-${width}.png` });
    await guide.getByRole("button", { name: "Paediatrics", exact: true }).click();
    await guide.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.getByRole("button", { name: `Clinical guide for ${name}`, exact: true }).click();
    await expect(guide.getByRole("heading", { name: "Dose · Adults", exact: true })).toBeVisible();
  });

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
    await expect(guide.getByRole("group", { name: "Patient group", exact: true })).toHaveCount(0);
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
