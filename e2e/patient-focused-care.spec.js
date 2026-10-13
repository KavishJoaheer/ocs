import { test, expect } from "@playwright/test";

const CARE = `http://127.0.0.1:${process.env.E2E_PATIENT_PORT || "4174"}`;
const user = { id: 1, patient_id: 1, full_name: "Maya Patient", link_status: "verified", has_password: true };
const appointments = [
  { id: 1, appointment_date: "2099-06-01", appointment_time: "09:00", status: "scheduled", doctor_name: "Future Home Doctor", reason: "Upcoming home visit" },
  { id: 2, appointment_date: "2099-06-02", appointment_time: "11:00", status: "scheduled", kind: "teleconsultation", doctor_name: "Future Remote Doctor", reason: "Upcoming remote appointment" },
  { id: 3, appointment_date: "2000-06-01", status: "completed", kind: "teleconsultation", doctor_name: "Past Remote Doctor", consultation_id: 30 },
  { id: 4, appointment_date: "2000-06-02", status: "overdue", doctor_name: "Overdue Doctor" },
  { id: 5, appointment_date: "2099-06-03", status: "cancelled", doctor_name: "Cancelled Doctor" },
];
const history = [
  { id: 1, status: "completed", reason: "Previous completed teleconsultation", consultation_id: 30 },
  { id: 2, status: "cancelled", reason: "Previous cancelled teleconsultation" },
  { id: 3, status: "referred", reason: "Previous referred teleconsultation" },
];

async function mockCare(page, options = {}) {
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    if (path === "/api/patient-auth/me") json = { user };
    if (path === "/api/patient-portal/dependents") json = { dependents: [] };
    if (path === "/api/patient-portal/dashboard") json = { patient: { id: 1 }, next_appointment: null, last_consultation: null };
    if (path === "/api/patient-portal/visit-requests/active") json = { visit_request: null, family_visit_requests: [] };
    if (path === "/api/patient-portal/appointments") json = { appointments: options.appointments ?? appointments };
    if (path === "/api/patient-portal/health-records") json = { consultations: [{ id: 30, date: "2000-06-01", doctor_name: "Past Remote Doctor", visit_type: "Teleconsultation", diagnosis: "Past consultation diagnosis", plain_summary: "Completed care stays in Records." }], reports: [], clinical: {} };
    if (path === "/api/patient-portal/teleconsultations") json = {
      requests: options.requests ?? history, eligible: options.eligible ?? true,
      confirmed_mobile: "23057001122", consent_version: "test-v1",
      consent: [{ title: "Service terms", text: "Please review the service terms before requesting care." }],
    };
    await route.fulfill({ json });
  });
}

for (const width of [360, 430]) {
  test(`mobile Visits shows upcoming appointments only at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 932 });
    await mockCare(page);
    await page.goto(`${CARE}/dashboard`);
    await page.locator("#ocs-patient-bottom-nav").getByRole("link", { name: "Visits", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Upcoming Appointments.", exact: true })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(page.getByText("Dr. Future Home Doctor", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Dr. Future Remote Doctor", { exact: true }).filter({ visible: true })).toBeVisible();
    for (const name of ["Past Remote Doctor", "Overdue Doctor", "Cancelled Doctor"]) {
      await expect(page.getByText(`Dr. ${name}`, { exact: true }).filter({ visible: true })).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/ocs-care-upcoming-${width}.png`, fullPage: true, animations: "disabled" });
    await page.getByRole("link", { name: "View past visits in Records", exact: true }).click();
    await expect(page.getByText("Past consultation diagnosis", { exact: true }).filter({ visible: true })).toBeVisible();
  });

  test(`teleconsultation request opens directly without history at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 932 });
    await mockCare(page);
    await page.goto(`${CARE}/teleconsultation`);
    await expect(page.getByRole("heading", { name: "Request a teleconsultation", exact: true })).toBeVisible();
    await expect(page.getByText(/Past consultations/)).toHaveCount(0);
    for (const request of history) await expect(page.getByText(request.reason, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Request another teleconsultation", exact: true })).toHaveCount(0);
    await page.screenshot({ path: `/tmp/ocs-care-teleconsultation-${width}.png`, fullPage: true, animations: "disabled" });
    await page.getByLabel("Reason for consultation").fill("Review my medication");
    await page.getByLabel("Your current location").fill("Moka");
    await page.getByRole("button", { name: "Continue to consent", exact: true }).click();
    await expect(page.getByRole("button", { name: "Accept & request teleconsultation", exact: true })).toBeDisabled();
    await expect(page.getByText(/Past consultations/)).toHaveCount(0);
    await page.getByRole("button", { name: "Edit details", exact: true }).click();
    await expect(page.getByLabel("Reason for consultation")).toHaveValue("Review my medication");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("mobile Visits has a useful empty state; desktop retains appointment history", async ({ page }) => {
  await mockCare(page, { appointments: appointments.filter(appointment => appointment.status !== "scheduled") });
  await page.setViewportSize({ width: 1023, height: 900 });
  await page.goto(`${CARE}/appointments`);
  await expect(page.getByText("No upcoming appointments.", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByText("Dr. Past Remote Doctor", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
});

test("active teleconsultation stays visible without the previous request history", async ({ page }) => {
  await mockCare(page, { requests: [{ id: 4, status: "assigned", reason: "Current consultation", doctor_name: "Current Doctor", consultation_code: "123456" }, ...history] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${CARE}/teleconsultation`);
  await expect(page.getByRole("heading", { name: "Doctor assigned", exact: true })).toBeVisible();
  await expect(page.getByText("123456", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Reason for consultation")).toHaveCount(0);
  await expect(page.getByText(/Past consultations/)).toHaveCount(0);
});

test("returning patients still need hotline screening before requesting care", async ({ page }) => {
  await mockCare(page, { eligible: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${CARE}/teleconsultation`);
  await expect(page.getByRole("heading", { name: "Start with a call to OCS", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Call the OCS hotline", exact: true })).toBeVisible();
  await expect(page.getByLabel("Reason for consultation")).toHaveCount(0);
  await expect(page.getByText(/Past consultations/)).toHaveCount(0);
});
