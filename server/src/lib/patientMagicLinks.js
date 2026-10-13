const { db } = require("../db");
const { generateSessionToken, hashSessionToken, getSessionExpiryTimestamp } = require("./security");
const { getPatientPortalOrigin } = require("./mailer");

function normalizeMobile(value) {
  let digits = String(value || "").replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `230${digits}`;
  return /^2305\d{7}$/.test(digits) ? digits : "";
}
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function issuePatientMagicLink(patientId, actor, body) {
  if (!["admin", "operator"].includes(actor.role) || actor.is_read_only) fail("Only authorised operators and administrators can issue invitations.", 403);
  const portalUrl = new URL(getPatientPortalOrigin());
  if (process.env.NODE_ENV === "production" && (!process.env.PATIENT_PORTAL_ORIGIN || portalUrl.protocol !== "https:")) {
    fail("Configure PATIENT_PORTAL_ORIGIN with the HTTPS OCS Care address before issuing invitations.", 503);
  }
  if (body.identity_confirmed !== true || body.mobile_confirmed !== true) fail("Confirm the patient’s identity and personal mobile number first.");
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const result = db.transaction(() => {
    const patient = db.prepare("SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL").get(patientId);
    if (!patient) fail("Patient not found.", 404);
    if (patient.parent_patient_id) fail("Use the verified guardian account for a dependent patient.");
    const mobile = normalizeMobile(patient.patient_contact_number);
    if (!mobile || mobile !== normalizeMobile(body.mobile)) fail("Confirm the patient’s own Mauritius mobile number saved in VP.");
    const users = db.prepare("SELECT * FROM patient_users WHERE patient_id = ?").all(patientId);
    if (users.length > 1) fail("Resolve the duplicate patient accounts before issuing an invitation.", 409);
    const user = users[0];
    if (user && (!user.is_active || !["verified", "staff_created"].includes(patient.link_status))) fail("Confirm the existing account’s ownership before issuing an invitation.", 409);
    if (user?.phone && normalizeMobile(user.phone) !== mobile) fail("The account mobile differs from the clinic record. Verify the change before continuing.", 409);
    db.prepare("UPDATE patient_magic_links SET revoked_at = CURRENT_TIMESTAMP WHERE patient_id = ? AND used_at IS NULL AND revoked_at IS NULL").run(patientId);
    db.prepare(`INSERT INTO patient_magic_links (patient_id, patient_user_id, token_hash, phone_snapshot, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(patientId, user?.id || null, hashSessionToken(token), mobile, actor.id, expiresAt);
    if (body.teleconsultation_screened === true) {
      db.prepare(`INSERT INTO teleconsultation_screenings (patient_id, screened_by, mobile_snapshot) VALUES (?, ?, ?)
        ON CONFLICT(patient_id) DO UPDATE SET screened_by=excluded.screened_by, mobile_snapshot=excluded.mobile_snapshot, screened_at=CURRENT_TIMESTAMP`)
        .run(patientId, actor.id, mobile);
    }
    return { mobile };
  })();
  // Fragment avoids sending the credential in HTTP URLs, access logs or referrers.
  const link = new URL("/sign-in-link", portalUrl);
  link.hash = `token=${token}`;
  return { url: link.href, mobile: result.mobile, expires_at: `${expiresAt.replace(" ", "T")}Z`, expires_in_seconds: 600,
    message: `OCS Médecins: Open your personal OCS Care sign-in link: ${link.href}\nValid for 10 minutes and one use. Keep this link private. OCS will never ask for your account password or WhatsApp registration code.` };
}
function redeemPatientMagicLink(rawToken) {
  const token = String(rawToken || "");
  if (!/^[a-f0-9]{64}$/.test(token)) fail("This sign-in link is invalid, expired or already used. Please ask OCS for a new link.", 401);
  return db.transaction(() => {
    const link = db.prepare(`SELECT * FROM patient_magic_links WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`).get(hashSessionToken(token));
    if (!link) fail("This sign-in link is invalid, expired or already used. Please ask OCS for a new link.", 401);
    const patient = db.prepare("SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL").get(link.patient_id);
    const issuer = db.prepare("SELECT * FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL").get(link.created_by);
    if (!patient || patient.parent_patient_id || !issuer || !["admin", "operator"].includes(issuer.role) || normalizeMobile(patient.patient_contact_number) !== link.phone_snapshot) fail("This invitation is no longer available. Please contact OCS.", 401);
    let user = db.prepare("SELECT * FROM patient_users WHERE patient_id = ?").all(patient.id);
    if (user.length > 1) fail("Please contact OCS to confirm your account.", 401);
    user = user[0];
    if (link.patient_user_id && Number(user?.id) !== Number(link.patient_user_id)) fail("This invitation is no longer available. Please contact OCS.", 401);
    if (user && (!user.is_active || !["verified", "staff_created"].includes(patient.link_status) || (user.phone && normalizeMobile(user.phone) !== link.phone_snapshot))) fail("Please contact OCS to confirm your account.", 401);
    if (!user) {
      const id = db.prepare(`INSERT INTO patient_users (email, password_hash, patient_id, full_name, phone, date_of_birth, gender, welcome_story_created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .run(patient.id, patient.full_name, link.phone_snapshot, patient.date_of_birth || "", patient.gender).lastInsertRowid;
      db.prepare("UPDATE patients SET link_status = 'verified' WHERE id = ?").run(patient.id);
      user = db.prepare("SELECT * FROM patient_users WHERE id = ?").get(id);
    }
    db.prepare("UPDATE patient_magic_links SET used_at = CURRENT_TIMESTAMP, patient_user_id = ? WHERE id = ?").run(user.id, link.id);
    const sessionToken = generateSessionToken();
    db.prepare("INSERT INTO patient_auth_sessions (patient_user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(user.id, hashSessionToken(sessionToken), getSessionExpiryTimestamp());
    return { user, token: sessionToken };
  })();
}
module.exports = { normalizeMobile, issuePatientMagicLink, redeemPatientMagicLink };
