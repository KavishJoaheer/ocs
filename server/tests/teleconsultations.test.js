const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
process.env.DB_PATH = path.join(os.tmpdir(), `ocs-teleconsultation-${process.pid}.db`);
process.env.NODE_ENV = "test";
// The overflow fixture deliberately creates >100 complete onboarding journeys.
process.env.API_RATE_LIMIT_PER_MINUTE = "10000";
process.env.PATIENT_PORTAL_ORIGIN = "http://localhost:5174";
const patientPush = mock.method(require("../src/lib/push"), "sendPushToPatientUser", async () => ({ ok: true }));
const { createApp } = require("../src/app");
const { db } = require("../src/db");
const { CONSENT_VERSION } = require("../src/lib/teleconsultations");
const { ensurePatientOnboardingSchema } = require("../src/lib/patientOnboardingSchema");
let server, base, admin, operator, doctor, otherDoctor, accountant, training;
before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  async function login(username) { const result = await api("POST", "/auth/login", { username, password: "Welcome@123" }); assert.equal(result.status, 200); return result.data; }
  admin = await login("shravan.joaheer"); operator = await login("operator01"); doctor = await login("arun.dharee"); accountant = await login("accountant01"); training = await login("tech.operator");
  const other = db.prepare("SELECT username FROM users WHERE role='doctor' AND doctor_id <> ? AND is_active=1 AND deleted_at IS NULL LIMIT 1").get(doctor.user.doctor_id);
  otherDoctor = await login(other.username);
});
after(async () => {
  await new Promise(resolve => server.close(resolve)); db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${process.env.DB_PATH}${suffix}`, { force: true });
});
async function api(method, route, body, actor) {
  const response = await fetch(`${base}/api${route}`, { method, headers: { "Content-Type": "application/json", ...(actor?.token ? { Authorization: `Bearer ${actor.token}` } : actor?.cookie ? { Cookie: actor.cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0], headers: response.headers };
}
let number = 0;
async function patient() {
  const result = await api("POST", "/patients", { first_name: "Tele", last_name: `Patient ${++number}`, date_of_birth: "1990-06-17", gender: "F", patient_id_number: `TELE-ID-${number}`, patient_contact_number: "52520142", address: "Moka", location: "Moka", location_tags: [{ name: "Moka", category: "Town" }] }, operator);
  assert.equal(result.status, 201, JSON.stringify(result.data)); assert.equal(result.data.assigned_doctor_id, null);
  return result.data;
}
async function invite(p, extra = {}) { return api("POST", `/patients/${p.id}/care-invitation`, { identity_confirmed: true, mobile_confirmed: true, mobile: p.patient_contact_number, teleconsultation_screened: true, ...extra }, operator); }
function token(invitation) { return new URLSearchParams(new URL(invitation.data.url).hash.slice(1)).get("token"); }
async function redeem(invitation) { return api("POST", "/patient-auth/magic-link/redeem", { token: token(invitation) }); }
async function request(actor, extra = {}) { return api("POST", "/patient-portal/teleconsultations", { reason: "Report review", current_location: "Moka, home", callback_number: "52520142", consent_version: CONSENT_VERSION, terms_accepted: true, clinical_consent: true, ...extra }, actor); }

test("future sign-in saves credentials on the same account and revokes previous access atomically", async () => {
  const p = await patient();
  const first = await redeem(await invite(p));
  const second = await redeem(await invite(p));
  const pending = await invite(p);
  const userId = first.data.user.id;
  assert.equal(first.data.user.has_password, false);
  const countBefore = db.prepare("SELECT count(*) AS n FROM patient_users").get().n;
  const form = { email: "  Future.Access@EXAMPLE.TEST  ", password: "Private-test-password1!", confirm_password: "Private-test-password1!", patient_id: 999999 };
  assert.equal((await api("POST", "/patient-auth/setup-future-sign-in", form)).status, 401);
  const saved = await api("POST", "/patient-auth/setup-future-sign-in", form, first);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data, { ok: true, email: "future.access@example.test" });
  assert.match(saved.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM patient_users").get().n, countBefore);
  const row = db.prepare("SELECT * FROM patient_users WHERE id=?").get(userId);
  assert.equal(row.patient_id, p.id);
  assert.equal(row.email, "future.access@example.test");
  assert.notEqual(row.password_hash, form.password);
  assert.ok(row.password_hash);
  for (const session of [first, second]) assert.equal((await api("GET", "/patient-auth/me", null, session)).status, 401);
  assert.equal((await redeem(pending)).status, 401);
  const signedIn = await api("POST", "/patient-auth/login", { email: "FUTURE.ACCESS@example.test", password: form.password });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
  assert.equal(signedIn.data.user.id, userId);
  assert.equal(signedIn.data.user.patient_id, p.id);
  assert.equal(signedIn.data.user.has_password, true);
  assert.equal((await api("GET", "/patient-portal/profile", null, signedIn)).status, 200);
  assert.equal((await api("POST", "/patient-auth/setup-future-sign-in", { ...form, email: "overwrite@example.test" }, signedIn)).status, 409);
  assert.equal((await api("GET", "/patient-auth/me", null, signedIn)).status, 200);
  assert.equal(db.prepare("SELECT email FROM patient_users WHERE id=?").get(userId).email, row.email);
});

test("invalid, duplicate and unconfirmed future sign-in attempts keep the patient signed in", async () => {
  const other = await redeem(await invite(await patient()));
  db.prepare("UPDATE patient_users SET email='Already.Used@EXAMPLE.TEST' WHERE id=?").run(other.data.user.id);
  const p = await patient();
  const login = await redeem(await invite(p));
  const form = { email: "new@example.test", password: "Private-test-password2!", confirm_password: "Private-test-password2!" };
  for (const invalid of [{ email: "invalid" }, { password: "short", confirm_password: "short" }, { confirm_password: "mismatch" }]) {
    assert.equal((await api("POST", "/patient-auth/setup-future-sign-in", { ...form, ...invalid }, login)).status, 400);
    assert.equal((await api("GET", "/patient-auth/me", null, login)).status, 200);
  }
  assert.equal((await api("POST", "/patient-auth/setup-future-sign-in", { ...form, email: "already.used@example.test" }, login)).status, 409);
  assert.equal((await api("GET", "/patient-auth/me", null, login)).status, 200);
  assert.equal(db.prepare("SELECT password_hash FROM patient_users WHERE id=?").get(login.data.user.id).password_hash, null);
  db.prepare("UPDATE patients SET link_status='pending_review' WHERE id=?").run(p.id);
  assert.equal((await api("POST", "/patient-auth/setup-future-sign-in", form, login)).status, 403);
  assert.equal((await api("GET", "/patient-auth/me", null, login)).status, 200);
  assert.equal(db.prepare("SELECT email FROM patient_users WHERE id=?").get(login.data.user.id).email, null);
  assert.equal(db.prepare("SELECT email FROM patient_users WHERE id=?").get(other.data.user.id).email, "Already.Used@EXAMPLE.TEST");
});

test("operator invitation grants a cookie session without email/password; single-use and hashes only", async () => {
  const p = await patient(); const link = await invite(p); assert.equal(link.status, 201, JSON.stringify(link.data));
  assert.equal(link.data.expires_in_seconds, 600); assert.equal(new URL(link.data.url).search, "");
  assert.match(token(link), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token(link), "base64url").length, 32);
  assert.equal(link.data.message, `${link.data.url}\n\n${link.data.instructions}`);
  assert.ok(link.data.instructions.startsWith("OCS Médecins"));
  const stored = db.prepare("SELECT * FROM patient_magic_links WHERE patient_id=?").get(p.id);
  assert.notEqual(stored.token_hash, token(link)); assert.equal(Date.parse(`${stored.expires_at.replace(' ', 'T')}Z`) - Date.parse(`${stored.created_at.replace(' ', 'T')}Z`), 600000);
  const login = await redeem(link); assert.equal(login.status, 200, JSON.stringify(login.data)); assert.ok(login.cookie);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/); assert.equal(login.data.token, undefined);
  assert.equal(login.data.user.patient_id, p.id); assert.equal(login.data.user.email, null);
  assert.equal(db.prepare("SELECT password_hash FROM patient_users WHERE id=?").get(login.data.user.id).password_hash, null);
  assert.equal((await api("GET", "/patient-portal/profile", null, login)).status, 200);
  assert.equal((await redeem(link)).status, 401);
  assert.equal((await api("GET", "/patient-portal/profile", null, login)).status, 200);
});
test("previously issued hexadecimal invitations remain usable once", async () => {
  const { generateSessionToken, hashSessionToken } = require("../src/lib/security");
  const p = await patient(); await invite(p);
  const legacyToken = generateSessionToken();
  db.prepare("UPDATE patient_magic_links SET token_hash=? WHERE patient_id=?").run(hashSessionToken(legacyToken), p.id);
  const login = await api("POST", "/patient-auth/magic-link/redeem", { token: legacyToken });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.patient_id, p.id);
  assert.equal((await api("POST", "/patient-auth/magic-link/redeem", { token: legacyToken })).status, 401);
});
test("invitation status confirms only the exact redeemed link and exposes no sign-in credential", async () => {
  const p = await patient(); const another = await patient();
  const first = await invite(p, { teleconsultation_screened: false });
  assert.ok(Number.isSafeInteger(first.data.invitation_id));
  const route = id => `/patients/${p.id}/care-invitation/${id}`;
  const pending = await api("GET", route(first.data.invitation_id), null, operator);
  assert.equal(pending.status, 200); assert.deepEqual(pending.data, { status: "pending", used_at: null });
  assert.equal(pending.headers.get("cache-control"), "no-store");
  for (const actor of [doctor, accountant, training]) assert.equal((await api("GET", route(first.data.invitation_id), null, actor)).status, 403);
  assert.equal((await api("GET", route(first.data.invitation_id))).status, 401);
  assert.equal((await api("GET", `/patients/${another.id}/care-invitation/${first.data.invitation_id}`, null, operator)).status, 404);
  assert.equal((await api("GET", route("invalid"), null, operator)).status, 404);
  assert.equal((await api("POST", "/patient-auth/magic-link/redeem", { token: "invalid" })).status, 401);
  assert.equal((await api("GET", route(first.data.invitation_id), null, operator)).data.status, "pending");
  const { EventEmitter } = require("node:events");
  const { addInventoryStreamClient } = require("../src/lib/inventoryRealtime");
  const stream = new EventEmitter(); let frames = "";
  stream.write = value => { frames += value; return true; };
  addInventoryStreamClient(stream, operator.user); frames = "";
  try {
    assert.equal((await redeem(first)).status, 200);
    assert.ok(frames.includes('"reason":"care_sign_in"'));
    assert.ok(!frames.includes(token(first)));
    const used = await api("GET", route(first.data.invitation_id), null, operator);
    assert.equal(used.data.status, "used"); assert.ok(used.data.used_at);
    assert.deepEqual(Object.keys(used.data).sort(), ["status", "used_at"]);
    const fresh = await invite(p);
    assert.equal((await api("GET", route(fresh.data.invitation_id), null, operator)).data.status, "pending", "an existing signed-in account must not mark a new link used");
    const replacement = await invite(p);
    assert.equal((await api("GET", route(fresh.data.invitation_id), null, operator)).data.status, "revoked");
    db.prepare("UPDATE patient_magic_links SET expires_at=datetime('now','-1 minute') WHERE id=?").run(replacement.data.invitation_id);
    assert.equal((await api("GET", route(replacement.data.invitation_id), null, operator)).data.status, "expired");
    assert.equal((await redeem(replacement)).status, 401);
    assert.equal((await api("GET", route(replacement.data.invitation_id), null, operator)).data.status, "expired");
  } finally { stream.emit("close"); }
});
test("resend revokes earlier links; expired, wrong-mobile, unconfirmed, and unauthorized invitations fail", async () => {
  const p = await patient(); const old = await invite(p); const replacement = await invite(p);
  assert.equal((await redeem(old)).status, 401);
  db.prepare("UPDATE patient_magic_links SET expires_at=datetime('now','-1 minute') WHERE patient_id=?").run(p.id);
  assert.equal((await redeem(replacement)).status, 401);
  assert.equal((await invite(p, { mobile: "52520143" })).status, 400);
  assert.equal((await invite(p, { identity_confirmed: false })).status, 400);
  for (const actor of [doctor, accountant, training]) assert.equal((await api("POST", `/patients/${p.id}/care-invitation`, {}, actor)).status, 403);
  const fresh = await invite(p);
  db.prepare("UPDATE patients SET patient_contact_number='52520143' WHERE id=?").run(p.id);
  assert.equal((await redeem(fresh)).status, 401);
});
test("existing account is reused and never bypasses pending ownership, disabled accounts or phone mismatches", async () => {
  const p = await patient(); const first = await redeem(await invite(p));
  const userId = first.data.user.id;
  assert.equal((await redeem(await invite(p))).data.user.id, userId);
  db.prepare("UPDATE patients SET link_status='pending_review' WHERE id=?").run(p.id);
  assert.equal((await invite(p)).status, 409);
  db.prepare("UPDATE patients SET link_status='verified' WHERE id=?").run(p.id);
  db.prepare("UPDATE patient_users SET phone='23052520143' WHERE id=?").run(userId);
  assert.equal((await invite(p)).status, 409);
  db.prepare("UPDATE patient_users SET phone='23052520142', is_active=0 WHERE id=?").run(userId);
  assert.equal((await invite(p)).status, 409);
});
test("consent and hotline screening are required; assignment, code checks, records and patient privacy hold end to end", async () => {
  const p = await patient(); const noScreen = await redeem(await invite(p, { teleconsultation_screened: false }));
  assert.equal((await request(noScreen)).status, 409);
  const login = await redeem(await invite(p));
  for (const extra of [{ clinical_consent: false }, { terms_accepted: false }, { consent_version: "old" }]) assert.equal((await request(login, extra)).status, 400);
  assert.equal((await request(login, { callback_number: "52520143" })).status, 409);
  const created = await request(login); assert.equal(created.status, 201, JSON.stringify(created.data)); const r = created.data.request;
  assert.match(r.consultation_code, /^\d{6}$/); assert.equal((await request(login)).status, 409);
  const stored = db.prepare("SELECT consent_snapshot FROM teleconsultation_requests WHERE id=?").get(r.id); assert.ok(JSON.parse(stored.consent_snapshot).length);
  const queue = await api("GET", "/teleconsultations", null, operator); assert.equal(queue.data.requests.find(row => row.id===r.id).consultation_code, r.consultation_code);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/assign`, { doctor_id: doctor.user.doctor_id }, doctor)).status, 403);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/assign`, { doctor_id: doctor.user.doctor_id }, operator)).status, 409);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/accept`, {}, operator)).status, 200);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/assign`, { doctor_id: doctor.user.doctor_id }, operator)).status, 200);
  assert.equal((await api("GET", "/teleconsultations", null, otherDoctor)).data.requests.some(row=>row.id===r.id), false);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/start`, { consultation_code:r.consultation_code, checks_confirmed:true }, otherDoctor)).status, 403);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/complete`, {}, doctor)).status, 409);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/start`, { consultation_code:"000000", checks_confirmed:true }, doctor)).status, 400);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/start`, { consultation_code:r.consultation_code, checks_confirmed:false }, doctor)).status, 400);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/start`, { consultation_code:r.consultation_code, checks_confirmed:true }, doctor)).status, 200);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/complete`, {}, operator)).status, 403);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/complete`, {}, doctor)).status, 400);
  const completed = await api("POST", `/teleconsultations/${r.id}/complete`, { clinical_note:"INTERNAL: private clinical details", patient_diagnosis:"Report discussed", patient_prescription:"Patient prescription instructions", patient_summary:"Your agreed care plan", follow_up:"OCS care team: follow up tomorrow through the hotline." }, doctor);
  assert.equal(completed.status, 200, JSON.stringify(completed.data)); assert.equal(completed.data.request.consultation_code, null);
  const list = await api("GET", "/patient-portal/teleconsultations", null, login); assert.equal(list.data.requests[0].patient_summary,"Your agreed care plan"); assert.ok(!JSON.stringify(list.data).includes("INTERNAL"));
  const records = await api("GET", "/patient-portal/health-records", null, login); assert.equal(records.status, 200); assert.ok(JSON.stringify(records.data).includes("Patient prescription instructions"));
  assert.equal((await api("POST", `/teleconsultations/${r.id}/complete`, {}, doctor)).status, 409);
  const otherPatient = await redeem(await invite(await patient()));
  assert.equal((await api("POST", `/patient-portal/teleconsultations/${r.id}/cancel`, {}, otherPatient)).status, 404);
});
test("each triage approves one request only after its OCS Care link is opened, even across simultaneous submissions", async () => {
  const p = await patient();
  const recordsSession = await redeem(await invite(p, { teleconsultation_screened: false }));
  assert.equal(recordsSession.data.teleconsultation_ready, false);
  const invitation = await invite(p);
  assert.equal((await api("GET", "/patient-portal/teleconsultations", null, recordsSession)).data.eligible, false);
  assert.equal((await request(recordsSession)).status, 409, "issuing a link does not authorize an existing session");
  const screenedSession = await redeem(invitation);
  assert.equal(screenedSession.data.teleconsultation_ready, true);
  assert.equal((await api("GET", "/patient-portal/teleconsultations", null, screenedSession)).data.eligible, true);
  assert.equal((await request(screenedSession, { clinical_consent: false })).status, 400);
  assert.equal((await request(screenedSession, { callback_number: "52520143" })).status, 409);
  assert.equal((await api("GET", "/patient-portal/teleconsultations", null, screenedSession)).data.eligible, true, "validation failures leave the approved case available");
  const results = await Promise.all([request(screenedSession), request(screenedSession)]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const created = results.find(result => result.status === 201).data.request;
  assert.equal(db.prepare("SELECT count(*) AS n FROM teleconsultation_requests WHERE patient_id=?").get(p.id).n, 1);
  assert.ok(db.prepare("SELECT consumed_at FROM teleconsultation_screenings WHERE patient_id=?").get(p.id).consumed_at);
  assert.equal((await api("GET", "/patient-portal/teleconsultations", null, screenedSession)).data.eligible, false);
  assert.equal((await invite(p)).status, 409, "an active request cannot stockpile approval for a future case");
  await api("POST", `/patient-portal/teleconsultations/${created.id}/cancel`, {}, screenedSession);
  const blocked = await request(screenedSession);
  assert.equal(blocked.status, 409); assert.match(blocked.data.error, /fresh triage.*new OCS Care link/);
  const nextInvitation = await invite(p);
  assert.equal((await request(screenedSession)).status, 409);
  const nextSession = await redeem(nextInvitation);
  assert.equal((await request(screenedSession)).status, 409, "old sessions cannot use a replacement link's approval");
  const nextRequest = await request(nextSession);
  assert.equal(nextRequest.status, 201); assert.notEqual(nextRequest.data.request.id, created.id);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("ordinary sign-in, records invitations, expired screenings and revoked issuers cannot authorize teleconsultation", async () => {
  const p = await patient();
  const screenedSession = await redeem(await invite(p));
  const { hashPassword } = require("../src/lib/security");
  db.prepare("UPDATE patient_users SET email=?, password_hash=? WHERE id=?")
    .run("triage-session@example.test", hashPassword("TriageSession123!"), screenedSession.data.user.id);
  const passwordSession = await api("POST", "/patient-auth/login", { email: "triage-session@example.test", password: "TriageSession123!" });
  assert.equal(passwordSession.status, 200);
  assert.equal((await request(passwordSession)).status, 409);
  assert.equal((await api("GET", "/patient-portal/teleconsultations", null, passwordSession)).data.eligible, false);
  const recordsLink = await invite(p, { teleconsultation_screened: false });
  assert.equal((await request(screenedSession)).status, 409, "a records replacement revokes the earlier unused approval");
  const recordsSession = await redeem(recordsLink);
  assert.equal(recordsSession.data.teleconsultation_ready, false);
  assert.equal((await request(recordsSession)).status, 409);
  const next = await redeem(await invite(p));
  db.prepare("UPDATE teleconsultation_screenings SET screened_at=datetime('now','-25 hours') WHERE patient_id=?").run(p.id);
  assert.equal((await request(next)).status, 409);
  assert.equal((await api("GET", "/patient-portal/teleconsultations", null, next)).data.eligible, false);
  const fresh = await redeem(await invite(p));
  db.prepare("UPDATE users SET is_active=0 WHERE id=?").run(operator.user.id);
  try { assert.equal((await request(fresh)).status, 409); }
  finally { db.prepare("UPDATE users SET is_active=1 WHERE id=?").run(operator.user.id); }
  assert.equal((await api("GET", "/patient-portal/health-records", null, recordsSession)).status, 200, "records access remains available");
});

test("completion requires private note and diagnosis, while prescription, summary and follow-up are optional", async () => {
  const p = await patient(); const login = await redeem(await invite(p));
  const r = (await request(login)).data.request;
  await api("POST", `/teleconsultations/${r.id}/accept`, {}, operator);
  await api("POST", `/teleconsultations/${r.id}/assign`, { doctor_id: doctor.user.doctor_id }, operator);
  await api("POST", `/teleconsultations/${r.id}/start`, { consultation_code: r.consultation_code, checks_confirmed: true }, doctor);
  const body = { clinical_note: "PRIVATE-MINIMAL: findings and reasoning", patient_diagnosis: "Assessment discussed with patient" };
  const beforeCount = db.prepare("SELECT count(*) AS n FROM consultations WHERE patient_id=?").get(p.id).n;
  for (const invalid of [
    { ...body, clinical_note: " " }, { ...body, patient_diagnosis: " " },
    { doctor_notes: "Legacy-only note must not bypass structured fields" },
    { ...body, patient_summary: "x".repeat(10001) }, { ...body, patient_prescription: "x".repeat(10001) },
  ]) assert.equal((await api("POST", `/teleconsultations/${r.id}/complete`, invalid, doctor)).status, 400);
  assert.equal(db.prepare("SELECT count(*) AS n FROM consultations WHERE patient_id=?").get(p.id).n, beforeCount);
  const completed = await api("POST", `/teleconsultations/${r.id}/complete`, body, doctor);
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  assert.equal(completed.data.request.status, "completed");
  const notification = patientPush.mock.calls.filter(call => call.arguments[1].tag === `teleconsultation-${r.id}`).at(-1);
  assert.equal(notification.arguments[0], login.data.user.id);
  assert.equal(notification.arguments[1].title, "Your consultation record is ready");
  assert.equal(notification.arguments[1].url, `/health-records/visits/${completed.data.consultation_id}`);
  assert.ok(!JSON.stringify(notification.arguments[1]).includes("PRIVATE-MINIMAL"));
  assert.equal(completed.data.request.patient_summary, "");
  assert.equal(completed.data.request.follow_up, "");
  const consultation = db.prepare("SELECT clinical_note, patient_diagnosis, patient_prescription FROM consultations WHERE id=?").get(completed.data.consultation_id);
  assert.deepEqual(consultation, { ...body, patient_prescription: "" });
  const records = await api("GET", "/patient-portal/health-records", null, login);
  assert.ok(JSON.stringify(records.data).includes(body.patient_diagnosis));
  assert.equal(records.data.consultations.find(row => row.id === completed.data.consultation_id).visit_type, "Teleconsultation");
  const appointments = await api("GET", "/patient-portal/appointments", null, login);
  assert.equal(appointments.data.appointments.find(row => row.consultation_id === completed.data.consultation_id).kind, "teleconsultation");
  assert.ok(!JSON.stringify(records.data).includes("PRIVATE-MINIMAL"));
  assert.equal((await api("POST", `/teleconsultations/${r.id}/complete`, body, doctor)).status, 409);
  assert.equal((await request(login)).status, 409, "completion does not renew the previous triage approval");
  const next = await redeem(await invite(p));
  assert.equal(next.data.teleconsultation_ready, true);
  assert.equal((await request(login)).status, 409);
  assert.equal((await request(next)).status, 201);
});

test("wrong codes are limited; cancellation and referral remove codes and preserve next steps", async () => {
  const p=await patient(); const login=await redeem(await invite(p)); const r=(await request(login)).data.request;
  await api("POST", `/teleconsultations/${r.id}/accept`, {}, operator);
  await api("POST", `/teleconsultations/${r.id}/assign`, {doctor_id:doctor.user.doctor_id}, operator);
  for(let i=0;i<5;i++) assert.equal((await api("POST", `/teleconsultations/${r.id}/start`, {consultation_code:"000000",checks_confirmed:true}, doctor)).status,400);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/start`, {consultation_code:r.consultation_code,checks_confirmed:true}, doctor)).status,429);
  const referred=await api("POST", `/teleconsultations/${r.id}/close`, {outcome:"referred",outcome_note:"Physical examination needed",follow_up:"Operator coordinates assessment today"},doctor);
  assert.equal(referred.status,200); assert.equal(referred.data.request.consultation_code,null);
  assert.equal((await request(login)).status, 409);
  const freshLogin = await redeem(await invite(p));
  const next=(await request(freshLogin)).data.request; const cancelled=await api("POST",`/patient-portal/teleconsultations/${next.id}/cancel`,{},freshLogin);assert.equal(cancelled.status,200);assert.equal(cancelled.data.request.consultation_code,null);
  assert.equal((await request(freshLogin)).status, 409, "patient cancellation does not renew triage approval");
});
test("account schema migration preserves existing sessions and relationships and can run twice", () => {
  const Database=require("better-sqlite3"); const temp=new Database(":memory:"); temp.pragma("foreign_keys=ON");
  temp.exec(`CREATE TABLE patients(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE consultations(id INTEGER PRIMARY KEY);
    CREATE TABLE patient_users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, patient_id INTEGER REFERENCES patients(id));
    CREATE TABLE sessions(id INTEGER PRIMARY KEY, patient_user_id INTEGER REFERENCES patient_users(id) ON DELETE CASCADE);
    CREATE INDEX account_patient ON patient_users(patient_id);
    INSERT INTO patients VALUES(1); INSERT INTO patient_users VALUES(1,'original@example.test','original-hash',1); INSERT INTO sessions VALUES(1,1);`);
  ensurePatientOnboardingSchema(temp); ensurePatientOnboardingSchema(temp);
  assert.equal(temp.prepare("SELECT password_hash FROM patient_users WHERE id=1").get().password_hash,"original-hash");
  assert.equal(temp.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,1);
  assert.equal(temp.prepare("PRAGMA foreign_key_check").all().length,0);
  assert.equal(temp.pragma("foreign_keys",{simple:true}),1);
  temp.prepare("INSERT INTO patient_users (email,password_hash,patient_id) VALUES (NULL,NULL,1)").run(); temp.close();
});

test("screening migration preserves legacy triage history without granting reusable approval", () => {
  const Database = require("better-sqlite3"); const temp = new Database(":memory:"); temp.pragma("foreign_keys=ON");
  temp.exec(`CREATE TABLE patients(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE patient_users(id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT);
    CREATE TABLE patient_auth_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE teleconsultation_screenings(patient_id INTEGER PRIMARY KEY REFERENCES patients(id),
      screened_by INTEGER REFERENCES users(id), mobile_snapshot TEXT NOT NULL, screened_at TEXT NOT NULL);
    INSERT INTO patients VALUES(1); INSERT INTO users VALUES(1);
    INSERT INTO teleconsultation_screenings VALUES(1,1,'23052520142','2026-10-14 10:00:00');`);
  ensurePatientOnboardingSchema(temp); ensurePatientOnboardingSchema(temp);
  assert.deepEqual(temp.prepare("SELECT * FROM teleconsultation_screenings WHERE patient_id=1").get(), {
    patient_id: 1, screened_by: 1, mobile_snapshot: "23052520142", screened_at: "2026-10-14 10:00:00",
    magic_link_id: null, authorized_session_id: null, consumed_at: null,
  });
  assert.deepEqual(temp.prepare("PRAGMA foreign_key_check").all(), []); temp.close();
});

test("operator acceptance is durable, first-wins, role restricted and separate from viewing or assignment", async () => {
  const p = await patient(); const login = await redeem(await invite(p)); const r = (await request(login)).data.request;
  const inbox = () => api("GET", "/teleconsultations/unaccepted", null, operator);
  assert.ok((await inbox()).data.requests.some(row => row.id === r.id));
  await api("GET", "/teleconsultations", null, operator);
  assert.ok((await inbox()).data.requests.some(row => row.id === r.id));
  for (const actor of [doctor, accountant, training]) assert.equal((await api("POST", `/teleconsultations/${r.id}/accept`, {}, actor)).status, 403);
  assert.equal((await api("GET", "/teleconsultations/unaccepted", null, doctor)).status, 403);
  const results = await Promise.all([api("POST", `/teleconsultations/${r.id}/accept`, {}, operator), api("POST", `/teleconsultations/${r.id}/accept`, {}, admin)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? operator : admin;
  const accepted = db.prepare("SELECT accepted_by, accepted_at FROM teleconsultation_requests WHERE id=?").get(r.id);
  assert.equal(accepted.accepted_by, winner.user.id); assert.ok(accepted.accepted_at);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/accept`, {}, winner)).status, 200);
  assert.deepEqual(db.prepare("SELECT accepted_by, accepted_at FROM teleconsultation_requests WHERE id=?").get(r.id), accepted);
  assert.ok(!(await inbox()).data.requests.some(row => row.id === r.id));
  const visible = (await api("GET", "/patient-portal/teleconsultations", null, login)).data.requests.find(row => row.id === r.id);
  assert.equal(visible.accepted_at, accepted.accepted_at);
  assert.equal(visible.accepted_by, undefined); assert.equal(visible.accepted_by_name, undefined);
  const cancelled = (await request(await redeem(await invite(await patient())))).data.request;
  const closed = await api("POST", `/teleconsultations/${cancelled.id}/close`, { outcome: "cancelled", outcome_note: "Patient chose another appointment", follow_up: "Contact OCS if care is needed" }, operator);
  assert.equal(closed.status, 200);
  assert.equal((await api("POST", `/teleconsultations/${cancelled.id}/accept`, {}, operator)).status, 409);
  assert.ok(!(await inbox()).data.requests.some(row => row.id === cancelled.id));
  assert.equal((await api("POST", "/teleconsultations/999999/accept", {}, operator)).status, 404);
});

test("acceptance migration preserves old processed requests and leaves pending requests for explicit acceptance", () => {
  const Database = require("better-sqlite3"); const temp = new Database(":memory:"); temp.pragma("foreign_keys=ON");
  temp.exec(`CREATE TABLE patients(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE patient_users(id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT);
    CREATE TABLE teleconsultation_requests(id INTEGER PRIMARY KEY, patient_id INTEGER, status TEXT,
      assigned_by INTEGER, assigned_at TEXT, code_verified_at TEXT, created_at TEXT, updated_at TEXT, consultation_id INTEGER);
    INSERT INTO users VALUES(1);
    INSERT INTO teleconsultation_requests VALUES(1,1,'pending',NULL,NULL,NULL,'2026-10-12','2026-10-12',NULL);
    INSERT INTO teleconsultation_requests VALUES(2,2,'assigned',1,'2026-10-12 10:00:00',NULL,'2026-10-12','2026-10-12',NULL);
    INSERT INTO teleconsultation_requests VALUES(3,3,'cancelled',NULL,NULL,NULL,'2026-10-12','2026-10-12',NULL);`);
  ensurePatientOnboardingSchema(temp); ensurePatientOnboardingSchema(temp);
  assert.equal(temp.prepare("SELECT accepted_at FROM teleconsultation_requests WHERE id=1").get().accepted_at, null);
  assert.deepEqual(temp.prepare("SELECT accepted_by, accepted_at FROM teleconsultation_requests WHERE id=2").get(), { accepted_by: 1, accepted_at: "2026-10-12 10:00:00" });
  assert.equal(temp.prepare("SELECT accepted_at FROM teleconsultation_requests WHERE id=3").get().accepted_at, null);
  temp.exec("UPDATE teleconsultation_requests SET status='cancelled' WHERE id=1");
  ensurePatientOnboardingSchema(temp);
  assert.equal(temp.prepare("SELECT accepted_at FROM teleconsultation_requests WHERE id=1").get().accepted_at, null);
  assert.equal(temp.prepare("PRAGMA foreign_key_check").all().length, 0); temp.close();
});

test("every active request stays manageable after acceptance even with more than 100 waiting patients", async () => {
  const ids = [];
  for (let index = 0; index < 101; index += 1) {
    const login = await redeem(await invite(await patient()));
    const created = await request(login);
    assert.equal(created.status, 201); ids.push(created.data.request.id);
  }
  const list = (await api("GET", "/teleconsultations", null, operator)).data.requests;
  assert.ok(ids.every(id => list.some(row => row.id === id)));
  const alerts = (await api("GET", "/teleconsultations/unaccepted", null, operator)).data.requests;
  assert.ok(ids.every(id => alerts.some(row => row.id === id)));
  assert.equal((await api("POST", `/teleconsultations/${ids[0]}/accept`, {}, operator)).status, 200);
  assert.equal((await api("POST", `/teleconsultations/${ids[0]}/assign`, { doctor_id: doctor.user.doctor_id }, operator)).status, 200);
  const updated = (await api("GET", "/teleconsultations", null, operator)).data.requests.find(row => row.id === ids[0]);
  assert.equal(updated.status, "assigned");
  assert.ok((await api("GET", "/teleconsultations", null, doctor)).data.requests.some(row => row.id === ids[0]));
});

test("completed record amendments update Care, preserve private notes, and never infer an omitted prescription", async () => {
  const p = await patient(); const login = await redeem(await invite(p)); const r = (await request(login)).data.request;
  await api("POST", `/teleconsultations/${r.id}/accept`, {}, operator);
  await api("POST", `/teleconsultations/${r.id}/assign`, { doctor_id: doctor.user.doctor_id }, operator);
  await api("POST", `/teleconsultations/${r.id}/start`, { consultation_code: r.consultation_code, checks_confirmed: true }, doctor);
  const completed = await api("POST", `/teleconsultations/${r.id}/complete`, {
    clinical_note: "PRIVATE: considered Amoxicillin 500mg - take three times daily but NOT prescribed", patient_diagnosis: "Initial assessment", patient_summary: "Your agreed plan",
  }, doctor);
  assert.equal(completed.status, 200); const id = completed.data.consultation_id;
  let records = (await api("GET", "/patient-portal/health-records", null, login)).data;
  let record = records.consultations.find(row => row.id === id);
  assert.deepEqual(record.prescriptions, []); assert.equal(record.plain_summary, "Your agreed plan");
  assert.ok(!JSON.stringify(records).includes("Amoxicillin"));
  const saved = (await api("GET", `/consultations/${id}`, null, doctor)).data;
  assert.equal(saved.teleconsultation_id, r.id); assert.equal(saved.patient_summary, "Your agreed plan");
  const list = (await api("GET", "/consultations", null, doctor)).data.find(row => row.id === id);
  assert.equal(list.teleconsultation_id, r.id);
  assert.equal((await api("PUT", `/consultations/${id}`, { consultation_date: saved.consultation_date, doctor_notes: "Combined replacement" }, doctor)).status, 409);
  const amendment = { consultation_date: saved.consultation_date, clinical_note: "PRIVATE: amended reasoning", patient_diagnosis: "Updated assessment", patient_prescription: "Patient prescription", patient_summary: "Updated agreed plan" };
  assert.equal((await api("PUT", `/consultations/${id}`, { ...amendment, clinical_note: "", patient_diagnosis: "", patient_prescription: "" }, doctor)).status, 400);
  assert.equal((await api("PUT", `/consultations/${id}`, amendment, otherDoctor)).status, 403);
  assert.equal((await api("PUT", `/consultations/${id}`, amendment, operator)).status, 403);
  const amended = await api("PUT", `/consultations/${id}`, amendment, doctor);
  assert.equal(amended.status, 200, JSON.stringify(amended.data));
  records = (await api("GET", "/patient-portal/health-records", null, login)).data;
  record = records.consultations.find(row => row.id === id);
  assert.equal(record.diagnosis, amendment.patient_diagnosis); assert.equal(record.patient_prescription, amendment.patient_prescription); assert.equal(record.plain_summary, amendment.patient_summary);
  assert.ok(!JSON.stringify(records).includes("PRIVATE"));
  assert.equal((await api("GET", "/patient-portal/teleconsultations", null, login)).data.requests.find(row => row.id === r.id).patient_summary, amendment.patient_summary);
  const dashboard = (await api("GET", "/patient-portal/dashboard", null, login)).data;
  assert.ok(JSON.stringify(dashboard).includes(amendment.patient_diagnosis)); assert.ok(!JSON.stringify(dashboard).includes("PRIVATE"));
  // Clearing a prescription after amendment must also stay blank in Care.
  assert.equal((await api("PUT", `/consultations/${id}`, { ...amendment, clinical_note: "PRIVATE: Paracetamol 500mg - considered only", patient_prescription: "" }, doctor)).status, 200);
  records = (await api("GET", "/patient-portal/health-records", null, login)).data;
  assert.deepEqual(records.consultations.find(row => row.id === id).prescriptions, []);
  assert.ok(!JSON.stringify(records).includes("Paracetamol"));
  const billCount = db.prepare("SELECT count(*) AS n FROM billing WHERE consultation_id=?").get(id).n;
  assert.equal(billCount, 1, "amendments do not create a second bill");
  const voided = await api("DELETE", `/consultations/${id}`, { reason: "Duplicate record entered in error" }, admin);
  assert.equal(voided.status, 204, JSON.stringify(voided.data));
  assert.ok(!(await api("GET", "/patient-portal/health-records", null, login)).data.consultations.some(row => row.id === id));
  assert.ok(!(await api("GET", "/patient-portal/appointments", null, login)).data.appointments.some(row => row.consultation_id === id));
  assert.ok(!JSON.stringify((await api("GET", "/patient-portal/dashboard", null, login)).data).includes(amendment.patient_diagnosis));
  const withdrawn = (await api("GET", "/patient-portal/teleconsultations", null, login)).data.requests.find(row => row.id === r.id);
  assert.equal(withdrawn.record_withdrawn, true); assert.equal(withdrawn.consultation_id, null); assert.equal(withdrawn.patient_summary, "");
  assert.ok((await api("GET", `/consultations/${id}`, null, admin)).data.voided_at, "staff retain the audit record");
});

test("closed history is bounded independently from all active work and doctor scope", async () => {
  const p = await patient(); const login = await redeem(await invite(p));
  const created = (await request(login)).data.request;
  // One patient's earlier closed records cannot displace any active request.
  const insert = db.prepare(`INSERT INTO teleconsultation_requests (patient_id,patient_user_id,reason,current_location,callback_number,consultation_code,consent_version,consent_snapshot,status,assigned_doctor_id) VALUES (?,?, 'Earlier request','Moka','23052520142','123456',?,'[]','cancelled',?)`);
  db.transaction(() => { for (let i = 0; i < 101; i++) insert.run(p.id, login.data.user.id, CONSENT_VERSION, doctor.user.doctor_id); })();
  const all = (await api("GET", "/teleconsultations", null, operator)).data;
  assert.equal(all.has_more_history, true); assert.equal(all.requests.filter(row => !["pending", "assigned", "in_consultation"].includes(row.status)).length, 100);
  assert.ok(all.requests.some(row => row.id === created.id));
  const scoped = (await api("GET", "/teleconsultations", null, otherDoctor)).data.requests;
  assert.ok(scoped.every(row => row.assigned_doctor_id === otherDoctor.user.doctor_id));
});

test("referral and cancellation reject oversized next steps without closing the request", async () => {
  const login = await redeem(await invite(await patient())); const r = (await request(login)).data.request;
  const body = { outcome: "cancelled", outcome_note: "Patient requested a different route", follow_up: "Call OCS" };
  for (const field of ["outcome_note", "follow_up"]) assert.equal((await api("POST", `/teleconsultations/${r.id}/close`, { ...body, [field]: "x".repeat(2001) }, operator)).status, 400);
  assert.equal(db.prepare("SELECT status FROM teleconsultation_requests WHERE id=?").get(r.id).status, "pending");
});
test("request, acceptance, reassignment and completion notify the patient and correct staff without duplicate events", async () => {
  const { EventEmitter } = require("node:events");
  const { addInventoryStreamClient, addPatientStreamClient } = require("../src/lib/inventoryRealtime");
  const p = await patient(); const login = await redeem(await invite(p)); const otherPatient = await patient();
  function capture(actor, id) {
    const res = new EventEmitter(); res.frames = ""; res.write = value => { res.frames += value; return true; };
    if (actor) addInventoryStreamClient(res, actor.user); else addPatientStreamClient(res, id);
    res.frames = ""; return res;
  }
  const streams = { operator: capture(operator), admin: capture(admin), doctor: capture(doctor), otherDoctor: capture(otherDoctor), patient: capture(null, p.id), otherPatient: capture(null, otherPatient.id) };
  const count = name => (streams[name].frames.match(/event: patient_data_change/g) || []).length;
  const clear = () => Object.values(streams).forEach(res => { res.frames = ""; });
  try {
    const r = (await request(login)).data.request;
    assert.equal(count("operator"), 1); assert.equal(count("patient"), 1); assert.equal(count("doctor"), 0); assert.equal(count("otherPatient"), 0);
    clear(); await api("POST", `/teleconsultations/${r.id}/accept`, {}, operator);
    assert.equal(count("admin"), 1); assert.equal(count("patient"), 1);
    clear(); await api("POST", `/teleconsultations/${r.id}/assign`, { doctor_id: doctor.user.doctor_id }, operator);
    assert.equal(count("doctor"), 1); assert.equal(count("otherDoctor"), 0); assert.equal(count("patient"), 1);
    clear(); await api("POST", `/teleconsultations/${r.id}/assign`, { doctor_id: otherDoctor.user.doctor_id }, operator);
    assert.equal(count("doctor"), 1, "old doctor removes the reassigned request"); assert.equal(count("otherDoctor"), 1, "new doctor receives the request"); assert.equal(count("patient"), 1);
    assert.equal((await api("POST", `/teleconsultations/${r.id}/start`, { consultation_code: r.consultation_code, checks_confirmed: true }, doctor)).status, 403);
    clear(); await api("POST", `/teleconsultations/${r.id}/start`, { consultation_code: r.consultation_code, checks_confirmed: true }, otherDoctor);
    assert.equal(count("otherDoctor"), 1); assert.equal(count("doctor"), 0); assert.equal(count("patient"), 1);
    clear(); const completed = await api("POST", `/teleconsultations/${r.id}/complete`, { clinical_note: "PRIVATE findings", patient_diagnosis: "Shared assessment" }, otherDoctor);
    assert.equal(completed.status, 200); assert.equal(count("operator"), 1); assert.equal(count("otherDoctor"), 1); assert.equal(count("patient"), 1); assert.equal(count("otherPatient"), 0);
    for (const res of Object.values(streams)) assert.ok(!res.frames.includes("PRIVATE"), "refresh events carry no consultation content");
    assert.equal((await api("POST", `/teleconsultations/${r.id}/complete`, { clinical_note: "Retry", patient_diagnosis: "Retry" }, otherDoctor)).status, 409);
    assert.equal(db.prepare("SELECT count(*) AS n FROM consultations WHERE patient_id=?").get(p.id).n, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally { Object.values(streams).forEach(res => res.emit("close")); }
});

test("production invitation works without a newly added environment setting", async t => {
  const p = await patient();
  const previous = { nodeEnv: process.env.NODE_ENV, origin: process.env.PATIENT_PORTAL_ORIGIN, staffOrigin: process.env.CLIENT_ORIGIN };
  t.after(() => {
    process.env.NODE_ENV = previous.nodeEnv;
    process.env.PATIENT_PORTAL_ORIGIN = previous.origin;
    if (previous.staffOrigin === undefined) delete process.env.CLIENT_ORIGIN;
    else process.env.CLIENT_ORIGIN = previous.staffOrigin;
  });
  process.env.NODE_ENV = "production";
  delete process.env.PATIENT_PORTAL_ORIGIN;
  process.env.CLIENT_ORIGIN = "https://staff.ocsvp.com";
  const invitation = await invite(p);
  assert.equal(invitation.status, 201, JSON.stringify(invitation.data));
  assert.equal(new URL(invitation.data.url).origin, "https://ocsvp.com");
  assert.equal(new URL(invitation.data.url).pathname, "/sign-in-link");
  assert.equal(invitation.data.expires_in_seconds, 600);
});
