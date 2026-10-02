"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-manual-invoice-test-"));
process.env.DB_PATH = path.join(testRoot, "clinic.db");
process.env.NODE_ENV = "test";

const { createApp } = require("../src/app");
const { db } = require("../src/db");

let server;
let baseUrl;
let operatorToken;
let doctorToken;
let consultation;

async function jsonRequest(method, urlPath, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}

async function login(username) {
  const response = await jsonRequest("POST", "/api/auth/login", {
    body: { username, password: "Welcome@123" },
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.token;
}

before(async () => {
  const app = createApp();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  consultation = db.prepare(`
    SELECT c.id, c.patient_id, c.doctor_id, c.doctor_notes, b.id AS billing_id
    FROM consultations c
    JOIN billing b ON b.consultation_id = c.id
    WHERE c.voided_at IS NULL AND b.voided_at IS NULL
    ORDER BY c.id
    LIMIT 1
  `).get();
  assert.ok(consultation);

  const doctorUsername = db.prepare(`
    SELECT username FROM users
    WHERE role = 'doctor' AND doctor_id = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(consultation.doctor_id)?.username;
  assert.ok(doctorUsername);

  operatorToken = await login("operator01");
  doctorToken = await login(doctorUsername);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("operator can read any consultation note but cannot edit it", async () => {
  const list = await jsonRequest("GET", "/api/consultations", { token: operatorToken });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.ok(list.data.some((row) => Number(row.id) === Number(consultation.id)));

  const detail = await jsonRequest("GET", `/api/consultations/${consultation.id}`, {
    token: operatorToken,
  });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.doctor_notes, consultation.doctor_notes);

  const edit = await jsonRequest("PUT", `/api/consultations/${consultation.id}`, {
    token: operatorToken,
    body: {
      consultation_date: "2031-01-01",
      doctor_notes: "Operator must not be able to save this.",
    },
  });
  assert.equal(edit.status, 403);
  assert.equal(
    db.prepare("SELECT doctor_notes FROM consultations WHERE id = ?").get(consultation.id).doctor_notes,
    consultation.doctor_notes,
  );
});

test("operator attaches a photo to the exact consultation and bill", async () => {
  const form = new FormData();
  form.append("consultation_id", String(consultation.id));
  form.append("billing_id", String(consultation.billing_id));
  form.append("invoice_photo", new Blob(["manual-invoice-image"], { type: "image/png" }), "invoice.png");

  const response = await fetch(`${baseUrl}/api/manual-invoice-attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${operatorToken}` },
    body: form,
  });
  const attachment = await response.json();
  assert.equal(response.status, 201, JSON.stringify(attachment));
  assert.equal(Number(attachment.consultation_id), Number(consultation.id));
  assert.equal(Number(attachment.billing_id), Number(consultation.billing_id));

  const stored = db.prepare("SELECT * FROM manual_invoice_attachments WHERE id = ?").get(attachment.id);
  assert.equal(Number(stored.patient_id), Number(consultation.patient_id));
  assert.equal(stored.original_name, "invoice.png");
  assert.equal(
    Number(stored.uploaded_by_user_id),
    Number(db.prepare("SELECT id FROM users WHERE username = 'operator01'").get().id),
  );

  const doctorDetail = await jsonRequest("GET", `/api/consultations/${consultation.id}`, {
    token: doctorToken,
  });
  assert.equal(doctorDetail.status, 200, JSON.stringify(doctorDetail.data));
  assert.equal(doctorDetail.data.manual_invoice_attachments.length, 1);
  assert.equal(doctorDetail.data.manual_invoice_attachments[0].original_name, "invoice.png");

  const downloaded = await fetch(`${baseUrl}/api${attachment.download_url}`, {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), "manual-invoice-image");
});

test("upload rejects a bill from a different consultation", async () => {
  const otherBill = db.prepare(`
    SELECT id FROM billing WHERE consultation_id != ? AND voided_at IS NULL LIMIT 1
  `).get(consultation.id);
  assert.ok(otherBill);

  const form = new FormData();
  form.append("consultation_id", String(consultation.id));
  form.append("billing_id", String(otherBill.id));
  form.append("invoice_photo", new Blob(["wrong-bill"], { type: "image/jpeg" }), "wrong.jpg");
  const response = await fetch(`${baseUrl}/api/manual-invoice-attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${operatorToken}` },
    body: form,
  });
  const body = await response.json();
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.match(body.error, /does not belong/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM manual_invoice_attachments").get().count, 1);
});
