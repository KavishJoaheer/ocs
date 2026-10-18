import { test, expect } from "@playwright/test";

const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const privateNoteLabel = "Consultation note (not visible to patient)";
const diagnosisLabel = "Patient-facing diagnosis / assessment";

for (const width of [390, 1280]) {
  for (const structured of [true, false]) {
    test(`doctor edits ${structured ? "structured" : "legacy"} patient note at ${width}px`, async ({ page, request }) => {
      const login = await request.post(`${API}/auth/login`, {
        data: { username: "arun.dharee", password: "Welcome@123" },
      });
      expect(login.ok()).toBeTruthy();
      const session = await login.json();
      const headers = { Authorization: `Bearer ${session.token}` };
      const created = await request.post(`${API}/patients`, {
        headers,
        data: {
          first_name: "Note", last_name: `Edit ${width} ${structured ? "Structured" : "Legacy"}`,
          patient_id_type: "old_age", gender: "F", patient_contact_number: "57001122",
          address: "Moka", location: "Moka", location_tags: [{ category: "Village", name: "Moka" }],
          assigned_doctor_id: session.user.doctor_id,
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const patient = await created.json();
      const original = structured ? {
        clinical_note: "Private clinical findings.", patient_diagnosis: "Initial assessment",
        patient_prescription: "Original prescription", vital_bp: "120/80",
        vital_temperature: "36.6", vital_spo2: "98",
      } : { doctor_notes: "Original legacy consultation note." };
      const added = await request.post(`${API}/patients/${patient.id}/consultations`, {
        headers, data: { consultation_date: "2026-10-18", appointment_time: "09:00", ...original },
      });
      expect(added.ok(), await added.text()).toBeTruthy();
      const consultation = await added.json();
      const url = `${API}/consultations/${consultation.id}`;
      const isNoteUpdate = req => new URL(req.url()).pathname === `/api/consultations/${consultation.id}` && req.method() === "PUT";

      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), session.token);
      await page.goto(`${STAFF}/patients/${patient.id}`);
      await page.getByRole("button", { name: "Notes", exact: true }).click();
      const edit = page.getByRole("button", { name: width < 1024 ? "Edit" : "Edit note", exact: true });
      await edit.click();

      let updateCount = 0;
      page.on("request", req => {
        if (isNoteUpdate(req)) updateCount++;
      });
      if (structured) {
        await expect(page.getByLabel(privateNoteLabel, { exact: true })).toHaveValue(original.clinical_note);
        await expect(page.getByLabel(diagnosisLabel, { exact: true })).toHaveValue(original.patient_diagnosis);
        await expect(page.getByLabel("Prescription (optional)", { exact: true })).toHaveValue(original.patient_prescription);
        await page.getByLabel(privateNoteLabel, { exact: true }).fill(" ");
        await page.getByRole("button", { name: "Save changes", exact: true }).click();
        await expect(page.getByText("Consultation note cannot be empty.", { exact: true })).toBeVisible();
        await page.getByLabel(privateNoteLabel, { exact: true }).fill("Updated private clinical findings.");
        await page.getByLabel(diagnosisLabel, { exact: true }).fill(" ");
        await page.getByRole("button", { name: "Save changes", exact: true }).click();
        await expect(page.getByText("Patient-facing diagnosis is required.", { exact: true })).toBeVisible();
        expect(updateCount).toBe(0);
        await page.getByLabel(diagnosisLabel, { exact: true }).fill("Updated patient assessment");
        await page.getByLabel("Prescription (optional)", { exact: true }).fill("");
      } else {
        await expect(page.getByLabel(privateNoteLabel, { exact: true })).toHaveCount(0);
        await page.getByPlaceholder("Update the clinical note for this consultation.").fill("Updated legacy consultation note.");
      }

      const responsePromise = page.waitForResponse(res => isNoteUpdate(res.request()));
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      const response = await responsePromise;
      expect(response.status(), await response.text()).toBe(200);
      const sent = response.request().postDataJSON();
      expect(Object.hasOwn(sent, "clinical_note")).toBe(structured);
      expect(Object.hasOwn(sent, "doctor_notes")).toBe(!structured);
      await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
      expect(updateCount).toBe(1);

      await page.reload();
      await edit.click();
      const saved = await (await request.get(url, { headers })).json();
      expect(saved.doctor_id).toBe(consultation.doctor_id);
      expect(saved.consultation_date).toBe(consultation.consultation_date);
      if (structured) {
        await expect(page.getByLabel(privateNoteLabel, { exact: true })).toHaveValue("Updated private clinical findings.");
        await expect(page.getByLabel(diagnosisLabel, { exact: true })).toHaveValue("Updated patient assessment");
        await expect(page.getByLabel("Prescription (optional)", { exact: true })).toHaveValue("");
        expect(saved.clinical_note).toBe("Updated private clinical findings.");
        expect(saved.patient_diagnosis).toBe("Updated patient assessment");
        expect(saved.patient_prescription).toBe("");
        expect(saved.vital_bp).toBe("120/80");
        expect(saved.vital_temperature).toBe("36.6 °C");
        expect(saved.vital_spo2).toBe("98%");
        expect(saved.doctor_notes).toContain("BP 120/80. T 36.6 °C. SpO2 98%");
        expect(saved.doctor_notes).toContain(saved.clinical_note);
        expect(saved.doctor_notes).toContain(saved.patient_diagnosis);
        expect(saved.doctor_notes).not.toContain("Original prescription");
      } else {
        await expect(page.getByPlaceholder("Update the clinical note for this consultation.")).toHaveValue("Updated legacy consultation note.");
        expect(saved.doctor_notes).toBe("Updated legacy consultation note.");
        expect(saved.clinical_note).toBe("");
        expect(saved.patient_diagnosis).toBe("");
      }
    });
  }
}
