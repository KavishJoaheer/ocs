const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
process.env.DB_PATH = path.join(os.tmpdir(), `ocs-teleconsultation-${process.pid}.db`);
process.env.NODE_ENV = "test";
process.env.PATIENT_PORTAL_ORIGIN = "http://localhost:5174";
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
test("wrong codes are limited; cancellation and referral remove codes and preserve next steps", async () => {
  const p=await patient(); const login=await redeem(await invite(p)); const r=(await request(login)).data.request;
  await api("POST", `/teleconsultations/${r.id}/assign`, {doctor_id:doctor.user.doctor_id}, operator);
  for(let i=0;i<5;i++) assert.equal((await api("POST", `/teleconsultations/${r.id}/start`, {consultation_code:"000000",checks_confirmed:true}, doctor)).status,400);
  assert.equal((await api("POST", `/teleconsultations/${r.id}/start`, {consultation_code:r.consultation_code,checks_confirmed:true}, doctor)).status,429);
  const referred=await api("POST", `/teleconsultations/${r.id}/close`, {outcome:"referred",outcome_note:"Physical examination needed",follow_up:"Operator coordinates assessment today"},doctor);
  assert.equal(referred.status,200); assert.equal(referred.data.request.consultation_code,null);
  const next=(await request(login)).data.request; const cancelled=await api("POST",`/patient-portal/teleconsultations/${next.id}/cancel`,{},login);assert.equal(cancelled.status,200);assert.equal(cancelled.data.request.consultation_code,null);
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
