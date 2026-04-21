const express = require("express");
const cors = require("cors");
const {
  calculateBillingTotal,
  getTodayLocal,
  normalizeBillingItems,
  offsetLocalDate,
  parseBillingRow,
  toNumber,
  toPagination,
} = require("./lib/utils");
const {
  ensurePostgresBillingForConsultation,
  initializePostgresDatabase,
  query,
  withTransaction,
} = require("./pg");

function getAllowedOrigins() {
  return (process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function createPostgresApp() {
  const app = express();
  const configuredOrigins = getAllowedOrigins();
  const validAppointmentStatuses = new Set(["scheduled", "completed", "cancelled"]);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || configuredOrigins.length === 0 || configuredOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(async (_req, _res, next) => {
    try {
      await initializePostgresDatabase();
      next();
    } catch (error) {
      next(error);
    }
  });

  function validatePatientPayload(body) {
    const fullName = String(body.full_name ?? "").trim();
    const age = Number(body.age);
    const contactNumber = String(body.contact_number ?? "").trim();
    const address = String(body.address ?? "").trim();

    if (!fullName) return "Full name is required.";
    if (!Number.isInteger(age) || age < 0) return "Age must be a valid non-negative number.";
    if (!contactNumber) return "Contact number is required.";
    if (!address) return "Address is required.";

    return null;
  }

  function validateDoctorPayload(body) {
    const fullName = String(body.full_name ?? "").trim();
    const specialization = String(body.specialization ?? "").trim();

    if (!fullName) return "Full name is required.";
    if (!specialization) return "Specialization is required.";

    return null;
  }

  function validateAppointmentPayload(body) {
    const patientId = Number(body.patient_id);
    const doctorId = Number(body.doctor_id);
    const appointmentDate = String(body.appointment_date ?? "").trim();
    const appointmentTime = String(body.appointment_time ?? "").trim();
    const status = String(body.status ?? "scheduled").trim();

    if (!Number.isInteger(patientId) || patientId <= 0) return "Patient selection is required.";
    if (!Number.isInteger(doctorId) || doctorId <= 0) return "Doctor selection is required.";
    if (!appointmentDate) return "Appointment date is required.";
    if (!appointmentTime) return "Appointment time is required.";
    if (!validAppointmentStatuses.has(status)) return "Appointment status is invalid.";

    return null;
  }

  function validateConsultationPayload(body) {
    const appointmentId = Number(body.appointment_id);
    const consultationDate = String(body.consultation_date ?? "").trim();
    const doctorNotes = String(body.doctor_notes ?? "").trim();

    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      return "Appointment selection is required.";
    }
    if (!consultationDate) return "Consultation date is required.";
    if (!doctorNotes) return "Doctor notes are required.";

    return null;
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mode: "postgres" });
  });

  app.get("/api/dashboard", async (_req, res) => {
    const today = getTodayLocal();
    const nextWeek = offsetLocalDate(7);

    const totals = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM patients) AS total_patients,
        (SELECT COUNT(*)::int FROM appointments WHERE appointment_date = CURRENT_DATE) AS todays_appointments,
        (SELECT COUNT(*)::int FROM billing WHERE status = 'unpaid') AS pending_bills,
        (SELECT COALESCE(SUM(total_amount), 0)::float FROM billing WHERE status = 'paid') AS total_revenue
    `);

    const upcomingAppointments = (
      await query(
        `
          SELECT
            a.id,
            a.appointment_date::text AS appointment_date,
            to_char(a.appointment_time, 'HH24:MI') AS appointment_time,
            a.status,
            p.full_name AS patient_name,
            d.full_name AS doctor_name,
            d.specialization
          FROM appointments a
          JOIN patients p ON p.id = a.patient_id
          JOIN doctors d ON d.id = a.doctor_id
          WHERE a.appointment_date BETWEEN $1 AND $2
          ORDER BY a.appointment_date ASC, a.appointment_time ASC
          LIMIT 10
        `,
        [today, nextWeek],
      )
    ).rows;

    const recentActivity = (
      await query(`
        SELECT * FROM (
          SELECT
            'appointment' AS type,
            a.created_at::text AS activity_at,
            CASE
              WHEN a.status = 'completed' THEN 'Appointment completed'
              WHEN a.status = 'cancelled' THEN 'Appointment cancelled'
              ELSE 'Appointment scheduled'
            END AS title,
            p.full_name AS patient_name,
            d.full_name AS doctor_name,
            a.appointment_date::text AS reference_date,
            to_char(a.appointment_time, 'HH24:MI') AS reference_time,
            'Status: ' || a.status AS detail
          FROM appointments a
          JOIN patients p ON p.id = a.patient_id
          JOIN doctors d ON d.id = a.doctor_id

          UNION ALL

          SELECT
            'consultation' AS type,
            c.created_at::text AS activity_at,
            'Consultation saved' AS title,
            p.full_name AS patient_name,
            d.full_name AS doctor_name,
            c.consultation_date::text AS reference_date,
            NULL AS reference_time,
            LEFT(c.doctor_notes, 110) AS detail
          FROM consultations c
          JOIN patients p ON p.id = c.patient_id
          JOIN doctors d ON d.id = c.doctor_id

          UNION ALL

          SELECT
            'billing' AS type,
            b.created_at::text AS activity_at,
            CASE WHEN b.status = 'paid' THEN 'Payment recorded' ELSE 'Bill generated' END AS title,
            p.full_name AS patient_name,
            NULL AS doctor_name,
            COALESCE(b.payment_date::text, b.created_at::text) AS reference_date,
            NULL AS reference_time,
            'Amount: Rs ' || TO_CHAR(COALESCE(b.total_amount, 0)::numeric, 'FM999999990.00') AS detail
          FROM billing b
          JOIN patients p ON p.id = b.patient_id
        ) activities
        ORDER BY activity_at DESC
        LIMIT 8
      `)
    ).rows;

    const summary = totals.rows[0];

    res.json({
      summary: {
        totalPatients: Number(summary.total_patients),
        todaysAppointments: Number(summary.todays_appointments),
        pendingBills: Number(summary.pending_bills),
        totalRevenue: toNumber(summary.total_revenue, 0),
      },
      upcomingAppointments,
      recentActivity,
    });
  });

  app.get("/api/patients/options", async (_req, res) => {
    const patients = (
      await query("SELECT id, full_name FROM patients ORDER BY full_name ASC")
    ).rows;
    res.json(patients);
  });

  app.get("/api/patients", async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const searchTerm = `%${search}%`;
    const { page, limit, offset } = toPagination(req.query.page, req.query.limit, 8);

    const total = Number(
      (
        await query(
          `
            SELECT COUNT(*)::int AS count
            FROM patients
            WHERE $1 = ''
              OR full_name ILIKE $2
              OR contact_number ILIKE $2
              OR address ILIKE $2
          `,
          [search, searchTerm],
        )
      ).rows[0].count,
    );

    const patients = (
      await query(
        `
          SELECT
            p.id,
            p.full_name,
            p.age,
            p.contact_number,
            p.address,
            p.created_at::text AS created_at,
            COUNT(DISTINCT a.id)::int AS appointment_count,
            COUNT(DISTINCT c.id)::int AS consultation_count,
            COUNT(DISTINCT b.id)::int AS bill_count
          FROM patients p
          LEFT JOIN appointments a ON a.patient_id = p.id
          LEFT JOIN consultations c ON c.patient_id = p.id
          LEFT JOIN billing b ON b.patient_id = p.id
          WHERE $1 = ''
            OR p.full_name ILIKE $2
            OR p.contact_number ILIKE $2
            OR p.address ILIKE $2
          GROUP BY p.id
          ORDER BY p.created_at DESC, p.full_name ASC
          LIMIT $3 OFFSET $4
        `,
        [search, searchTerm, limit, offset],
      )
    ).rows;

    res.json({
      items: patients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  });

  app.get("/api/patients/:id", async (req, res) => {
    const patientId = Number(req.params.id);
    const patientResult = await query(
      `
        SELECT
          id,
          full_name,
          age,
          contact_number,
          address,
          created_at::text AS created_at
        FROM patients
        WHERE id = $1
      `,
      [patientId],
    );

    if (!patientResult.rowCount) {
      return res.status(404).json({ error: "Patient not found." });
    }

    const appointments = (
      await query(
        `
          SELECT
            a.id,
            a.patient_id,
            a.doctor_id,
            a.appointment_date::text AS appointment_date,
            to_char(a.appointment_time, 'HH24:MI') AS appointment_time,
            a.status,
            a.created_at::text AS created_at,
            d.full_name AS doctor_name,
            d.specialization,
            c.id AS consultation_id
          FROM appointments a
          JOIN doctors d ON d.id = a.doctor_id
          LEFT JOIN consultations c ON c.appointment_id = a.id
          WHERE a.patient_id = $1
          ORDER BY a.appointment_date DESC, a.appointment_time DESC
        `,
        [patientId],
      )
    ).rows;

    const consultations = (
      await query(
        `
          SELECT
            c.id,
            c.appointment_id,
            c.patient_id,
            c.doctor_id,
            c.consultation_date::text AS consultation_date,
            c.doctor_notes,
            c.created_at::text AS created_at,
            d.full_name AS doctor_name,
            d.specialization,
            a.appointment_date::text AS appointment_date,
            to_char(a.appointment_time, 'HH24:MI') AS appointment_time
          FROM consultations c
          JOIN doctors d ON d.id = c.doctor_id
          JOIN appointments a ON a.id = c.appointment_id
          WHERE c.patient_id = $1
          ORDER BY c.consultation_date DESC, c.created_at DESC
        `,
        [patientId],
      )
    ).rows;

    const bills = (
      await query(
        `
          SELECT
            b.id,
            b.consultation_id,
            b.patient_id,
            b.items,
            b.total_amount,
            b.status,
            b.payment_date::text AS payment_date,
            b.created_at::text AS created_at,
            c.consultation_date::text AS consultation_date,
            d.full_name AS doctor_name
          FROM billing b
          JOIN consultations c ON c.id = b.consultation_id
          JOIN doctors d ON d.id = c.doctor_id
          WHERE b.patient_id = $1
          ORDER BY b.created_at DESC
        `,
        [patientId],
      )
    ).rows.map(parseBillingRow);

    return res.json({
      patient: patientResult.rows[0],
      appointments,
      consultations,
      bills,
    });
  });

  app.post("/api/patients", async (req, res) => {
    const validationError = validatePatientPayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = await query(
      `
        INSERT INTO patients (full_name, age, contact_number, address)
        VALUES ($1, $2, $3, $4)
        RETURNING id, full_name, age, contact_number, address, created_at::text AS created_at
      `,
      [
        String(req.body.full_name).trim(),
        Number(req.body.age),
        String(req.body.contact_number).trim(),
        String(req.body.address).trim(),
      ],
    );

    res.status(201).json(result.rows[0]);
  });

  app.put("/api/patients/:id", async (req, res) => {
    const patientId = Number(req.params.id);
    const existing = await query("SELECT id FROM patients WHERE id = $1", [patientId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Patient not found." });

    const validationError = validatePatientPayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const updated = await query(
      `
        UPDATE patients
        SET full_name = $1, age = $2, contact_number = $3, address = $4
        WHERE id = $5
        RETURNING id, full_name, age, contact_number, address, created_at::text AS created_at
      `,
      [
        String(req.body.full_name).trim(),
        Number(req.body.age),
        String(req.body.contact_number).trim(),
        String(req.body.address).trim(),
        patientId,
      ],
    );

    res.json(updated.rows[0]);
  });

  app.delete("/api/patients/:id", async (req, res) => {
    const patientId = Number(req.params.id);
    const existing = await query("SELECT id FROM patients WHERE id = $1", [patientId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Patient not found." });

    const relationCounts = (
      await query(
        `
          SELECT
            (SELECT COUNT(*)::int FROM appointments WHERE patient_id = $1) AS appointments,
            (SELECT COUNT(*)::int FROM consultations WHERE patient_id = $1) AS consultations,
            (SELECT COUNT(*)::int FROM billing WHERE patient_id = $1) AS bills
        `,
        [patientId],
      )
    ).rows[0];

    if (relationCounts.appointments || relationCounts.consultations || relationCounts.bills) {
      return res.status(400).json({
        error: "This patient has linked clinical records and cannot be deleted.",
      });
    }

    await query("DELETE FROM patients WHERE id = $1", [patientId]);
    return res.status(204).end();
  });

  app.get("/api/doctors", async (_req, res) => {
    const doctors = (
      await query(`
        SELECT
          d.id,
          d.full_name,
          d.specialization,
          COUNT(DISTINCT a.id)::int AS appointment_count,
          COUNT(DISTINCT c.id)::int AS consultation_count
        FROM doctors d
        LEFT JOIN appointments a ON a.doctor_id = d.id
        LEFT JOIN consultations c ON c.doctor_id = d.id
        GROUP BY d.id
        ORDER BY d.full_name ASC
      `)
    ).rows;

    res.json(doctors);
  });

  app.post("/api/doctors", async (req, res) => {
    const validationError = validateDoctorPayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = await query(
      `
        INSERT INTO doctors (full_name, specialization)
        VALUES ($1, $2)
        RETURNING id, full_name, specialization
      `,
      [String(req.body.full_name).trim(), String(req.body.specialization).trim()],
    );

    res.status(201).json(result.rows[0]);
  });

  app.put("/api/doctors/:id", async (req, res) => {
    const doctorId = Number(req.params.id);
    const existing = await query("SELECT id FROM doctors WHERE id = $1", [doctorId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Doctor not found." });

    const validationError = validateDoctorPayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = await query(
      `
        UPDATE doctors
        SET full_name = $1, specialization = $2
        WHERE id = $3
        RETURNING id, full_name, specialization
      `,
      [String(req.body.full_name).trim(), String(req.body.specialization).trim(), doctorId],
    );

    res.json(result.rows[0]);
  });

  app.delete("/api/doctors/:id", async (req, res) => {
    const doctorId = Number(req.params.id);
    const existing = await query("SELECT id FROM doctors WHERE id = $1", [doctorId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Doctor not found." });

    const linked = (
      await query(
        `
          SELECT
            (SELECT COUNT(*)::int FROM appointments WHERE doctor_id = $1) AS appointments,
            (SELECT COUNT(*)::int FROM consultations WHERE doctor_id = $1) AS consultations
        `,
        [doctorId],
      )
    ).rows[0];

    if (linked.appointments || linked.consultations) {
      return res.status(400).json({
        error: "This doctor has linked appointments or consultations and cannot be deleted.",
      });
    }

    await query("DELETE FROM doctors WHERE id = $1", [doctorId]);
    res.status(204).end();
  });

  app.get("/api/appointments", async (req, res) => {
    const conditions = [];
    const params = [];

    if (req.query.doctorId) {
      params.push(Number(req.query.doctorId));
      conditions.push(`a.doctor_id = $${params.length}`);
    }

    if (req.query.status) {
      params.push(String(req.query.status).trim());
      conditions.push(`a.status = $${params.length}`);
    }

    if (req.query.dateFrom) {
      params.push(String(req.query.dateFrom).trim());
      conditions.push(`a.appointment_date >= $${params.length}`);
    }

    if (req.query.dateTo) {
      params.push(String(req.query.dateTo).trim());
      conditions.push(`a.appointment_date <= $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const appointments = (
      await query(
        `
          SELECT
            a.id,
            a.patient_id,
            a.doctor_id,
            a.appointment_date::text AS appointment_date,
            to_char(a.appointment_time, 'HH24:MI') AS appointment_time,
            a.status,
            a.created_at::text AS created_at,
            p.full_name AS patient_name,
            d.full_name AS doctor_name,
            d.specialization,
            c.id AS consultation_id
          FROM appointments a
          JOIN patients p ON p.id = a.patient_id
          JOIN doctors d ON d.id = a.doctor_id
          LEFT JOIN consultations c ON c.appointment_id = a.id
          ${where}
          ORDER BY a.appointment_date ASC, a.appointment_time ASC
        `,
        params,
      )
    ).rows;

    res.json(appointments);
  });

  app.post("/api/appointments", async (req, res) => {
    const validationError = validateAppointmentPayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const patient = await query("SELECT id FROM patients WHERE id = $1", [
      Number(req.body.patient_id),
    ]);
    const doctor = await query("SELECT id FROM doctors WHERE id = $1", [
      Number(req.body.doctor_id),
    ]);

    if (!patient.rowCount || !doctor.rowCount) {
      return res.status(400).json({ error: "Patient or doctor record does not exist." });
    }

    const created = (
      await query(
        `
          INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `,
        [
          Number(req.body.patient_id),
          Number(req.body.doctor_id),
          String(req.body.appointment_date).trim(),
          String(req.body.appointment_time).trim(),
          String(req.body.status ?? "scheduled").trim(),
        ],
      )
    ).rows[0];

    const appointment = (
      await query(
        `
          SELECT
            a.id,
            a.patient_id,
            a.doctor_id,
            a.appointment_date::text AS appointment_date,
            to_char(a.appointment_time, 'HH24:MI') AS appointment_time,
            a.status,
            a.created_at::text AS created_at,
            p.full_name AS patient_name,
            d.full_name AS doctor_name,
            d.specialization
          FROM appointments a
          JOIN patients p ON p.id = a.patient_id
          JOIN doctors d ON d.id = a.doctor_id
          WHERE a.id = $1
        `,
        [created.id],
      )
    ).rows[0];

    res.status(201).json(appointment);
  });

  app.put("/api/appointments/:id", async (req, res) => {
    const appointmentId = Number(req.params.id);
    const existing = await query("SELECT id FROM appointments WHERE id = $1", [appointmentId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Appointment not found." });

    const validationError = validateAppointmentPayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    await query(
      `
        UPDATE appointments
        SET patient_id = $1, doctor_id = $2, appointment_date = $3, appointment_time = $4, status = $5
        WHERE id = $6
      `,
      [
        Number(req.body.patient_id),
        Number(req.body.doctor_id),
        String(req.body.appointment_date).trim(),
        String(req.body.appointment_time).trim(),
        String(req.body.status ?? "scheduled").trim(),
        appointmentId,
      ],
    );

    const appointment = (
      await query(
        `
          SELECT
            a.id,
            a.patient_id,
            a.doctor_id,
            a.appointment_date::text AS appointment_date,
            to_char(a.appointment_time, 'HH24:MI') AS appointment_time,
            a.status,
            a.created_at::text AS created_at,
            p.full_name AS patient_name,
            d.full_name AS doctor_name,
            d.specialization,
            c.id AS consultation_id
          FROM appointments a
          JOIN patients p ON p.id = a.patient_id
          JOIN doctors d ON d.id = a.doctor_id
          LEFT JOIN consultations c ON c.appointment_id = a.id
          WHERE a.id = $1
        `,
        [appointmentId],
      )
    ).rows[0];

    res.json(appointment);
  });

  app.patch("/api/appointments/:id/status", async (req, res) => {
    const appointmentId = Number(req.params.id);
    const status = String(req.body.status ?? "").trim();

    if (!validAppointmentStatuses.has(status)) {
      return res.status(400).json({ error: "Appointment status is invalid." });
    }

    const existing = await query("SELECT id FROM appointments WHERE id = $1", [appointmentId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Appointment not found." });

    const updated = (
      await query(
        `
          UPDATE appointments
          SET status = $1
          WHERE id = $2
          RETURNING
            id,
            patient_id,
            doctor_id,
            appointment_date::text AS appointment_date,
            to_char(appointment_time, 'HH24:MI') AS appointment_time,
            status,
            created_at::text AS created_at
        `,
        [status, appointmentId],
      )
    ).rows[0];

    res.json(updated);
  });

  app.delete("/api/appointments/:id", async (req, res) => {
    const appointmentId = Number(req.params.id);
    const existing = await query("SELECT id FROM appointments WHERE id = $1", [appointmentId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Appointment not found." });

    const consultation = await query(
      "SELECT id FROM consultations WHERE appointment_id = $1",
      [appointmentId],
    );

    if (consultation.rowCount) {
      return res.status(400).json({
        error: "This appointment already has a consultation record and cannot be deleted.",
      });
    }

    await query("DELETE FROM appointments WHERE id = $1", [appointmentId]);
    res.status(204).end();
  });

  app.get("/api/consultations/available-appointments", async (_req, res) => {
    const appointments = (
      await query(`
        SELECT
          a.id,
          a.appointment_date::text AS appointment_date,
          to_char(a.appointment_time, 'HH24:MI') AS appointment_time,
          a.status,
          p.full_name AS patient_name,
          d.full_name AS doctor_name,
          d.specialization
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN doctors d ON d.id = a.doctor_id
        LEFT JOIN consultations c ON c.appointment_id = a.id
        WHERE c.id IS NULL
          AND a.status != 'cancelled'
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
      `)
    ).rows;

    res.json(appointments);
  });

  app.get("/api/consultations", async (_req, res) => {
    const consultations = (
      await query(`
        SELECT
          c.id,
          c.appointment_id,
          c.patient_id,
          c.doctor_id,
          c.consultation_date::text AS consultation_date,
          c.doctor_notes,
          c.created_at::text AS created_at,
          p.full_name AS patient_name,
          d.full_name AS doctor_name,
          d.specialization,
          a.appointment_date::text AS appointment_date,
          to_char(a.appointment_time, 'HH24:MI') AS appointment_time,
          b.id AS bill_id,
          b.status AS bill_status
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        JOIN doctors d ON d.id = c.doctor_id
        JOIN appointments a ON a.id = c.appointment_id
        LEFT JOIN billing b ON b.consultation_id = c.id
        ORDER BY c.consultation_date DESC, c.created_at DESC
      `)
    ).rows;

    res.json(consultations);
  });

  app.post("/api/consultations", async (req, res) => {
    const validationError = validateConsultationPayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const appointmentId = Number(req.body.appointment_id);
    const appointment = await query("SELECT * FROM appointments WHERE id = $1", [appointmentId]);
    if (!appointment.rowCount) {
      return res.status(400).json({ error: "Selected appointment does not exist." });
    }

    const existingConsultation = await query(
      "SELECT id FROM consultations WHERE appointment_id = $1",
      [appointmentId],
    );
    if (existingConsultation.rowCount) {
      return res.status(409).json({
        error: "A consultation already exists for this appointment. Please edit the existing note.",
      });
    }

    const appointmentRow = appointment.rows[0];
    const consultationId = await withTransaction(async (client) => {
      const result = await client.query(
        `
          INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `,
        [
          appointmentId,
          appointmentRow.patient_id,
          appointmentRow.doctor_id,
          String(req.body.consultation_date).trim(),
          String(req.body.doctor_notes).trim(),
        ],
      );

      await client.query("UPDATE appointments SET status = 'completed' WHERE id = $1", [
        appointmentId,
      ]);
      await ensurePostgresBillingForConsultation(
        client,
        Number(result.rows[0].id),
        appointmentRow.patient_id,
      );

      return Number(result.rows[0].id);
    });

    const consultation = (
      await query(
        `
          SELECT
            c.id,
            c.appointment_id,
            c.patient_id,
            c.doctor_id,
            c.consultation_date::text AS consultation_date,
            c.doctor_notes,
            c.created_at::text AS created_at,
            p.full_name AS patient_name,
            d.full_name AS doctor_name,
            d.specialization
          FROM consultations c
          JOIN patients p ON p.id = c.patient_id
          JOIN doctors d ON d.id = c.doctor_id
          WHERE c.id = $1
        `,
        [consultationId],
      )
    ).rows[0];

    res.status(201).json(consultation);
  });

  app.put("/api/consultations/:id", async (req, res) => {
    const consultationId = Number(req.params.id);
    const existing = await query("SELECT * FROM consultations WHERE id = $1", [consultationId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Consultation not found." });

    const validationError = validateConsultationPayload({
      ...req.body,
      appointment_id: existing.rows[0].appointment_id,
    });
    if (validationError) return res.status(400).json({ error: validationError });

    const updated = (
      await query(
        `
          UPDATE consultations
          SET consultation_date = $1, doctor_notes = $2
          WHERE id = $3
          RETURNING
            id,
            appointment_id,
            patient_id,
            doctor_id,
            consultation_date::text AS consultation_date,
            doctor_notes,
            created_at::text AS created_at
        `,
        [
          String(req.body.consultation_date).trim(),
          String(req.body.doctor_notes).trim(),
          consultationId,
        ],
      )
    ).rows[0];

    const doctor = await query(
      "SELECT full_name AS doctor_name, specialization FROM doctors WHERE id = $1",
      [updated.doctor_id],
    );
    const patient = await query("SELECT full_name AS patient_name FROM patients WHERE id = $1", [
      updated.patient_id,
    ]);

    res.json({
      ...updated,
      doctor_name: doctor.rows[0].doctor_name,
      specialization: doctor.rows[0].specialization,
      patient_name: patient.rows[0].patient_name,
    });
  });

  app.get("/api/billing/patient-summary", async (_req, res) => {
    const summary = (
      await query(`
        SELECT
          p.id AS patient_id,
          p.full_name AS patient_name,
          COUNT(b.id)::int AS bill_count,
          COALESCE(SUM(b.total_amount), 0)::float AS total_billed,
          COALESCE(SUM(CASE WHEN b.status = 'paid' THEN b.total_amount ELSE 0 END), 0)::float AS paid_amount,
          COALESCE(SUM(CASE WHEN b.status = 'unpaid' THEN b.total_amount ELSE 0 END), 0)::float AS unpaid_amount
        FROM patients p
        LEFT JOIN billing b ON b.patient_id = p.id
        GROUP BY p.id
        ORDER BY unpaid_amount DESC, total_billed DESC, patient_name ASC
      `)
    ).rows;

    res.json(summary);
  });

  app.get("/api/billing", async (req, res) => {
    const conditions = [];
    const params = [];

    if (req.query.status) {
      params.push(String(req.query.status).trim());
      conditions.push(`b.status = $${params.length}`);
    }

    if (req.query.patientId) {
      params.push(Number(req.query.patientId));
      conditions.push(`b.patient_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const bills = (
      await query(
        `
          SELECT
            b.id,
            b.consultation_id,
            b.patient_id,
            b.items,
            b.total_amount,
            b.status,
            b.payment_date::text AS payment_date,
            b.created_at::text AS created_at,
            p.full_name AS patient_name,
            c.consultation_date::text AS consultation_date,
            d.full_name AS doctor_name
          FROM billing b
          JOIN patients p ON p.id = b.patient_id
          JOIN consultations c ON c.id = b.consultation_id
          JOIN doctors d ON d.id = c.doctor_id
          ${where}
          ORDER BY b.created_at DESC
        `,
        params,
      )
    ).rows.map(parseBillingRow);

    res.json(bills);
  });

  app.get("/api/billing/:id", async (req, res) => {
    const billId = Number(req.params.id);
    const result = await query(
      `
        SELECT
          b.id,
          b.consultation_id,
          b.patient_id,
          b.items,
          b.total_amount,
          b.status,
          b.payment_date::text AS payment_date,
          b.created_at::text AS created_at,
          p.full_name AS patient_name,
          c.consultation_date::text AS consultation_date,
          d.full_name AS doctor_name
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        JOIN consultations c ON c.id = b.consultation_id
        JOIN doctors d ON d.id = c.doctor_id
        WHERE b.id = $1
      `,
      [billId],
    );

    if (!result.rowCount) return res.status(404).json({ error: "Bill not found." });
    res.json(parseBillingRow(result.rows[0]));
  });

  app.put("/api/billing/:id", async (req, res) => {
    const billId = Number(req.params.id);
    const existing = await query("SELECT * FROM billing WHERE id = $1", [billId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Bill not found." });

    const items = normalizeBillingItems(req.body.items);
    if (!items.length) {
      return res.status(400).json({ error: "At least one billing line item is required." });
    }

    const status = String(req.body.status ?? existing.rows[0].status).trim();
    if (!["paid", "unpaid"].includes(status)) {
      return res.status(400).json({ error: "Billing status is invalid." });
    }

    const paymentDate =
      status === "paid"
        ? String(req.body.payment_date ?? existing.rows[0].payment_date ?? getTodayLocal()).trim()
        : null;

    const updated = (
      await query(
        `
          UPDATE billing
          SET items = $1::jsonb, total_amount = $2, status = $3, payment_date = $4
          WHERE id = $5
          RETURNING
            id,
            consultation_id,
            patient_id,
            items,
            total_amount,
            status,
            payment_date::text AS payment_date,
            created_at::text AS created_at
        `,
        [
          JSON.stringify(items),
          calculateBillingTotal(items),
          status,
          paymentDate || null,
          billId,
        ],
      )
    ).rows[0];

    res.json(parseBillingRow(updated));
  });

  app.patch("/api/billing/:id/pay", async (req, res) => {
    const billId = Number(req.params.id);
    const existing = await query("SELECT * FROM billing WHERE id = $1", [billId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Bill not found." });

    const updated = (
      await query(
        `
          UPDATE billing
          SET status = 'paid', payment_date = $1
          WHERE id = $2
          RETURNING
            id,
            consultation_id,
            patient_id,
            items,
            total_amount,
            status,
            payment_date::text AS payment_date,
            created_at::text AS created_at
        `,
        [getTodayLocal(), billId],
      )
    ).rows[0];

    res.json(parseBillingRow(updated));
  });

  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "Unexpected server error." });
  });

  return app;
}

module.exports = {
  createPostgresApp,
};
