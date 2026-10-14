import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";

const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const patientIds = [];

test.afterEach(() => {
  const db = openE2eDb();
  try {
    db.transaction(() => {
      for (const id of patientIds) {
        db.prepare("UPDATE patients SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      }
    })();
  } finally {
    patientIds.length = 0;
    db.close();
  }
});

for (const width of [390, 1280]) {
  test(`patient profile renders identity values and missing-ID labels at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const login = await request.post(`${API}/auth/login`, {
      data: { username: "operator01", password: "Welcome@123" },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };
    await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), token);

    const cases = [
      { type: "national_id", label: "National ID Number", number: width === 390 ? "B290493310239F" : "B290493310240F" },
      { type: "driving_licence", label: "Driving Licence", number: `LICENCE-${width}` },
      { type: "passport", label: "Passport Number", number: `PASSPORT-${width}` },
      { type: "birth_certificate", label: "Birth Certificate Number", number: `BIRTH-${width}` },
      { type: "old_age", label: "Old Age", text: "No identifier required" },
      { type: "no_id", label: "No ID available", text: "No identification provided" },
      // Older records can have the default national ID type with no recorded number.
      { label: "National ID Number", text: "Not recorded" },
    ];
    for (const sample of cases) {
      const response = await request.post(`${API}/patients`, { headers, data: {
        first_name: "Identity", last_name: "Profile", gender: "F",
        date_of_birth: "1993-04-29", patient_contact_number: "57001122",
        address: "Moka", location: "Moka", location_tags: [{ category: "Village", name: "Moka" }],
        ...(sample.type ? { patient_id_type: sample.type } : {}),
        ...(sample.number ? { patient_id_number: sample.number } : {}),
      } });
      expect(response.ok(), await response.text()).toBeTruthy();
      const patient = await response.json();
      patientIds.push(patient.id);
      await page.goto(`${STAFF}/patients/${patient.id}`);
      const summary = page.locator(".patient-summary-cards");
      const item = summary.locator("dl > div").filter({ has: page.getByText(sample.label, { exact: true }) });
      await expect(item.locator("dd")).toHaveText(sample.number || sample.text);
      await expect(item.locator("dd")).toBeVisible();
      await expect(page.locator(".patient-profile")).not.toContainText("[object Object]");
    }
  });
}
