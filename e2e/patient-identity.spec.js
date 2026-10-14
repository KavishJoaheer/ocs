import { test, expect } from "@playwright/test";
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;

for (const width of [390, 1280]) {
  test(`patient identity selection, optional details and saving at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const login = await request.post(`${API}/auth/login`, { data: { username: "shravan.joaheer", password: "Welcome@123" } });
    const { token } = await login.json();
    await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), token);
    await page.goto(`${STAFF}/patients/add`);
    const idType = page.getByRole("combobox", { name: "ID type", exact: true });
    const idNumber = page.locator('input[name="patient_id_number"]');
    const dob = page.getByLabel("Date of Birth", { exact: false });
    await expect(idType).toHaveValue("national_id");
    await expect(idType.locator("option")).toHaveText(["National ID Number", "Driving Licence", "Passport Number", "Birth Certificate Number", "Old Age", "No ID available"]);
    await expect(idNumber).toHaveAttribute("required", "");
    await idNumber.fill("B290493310239F");
    await expect(dob).toHaveValue("29/04/1993");
    await expect(dob).toHaveAttribute("readonly", "");
    await expect(page.getByText(/Age: \d+ years old/)).toBeVisible();
    for (const type of ["driving_licence", "passport", "birth_certificate", "old_age", "no_id"]) {
      await idType.selectOption(type);
      await expect(dob).toHaveValue("");
      await expect(dob).not.toHaveAttribute("readonly", "");
      await expect(dob).not.toHaveAttribute("required", "");
      const age = page.getByLabel("Age (years)");
      await expect(age).toHaveValue("");
      await expect(age).not.toHaveAttribute("required", "");
      if (["old_age", "no_id"].includes(type)) await expect(idNumber).toHaveCount(0);
      else {
        await idNumber.fill("B290493310240F");
        await expect(dob).toHaveValue("");
        await expect(age).toHaveValue("");
      }
    }
    await dob.fill("10081950");
    await expect(dob).toHaveValue("10/08/1950");
    await page.getByLabel("Age (years)").fill("76");
    // Remount the first wizard step and verify manual DOB and age remain visible.
    await page.locator('input[name="first_name"]').fill("Identity");
    await page.locator('input[name="last_name"]').fill("Browser");
    await page.locator('input[name="patient_contact_number"]').fill("57001122");
    await page.locator('textarea[name="address"]').fill("Moka");
    await page.locator('select').filter({ has: page.locator('option[value="Medic World"]') }).selectOption("Medic World");
    await page.getByRole("button", { name: /^Next(?::.*)?$/ }).click();
    await page.getByRole("button", { name: /Intake$/ }).click();
    await expect(dob).toHaveValue("10/08/1950");
    await expect(page.getByLabel("Age (years)")).toHaveValue("76");
    await page.screenshot({ path: `/tmp/ocs-patient-identity-${width}.png`, fullPage: true });
    // Saving a patient without identification or known birth details must succeed.
    await dob.fill("");
    await page.getByLabel("Age (years)").fill("");
    await page.getByRole("button", { name: /^Next(?::.*)?$/ }).click();
    await page.getByRole("button", { name: /^Next(?::.*)?$/ }).click();
    const savedResponse = page.waitForResponse(response => response.url().endsWith("/api/patients") && response.request().method() === "POST");
    await page.getByRole("button", { name: /^(Add|Save) patient$/, exact: true }).click();
    const saved = await savedResponse;
    expect(saved.status()).toBe(201);
    const patient = await saved.json();
    expect(patient.patient_id_type).toBe("no_id");
    expect(patient.patient_id_number).toBe("");
    expect(patient.date_of_birth).toBe("");
    expect(patient.manual_age).toBeNull();
    await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}$`));
    await expect(page.getByText("No ID available", { exact: true })).toBeVisible();
  });
}
