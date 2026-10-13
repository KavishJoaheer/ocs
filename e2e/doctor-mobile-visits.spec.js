import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";

const STAFF_BASE = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API_BASE = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;

const fixtureVisitIds = [];
test.afterEach(() => {
  const db = openE2eDb();
  try {
    for (const id of fixtureVisitIds) db.prepare("DELETE FROM visit_requests WHERE id = ?").run(id);
    fixtureVisitIds.length = 0;
  } finally {
    db.close();
  }
});

async function prepareVisits(page, request) {
  const login = await request.post(`${API_BASE}/auth/login`, {
    data: { username: "arun.dharee", password: "Welcome@123" },
  });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const registration = await request.post(`${API_BASE}/patient-auth/register`, {
    data: {
      email: `mobile-visits-${uniqueId}@test.local`, password: "secret123",
      full_name: "Amelia Marie Ramgoolam", phone: "57001122", national_id: `MV-${uniqueId}`,
    },
  });
  expect(registration.ok(), await registration.text()).toBeTruthy();
  const patient = await registration.json();
  const db = openE2eDb();
  let visitId;
  try {
    const insert = db.prepare(`INSERT INTO visit_requests
      (patient_id, assigned_doctor_id, status, address, reason, urgency)
      VALUES (?, ?, ?, ?, ?, ?)`);
    visitId = Number(insert.run(patient.user.patient_id, session.user.doctor_id, "assigned",
      "12 Avenue des Flamboyants, Quatre Bornes, Mauritius", "Fever and persistent cough since yesterday", "urgent").lastInsertRowid);
    fixtureVisitIds.push(visitId);
    const cancelled = insert.run(patient.user.patient_id, session.user.doctor_id, "cancelled",
      "12 Avenue des Flamboyants, Quatre Bornes, Mauritius", "Previous visit cancelled", "routine");
    fixtureVisitIds.push(Number(cancelled.lastInsertRowid));
  } finally {
    db.close();
  }
  await page.addInitScript((token) => localStorage.setItem("ocs_medecins_auth_token", token), session.token);
  return { visitId, session };
}

for (const width of [360, 430]) {
  test(`doctor mobile visits stay focused and support the full visit flow at ${width}px`, async ({ page, request }) => {
    const { visitId, session } = await prepareVisits(page, request);
    await page.setViewportSize({ width, height: 932 });
    await page.goto(`${STAFF_BASE}/visit-requests`);
    await expect(page.getByRole("heading", { name: "Visit requests", exact: true })).toBeVisible();
    const bottom = page.locator("#ocs-bottom-nav");
    await expect(bottom.getByRole("link")).toHaveCount(4);
    await expect(bottom.getByRole("link", { name: "Visits", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Live board" })).toHaveCount(0);
    await expect(page.getByLabel("From", { exact: true })).toBeHidden();
    const card = page.getByRole("region", { name: "Active visits", exact: true }).getByRole("article")
      .filter({ hasText: "Fever and persistent cough since yesterday" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("link", { name: "Call Amelia Marie Ramgoolam" })).toHaveAttribute("href", "tel:57001122");
    await expect(card.getByRole("link", { name: "Directions" })).toHaveAttribute("href", /google.com\/maps\/search/);
    await expect(card.getByLabel("ETA in minutes")).toBeHidden();
    const action = card.getByRole("button", { name: "I'm on my way", exact: true });
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y + box.height).toBeLessThan(820);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/ocs-doctor-visits-${width}.png`, fullPage: true });

    await card.getByText("ETA & team notes", { exact: true }).click();
    await card.getByLabel("ETA in minutes").fill("25");
    await card.getByLabel("Team notes", { exact: true }).fill("Patient called. Entrance beside the pharmacy.");
    await card.getByRole("button", { name: "Save details", exact: true }).click();
    await expect(card.getByText("25 min ETA", { exact: true })).toBeVisible();
    await page.reload();
    await card.getByText("ETA & team notes", { exact: true }).click();
    await expect(card.getByLabel("Team notes", { exact: true })).toHaveValue("Patient called. Entrance beside the pharmacy.");
    await card.getByText("ETA & team notes", { exact: true }).click();

    // A rejected update must restore the current status and allow retry.
    await page.route(`**/api/visit-requests/${visitId}`, (route) => route.fulfill({
      status: 500, contentType: "application/json", body: JSON.stringify({ error: "Please retry this visit update." }),
    }), { times: 1 });
    await action.click();
    await expect(page.getByText("Please retry this visit update.", { exact: true })).toBeVisible();
    await expect(action).toBeEnabled();
    await action.click();
    await expect(card.getByRole("button", { name: "I've arrived", exact: true })).toBeEnabled();
    await card.getByRole("button", { name: "I've arrived", exact: true }).click();
    await expect(card.getByRole("button", { name: "Start consultation", exact: true })).toBeEnabled();
    await card.getByRole("button", { name: "Start consultation", exact: true }).click();
    await expect(card.getByRole("button", { name: "Complete visit", exact: true })).toBeEnabled();
    await card.getByRole("button", { name: "Complete visit", exact: true }).click();
    await expect(page).toHaveURL(/\/consultations\/\d+/);
    const response = await request.get(`${API_BASE}/visit-requests?status=completed`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect((await response.json()).visit_requests.some((visit) => visit.id === visitId)).toBeTruthy();

    await page.goto(`${STAFF_BASE}/visit-requests`);
    await page.getByRole("button", { name: "History", exact: true }).click();
    const history = page.getByRole("region", { name: "Visit history", exact: true });
    await expect(history.getByText("Previous visit cancelled", { exact: true })).toBeVisible();
    await expect(history.getByRole("button", { name: "Complete visit", exact: true })).toHaveCount(0);
    await page.getByText("Filter by date", { exact: true }).click();
    await page.getByLabel("From", { exact: true }).fill("2040-01-01");
    await page.getByLabel("To", { exact: true }).fill("2040-01-02");
    await page.getByRole("button", { name: "Apply dates", exact: true }).click();
    await expect(page.getByText("No visits match these dates", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear dates", exact: true }).click();
    await expect(history.getByText("Previous visit cancelled", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Active visits", exact: true }).click();
    await expect(page.getByText("No active visits", { exact: true })).toBeVisible();
  });
}

test("doctor desktop visit board keeps its existing controls", async ({ page, request }) => {
  await prepareVisits(page, request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${STAFF_BASE}/visit-requests`);
  await expect(page.getByRole("button", { name: "Live board", exact: true })).toBeVisible();
  await expect(page.locator('[draggable="true"]').filter({ hasText: "Fever and persistent cough since yesterday" })).toBeVisible();
  await expect(page.getByLabel("From", { exact: true })).toBeVisible();
});
