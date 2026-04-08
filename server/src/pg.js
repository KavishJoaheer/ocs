const { Pool } = require("pg");
const {
  calculateBillingTotal,
  getTodayLocal,
  normalizeBillingItems,
  offsetLocalDate,
} = require("./lib/utils");

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";

const hasPostgresConfig = Boolean(connectionString);

const pool = hasPostgresConfig
  ? new Pool({
      connectionString,
      ssl: connectionString.includes("localhost")
        ? false
        : {
            rejectUnauthorized: false,
          },
    })
  : null;

if (pool) {
  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error", error);
  });
}

let initPromise = null;

async function withTransaction(callback) {
  if (!pool) {
    throw new Error("PostgreSQL is not configured.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensurePostgresBillingForConsultation(client, consultationId, patientId) {
  const existing = await client.query(
    "SELECT id FROM billing WHERE consultation_id = $1",
    [consultationId],
  );

  if (existing.rowCount) {
    return Number(existing.rows[0].id);
  }

  const items = normalizeBillingItems([
    {
      description: "Consultation Fee",
      amount: 0,
    },
  ]);

  const result = await client.query(
    `
      INSERT INTO billing (consultation_id, patient_id, items, total_amount, status)
      VALUES ($1, $2, $3::jsonb, $4, 'unpaid')
      RETURNING id
    `,
    [
      consultationId,
      patientId,
      JSON.stringify(items),
      calculateBillingTotal(items),
    ],
  );

  return Number(result.rows[0].id);
}

async function seedDatabase() {
  await withTransaction(async (client) => {
    const result = await client.query(
      "INSERT INTO seed_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING RETURNING id",
    );

    if (!result.rowCount) {
      return;
    }

    const seededDoctors = [
      ["Dr. Amelia Hart", "General Medicine"],
      ["Dr. Lucas Bennett", "Pediatrics"],
      ["Dr. Sofia Reyes", "Dermatology"],
    ];

    for (const doctor of seededDoctors) {
      await client.query(
        "INSERT INTO doctors (full_name, specialization) VALUES ($1, $2)",
        doctor,
      );
    }

    const seededPatients = [
      ["John Carter", 34, "+1 555-0123", "18 Pine Avenue, Springfield"],
      ["Maya Singh", 27, "+1 555-0199", "42 Cedar Lane, Springfield"],
    ];

    for (const patient of seededPatients) {
      await client.query(
        `
          INSERT INTO patients (full_name, age, contact_number, address)
          VALUES ($1, $2, $3, $4)
        `,
        patient,
      );
    }

    const appointmentIds = [];
    appointmentIds.push(
      Number(
        (
          await client.query(
            `
              INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `,
            [1, 1, getTodayLocal(), "09:30", "scheduled"],
          )
        ).rows[0].id,
      ),
    );
    appointmentIds.push(
      Number(
        (
          await client.query(
            `
              INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `,
            [2, 2, offsetLocalDate(2), "11:00", "scheduled"],
          )
        ).rows[0].id,
      ),
    );
    appointmentIds.push(
      Number(
        (
          await client.query(
            `
              INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `,
            [1, 3, offsetLocalDate(-1), "15:00", "completed"],
          )
        ).rows[0].id,
      ),
    );
    appointmentIds.push(
      Number(
        (
          await client.query(
            `
              INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `,
            [2, 1, getTodayLocal(), "14:30", "completed"],
          )
        ).rows[0].id,
      ),
    );

    const firstConsultationId = Number(
      (
        await client.query(
          `
            INSERT INTO consultations (
              appointment_id,
              patient_id,
              doctor_id,
              consultation_date,
              doctor_notes
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
          `,
          [
            appointmentIds[2],
            1,
            3,
            offsetLocalDate(-1),
            "Patient reported a persistent rash on the forearm. Prescribed a topical steroid and advised a 10-day review.",
          ],
        )
      ).rows[0].id,
    );

    const secondConsultationId = Number(
      (
        await client.query(
          `
            INSERT INTO consultations (
              appointment_id,
              patient_id,
              doctor_id,
              consultation_date,
              doctor_notes
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
          `,
          [
            appointmentIds[3],
            2,
            1,
            getTodayLocal(),
            "Follow-up consultation for fatigue and headaches. Ordered a CBC panel and advised hydration, rest, and a one-week follow-up.",
          ],
        )
      ).rows[0].id,
    );

    const paidItems = normalizeBillingItems([
      { description: "Dermatology Consultation", amount: 120 },
      { description: "Medication Guidance", amount: 25 },
    ]);
    const unpaidItems = normalizeBillingItems([
      { description: "General Consultation", amount: 95 },
      { description: "Lab Work Coordination", amount: 35 },
    ]);

    await client.query(
      `
        INSERT INTO billing (
          consultation_id,
          patient_id,
          items,
          total_amount,
          status,
          payment_date
        )
        VALUES ($1, $2, $3::jsonb, $4, $5, $6)
      `,
      [
        firstConsultationId,
        1,
        JSON.stringify(paidItems),
        calculateBillingTotal(paidItems),
        "paid",
        offsetLocalDate(-1),
      ],
    );

    await client.query(
      `
        INSERT INTO billing (
          consultation_id,
          patient_id,
          items,
          total_amount,
          status,
          payment_date
        )
        VALUES ($1, $2, $3::jsonb, $4, $5, $6)
      `,
      [
        secondConsultationId,
        2,
        JSON.stringify(unpaidItems),
        calculateBillingTotal(unpaidItems),
        "unpaid",
        null,
      ],
    );
  });
}

async function initializePostgresDatabase() {
  if (!pool) {
    return;
  }

  if (!initPromise) {
    initPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS patients (
          id SERIAL PRIMARY KEY,
          full_name TEXT NOT NULL,
          age INTEGER NOT NULL CHECK (age >= 0),
          contact_number TEXT NOT NULL,
          address TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS doctors (
          id SERIAL PRIMARY KEY,
          full_name TEXT NOT NULL,
          specialization TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS appointments (
          id SERIAL PRIMARY KEY,
          patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
          doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
          appointment_date DATE NOT NULL,
          appointment_time TIME NOT NULL,
          status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS consultations (
          id SERIAL PRIMARY KEY,
          appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE RESTRICT,
          patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
          doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
          consultation_date DATE NOT NULL,
          doctor_notes TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS billing (
          id SERIAL PRIMARY KEY,
          consultation_id INTEGER NOT NULL UNIQUE REFERENCES consultations(id) ON DELETE RESTRICT,
          patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
          items JSONB NOT NULL,
          total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
          payment_date DATE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
        CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
        CREATE INDEX IF NOT EXISTS idx_consultations_date ON consultations(consultation_date);
        CREATE INDEX IF NOT EXISTS idx_billing_status ON billing(status);

        CREATE TABLE IF NOT EXISTS seed_control (
          id INTEGER PRIMARY KEY,
          seeded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await seedDatabase();
    })();
  }

  return initPromise;
}

async function query(text, params = []) {
  if (!pool) {
    throw new Error("PostgreSQL is not configured.");
  }

  return pool.query(text, params);
}

module.exports = {
  ensurePostgresBillingForConsultation,
  hasPostgresConfig,
  initializePostgresDatabase,
  query,
  withTransaction,
};
