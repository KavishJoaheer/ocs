import { test, expect } from "@playwright/test";

const CARE = `http://127.0.0.1:${process.env.E2E_PATIENT_PORT || "4174"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;

async function invitation(request) {
  const staff = await request.post(`${API}/auth/login`, { data: { username: "operator01", password: "Welcome@123" } });
  expect(staff.ok()).toBeTruthy();
  const { token } = await staff.json();
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post(`${API}/patients`, { headers, data: {
    first_name: "Future", last_name: `Access ${Date.now()}`, gender: "F", date_of_birth: "1990-06-17",
    patient_contact_number: "52520142", patient_id_number: `ACCESS-E2E-${Date.now()}`,
    address: "Moka", location: "Moka", location_tags: [{ category: "Town", name: "Moka" }],
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const patient = await created.json();
  async function issue() {
    const response = await request.post(`${API}/patients/${patient.id}/care-invitation`, { headers, data: {
      identity_confirmed: true, mobile_confirmed: true, mobile: "52520142", teleconsultation_screened: false,
    } });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).url;
  }
  return { patient, issue };
}

async function enter(page, url) {
  await page.goto(url.replace(new URL(url).origin, CARE));
  await page.getByRole("button", { name: "Continue to OCS Care" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("dialog", { name: "Before you sign out" })).toHaveCount(0);
}

test("mobile patient opts into future sign-in only at sign-out and returns to the same record", async ({ browser, request }, testInfo) => {
  const { patient, issue } = await invitation(request);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await enter(page, await issue());
    await page.goto(`${CARE}/profile`);
    const signOut = page.getByRole("button", { name: "Sign Out", exact: true }).filter({ visible: true });
    await signOut.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName("Before you sign out");
    await expect(dialog.getByLabel("Email address")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Stay signed in" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(signOut).toBeFocused();
    await signOut.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await signOut.click();
    await dialog.getByRole("button", { name: "Set up future sign-in", exact: true }).click();
    const email = `future-${Date.now()}@example.test`;
    const password = "Patient-chosen-password1!";
    await expect(dialog.getByLabel("Email address")).toBeFocused();
    await dialog.getByLabel("Email address").fill(email);
    await dialog.getByLabel("Choose a password").fill(password);
    await dialog.getByLabel("Confirm your password").fill("Different-password1!");
    await dialog.getByRole("button", { name: "Save & sign out" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("The passwords do not match.");
    await dialog.getByLabel("Confirm your password").fill(password);
    await page.route("**/api/patient-auth/setup-future-sign-in", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Could not save. Please try again." }) }));
    await dialog.getByRole("button", { name: "Save & sign out" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Could not save");
    expect((await context.request.get(`${API}/patient-auth/me`)).status()).toBe(200);
    await page.unroute("**/api/patient-auth/setup-future-sign-in");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("future-sign-in-mobile.png") });
    await dialog.getByRole("button", { name: "Save & sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("status")).toContainText("Your sign-in is ready");
    await expect(page.getByLabel("Email address")).toHaveValue(email);
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    expect((await context.request.get(`${API}/patient-auth/me`)).status()).toBe(401);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in to OCS Care" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const me = await (await context.request.get(`${API}/patient-auth/me`)).json();
    expect(me.user.patient_id).toBe(patient.id);
    expect(me.user.has_password).toBe(true);
    await page.goto(`${CARE}/profile`);
    await signOut.click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally { await context.close(); }
});

test("desktop patient can skip setup, survives failed sign-out and returns using a fresh link", async ({ browser, request }) => {
  const { issue } = await invitation(request);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await enter(page, await issue());
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Before you sign out" });
    await page.route("**/api/patient-auth/logout", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Could not sign out. Please try again." }) }));
    await dialog.getByRole("button", { name: "Sign out for now" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Could not sign out");
    expect((await context.request.get(`${API}/patient-auth/me`)).status()).toBe(200);
    await page.unroute("**/api/patient-auth/logout");
    await dialog.getByRole("button", { name: "Sign out for now" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("status")).toContainText("contact OCS for a new personal sign-in link");
    expect((await context.request.get(`${API}/patient-auth/me`)).status()).toBe(401);
    await enter(page, await issue());
    const me = await (await context.request.get(`${API}/patient-auth/me`)).json();
    expect(me.user.has_password).toBe(false);
  } finally { await context.close(); }
});
