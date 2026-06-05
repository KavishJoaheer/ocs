#!/usr/bin/env node
/**
 * Smoke-test critical API routes for all roles (catches SQL binding errors, 500s).
 * Usage: node src/scripts/smokeApiAudit.js
 *
 * Env:
 *   SEED_USER_PASSWORD — login password (default Welcome@123). On production DBs with
 *     custom passwords, accountant routes are skipped when login fails.
 */

const { createApp } = require("../app");
const { db, initializeDatabase } = require("../db");

const PASSWORD = process.env.SEED_USER_PASSWORD || "Welcome@123";

const ROLE_ENDPOINTS = {
  admin: [
    ["GET", "/api/dashboard"],
    ["GET", "/api/dashboard/long-term-review"],
    ["GET", "/api/patients?page=1&limit=5"],
    ["GET", "/api/inventory"],
    ["GET", "/api/billing"],
    ["GET", "/api/dashboard/live-report"],
    ["GET", "/api/hcm-news"],
    ["GET", "/api/doctors"],
    ["GET", "/api/team-operations/linkham_admin"],
    ["GET", "/api/inventory/activity-history"],
  ],
  doctor: [
    ["GET", "/api/dashboard"],
    ["GET", "/api/dashboard/long-term-review"],
    ["GET", "/api/dashboard/doctor-workspace"],
    ["GET", "/api/patients?page=1&limit=5"],
    ["GET", "/api/patients/offline-directory"],
    ["GET", "/api/patients?filter=my_assigned&page=1&limit=5"],
    ["GET", "/api/inventory"],
    ["GET", "/api/billing"],
    ["GET", "/api/dashboard/live-report"],
    ["GET", "/api/consultations"],
  ],
  operator: [
    ["GET", "/api/dashboard"],
    ["GET", "/api/dashboard/long-term-review"],
    ["GET", "/api/dashboard/operator-workspace"],
    ["GET", "/api/patients?page=1&limit=5"],
    ["GET", "/api/doctors"],
    ["GET", "/api/inventory"],
    ["GET", "/api/billing/patient-summary"],
    ["GET", "/api/inventory/activity-history"],
    ["GET", "/api/hcm-news"],
  ],
  lab_tech: [
    ["GET", "/api/dashboard"],
    ["GET", "/api/patients?page=1&limit=5"],
    ["GET", "/api/consultations"],
    ["GET", "/api/hcm-news"],
  ],
  accountant: [
    ["GET", "/api/dashboard"],
    ["GET", "/api/billing"],
    ["GET", "/api/hcm-news"],
  ],
};

/** role -> path -> expected HTTP status (RBAC-by-design, not a failure). */
const EXPECTED_STATUS = {
  accountant: {
    "/api/dashboard/live-report": 403,
  },
};

async function login(username) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Login failed for ${username}: ${data?.error || response.status}`);
  }
  return data.token;
}

async function request(token, method, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

function pickUserForRole(role) {
  const row = db
    .prepare(`
      SELECT username
      FROM users
      WHERE role = ?
        AND is_active = 1
        AND deleted_at IS NULL
      ORDER BY id ASC
      LIMIT 1
    `)
    .get(role);
  return row?.username || null;
}

function expectedStatusFor(role, path) {
  return EXPECTED_STATUS[role]?.[path] ?? null;
}

let baseUrl;
let server;

async function main() {
  initializeDatabase();
  const app = createApp();

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  const patient = db
    .prepare("SELECT id FROM patients WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1")
    .get();
  const patientId = patient?.id;

  const failures = [];
  const passes = [];
  const skipped = [];

  for (const [role, endpoints] of Object.entries(ROLE_ENDPOINTS)) {
    const username = pickUserForRole(role);
    if (!username) {
      skipped.push({ role, reason: "No active user for role" });
      continue;
    }

    let token;
    try {
      token = await login(username);
    } catch (error) {
      if (role === "accountant") {
        skipped.push({
          role,
          username,
          reason: `${error.message} (set SEED_USER_PASSWORD to audit accountant routes)`,
        });
        continue;
      }
      failures.push({ role, path: "/api/auth/login", error: error.message });
      continue;
    }

    const paths = [...endpoints];
    if (patientId) {
      paths.push(["GET", `/api/patients/${patientId}`]);
    }

    for (const [method, path] of paths) {
      try {
        const result = await request(token, method, path);
        const expected = expectedStatusFor(role, path);

        if (expected != null && result.status === expected) {
          passes.push({ role, path, status: result.status, note: "expected RBAC" });
          continue;
        }

        if (result.status >= 500 || result.status === 404) {
          failures.push({
            role,
            username,
            path,
            error: result.body?.error || `HTTP ${result.status}`,
          });
        } else if (result.status === 401 || result.status === 403) {
          failures.push({
            role,
            username,
            path,
            error: `Unexpected ${result.status}: ${result.body?.error || ""}`,
          });
        } else {
          passes.push({ role, path, status: result.status });
        }
      } catch (error) {
        failures.push({ role, username, path, error: error.message });
      }
    }
  }

  if (patientId) {
    const operatorUser = pickUserForRole("operator");
    if (operatorUser) {
      try {
        const token = await login(operatorUser);
        const profile = await request(token, "GET", `/api/patients/${patientId}`);
        if (profile.status >= 500) {
          failures.push({
            role: "operator",
            path: `/api/patients/${patientId}`,
            error: profile.body?.error || `HTTP ${profile.status}`,
          });
        } else if (profile.status !== 200) {
          failures.push({
            role: "operator",
            path: `/api/patients/${patientId}`,
            error: `HTTP ${profile.status}: ${profile.body?.error || ""}`,
          });
        } else {
          passes.push({ role: "operator", path: `/api/patients/${patientId}`, status: 200 });
        }
      } catch (error) {
        failures.push({
          role: "operator",
          path: `/api/patients/${patientId}`,
          error: error.message,
        });
      }
    }
  }

  console.log(`\nSmoke audit: ${passes.length} passed, ${failures.length} failed`);
  if (skipped.length) {
    console.log(`  (${skipped.length} role(s) skipped)`);
  }
  console.log("");

  if (skipped.length) {
    console.log("SKIPPED:");
    skipped.forEach((entry) => {
      console.log(`  [${entry.role}] ${entry.username || ""} ${entry.reason || ""}`.trim());
    });
    console.log("");
  }

  if (failures.length) {
    console.log("FAILURES:");
    failures.forEach((entry) => {
      console.log(`  [${entry.role}] ${entry.path}`);
      console.log(`    ${entry.error}`);
    });
    process.exitCode = 1;
  } else {
    console.log("All critical routes OK for every role.");
  }
}

main()
  .catch((error) => {
    console.error("Smoke audit crashed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) {
      server.close();
    }
  });
