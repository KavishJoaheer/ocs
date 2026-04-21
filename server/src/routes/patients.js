const express = require("express");
const { db, ensureBillingForConsultation } = require("../db");
const { parseBillingRow, toPagination } = require("../lib/utils");

const router = express.Router();

const DEFAULT_OPERATOR_ACCESS_HOURS = 24;
const RECENTLY_DELETED_WINDOW_SQL = "-30 days";

function buildPatientFullName(firstName, lastName) {
  return [String(firstName || "").trim(), String(lastName || "").trim()]
    .filter(Boolean)
    .join(" ");
}

function normalizeSqlDateTime(value) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function getDefaultOperatorExpiry() {
  return normalizeSqlDateTime(Date.now() + DEFAULT_OPERATOR_ACCESS_HOURS * 60 * 60 * 1000);
}

function normalizePatientIdentifier(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizePatientIdNumber(value) {
  return String(value || "").trim().toUpperCase();
}

function deriveDateOfBirthFromAge(age) {
  const numericAge = Number(age);

  if (!Number.isInteger(numericAge) || numericAge < 0) {
    return "";
  }

  const currentYear = new Date().getFullYear();
  return `${currentYear - numericAge}-01-01`;
}

function calculateAgeFromDateOfBirth(dateOfBirth) {
  const normalized = String(dateOfBirth || "").trim();

  if (!normalized) {
    return 0;
  }

  const today = new Date();
  const birthDate = new Date(`${normalized}T00:00:00`);

  if (Number.isNaN(birthDate.getTime())) {
    return 0;
  }

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function parseDateOfBirth(dateOfBirth) {
  const normalized = String(dateOfBirth || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const parsed = new Date(`${normalized}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function getNextPatientIdentifier() {
  const latestIdentifier = db
    .prepare(`
      SELECT patient_identifier
      FROM patients
      WHERE patient_identifier GLOB 'OCS-[0-9]*'
      ORDER BY CAST(substr(patient_identifier, 5) AS INTEGER) DESC
      LIMIT 1
    `)
    .get()?.patient_identifier;

  const latestNumber = latestIdentifier
    ? Number.parseInt(String(latestIdentifier).replace(/^OCS-/, ""), 10)
    : Number.NaN;
  const nextNumber = Number.isFinite(latestNumber) ? latestNumber + 1 : 150;

  return `OCS-${nextNumber}`;
}

function normalizePatientPayload(body) {
  const status = String(body.status ?? "active").trim().toLowerCase();
  const assignedDoctorRaw = String(body.assigned_doctor_id ?? "").trim();

  return {
    first_name: String(body.first_name ?? "").trim(),
    last_name: String(body.last_name ?? "").trim(),
    patient_identifier: normalizePatientIdentifier(body.patient_identifier),
    patient_id_number: normalizePatientIdNumber(body.patient_id_number),
    date_of_birth: String(
      body.date_of_birth ?? deriveDateOfBirthFromAge(body.age),
    ).trim(),
    gender: String(body.gender ?? "").trim().toUpperCase(),
    assigned_doctor_id: assignedDoctorRaw ? Number(assignedDoctorRaw) : null,
    patient_contact_number: String(
      body.patient_contact_number ?? body.contact_number ?? "",
    ).trim(),
    address: String(body.address ?? "").trim(),
    location: String(body.location ?? "").trim(),
    past_medical_history: String(body.past_medical_history ?? "").trim(),
    past_surgical_history: String(body.past_surgical_history ?? "").trim(),
    drug_allergy_history: String(body.drug_allergy_history ?? "").trim(),
    particularity: String(body.particularity ?? "").trim(),
    consultation_notes:
      body.consultation_notes === undefined ? undefined : String(body.consultation_notes).trim(),
    next_of_kin_name: String(body.next_of_kin_name ?? "").trim(),
    next_of_kin_relationship: String(
      body.next_of_kin_relationship ?? body.contact_relationship ?? "",
    ).trim(),
    next_of_kin_contact_number: String(
      body.next_of_kin_contact_number ?? "",
    ).trim(),
    next_of_kin_email: String(body.next_of_kin_email ?? "").trim(),
    next_of_kin_address:
      body.next_of_kin_address === undefined ? undefined : String(body.next_of_kin_address).trim(),
    status,
    ongoing_treatment:
      status === "active" ? String(body.ongoing_treatment ?? "").trim() : "",
  };
}

function validatePatientPayload(
  payload,
  { isCreate = false, requireAssignedDoctor = false } = {},
) {
  if (!buildPatientFullName(payload.first_name, payload.last_name)) {
    return "Patient name is required.";
  }
  if (payload.date_of_birth) {
    const dateOfBirth = parseDateOfBirth(payload.date_of_birth);
    if (!dateOfBirth) {
      return "Date of birth must be a valid date.";
    }
    if (dateOfBirth.getTime() > Date.now()) {
      return "Date of birth must be a valid past date.";
    }
  }
  if (!["M", "F"].includes(payload.gender)) return "Gender must be either M or F.";
  if (
    payload.assigned_doctor_id !== null &&
    (!Number.isInteger(payload.assigned_doctor_id) || payload.assigned_doctor_id <= 0)
  ) {
    return "Assigned doctor must be valid.";
  }
  if (payload.patient_identifier && !/^OCS-\d+$/.test(payload.patient_identifier)) {
    return "OCS care number must follow the OCS-### format.";
  }
  if (!payload.patient_contact_number) return "Patient contact number is required.";
  if (!payload.address) return "Address is required.";
  if (!["active", "discharged"].includes(payload.status)) {
    return "Status must be active or discharged.";
  }
  if (
    payload.next_of_kin_email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.next_of_kin_email)
  ) {
    return "Next of kin email address is invalid.";
  }
  if (
    (payload.next_of_kin_name ||
      payload.next_of_kin_contact_number ||
      payload.next_of_kin_email) &&
    !payload.next_of_kin_name
  ) {
    return "Next of kin name is required when next of kin details are provided.";
  }
  if (
    (payload.next_of_kin_name ||
      payload.next_of_kin_email) &&
    !payload.next_of_kin_contact_number
  ) {
    return "Next of kin contact number is required when next of kin details are provided.";
  }
  if (isCreate && requireAssignedDoctor && !payload.assigned_doctor_id) {
    return "Assigned doctor is required at registration.";
  }

  return null;
}

function getAssignedDoctorById(doctorId) {
  if (!doctorId) {
    return null;
  }

  return db
    .prepare(`
      SELECT id, full_name, specialization
      FROM doctors
      WHERE id = ?
        AND is_active = 1
        AND deleted_at IS NULL
    `)
    .get(Number(doctorId));
}

function getPatientById(patientId, { includeDeleted = false } = {}) {
  return db
    .prepare(`
      SELECT
        p.*,
        d.full_name AS assigned_doctor_name,
        d.specialization AS assigned_doctor_specialization
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      WHERE p.id = ?
        AND (? = 1 OR p.deleted_at IS NULL)
    `)
    .get(patientId, includeDeleted ? 1 : 0);
}

function getPatientSnapshot(patient) {
  if (!patient) {
    return null;
  }

  return {
    patient_identifier: patient.patient_identifier || "",
    patient_id_number: patient.patient_id_number || "",
    first_name: patient.first_name || "",
    last_name: patient.last_name || "",
    full_name: patient.full_name || "",
    date_of_birth: patient.date_of_birth || "",
    age: calculateAgeFromDateOfBirth(patient.date_of_birth),
    gender: patient.gender || "",
    assigned_doctor_id: patient.assigned_doctor_id ? Number(patient.assigned_doctor_id) : null,
    assigned_doctor_name: patient.assigned_doctor_name || "",
    patient_contact_number: patient.patient_contact_number || patient.contact_number || "",
    address: patient.address || "",
    location: patient.location || "",
    past_medical_history: patient.past_medical_history || "",
    past_surgical_history: patient.past_surgical_history || "",
    drug_allergy_history: patient.drug_allergy_history || "",
    particularity: patient.particularity || "",
    consultation_notes: patient.consultation_notes || "",
    next_of_kin_name: patient.next_of_kin_name || "",
    next_of_kin_relationship:
      patient.next_of_kin_relationship || patient.contact_relationship || "",
    next_of_kin_contact_number: patient.next_of_kin_contact_number || "",
    next_of_kin_email: patient.next_of_kin_email || "",
    next_of_kin_address: patient.next_of_kin_address || "",
    status: patient.status || "",
    ongoing_treatment: patient.ongoing_treatment || "",
  };
}

function getChangedFields(previousSnapshot, updatedSnapshot) {
  const keys = Object.keys(updatedSnapshot);

  return keys.filter((key) => {
    const previousValue =
      previousSnapshot[key] === null || previousSnapshot[key] === undefined
        ? ""
        : String(previousSnapshot[key]);
    const updatedValue =
      updatedSnapshot[key] === null || updatedSnapshot[key] === undefined
        ? ""
        : String(updatedSnapshot[key]);

    return previousValue !== updatedValue;
  });
}

function recordPatientRevision(patientId, previousSnapshot, updatedSnapshot, changedByUserId) {
  const changedFields = getChangedFields(previousSnapshot, updatedSnapshot);

  if (!changedFields.length) {
    return;
  }

  db.prepare(`
    INSERT INTO patient_revisions (
      patient_id,
      previous_snapshot,
      updated_snapshot,
      changed_fields,
      changed_by_user_id
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    patientId,
    JSON.stringify(previousSnapshot),
    JSON.stringify(updatedSnapshot),
    JSON.stringify(changedFields),
    changedByUserId || null,
  );
}

function getPatientRevisions(patientId) {
  return db
    .prepare(`
      SELECT
        pr.*,
        u.full_name AS changed_by_name,
        u.role AS changed_by_role
      FROM patient_revisions pr
      LEFT JOIN users u ON u.id = pr.changed_by_user_id
      WHERE pr.patient_id = ?
      ORDER BY pr.created_at DESC, pr.id DESC
    `)
    .all(patientId)
    .map((revision) => ({
      ...revision,
      changed_fields: JSON.parse(revision.changed_fields || "[]"),
      previous_snapshot: JSON.parse(revision.previous_snapshot || "{}"),
      updated_snapshot: JSON.parse(revision.updated_snapshot || "{}"),
    }));
}

function hasActiveOperatorEditAccess(patientId, operatorUserId) {
  if (!patientId || !operatorUserId) {
    return false;
  }

  return Boolean(
    db
      .prepare(`
        SELECT id
        FROM patient_operator_access
        WHERE patient_id = ?
          AND operator_user_id = ?
          AND expires_at > CURRENT_TIMESTAMP
        ORDER BY expires_at DESC
        LIMIT 1
      `)
      .get(patientId, operatorUserId),
  );
}

function getPatientOperatorAccess(patientId) {
  return db
    .prepare(`
      SELECT
        poa.*,
        operator_user.full_name AS operator_name,
        operator_user.username AS operator_username,
        admin_user.full_name AS granted_by_name
      FROM patient_operator_access poa
      JOIN users operator_user
        ON operator_user.id = poa.operator_user_id
       AND operator_user.role = 'operator'
      LEFT JOIN users admin_user ON admin_user.id = poa.granted_by_user_id
      WHERE poa.patient_id = ?
        AND poa.expires_at > CURRENT_TIMESTAMP
      ORDER BY poa.expires_at ASC, poa.id DESC
    `)
    .all(patientId);
}

function getOperatorOptions() {
  return db
    .prepare(`
      SELECT id, username, full_name
      FROM users
      WHERE role = 'operator'
        AND is_active = 1
        AND deleted_at IS NULL
      ORDER BY full_name ASC
    `)
    .all();
}

function resolveAssignedDoctorIdForCreate(payload, auth) {
  if (auth.role === "doctor") {
    if (!auth.doctor_id) {
      return { error: "Your doctor account is not linked to a doctor profile." };
    }

    return { assignedDoctorId: Number(auth.doctor_id) };
  }

  const assignedDoctor = getAssignedDoctorById(payload.assigned_doctor_id);

  if (!assignedDoctor) {
    return { error: "Assigned doctor not found." };
  }

  return { assignedDoctorId: Number(assignedDoctor.id) };
}

function resolveAssignedDoctorIdForUpdate(existing, payload, auth) {
  const existingAssignedDoctorId = existing.assigned_doctor_id
    ? Number(existing.assigned_doctor_id)
    : null;

  if (auth.role !== "admin") {
    return {
      assignedDoctorId: existingAssignedDoctorId,
      assignedDoctorName: existing.assigned_doctor_name || "",
    };
  }

  const requestedDoctorId = payload.assigned_doctor_id ? Number(payload.assigned_doctor_id) : null;

  if (!requestedDoctorId) {
    if (!existingAssignedDoctorId) {
      return { error: "Assigned doctor is required." };
    }

    return {
      assignedDoctorId: existingAssignedDoctorId,
      assignedDoctorName: existing.assigned_doctor_name || "",
    };
  }

  if (requestedDoctorId === existingAssignedDoctorId) {
    return {
      assignedDoctorId: existingAssignedDoctorId,
      assignedDoctorName: existing.assigned_doctor_name || "",
    };
  }

  const assignedDoctor = getAssignedDoctorById(requestedDoctorId);

  if (!assignedDoctor) {
    return { error: "Assigned doctor not found." };
  }

  return {
    assignedDoctorId: Number(assignedDoctor.id),
    assignedDoctorName: assignedDoctor.full_name || "",
  };
}

function validatePatientIdentifierAvailability(patientIdentifier, patientId = null) {
  if (!patientIdentifier) {
    return null;
  }

  const existing = patientId
    ? db
        .prepare(
          "SELECT id FROM patients WHERE patient_identifier = ? AND id != ? LIMIT 1",
        )
        .get(patientIdentifier, patientId)
    : db
        .prepare("SELECT id FROM patients WHERE patient_identifier = ? LIMIT 1")
        .get(patientIdentifier);

  if (existing) {
    return "OCS care number is already in use.";
  }

  return null;
}

function validatePatientIdNumberAvailability(patientIdNumber, patientId = null) {
  if (!patientIdNumber) {
    return null;
  }

  const existing = patientId
    ? db
        .prepare(
          "SELECT id FROM patients WHERE patient_id_number = ? AND id != ? LIMIT 1",
        )
        .get(patientIdNumber, patientId)
    : db
        .prepare("SELECT id FROM patients WHERE patient_id_number = ? LIMIT 1")
        .get(patientIdNumber);

  if (existing) {
    return "Patient ID is already in use.";
  }

  return null;
}

function getLabReportsByPatientId(patientId) {
  return db
    .prepare(`
      SELECT
        lr.*,
        c.consultation_date,
        d.full_name AS consultation_doctor_name,
        d.specialization AS consultation_doctor_specialization,
        u.full_name AS created_by_name,
        u.role AS created_by_role
      FROM lab_reports lr
      LEFT JOIN consultations c ON c.id = lr.consultation_id
      LEFT JOIN doctors d ON d.id = c.doctor_id
      LEFT JOIN users u ON u.id = lr.created_by_user_id
      WHERE lr.patient_id = ?
      ORDER BY lr.report_date DESC, lr.created_at DESC
    `)
    .all(patientId);
}

router.get("/options", (_req, res) => {
  const patients = db
    .prepare(`
      SELECT id, patient_identifier, patient_id_number, full_name
      FROM patients
      WHERE deleted_at IS NULL
      ORDER BY full_name ASC
    `)
    .all();

  res.json(patients);
});

router.get("/", (req, res) => {
  const search = String(req.query.search ?? "").trim();
  const searchTerm = `%${search}%`;
  const status = String(req.query.status ?? "").trim();
  const requestedDoctorId = Number(req.query.doctorId);
  const doctorId =
    Number.isInteger(requestedDoctorId) && requestedDoctorId > 0 ? requestedDoctorId : null;
  const { page, limit, offset } = toPagination(req.query.page, req.query.limit, 8);
  const operatorUserId = req.auth?.role === "operator" ? Number(req.auth.id) : null;

  const filters = { search, searchTerm, status, doctorId, operatorUserId };

  const total = db
    .prepare(`
      SELECT COUNT(DISTINCT p.id) AS count
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      WHERE
        p.deleted_at IS NULL
        AND
        (
          @search = ''
          OR p.full_name LIKE @searchTerm
          OR p.first_name LIKE @searchTerm
          OR p.last_name LIKE @searchTerm
          OR p.patient_identifier LIKE @searchTerm
          OR p.patient_id_number LIKE @searchTerm
          OR d.full_name LIKE @searchTerm
          OR p.patient_contact_number LIKE @searchTerm
          OR p.next_of_kin_name LIKE @searchTerm
          OR p.next_of_kin_contact_number LIKE @searchTerm
          OR p.address LIKE @searchTerm
          OR p.location LIKE @searchTerm
          OR p.status LIKE @searchTerm
          OR CAST(p.id AS TEXT) = @search
        )
        AND (@status = '' OR p.status = @status)
        AND (@doctorId IS NULL OR p.assigned_doctor_id = @doctorId)
    `)
    .get(filters).count;

  const patients = db
    .prepare(`
      SELECT
        p.*,
        d.full_name AS assigned_doctor_name,
        d.specialization AS assigned_doctor_specialization,
        COUNT(DISTINCT a.id) AS appointment_count,
        COUNT(DISTINCT c.id) AS consultation_count,
        COUNT(DISTINCT b.id) AS bill_count,
        EXISTS (
          SELECT 1
          FROM patient_operator_access poa
          WHERE poa.patient_id = p.id
            AND poa.operator_user_id = @operatorUserId
            AND poa.expires_at > CURRENT_TIMESTAMP
        ) AS operator_edit_allowed
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      LEFT JOIN appointments a ON a.patient_id = p.id
      LEFT JOIN consultations c ON c.patient_id = p.id
      LEFT JOIN billing b ON b.patient_id = p.id
      WHERE
        p.deleted_at IS NULL
        AND
        (
          @search = ''
          OR p.full_name LIKE @searchTerm
          OR p.first_name LIKE @searchTerm
          OR p.last_name LIKE @searchTerm
          OR p.patient_identifier LIKE @searchTerm
          OR p.patient_id_number LIKE @searchTerm
          OR d.full_name LIKE @searchTerm
          OR p.patient_contact_number LIKE @searchTerm
          OR p.next_of_kin_name LIKE @searchTerm
          OR p.next_of_kin_contact_number LIKE @searchTerm
          OR p.address LIKE @searchTerm
          OR p.location LIKE @searchTerm
          OR p.status LIKE @searchTerm
          OR CAST(p.id AS TEXT) = @search
        )
        AND (@status = '' OR p.status = @status)
        AND (@doctorId IS NULL OR p.assigned_doctor_id = @doctorId)
      GROUP BY p.id, d.full_name, d.specialization
      ORDER BY p.created_at DESC, p.full_name ASC
      LIMIT @limit OFFSET @offset
    `)
    .all({ ...filters, limit, offset });

  res.json({
    items: patients.map((patient) => ({
      ...patient,
      operator_edit_allowed: Boolean(patient.operator_edit_allowed),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
});

router.get("/deleted/recent", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can view recently deleted patients." });
  }

  const patients = db
    .prepare(`
      SELECT
        p.*,
        d.full_name AS assigned_doctor_name,
        d.specialization AS assigned_doctor_specialization,
        COUNT(DISTINCT a.id) AS appointment_count,
        COUNT(DISTINCT c.id) AS consultation_count,
        COUNT(DISTINCT b.id) AS bill_count
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      LEFT JOIN appointments a ON a.patient_id = p.id
      LEFT JOIN consultations c ON c.patient_id = p.id
      LEFT JOIN billing b ON b.patient_id = p.id
      WHERE p.deleted_at IS NOT NULL
        AND p.deleted_at >= datetime('now', ?)
      GROUP BY p.id, d.full_name, d.specialization
      ORDER BY p.deleted_at DESC, p.full_name ASC
    `)
    .all(RECENTLY_DELETED_WINDOW_SQL);

  res.json(patients);
});

router.post("/:id/restore", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can restore deleted patients." });
  }

  const patientId = Number(req.params.id);
  const existing = getPatientById(patientId, { includeDeleted: true });

  if (!existing || !existing.deleted_at) {
    return res.status(404).json({ error: "Deleted patient not found." });
  }

  db.prepare("UPDATE patients SET deleted_at = NULL WHERE id = ?").run(patientId);
  res.json(getPatientById(patientId));
});

router.get("/:id", (req, res) => {
  const patientId = Number(req.params.id);
  const patient = getPatientById(patientId);

  if (!patient) {
    return res.status(404).json({ error: "Patient not found." });
  }

  const appointments = db
    .prepare(`
      SELECT
        a.*,
        d.full_name AS doctor_name,
        d.specialization,
        c.id AS consultation_id
      FROM appointments a
      JOIN doctors d ON d.id = a.doctor_id
      LEFT JOIN consultations c ON c.appointment_id = a.id
      WHERE a.patient_id = ?
      ORDER BY a.appointment_date DESC, a.appointment_time DESC
    `)
    .all(patientId);

  const consultations = db
    .prepare(`
      SELECT
        c.*,
        d.full_name AS doctor_name,
        d.specialization,
        a.appointment_date,
        a.appointment_time
      FROM consultations c
      JOIN doctors d ON d.id = c.doctor_id
      JOIN appointments a ON a.id = c.appointment_id
      WHERE c.patient_id = ?
      ORDER BY c.consultation_date DESC, c.created_at DESC
    `)
    .all(patientId);

  const bills = db
    .prepare(`
      SELECT
        b.*,
        c.consultation_date,
        d.full_name AS doctor_name
      FROM billing b
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE b.patient_id = ?
      ORDER BY b.created_at DESC
    `)
    .all(patientId)
    .map(parseBillingRow);

  const labReports = getLabReportsByPatientId(patientId);
  const revisions = getPatientRevisions(patientId);
  const operatorAccess = getPatientOperatorAccess(patientId);
  const operatorOptions = req.auth.role === "admin" ? getOperatorOptions() : [];

  res.json({
    patient,
    appointments,
    consultations,
    bills,
    labReports,
    revisions,
    operatorAccess,
    operatorOptions,
    operator_can_edit:
      req.auth.role === "operator"
        ? hasActiveOperatorEditAccess(patientId, Number(req.auth.id))
        : false,
  });
});

router.post("/", (req, res) => {
  const payload = normalizePatientPayload(req.body);
  const validationError = validatePatientPayload(payload, {
    isCreate: true,
    requireAssignedDoctor: ["admin", "operator"].includes(req.auth.role),
  });

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { assignedDoctorId, error } = resolveAssignedDoctorIdForCreate(payload, req.auth);

  if (error) {
    return res.status(400).json({ error });
  }

  const patientIdentifier =
    req.auth.role === "admin" && payload.patient_identifier
      ? payload.patient_identifier
      : getNextPatientIdentifier();
  const identifierError = validatePatientIdentifierAvailability(patientIdentifier);
  const patientIdNumberError = validatePatientIdNumberAvailability(payload.patient_id_number);

  if (identifierError) {
    return res.status(400).json({ error: identifierError });
  }

  if (patientIdNumberError) {
    return res.status(400).json({ error: patientIdNumberError });
  }

  const fullName = buildPatientFullName(payload.first_name, payload.last_name);
  const calculatedAge = calculateAgeFromDateOfBirth(payload.date_of_birth);

  const result = db
    .prepare(`
      INSERT INTO patients (
        full_name,
        first_name,
        last_name,
        patient_identifier,
        patient_id_number,
        age,
        date_of_birth,
        gender,
        assigned_doctor_id,
        contact_number,
        patient_contact_number,
        contact_relationship,
        address,
        location,
        past_medical_history,
        past_surgical_history,
        drug_allergy_history,
        particularity,
        consultation_notes,
        next_of_kin_name,
        next_of_kin_relationship,
        next_of_kin_contact_number,
        next_of_kin_email,
        next_of_kin_address,
        status,
        ongoing_treatment
      )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
    .run(
      fullName,
      payload.first_name,
      payload.last_name,
      patientIdentifier,
      payload.patient_id_number,
      calculatedAge,
      payload.date_of_birth,
      payload.gender,
      assignedDoctorId,
      payload.patient_contact_number,
      payload.patient_contact_number,
      payload.next_of_kin_relationship,
      payload.address,
      payload.location,
      payload.past_medical_history,
      payload.past_surgical_history,
      payload.drug_allergy_history,
      payload.particularity,
      payload.consultation_notes || "",
      payload.next_of_kin_name,
      payload.next_of_kin_relationship,
      payload.next_of_kin_contact_number,
      payload.next_of_kin_email,
      payload.next_of_kin_address || "",
      payload.status,
      payload.ongoing_treatment,
    );

  const patient = getPatientById(result.lastInsertRowid);
  res.status(201).json(patient);
});

router.put("/:id", (req, res) => {
  const patientId = Number(req.params.id);
  const existing = getPatientById(patientId);

  if (!existing) {
    return res.status(404).json({ error: "Patient not found." });
  }

  if (
    req.auth.role === "operator" &&
    !hasActiveOperatorEditAccess(patientId, Number(req.auth.id))
  ) {
    return res.status(403).json({
      error: "An active admin approval is required before this operator can edit the patient.",
    });
  }

  const payload = normalizePatientPayload(req.body);
  const validationError = validatePatientPayload(payload);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const {
    assignedDoctorId,
    assignedDoctorName,
    error: assignedDoctorError,
  } = resolveAssignedDoctorIdForUpdate(existing, payload, req.auth);

  if (assignedDoctorError) {
    return res.status(400).json({ error: assignedDoctorError });
  }

  const patientIdentifier =
    req.auth.role === "admin" && payload.patient_identifier
      ? payload.patient_identifier
      : existing.patient_identifier || getNextPatientIdentifier();
  const identifierError = validatePatientIdentifierAvailability(
    patientIdentifier,
    patientId,
  );
  const patientIdNumber = payload.patient_id_number || "";
  const patientIdNumberError = validatePatientIdNumberAvailability(
    patientIdNumber,
    patientId,
  );

  if (identifierError) {
    return res.status(400).json({ error: identifierError });
  }

  if (patientIdNumberError) {
    return res.status(400).json({ error: patientIdNumberError });
  }

  const fullName = buildPatientFullName(payload.first_name, payload.last_name);
  const preservedConsultationNotes =
    payload.consultation_notes === undefined
      ? existing.consultation_notes || ""
      : payload.consultation_notes;
  const preservedNextOfKinAddress =
    payload.next_of_kin_address === undefined
      ? existing.next_of_kin_address || ""
      : payload.next_of_kin_address;
  const previousSnapshot = getPatientSnapshot(existing);
  const updatedSnapshot = {
    ...previousSnapshot,
    patient_identifier: patientIdentifier,
    patient_id_number: patientIdNumber,
    first_name: payload.first_name,
    last_name: payload.last_name,
    full_name: fullName,
    date_of_birth: payload.date_of_birth,
    age: calculateAgeFromDateOfBirth(payload.date_of_birth),
    gender: payload.gender,
    assigned_doctor_id: assignedDoctorId,
    assigned_doctor_name: assignedDoctorName,
    patient_contact_number: payload.patient_contact_number,
    address: payload.address,
    location: payload.location,
    past_medical_history: payload.past_medical_history,
    past_surgical_history: payload.past_surgical_history,
    drug_allergy_history: payload.drug_allergy_history,
    particularity: payload.particularity,
    consultation_notes: preservedConsultationNotes,
    next_of_kin_name: payload.next_of_kin_name,
    next_of_kin_relationship: payload.next_of_kin_relationship,
    next_of_kin_contact_number: payload.next_of_kin_contact_number,
    next_of_kin_email: payload.next_of_kin_email,
    next_of_kin_address: preservedNextOfKinAddress,
    status: payload.status,
    ongoing_treatment: payload.ongoing_treatment,
  };
  const calculatedAge = calculateAgeFromDateOfBirth(payload.date_of_birth);

  const updatePatient = db.transaction(() => {
    db.prepare(`
      UPDATE patients
      SET
        full_name = ?,
        first_name = ?,
        last_name = ?,
        patient_identifier = ?,
        patient_id_number = ?,
        age = ?,
        date_of_birth = ?,
        gender = ?,
        assigned_doctor_id = ?,
        contact_number = ?,
        patient_contact_number = ?,
        contact_relationship = ?,
        address = ?,
        location = ?,
        past_medical_history = ?,
        past_surgical_history = ?,
        drug_allergy_history = ?,
        particularity = ?,
        consultation_notes = ?,
        next_of_kin_name = ?,
        next_of_kin_relationship = ?,
        next_of_kin_contact_number = ?,
        next_of_kin_email = ?,
        next_of_kin_address = ?,
        status = ?,
        ongoing_treatment = ?
      WHERE id = ?
    `).run(
      fullName,
      payload.first_name,
      payload.last_name,
      patientIdentifier,
      patientIdNumber,
      calculatedAge,
      payload.date_of_birth,
      payload.gender,
      assignedDoctorId,
      payload.patient_contact_number,
      payload.patient_contact_number,
      payload.next_of_kin_relationship,
      payload.address,
      payload.location,
      payload.past_medical_history,
      payload.past_surgical_history,
      payload.drug_allergy_history,
      payload.particularity,
      preservedConsultationNotes,
      payload.next_of_kin_name,
      payload.next_of_kin_relationship,
      payload.next_of_kin_contact_number,
      payload.next_of_kin_email,
      preservedNextOfKinAddress,
      payload.status,
      payload.ongoing_treatment,
      patientId,
    );

    recordPatientRevision(patientId, previousSnapshot, updatedSnapshot, req.auth.id);
  });

  updatePatient();

  const updated = getPatientById(patientId);
  res.json(updated);
});

router.post("/:id/consultations", (req, res) => {
  if (!["admin", "doctor"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin and doctors can add consultation notes." });
  }

  const patientId = Number(req.params.id);
  const patient = getPatientById(patientId);

  if (!patient) {
    return res.status(404).json({ error: "Patient not found." });
  }

  const consultationDate = String(req.body.consultation_date ?? "").trim();
  const appointmentTime = String(req.body.appointment_time ?? "").trim();
  const doctorNotes = String(req.body.doctor_notes ?? "").trim();
  const requestedDoctorId = Number(req.body.doctor_id);

  if (!consultationDate) {
    return res.status(400).json({ error: "Consultation date is required." });
  }

  if (!appointmentTime) {
    return res.status(400).json({ error: "Consultation time is required." });
  }

  if (!doctorNotes) {
    return res.status(400).json({ error: "Consultation note is required." });
  }

  const doctorId =
    req.auth.role === "doctor"
      ? Number(req.auth.doctor_id)
      : Number.isInteger(requestedDoctorId) && requestedDoctorId > 0
        ? requestedDoctorId
        : null;

  if (!doctorId) {
    return res.status(400).json({ error: "Doctor selection is required." });
  }

  const assignedDoctor = getAssignedDoctorById(doctorId);

  if (!assignedDoctor) {
    return res.status(400).json({ error: "Selected doctor was not found." });
  }

  const createConsultation = db.transaction(() => {
    const appointmentId = db
      .prepare(`
        INSERT INTO appointments (
          patient_id,
          doctor_id,
          appointment_date,
          appointment_time,
          status
        )
        VALUES (?, ?, ?, ?, 'completed')
      `)
      .run(patientId, doctorId, consultationDate, appointmentTime).lastInsertRowid;

    const consultationId = db
      .prepare(`
        INSERT INTO consultations (
          appointment_id,
          patient_id,
          doctor_id,
          consultation_date,
          doctor_notes
        )
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(appointmentId, patientId, doctorId, consultationDate, doctorNotes).lastInsertRowid;

    ensureBillingForConsultation(consultationId, patientId);

    return consultationId;
  });

  const consultationId = createConsultation();
  const consultation = db
    .prepare(`
      SELECT
        c.*,
        p.full_name AS patient_name,
        d.full_name AS doctor_name,
        d.specialization,
        a.appointment_date,
        a.appointment_time
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      JOIN appointments a ON a.id = c.appointment_id
      WHERE c.id = ?
    `)
    .get(consultationId);

  res.status(201).json(consultation);
});

router.post("/:id/operator-access", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can grant operator access." });
  }

  const patientId = Number(req.params.id);
  const patient = getPatientById(patientId);

  if (!patient) {
    return res.status(404).json({ error: "Patient not found." });
  }

  const operatorUserId = Number(req.body.operator_user_id);

  if (!Number.isInteger(operatorUserId) || operatorUserId <= 0) {
    return res.status(400).json({ error: "Operator selection is required." });
  }

  const operatorUser = db
    .prepare(`
      SELECT id, full_name, username
      FROM users
      WHERE id = ?
        AND role = 'operator'
        AND is_active = 1
        AND deleted_at IS NULL
    `)
    .get(operatorUserId);

  if (!operatorUser) {
    return res.status(400).json({ error: "Selected operator could not be found." });
  }

  const expiresAt =
    normalizeSqlDateTime(req.body.expires_at) || getDefaultOperatorExpiry();

  if (!expiresAt || expiresAt <= normalizeSqlDateTime(Date.now())) {
    return res.status(400).json({ error: "Operator access expiry must be in the future." });
  }

  db.transaction(() => {
    db.prepare(`
      DELETE FROM patient_operator_access
      WHERE patient_id = ?
        AND operator_user_id = ?
    `).run(patientId, operatorUserId);

    db.prepare(`
      INSERT INTO patient_operator_access (
        patient_id,
        operator_user_id,
        granted_by_user_id,
        expires_at
      )
      VALUES (?, ?, ?, ?)
    `).run(patientId, operatorUserId, req.auth.id, expiresAt);
  })();

  res.status(201).json({
    access: getPatientOperatorAccess(patientId),
  });
});

router.delete("/:id/operator-access/:accessId", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can revoke operator access." });
  }

  const patientId = Number(req.params.id);
  const accessId = Number(req.params.accessId);

  const existing = db
    .prepare(`
      SELECT id
      FROM patient_operator_access
      WHERE id = ?
        AND patient_id = ?
    `)
    .get(accessId, patientId);

  if (!existing) {
    return res.status(404).json({ error: "Operator access record not found." });
  }

  db.prepare("DELETE FROM patient_operator_access WHERE id = ?").run(accessId);
  res.status(204).send();
});

router.delete("/:id", (req, res) => {
  const patientId = Number(req.params.id);
  const existing = getPatientById(patientId);

  if (!existing) {
    return res.status(404).json({ error: "Patient not found." });
  }

  db.transaction(() => {
    db.prepare("UPDATE patients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(patientId);
    db.prepare("DELETE FROM patient_operator_access WHERE patient_id = ?").run(patientId);
  })();

  res.status(204).send();
});

module.exports = router;
