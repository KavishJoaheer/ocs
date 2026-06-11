import { test, expect } from "@playwright/test";

const STAFF_BASE = "http://127.0.0.1:4173";
const PATIENT_BASE = "http://127.0.0.1:4174";
const API_BASE = "http://127.0.0.1:3001/api";

async function staffLogin(request) {
  const response = await request.post(`${API_BASE}/auth/login`, {
    data: { username: "shravan.joaheer", password: "Welcome@123" },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function registerPatient(request, suffix) {
  const email = `e2e_${suffix}_${Date.now()}@test.local`;
  const response = await request.post(`${API_BASE}/patient-auth/register`, {
    data: {
      email,
      password: "secret123",
      full_name: "E2E Patient",
      phone: "57001122",
      date_of_birth: "1990-05-05",
      gender: "M",
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return { email, token: body.token };
}

async function injectPatientSession(page, token) {
  await page.addInitScript((authToken) => {
    window.localStorage.setItem("ocs_patient_auth_token", authToken);
  }, token);
}

async function injectStaffSession(page, token) {
  await page.addInitScript((authToken) => {
    window.localStorage.setItem("ocs_medecins_auth_token", authToken);
  }, token);
}

test.describe("OCS smoke", () => {
  test("staff portal login page loads", async ({ page }) => {
    await page.goto(`${STAFF_BASE}/login`);
    await expect(page.getByRole("heading", { name: /sign in with credentials/i })).toBeVisible();
  });

  test("patient portal login page loads", async ({ page }) => {
    await page.goto(`${PATIENT_BASE}/login`);
    await expect(page.getByRole("heading", { name: /sign in to access your health records/i })).toBeVisible();
  });

  test("API staff login succeeds", async ({ request }) => {
    const body = await staffLogin(request);
    expect(body.token).toBeTruthy();
    expect(body.user.role).toBe("admin");
  });

  test("API patient can register, request a visit, and staff can see it", async ({ request }) => {
    const { token } = await registerPatient(request, "flow");
    const authHeaders = { Authorization: `Bearer ${token}` };

    const createVisit = await request.post(`${API_BASE}/patient-portal/visit-requests`, {
      headers: authHeaders,
      data: {
        address: "Port Louis, Mauritius",
        reason: "Fever and cough",
        urgency: "urgent",
      },
    });
    expect(createVisit.ok()).toBeTruthy();
    const visitBody = await createVisit.json();
    expect(visitBody.visit_request.status).toBe("pending");

    const staff = await staffLogin(request);
    const staffHeaders = { Authorization: `Bearer ${staff.token}` };
    const staffList = await request.get(`${API_BASE}/visit-requests?status=active`, {
      headers: staffHeaders,
    });
    expect(staffList.ok()).toBeTruthy();
    const listBody = await staffList.json();
    expect(listBody.visit_requests.some((row) => row.id === visitBody.visit_request.id)).toBeTruthy();
  });

  test("API patient can cancel a pending visit request", async ({ request }) => {
    const { token } = await registerPatient(request, "cancel-api");
    const authHeaders = { Authorization: `Bearer ${token}` };

    const createVisit = await request.post(`${API_BASE}/patient-portal/visit-requests`, {
      headers: authHeaders,
      data: {
        address: "Beau Bassin, Mauritius",
        reason: "Routine check",
        urgency: "routine",
      },
    });
    const visitBody = await createVisit.json();
    const requestId = visitBody.visit_request.id;

    const cancelled = await request.patch(
      `${API_BASE}/patient-portal/visit-requests/${requestId}/cancel`,
      { headers: authHeaders },
    );
    expect(cancelled.ok()).toBeTruthy();
    const cancelledBody = await cancelled.json();
    expect(cancelledBody.visit_request.status).toBe("cancelled");

    const active = await request.get(`${API_BASE}/patient-portal/visit-requests/active`, {
      headers: authHeaders,
    });
    const activeBody = await active.json();
    expect(activeBody.visit_request).toBeNull();
  });

  test("patient visit tracking UI renders for an active request", async ({ page, request }) => {
    const { token } = await registerPatient(request, "tracking");
    await injectPatientSession(page, token);

    await request.post(`${API_BASE}/patient-portal/visit-requests`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        address: "Curepipe, Mauritius",
        reason: "Follow-up check",
        urgency: "routine",
      },
    });

    await page.goto(`${PATIENT_BASE}/request-visit/tracking`);
    await expect(page.getByRole("heading", { name: "Visit Status" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/we're reviewing your request|your doctor is preparing|on the way|has arrived/i).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Visit progress tracker" })).toBeVisible();
  });

  test("patient can cancel an active visit from tracking", async ({ page, request }) => {
    const { token } = await registerPatient(request, "cancel-ui");
    await injectPatientSession(page, token);

    await request.post(`${API_BASE}/patient-portal/visit-requests`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        address: "Vacoas, Mauritius",
        reason: "Cancel flow test",
        urgency: "routine",
      },
    });

    await page.goto(`${PATIENT_BASE}/request-visit/tracking`);
    await expect(page.getByRole("button", { name: /cancel this visit/i })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: /cancel this visit/i }).click();
    await page.getByRole("button", { name: /yes, cancel visit/i }).click();

    await expect(page.getByText(/no active visit right now/i)).toBeVisible({ timeout: 15_000 });
  });

  test("patient dashboard loads for an authenticated user", async ({ page, request }) => {
    const { token } = await registerPatient(request, "dashboard");
    await injectPatientSession(page, token);

    await page.goto(`${PATIENT_BASE}/dashboard`);
    await expect(
      page.getByRole("heading", { name: /good (morning|afternoon|evening), e2e/i }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/no active visit|request a home visit/i).first()).toBeVisible();
  });

  test("patient health records overview loads", async ({ page, request }) => {
    const { token } = await registerPatient(request, "records");
    await injectPatientSession(page, token);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`${PATIENT_BASE}/health-records`);
    await expect(page.getByRole("heading", { name: /your health records/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("tab", { name: /^consultations$/i })).toBeVisible();
    await expect(
      page.getByText(/no consultations yet|health story starts here|your health summary/i).first(),
    ).toBeVisible();
  });

  test("patient billing page loads", async ({ page, request }) => {
    const { token } = await registerPatient(request, "billing");
    await injectPatientSession(page, token);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`${PATIENT_BASE}/billing`);
    await expect(page.getByRole("heading", { name: /billing & payments/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/total billed|no bills found/i).first()).toBeVisible();
  });

  test("staff visit requests board loads for an authenticated admin", async ({ page, request }) => {
    const staff = await staffLogin(request);
    await injectStaffSession(page, staff.token);

    await page.goto(`${STAFF_BASE}/visit-requests`);
    await expect(page.getByRole("heading", { name: /visit requests/i })).toBeVisible();
    await expect(page.getByText(/live board|pending|dispatch desk/i).first()).toBeVisible();
  });
});
