#!/usr/bin/env node
/**
 * End-to-end smoke for the three post-deploy flows:
 * 1) Staff adds structured consultation (desktop + mobile share the same API)
 * 2) Patient health records show the diagnosis
 * 3) Verified patient can request a home visit
 *
 * Usage:
 *   PRODUCTION_API_BASE=https://your-host/api node src/scripts/productionFlowSmoke.js
 *
 * If PRODUCTION_API_BASE is unset, spins up a temporary local server (CI-style).
 */

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const REMOTE_API_BASE = String(process.env.PRODUCTION_API_BASE || "").replace(/\/$/, "");
const STAFF_PASSWORD = process.env.SEED_USER_PASSWORD || "Welcome@123";

let server;
let baseUrl;
let ownsServer = false;

function apiUrl(pathname) {
  return `${baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function request(method, pathname, { token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(apiUrl(pathname), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  return { status: response.status, ok: response.ok, data };
}

function assertOk(condition, message, detail) {
  if (!condition) {
    const extra = detail ? `\n${JSON.stringify(detail, null, 2)}` : "";
    throw new Error(`${message}${extra}`);
  }
}

function uniqueSuffix() {
  return `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

async function startLocalServer() {
  const tmpDb = path.join(os.tmpdir(), `ocs-flow-smoke-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = tmpDb;
  process.env.NODE_ENV = "test";

  delete require.cache[require.resolve("../db")];
  delete require.cache[require.resolve("../app")];

  const { createApp } = require("../app");
  const app = createApp();

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  ownsServer = true;
}

async function stopLocalServer() {
  if (!ownsServer || !server) {
    return;
  }

  const tmpDb = process.env.DB_PATH;
  await new Promise((resolve) => server.close(resolve));

  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${tmpDb}${suffix}`);
    } catch {
      // best-effort
    }
  }
}

async function staffLogin(username = "shravan.joaheer") {
  const response = await request("POST", "/api/auth/login", {
    body: { username, password: STAFF_PASSWORD },
  });
  assertOk(response.ok, `Staff login failed for ${username}`, response.data);
  return response.data.token;
}

async function flowConsultationAndPatientDiagnosis() {
  console.log("\n[1/3] Staff consultation note -> patient diagnosis");

  const adminToken = await staffLogin();
  const doctorToken = await staffLogin("arun.dharee");
  const nationalId = `SMOKE-${uniqueSuffix()}`;

  const patient = await request("POST", "/api/patients", {
    token: adminToken,
    body: {
      first_name: "Flow",
      last_name: `Smoke${uniqueSuffix()}`,
      patient_id_number: nationalId,
      date_of_birth: "1985-06-15",
      gender: "F",
      patient_contact_number: "57001234",
      address: "Port Louis",
      status: "active",
      assigned_doctor_id: 1,
    },
  });
  assertOk(patient.ok, "Create patient failed", patient.data);
  const patientId = patient.data.id;

  const desktopConsultation = await request("POST", `/api/patients/${patientId}/consultations`, {
    token: adminToken,
    body: {
      doctor_id: 1,
      consultation_date: "2026-06-15",
      appointment_time: "10:00",
      clinical_note: "BP 130/85. Mild fever.",
      patient_diagnosis: "URTI",
      patient_prescription: "Tab paracetamol 500mg",
    },
  });
  assertOk(desktopConsultation.ok, "Desktop structured consultation failed", desktopConsultation.data);
  assertOk(
    desktopConsultation.data.patient_diagnosis === "URTI",
    "Desktop consultation missing patient_diagnosis",
    desktopConsultation.data,
  );

  const mobileConsultation = await request("POST", `/api/patients/${patientId}/consultations`, {
    token: doctorToken,
    body: {
      consultation_date: "2026-06-14",
      appointment_time: "15:30",
      clinical_note: "Follow-up review. Symptoms improving.",
      patient_diagnosis: "Resolved URTI",
      patient_prescription: "Continue fluids",
    },
  });
  assertOk(mobileConsultation.ok, "Mobile structured consultation failed", mobileConsultation.data);
  assertOk(
    mobileConsultation.data.clinical_note.includes("Follow-up"),
    "Mobile consultation missing clinical_note",
    mobileConsultation.data,
  );

  const email = `flow_smoke_${uniqueSuffix()}@test.local`;
  const register = await request("POST", "/api/patient-auth/register", {
    body: {
      email,
      password: "secret123",
      full_name: `${patient.data.first_name} ${patient.data.last_name}`,
      phone: "57009911",
      national_id: nationalId,
      date_of_birth: "1985-06-15",
      gender: "F",
    },
  });
  assertOk(register.ok, "Patient register failed", register.data);
  assertOk(register.data.user.link_status === "pending_review", "Expected pending_review", register.data);

  const verify = await request("PATCH", `/api/patients/${patientId}/verify-link`, {
    token: adminToken,
    body: { verified: true },
  });
  assertOk(verify.ok, "Verify patient link failed", verify.data);

  const health = await request("GET", "/api/patient-portal/health-records", {
    token: register.data.token,
  });
  assertOk(health.ok, "Patient health records failed", health.data);
  const diagnoses = (health.data.consultations || []).map((row) => row.diagnosis).filter(Boolean);
  assertOk(
    diagnoses.some((value) => /URTI/i.test(value)),
    "Patient health records missing structured diagnosis",
    health.data.consultations,
  );

  console.log("  OK — structured consultations saved; patient health records show diagnosis");
}

