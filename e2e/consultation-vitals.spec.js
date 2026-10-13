import { test, expect } from "@playwright/test";

const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;

for (const width of [390, 1280]) {
  test(`consultation vitals format while typing and save units at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const login = await request.post(`${API}/auth/login`, { data: { username: "shravan.joaheer", password: "Welcome@123" } });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };
    const doctors = await (await request.get(`${API}/doctors`, { headers })).json();
    const doctorId = doctors[0].id;
    const created = await request.post(`${API}/patients`, {
      headers, data: {
        first_name: "Vitals", last_name: `Browser ${width}`, patient_id_type: "old_age",
        gender: "F", patient_contact_number: "57001122", address: "Moka",
        location: "Moka", location_tags: [{ category: "Village", name: "Moka" }],
        assigned_doctor_id: doctorId,
      },
    });
    expect(created.ok()).toBeTruthy();
    const patient = await created.json();
    await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), token);
    await page.goto(`${STAFF}/patients/${patient.id}`);
    if (width < 1024) await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "Add consultation note", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add consultation note", exact: true });
    await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
    const bp = dialog.getByRole("textbox", { name: "BP", exact: true });
    await bp.pressSequentially("120");
    await expect(bp).toHaveValue("120/");
    await bp.pressSequentially("80");
    await expect(bp).toHaveValue("120/80");
    for (let i = 0; i < 5; i++) await bp.press("Backspace");
    await expect(bp).toHaveValue("");
    await bp.fill("90/60");
    await expect(bp).toHaveValue("90/60");
    await bp.fill("12080");
    await expect(bp).toHaveValue("120/80");
    const temperature = dialog.getByRole("textbox", { name: "T", exact: true });
    const spo2 = dialog.getByRole("textbox", { name: "SpO2", exact: true });
    await temperature.pressSequentially("36.6");
    await expect(temperature).toHaveValue("36.6");
    await expect(dialog.locator("#vital_temperature-unit")).toHaveText("°C");
    await spo2.pressSequentially("98");
    await expect(spo2).toHaveValue("98");
    await expect(dialog.locator("#vital_spo2-unit")).toHaveText("%");
    await temperature.fill("");
    await spo2.fill("");
    await expect(temperature).toHaveValue("");
    await expect(spo2).toHaveValue("");
    await temperature.fill("36.6 °C");
    await spo2.fill("98%");
    await expect(temperature).toHaveValue("36.6");
    await expect(spo2).toHaveValue("98");
    await page.screenshot({ path: `/tmp/ocs-consultation-vitals-${width}.png`, fullPage: true });
    await dialog.getByRole("combobox", { name: "Doctor", exact: true }).selectOption(String(doctorId));
    await dialog.getByPlaceholder("Record assessment and private clinical observations. This will not be visible to the patient.").fill("Vitals recorded during review.");
    await dialog.getByPlaceholder("Enter the clear, finalized diagnosis for the patient.").fill("Routine review");
    const savedResponse = page.waitForResponse(response => response.url().endsWith(`/api/patients/${patient.id}/consultations`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Add consultation note", exact: true }).click();
    const response = await savedResponse;
    expect(response.status()).toBe(201);
    const consultation = await response.json();
    expect(consultation.vital_bp).toBe("120/80");
    expect(consultation.vital_temperature).toBe("36.6 °C");
    expect(consultation.vital_spo2).toBe("98%");
    expect(consultation.doctor_notes).toContain("BP 120/80. T 36.6 °C. SpO2 98%");
    await expect(dialog).not.toBeVisible();
    const reopened = await (await request.get(`${API}/patients/${patient.id}`, { headers })).json();
    expect(reopened.consultations[0].vital_temperature).toBe("36.6 °C");
    expect(reopened.consultations[0].vital_spo2).toBe("98%");
  });
}
