import { test, expect } from "@playwright/test";
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const CARE = `http://127.0.0.1:${process.env.E2E_PATIENT_PORT || "4174"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
async function login(request, username) {
  const response = await request.post(`${API}/auth/login`, { data: { username, password: "Welcome@123" } });
  expect(response.ok()).toBeTruthy(); return response.json();
}
async function staffPage(context, actor) {
  await context.addInitScript(token => window.localStorage.setItem("ocs_medecins_auth_token", token), actor.token);
  return context.newPage();
}
test("hotline invitation, patient consent, doctor verification and published care plan", async ({ browser, request }, testInfo) => {
  const operator = await login(request, "operator01");
  const doctor = await login(request, "arun.dharee");
  const patientName = `Teleconsultation E2E ${Date.now()}`;
  const created = await request.post(`${API}/patients`, { headers: { Authorization: `Bearer ${operator.token}` }, data: {
    first_name: "Teleconsultation", last_name: patientName.replace("Teleconsultation ", ""), gender: "F", date_of_birth: "1990-06-17",
    patient_contact_number: "52520142", patient_id_number: `TELE-E2E-${Date.now()}`, address: "Moka", location: "Moka", location_tags: [{ category: "Town", name: "Moka" }],
  } });
  expect(created.ok(), await created.text()).toBeTruthy(); const patient = await created.json();
  const opContext = await browser.newContext(); const patientContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); const doctorContext = await browser.newContext();
  try {
    const opPage = await staffPage(opContext, operator);
    await opPage.goto(`${STAFF}/patients/${patient.id}`);
    await expect(opPage.getByRole("heading", { name: "Invite to OCS Care" })).toBeVisible();
    await opPage.getByLabel("Patient identity checked using the agreed OCS procedure.").check();
    await opPage.getByLabel("Patient personally controls this mobile; number read back and confirmed.").check();
    await opPage.getByLabel("Hotline screening completed; potentially suitable for teleconsultation, subject to the doctor’s assessment.").check();
    await opPage.getByRole("button", { name: "Create 10-minute sign-in link" }).click();
    const invitation = opPage.getByLabel("Personal invitation to copy"); await expect(invitation).toBeVisible();
    const magicUrl = (await invitation.inputValue()).match(/https?:\/\/\S+/)[0];
    const carePage = await patientContext.newPage();
    await carePage.goto(magicUrl.replace(new URL(magicUrl).origin, CARE));
    await expect(carePage.getByRole("button", { name: "Continue to OCS Care" })).toBeEnabled();
    expect(new URL(carePage.url()).hash).toBe("");
    expect((await patientContext.request.get(`${API}/patient-auth/me`)).status()).toBe(401);
    await carePage.getByRole("button", { name: "Continue to OCS Care" }).click();
    await expect(carePage).toHaveURL(/\/dashboard$/);
    await expect(carePage.getByRole("link", { name: "Request a teleconsultation", exact: true })).toBeVisible();
    await carePage.getByRole("link", { name: "Request a teleconsultation", exact: true }).click();
    await carePage.getByLabel("Reason for consultation").fill("Review an existing report");
    await carePage.getByLabel("Your current location").fill("Moka, home");
    await carePage.getByLabel("Mobile confirmed with OCS").fill("52520142");
    await expect(carePage.getByRole("button", { name: "Accept & request teleconsultation" })).toBeDisabled();
    await carePage.getByLabel("I have read and accept these service terms and limitations.").check();
    await carePage.getByLabel("I understand the benefits and limitations, have had the opportunity to ask questions, and consent to teleconsultation.").check();
    await carePage.getByRole("button", { name: "Accept & request teleconsultation" }).click();
    await expect(carePage.getByText("Your OCS consultation code", { exact: true })).toBeVisible();
    const code = await carePage.locator("section").first().locator("p").filter({ hasText: /^\d{6}$/ }).innerText();
    await opPage.goto(`${STAFF}/teleconsultations`);
    const card = opPage.locator("section").filter({ has: opPage.getByRole("link", { name: patientName, exact: true }) });
    await expect(card).toContainText(code);
    await card.getByLabel("Assign doctor").selectOption(String(doctor.user.doctor_id)); await card.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(card).toContainText("Doctor assigned");
    const doctorPage = await staffPage(doctorContext, doctor); await doctorPage.goto(`${STAFF}/teleconsultations`);
    const doctorCard = doctorPage.locator("section").filter({ has: doctorPage.getByRole("link", { name: patientName, exact: true }) });
    await doctorCard.getByLabel("Patient’s consultation code").fill(code);
    await doctorCard.getByLabel("Identity, current location, callback, privacy, consent and clinical suitability confirmed.").check();
    await doctorCard.getByRole("button", { name: "Verify code & begin consultation" }).click();
    await doctorCard.getByLabel("Internal clinical note", { exact: true }).fill("PRIVATE CLINICAL NOTE: findings discussed");
    await doctorCard.getByLabel("Patient-facing diagnosis / assessment", { exact: true }).fill("Report reviewed");
    await doctorCard.getByLabel("Prescription · optional", { exact: true }).fill("Demonstration prescription instructions");
    await doctorCard.getByLabel("Patient care summary and warning signs", { exact: true }).fill("Your agreed plan. Seek urgent care if your symptoms worsen.");
    await doctorCard.getByLabel("Follow-up: responsible person, timing and contact route", { exact: true }).fill("OCS care team will contact you tomorrow; call the hotline for assistance.");
    await doctorCard.getByRole("button", { name: "Save consultation & publish care plan" }).click();
    await expect(doctorCard).toContainText("Completed");
    await carePage.reload(); await expect(carePage.getByText("Your agreed plan. Seek urgent care if your symptoms worsen.", { exact: true })).toBeVisible();
    await expect(carePage.getByText("Your OCS consultation code", { exact: true })).toHaveCount(0);
    await expect(carePage.getByText(/PRIVATE CLINICAL NOTE/)).toHaveCount(0);
    expect(await carePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await carePage.screenshot({ path: testInfo.outputPath("patient-care-plan-mobile.png"), fullPage: true });
    await carePage.getByRole("link", { name: "View consultation and prescription" }).click();
    await expect(carePage.getByText("Demonstration prescription instructions", { exact: false }).first()).toBeVisible();
    await carePage.goto(magicUrl.replace(new URL(magicUrl).origin, CARE));
    await carePage.getByRole("button", { name: "Continue to OCS Care" }).click();
    await expect(carePage.getByRole("alert")).toContainText("invalid, expired or already used");
  } finally { await opContext.close(); await patientContext.close(); await doctorContext.close(); }
});