async function flowVerifiedVisitRequest() {
  console.log("\n[2/3] Verified patient home visit request");

  const adminToken = await staffLogin();
  const email = `visit_flow_${uniqueSuffix()}@test.local`;

  const register = await request("POST", "/api/patient-auth/register", {
    body: {
      email,
      password: "secret123",
      full_name: "Visit Flow Patient",
      phone: "57005555",
      date_of_birth: "1990-01-01",
      gender: "M",
    },
  });
  assertOk(register.ok, "Patient register failed", register.data);
  assertOk(register.data.user.link_status === "self_registered", "Expected self_registered", register.data);

  const blocked = await request("POST", "/api/patient-portal/visit-requests", {
    token: register.data.token,
    body: {
      address: "Curepipe",
      reason: "Should be blocked",
      urgency: "routine",
    },
  });
  assertOk(blocked.status === 409, "Unverified patient should not create visits", blocked.data);
  assertOk(blocked.data.code === "account_link_pending", "Expected account_link_pending", blocked.data);

  const verify = await request("PATCH", `/api/patients/${register.data.user.patient_id}/verify-link`, {
    token: adminToken,
    body: { verified: true },
  });
  assertOk(verify.ok, "Verify patient failed", verify.data);

  const createVisit = await request("POST", "/api/patient-portal/visit-requests", {
    token: register.data.token,
    body: {
      address: "Beau Bassin, Mauritius",
      reason: "Post-deploy smoke visit",
      urgency: "routine",
    },
  });
  assertOk(createVisit.ok, "Verified visit request failed", createVisit.data);
  assertOk(createVisit.data.visit_request?.status === "pending", "Visit not pending", createVisit.data);

  const staffList = await request("GET", "/api/visit-requests?status=active", {
    token: adminToken,
  });
  assertOk(staffList.ok, "Staff visit list failed", staffList.data);
  assertOk(
    staffList.data.visit_requests.some((row) => row.id === createVisit.data.visit_request.id),
    "Staff did not see patient visit request",
    staffList.data,
  );

  console.log("  OK — unverified blocked; verified patient visit visible to staff");
}

async function flowHealthCheck() {
  console.log("\n[3/3] Production health");

  const health = await request("GET", "/api/health");
  assertOk(health.ok, "Health check failed", health.data);
  assertOk(health.data.ok === true, "Health payload not ok", health.data);
  assertOk(health.data.features?.billing === true, "Billing feature disabled", health.data);
  assertOk(health.data.features?.inventory === true, "Inventory feature disabled", health.data);

  console.log(`  OK — mode=${health.data.mode}, billing + inventory enabled`);
}

async function main() {
  if (REMOTE_API_BASE) {
    baseUrl = REMOTE_API_BASE.replace(/\/api$/, "");
    console.log(`Running production flow smoke against ${REMOTE_API_BASE}`);
  } else {
    await startLocalServer();
    console.log(`Running local flow smoke against ${baseUrl}`);
  }

  try {
    await flowHealthCheck();
    await flowConsultationAndPatientDiagnosis();
    await flowVerifiedVisitRequest();
    console.log("\nAll production flow checks passed.\n");
  } finally {
    await stopLocalServer();
  }
}

main().catch((error) => {
  console.error("\nProduction flow smoke FAILED:");
  console.error(error.message);
  process.exit(1);
});
