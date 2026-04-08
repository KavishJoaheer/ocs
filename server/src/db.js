const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const {
  calculateBillingTotal,
  getTodayLocal,
  normalizeBillingItems,
  offsetLocalDate,
} = require("./lib/utils");

const explicitDbPath = process.env.DB_PATH;
const volumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const isVercelRuntime = Boolean(process.env.VERCEL);
const defaultDbPath = path.join(
  volumeMountPath || (isVercelRuntime ? path.join("/tmp") : path.join(__dirname, "..", "data")),
  "clinic.db",
);
const dbPath = explicitDbPath || defaultDbPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      age INTEGER NOT NULL CHECK (age >= 0),
      contact_number TEXT NOT NULL,
      address TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      specialization TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      consultation_date TEXT NOT NULL,
      doctor_notes TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS billing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultation_id INTEGER NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL,
      items TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
      payment_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE RESTRICT,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
    CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
    CREATE INDEX IF NOT EXISTS idx_consultations_date ON consultations(consultation_date);
    CREATE INDEX IF NOT EXISTS idx_billing_status ON billing(status);
  `);

  seedDatabase();
}

function ensureBillingForConsultation(consultationId, patientId) {
  const existingBill = db
    .prepare("SELECT id FROM billing WHERE consultation_id = ?")
    .get(consultationId);

  if (existingBill) {
    return existingBill.id;
  }

  const items = normalizeBillingItems([
    {
      description: "Consultation Fee",
      amount: 0,
    },
  ]);

  const insert = db.prepare(`
    INSERT INTO billing (consultation_id, patient_id, items, total_amount, status)
    VALUES (?, ?, ?, ?, 'unpaid')
  `);

  const result = insert.run(
    consultationId,
    patientId,
    JSON.stringify(items),
    calculateBillingTotal(items),
  );

  return result.lastInsertRowid;
}

function seedDatabase() {
  const patientsCount = db.prepare("SELECT COUNT(*) AS count FROM patients").get().count;
  const doctorsCount = db.prepare("SELECT COUNT(*) AS count FROM doctors").get().count;
  const appointmentsCount = db.prepare("SELECT COUNT(*) AS count FROM appointments").get().count;

  const insertDoctor = db.prepare(`
    INSERT INTO doctors (full_name, specialization)
    VALUES (?, ?)
  `);

  const insertPatient = db.prepare(`
    INSERT INTO patients (full_name, age, contact_number, address)
    VALUES (?, ?, ?, ?)
  `);

  const insertAppointment = db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertConsultation = db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertBilling = db.prepare(`
    INSERT INTO billing (consultation_id, patient_id, items, total_amount, status, payment_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    if (doctorsCount === 0) {
      [
        ["Dr. Amelia Hart", "General Medicine"],
        ["Dr. Lucas Bennett", "Pediatrics"],
        ["Dr. Sofia Reyes", "Dermatology"],
      ].forEach((doctor) => insertDoctor.run(...doctor));
    }

    if (patientsCount === 0) {
      [
        ["John Carter", 34, "+1 555-0123", "18 Pine Avenue, Springfield"],
        ["Maya Singh", 27, "+1 555-0199", "42 Cedar Lane, Springfield"],
      ].forEach((patient) => insertPatient.run(...patient));
    }

    if (appointmentsCount === 0) {
      const appointmentIds = [];
      appointmentIds.push(
        insertAppointment.run(1, 1, getTodayLocal(), "09:30", "scheduled").lastInsertRowid,
      );
      appointmentIds.push(
        insertAppointment.run(2, 2, offsetLocalDate(2), "11:00", "scheduled").lastInsertRowid,
      );
      appointmentIds.push(
        insertAppointment.run(1, 3, offsetLocalDate(-1), "15:00", "completed").lastInsertRowid,
      );
      appointmentIds.push(
        insertAppointment.run(2, 1, getTodayLocal(), "14:30", "completed").lastInsertRowid,
      );

      const firstConsultationId = insertConsultation.run(
        appointmentIds[2],
        1,
        3,
        offsetLocalDate(-1),
        "Patient reported a persistent rash on the forearm. Prescribed a topical steroid and advised a 10-day review.",
      ).lastInsertRowid;

      const secondConsultationId = insertConsultation.run(
        appointmentIds[3],
        2,
        1,
        getTodayLocal(),
        "Follow-up consultation for fatigue and headaches. Ordered a CBC panel and advised hydration, rest, and a one-week follow-up.",
      ).lastInsertRowid;

      const paidItems = normalizeBillingItems([
        { description: "Dermatology Consultation", amount: 120 },
        { description: "Medication Guidance", amount: 25 },
      ]);
      const unpaidItems = normalizeBillingItems([
        { description: "General Consultation", amount: 95 },
        { description: "Lab Work Coordination", amount: 35 },
      ]);

      insertBilling.run(
        firstConsultationId,
        1,
        JSON.stringify(paidItems),
        calculateBillingTotal(paidItems),
        "paid",
        offsetLocalDate(-1),
      );

      insertBilling.run(
        secondConsultationId,
        2,
        JSON.stringify(unpaidItems),
        calculateBillingTotal(unpaidItems),
        "unpaid",
        null,
      );
    }
  });

  seed();
}

module.exports = {
  db,
  ensureBillingForConsultation,
  initializeDatabase,
};
