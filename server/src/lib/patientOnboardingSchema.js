// Invited patients authenticate without an invented email address or password.
// Rebuild only the two legacy NOT NULL constraints; preserve all rows, indexes,
// triggers and foreign-key references to the original table name.
function ensurePatientOnboardingSchema(db) {
  const columns = db.prepare("PRAGMA table_info(patient_users)").all();
  if (columns.some(c => ["email", "password_hash"].includes(c.name) && c.notnull)) {
    const original = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='patient_users'").get().sql;
    const extras = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='patient_users' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
    const schema = original.replace(/CREATE TABLE(?: IF NOT EXISTS)?\s+patient_users/i, "CREATE TABLE patient_users_onboarding")
      .replace(/email TEXT NOT NULL/i, "email TEXT")
      .replace(/password_hash TEXT NOT NULL/i, "password_hash TEXT");
    const names = columns.map(c => `"${c.name}"`).join(", ");
    const foreignKeys = db.pragma("foreign_keys", { simple: true });
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(schema);
        db.exec(`INSERT INTO patient_users_onboarding (${names}) SELECT ${names} FROM patient_users`);
        db.exec("DROP TABLE patient_users; ALTER TABLE patient_users_onboarding RENAME TO patient_users");
        extras.forEach(row => db.exec(row.sql));
        if (db.prepare("PRAGMA foreign_key_check(patient_users)").all().length) throw new Error("Patient account migration failed integrity checks.");
      })();
    } finally { db.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`); }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS patient_magic_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    patient_user_id INTEGER REFERENCES patient_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    phone_snapshot TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_patient_magic_links_patient ON patient_magic_links(patient_id);
  CREATE TABLE IF NOT EXISTS teleconsultation_screenings (
    patient_id INTEGER PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    screened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    mobile_snapshot TEXT NOT NULL,
    screened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS teleconsultation_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    patient_user_id INTEGER NOT NULL REFERENCES patient_users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    current_location TEXT NOT NULL,
    callback_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','assigned','in_consultation','completed','cancelled','referred')),
    consultation_code TEXT NOT NULL,
    consent_version TEXT NOT NULL,
    consent_snapshot TEXT NOT NULL,
    consented_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_doctor_id INTEGER REFERENCES doctors(id),
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TEXT,
    code_verified_at TEXT,
    code_attempts INTEGER NOT NULL DEFAULT 0,
    consultation_id INTEGER REFERENCES consultations(id) ON DELETE SET NULL,
    patient_summary TEXT NOT NULL DEFAULT '',
    follow_up TEXT NOT NULL DEFAULT '',
    outcome_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_teleconsultation_active_patient ON teleconsultation_requests(patient_id)
    WHERE status IN ('pending','assigned','in_consultation');`);
}
module.exports = { ensurePatientOnboardingSchema };
