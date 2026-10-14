import { test, expect } from "@playwright/test";

const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const roles = [
  { role: "doctor", username: "arun.dharee", groups: ["Patient care", "Finance", "Stock & supplies"],
    paths: ["/", "/action-inbox", "/patients", "/visit-requests", "/teleconsultations", "/appointments", "/doctor/long-term-review", "/billing", "/live-report", "/inventory", "/supply-requests", "/stock-history", "/hcm-news"] },
  { role: "operator", username: "operator01", groups: ["Patient care", "Finance", "Stock & supplies"],
    paths: ["/", "/action-inbox", "/patients", "/visit-requests", "/teleconsultations", "/operator/long-term-review", "/billing", "/operator/pending-payment", "/inventory", "/supply-requests", "/stock-history", "/hcm-news"] },
  { role: "admin", username: "shravan.joaheer", groups: ["Patient care", "Finance", "Stock & supplies", "Administration"],
    paths: ["/", "/action-inbox", "/patients", "/visit-requests", "/teleconsultations", "/appointments", "/admin/long-term-review", "/admin/finance", "/admin/accounts", "/live-report", "/inventory", "/stock-history", "/team-operations", "/patient-care-content", "/hcm-news"] },
  { role: "lab", username: "labtech01", groups: ["Patient care"], paths: ["/", "/action-inbox", "/patients", "/hcm-news"] },
  { role: "accountant", username: "accountant01", groups: ["Finance"], paths: ["/", "/admin/finance", "/admin/accounts", "/hcm-news"] },
];

async function session(page, request, username, width) {
  await page.setViewportSize({ width, height: 1000 });
  const response = await request.post(`${API}/auth/login`, { data: { username, password: "Welcome@123" } });
  expect(response.ok()).toBeTruthy();
  const { token } = await response.json();
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), token);
  await page.goto(`${STAFF}/`);
}

for (const actor of roles) {
  test(`${actor.role} desktop menu groups all permitted links in workflow order`, async ({ page, request }, testInfo) => {
    await session(page, request, actor.username, 1440);
    const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("heading")).toHaveText(actor.groups);
    expect(await nav.getByRole("link").evaluateAll(links => links.map(link => link.getAttribute("href")))).toEqual(actor.paths);
    await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
    for (const group of actor.groups) await expect(nav.getByRole("region", { name: group, exact: true }).getByRole("link").first()).toBeVisible();
    expect(await nav.getByRole("link").evaluateAll(links => links.every(link => link.getBoundingClientRect().height >= 44))).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    if (["doctor", "operator"].includes(actor.role)) {
      await expect(nav.getByRole("region", { name: "Patient care", exact: true }).getByRole("link", { name: /^Home Visit Request/ })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Teleconsultations", exact: true })).toBeVisible();
      await nav.getByRole("link", { name: /^Pending actions/ }).click();
      await expect(page).toHaveURL(`${STAFF}/action-inbox`);
      await expect(nav.getByRole("link", { name: /^Pending actions/ })).toHaveAttribute("aria-current", "page");
      await page.getByRole("complementary", { name: "Desktop navigation", exact: true }).screenshot({ path: testInfo.outputPath(`${actor.role}-grouped-sidebar.png`) });
    }
  });
}

for (const actor of roles.slice(0, 2)) {
  test(`${actor.role} phone menu keeps role shortcuts and grouped links accessible`, async ({ page, request }) => {
    await session(page, request, actor.username, 390);
    const bottom = page.locator("#ocs-bottom-nav");
    await expect(bottom.getByRole("link")).toHaveText(actor.role === "doctor"
      ? ["Home", "Patients", "Home Visit Request", "Inventory"] : ["Home", "Add patient", "Reviews"]);
    const open = page.getByRole("button", { name: "Open menu", exact: true });
    await open.click();
    const drawer = page.getByRole("dialog", { name: "Navigation menu", exact: true });
    const nav = drawer.getByRole("navigation", { name: "Additional navigation", exact: true });
    await expect(nav.getByRole("heading")).toHaveText(actor.role === "doctor" ? actor.groups : ["Patient care"]);
    await expect(nav.getByRole("link").first()).toHaveAttribute("href", "/action-inbox");
    await expect(nav.getByRole("link", { name: "Teleconsultations", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Billing", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Patients", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(open).toBeFocused();
    await open.click();
    await nav.getByRole("link", { name: /^Pending actions/ }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(`${STAFF}/action-inbox`);
    await expect(page.getByRole("heading", { name: "Pending actions", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
