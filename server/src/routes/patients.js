const express = require("express");
const { db, ensureBillingForConsultation } = require("../db");
const {
  publishLinkhamPatientsChange,
  publishLongTermReviewChange,
  publishPatientDataChange,
} = require("../lib/inventoryRealtime");
const {
  ensureLinkhamPatientAccess,
  getLinkhamPatientFilterSql,
} = require("../lib/linkhamRbac");
const {
  isLinkhamInsuranceProvider,
  resolveInsuranceProviderFromTags,
} = require("../lib/insuranceProvider");
const {
  buildPatientLocationFieldFromTags,
  sanitizeLocationTagsForSave,
} = require("../lib/locationTags.js");
const { normalizeConsultationNotesPayload } = require("../lib/consultationNotes.js");
const { parseBillingRow, toPagination } = require("../lib/utils");

const router = express.Router();

const DEFAULT_OPERATOR_ACCESS_HOURS = 24;
const RECENTLY_DELETED_WINDOW_SQL = "-30 days";
const PATIENT_TAG_ROLES = new Set(["admin", "doctor", "operator"]);

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

function parseBooleanField(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function formatPatientRecord(patient) {
  if (!patient) {
    return patient;
  }

  const reviewNote = String(patient.review_reason_note ?? "").trim();

  return {
    ...patient,
    is_subscribed: parseBooleanField(patient.is_subscribed),
    is_under_review: parseBooleanField(patient.is_under_review),
    review_reason_note: reviewNote || null,
    review_due_date: String(patient.review_due_date ?? "").trim() || null,
    link_status: String(patient.link_status ?? "staff_created").trim() || "staff_created",
  };
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
    location_tags: Array.isArray(body.location_tags)
      ? body.location_tags
      : Array.isArray(body.locationTags)
        ? body.locationTags
        : [],
    past_medical_history: String(body.past_medical_history ?? "").trim(),
    past_surgical_history: String(body.past_surgical_history ?? "").trim(),
    drug_history: String(body.drug_history ?? "").trim(),
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
    is_subscribed: parseBooleanField(body.is_subscribed),
    insurance_provider: (() => {
      const locationTags = Array.isArray(body.location_tags)
        ? body.location_tags
        : Array.isArray(body.locationTags)
          ? body.locationTags
          : [];
      return resolveInsuranceProviderFromTags(locationTags, body.insurance_provider);
    })(),
    insurance_policy_number: (() => {
      const locationTags = Array.isArray(body.location_tags)
        ? body.location_tags
        : Array.isArray(body.locationTags)
          ? body.locationTags
          : [];
      const provider = resolveInsuranceProviderFromTags(locationTags, body.insurance_provider);
      if (!isLinkhamInsuranceProvider(provider)) {
        return "";
      }
      return String(body.insurance_policy_number ?? "").trim();
    })(),
  };
}

function notifyLinkhamPatientsIfNeeded(
  patientId,
  insuranceProvider,
  userId,
  previousInsuranceProvider = null,
) {
  if (
    !isLinkhamInsuranceProvider(insuranceProvider) &&
    !isLinkhamInsuranceProvider(previousInsuranceProvider)
  ) {
    return;
  }

  publishLinkhamPatientsChange({
    patientId,
    changedByUserId: userId,
  });
}

function normalizeLocationTag(tag) {
  const category = String(tag?.category ?? "").trim();
  const name = String(tag?.name ?? "").trim();
  return category && name ? { category, name } : null;
}

function normalizeLocationTags(tags) {
  const deduped = new Map();

  for (const tag of tags || []) {
    const normalized = normalizeLocationTag(tag);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.category.toLowerCase()}::${normalized.name.toLowerCase()}`;
    if (!deduped.has(key)) {
      deduped.set(key, normalized);
    }
  }

  return Array.from(deduped.values());
}

function getPatientLocationTags(patientId) {
  return db
    .prepare(`
      SELECT l.category, l.name
      FROM patient_locations pl
      JOIN locations l ON l.id = pl.location_id
      WHERE pl.patient_id = ?
      ORDER BY l.category ASC, l.name ASC
    `)
    .all(patientId);
}

function updatePatientLocationTags(patientId, rawTags) {
  const tags = sanitizeLocationTagsForSave(normalizeLocationTags(rawTags));
  const deleteLinks = db.prepare("DELETE FROM patient_locations WHERE patient_id = ?");
  const upsertLocation = db.prepare(`
    INSERT INTO locations (category, name)
    VALUES (?, ?)
    ON CONFLICT(category, name) DO NOTHING
  `);
  const getLocation = db.prepare(
    "SELECT id FROM locations WHERE category = ? AND name = ? LIMIT 1",
  );
  const upsertLink = db.prepare(`
    INSERT INTO patient_locations (patient_id, location_id)
    VALUES (?, ?)
    ON CONFLICT(patient_id, location_id) DO NOTHING
  `);

  const sync = db.transaction(() => {
    deleteLinks.run(patientId);
    tags.forEach((tag) => {
      upsertLocation.run(tag.category, tag.name);
      const location = getLocation.get(tag.category, tag.name);
      if (location?.id) {
        upsertLink.run(patientId, location.id);
      }
    });
  });

  sync();
  return tags;
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
  if (isLinkhamInsuranceProvider(payload.insurance_provider) && !payload.insurance_policy_number) {
    return "Linkham policy number is required when Linkham insurance is selected.";
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
    location_tags: patient.location_tags || [],
    past_medical_history: patient.past_medical_history || "",
    past_surgical_history: patient.past_surgical_history || "",
    drug_history: patient.drug_history || "",
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
    is_subscribed: parseBooleanField(patient.is_subscribed),
    is_under_review: parseBooleanField(patient.is_under_review),
    review_reason_note: String(patient.review_reason_note ?? "").trim(),
    review_due_date: String(patient.review_due_date ?? "").trim(),
    insurance_provider: String(patient.insurance_provider ?? "").trim(),
    insurance_policy_number: String(patient.insurance_policy_number ?? "").trim(),
  };
}

function normalizeReviewDueDate(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return "";
  }
  const parsed = new Date(`${normalized}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "" : normalized;
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

function ensureDoctorPatientAccess(patient, auth) {
  if (!patient || auth?.role !== "doctor") {
    return true;
  }

  return Boolean(auth?.doctor_id);
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
  const reports = db
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

  if (!reports.length) {
    return reports;
  }

  const placeholders = reports.map(() => "?").join(", ");
  const attachments = db
    .prepare(`
      SELECT
        attachment.*,
        uploader.full_name AS uploaded_by_name,
        uploader.role AS uploaded_by_role
      FROM lab_report_attachments attachment
      LEFT JOIN users uploader ON uploader.id = attachment.uploaded_by_user_id
      WHERE attachment.report_id IN (${placeholders})
      ORDER BY attachment.created_at ASC, attachment.id ASC
    `)
    .all(...reports.map((report) => report.id));

  const attachmentsByReportId = new Map();

  attachments.forEach((attachment) => {
    const current = attachmentsByReportId.get(attachment.report_id) || [];
    current.push({
      ...attachment,
      download_url: `/lab-reports/attachments/${attachment.id}/download`,
    });
    attachmentsByReportId.set(attachment.report_id, current);
  });

  return reports.map((report) => ({
    ...report,
    attachments: attachmentsByReportId.get(report.id) || [],
  }));
}

function formatPatientGenderLabel(gender) {
  if (gender === "M") return "Male";
  if (gender === "F") return "Female";
  const normalized = String(gender || "").trim();
  return normalized || "Unknown";
}

function buildMedicalAlertsSummary(patient) {
  const parts = [
    patient.drug_allergy_history,
    patient.past_medical_history,
    patient.particularity,
    patient.ongoing_treatment,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return parts.length ? parts.join(", ") : "None recorded";
}

function buildEmergencyContactSummary(patient) {
  const name = String(patient.next_of_kin_name || "").trim();
  const phone = String(patient.next_of_kin_contact_number || "").trim();

  if (name && phone) {
    return `${name} (${phone})`;
  }

  return name || phone || "Not recorded";
}

function buildAddressLocationSummary(patient) {
  return [patient.address, patient.location]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function summarizeConsultationNotes(notes) {
  const normalized = String(notes || "").trim();
  if (!normalized) {
    return "No recent consultation summary on file.";
  }

  return normalized.length > 220 ? `${normalized.slice(0, 217).trim()}...` : normalized;
}

router.get("/offline-directory", (req, res) => {
  if (req.auth.role !== "doctor" || !req.auth.doctor_id) {
    return res.status(403).json({ error: "Only doctor accounts can prefetch the offline directory." });
  }

  const doctorId = Number(req.auth.doctor_id);
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const startDate = now.toISOString().slice(0, 10);
  const endDate = windowEnd.toISOString().slice(0, 10);

  const patients = db
    .prepare(`
      SELECT DISTINCT p.*
      FROM patients p
      INNER JOIN appointments a ON a.patient_id = p.id
      WHERE p.deleted_at IS NULL
        AND a.doctor_id = @doctorId
        AND a.status = 'scheduled'
        AND a.appointment_date >= @startDate
        AND a.appointment_date <= @endDate
      ORDER BY p.full_name ASC
    `)
    .all({ doctorId, startDate, endDate });

  const latestConsultationStmt = db.prepare(`
    SELECT doctor_notes, consultation_date
    FROM consultations
    WHERE patient_id = ?
      AND doctor_id = ?
    ORDER BY consultation_date DESC, id DESC
    LIMIT 1
  `);

  const items = patients.map((patient) => {
    const age = calculateAgeFromDateOfBirth(patient.date_of_birth) || Number(patient.age || 0);
    const genderLabel = formatPatientGenderLabel(patient.gender);
    const consultation = latestConsultationStmt.get(patient.id, doctorId);

    return {
      id: Number(patient.id),
      patient_id: String(patient.patient_identifier || `PT-${patient.id}`),
      full_name: patient.full_name,
      age_gender: `${age}, ${genderLabel}`,
      contact_number: String(patient.patient_contact_number || patient.contact_number || "").trim(),
      emergency_contact: buildEmergencyContactSummary(patient),
      address_location: buildAddressLocationSummary(patient) || "Address not recorded",
      medical_alerts: buildMedicalAlertsSummary(patient),
      last_consultation_summary: summarizeConsultationNotes(consultation?.doctor_notes),
      status: patient.status,
      patient_identifier: patient.patient_identifier,
      date_of_birth: patient.date_of_birth || "",
      gender: patient.gender,
      location: patient.location || "",
      assigned_doctor_id: patient.assigned_doctor_id ? Number(patient.assigned_doctor_id) : null,
    };
  });

  res.json({
    items,
    synced_at: new Date().toISOString(),
    window_hours: 48,
    total: items.length,
  });
});

router.get("/options", (req, res) => {
  const auth = req.auth;
  if (!auth) {
    return res.status(401).json({ error: "Authentication is required." });
  }

  const linkhamFilterSql = getLinkhamPatientFilterSql(auth.role);
  const patients = db
    .prepare(`
      SELECT id, patient_identifier, patient_id_number, full_name
      FROM patients
      WHERE deleted_at IS NULL
        ${linkhamFilterSql}
      ORDER BY full_name ASC
    `)
    .all();

  res.json(patients);
});

router.get("/", (req, res) => {
  const search = String(req.query.search ?? "").trim();
  const searchTerm = `%${search}%`;
  const status = String(req.query.status ?? "").trim();
  const underReview =
    String(req.query.underReview ?? "").trim() === "1" ||
    String(req.query.underReview ?? "").trim().toLowerCase() === "true";
  const subscribed =
    String(req.query.subscribed ?? "").trim() === "1" ||
    String(req.query.subscribed ?? "").trim().toLowerCase() === "true" ||
    String(req.query.filter ?? "").trim() === "subscribed";
  const myAssignedFilter = String(req.query.filter ?? "").trim() === "my_assigned";
  const requestedDoctorId = Number(req.query.doctorId);
  let doctorId =
    Number.isInteger(requestedDoctorId) && requestedDoctorId > 0 ? requestedDoctorId : null;
  if (myAssignedFilter && req.auth?.role === "doctor" && req.auth.doctor_id) {
    doctorId = Number(req.auth.doctor_id);
  }

  const effectiveStatus =
    myAssignedFilter && req.auth?.role === "doctor" && !status ? "active" : status;
  // The Sale-allocation picker needs the full assigned roster in one shot so
  // doctors with large patient panels still see every option without paging
  // inside a select dropdown. Other list views keep the default 100 cap.
  const pageLimitCeiling = myAssignedFilter ? 500 : 100;
  const { page, limit, offset } = toPagination(
    req.query.page,
    req.query.limit,
    8,
    pageLimitCeiling,
  );
  const operatorUserId = req.auth?.role === "operator" ? Number(req.auth.id) : null;

  const filters = {
    search,
    searchTerm,
    status: effectiveStatus,
    doctorId,
    operatorUserId,
    underReview: underReview ? 1 : 0,
    subscribed: subscribed ? 1 : 0,
  };
  const reviewFilterSql = "AND (@underReview = 0 OR p.is_under_review = 1)";
  const subscribedFilterSql = "AND (@subscribed = 0 OR p.is_subscribed = 1)";
  const linkhamFilterSql = getLinkhamPatientFilterSql(req.auth?.role);
  const listOrderSql = underReview
    ? `ORDER BY
        CASE
          WHEN p.review_due_date IS NULL OR trim(p.review_due_date) = '' THEN 1
          ELSE 0
        END ASC,
        p.review_due_date ASC,
        p.full_name ASC`
    : "ORDER BY p.created_at DESC, p.full_name ASC";

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
        ${reviewFilterSql}
        ${subscribedFilterSql}
        ${linkhamFilterSql}
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
        ${reviewFilterSql}
        ${subscribedFilterSql}
        ${linkhamFilterSql}
      GROUP BY p.id, d.full_name, d.specialization
      ${listOrderSql}
      LIMIT @limit OFFSET @offset
    `)
    .all({ ...filters, limit, offset });

  res.json({
    items: patients.map((patient) =>
      formatPatientRecord({
        ...patient,
        operator_edit_allowed: Boolean(patient.operator_edit_allowed),
        location_tags: getPatientLocationTags(patient.id),
      }),
    ),
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

  if (!ensureLinkhamPatientAccess(patient, req.auth)) {
    return res.status(404).json({ error: "Patient not found." });
  }

  if (!ensureDoctorPatientAccess(patient, req.auth)) {
    return res.status(403).json({
      error: "Your doctor account is not linked to a doctor profile.",
    });
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
      WHERE a.patient_id = @patientId
      ORDER BY a.appointment_date DESC, a.appointment_time DESC
    `)
    .all({ patientId });

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
      WHERE c.patient_id = @patientId
      ORDER BY c.consultation_date DESC, c.created_at DESC
    `)
    .all({ patientId });

  const bills = db
    .prepare(`
      SELECT
        b.*,
        c.consultation_date,
        d.full_name AS doctor_name
      FROM billing b
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE b.patient_id = @patientId
      ORDER BY b.created_at DESC
    `)
    .all({ patientId })
    .map(parseBillingRow);

  const labReports = getLabReportsByPatientId(patientId);
  const revisions = getPatientRevisions(patientId);
  const operatorAccess = getPatientOperatorAccess(patientId);
  const operatorOptions = req.auth.role === "admin" ? getOperatorOptions() : [];

  res.json({
    patient: formatPatientRecord({
      ...patient,
      location_tags: getPatientLocationTags(patientId),
    }),
    appointments,
    consultations,
    bills,
    labReports,
    revisions,
    operatorAccess,
    operatorOptions,
    operator_can_edit: req.auth.role === "operator",
  });
});

// Confirm (or reset) the portal-account link for a self-registered patient.
router.patch("/:id/verify-link", (req, res) => {
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({
      error: "Only admin and operator accounts can verify patient account links.",
    });
  }

  const patientId = Number(req.params.id);
  const existing = getPatientById(patientId);

  if (!existing) {
    return res.status(404).json({ error: "Patient not found." });
  }

  const verified = req.body.verified === undefined ? true : parseBooleanField(req.body.verified);
  const nextStatus = verified ? "verified" : "pending_review";

  db.prepare("UPDATE patients SET link_status = ? WHERE id = ?").run(nextStatus, patientId);

  publishPatientDataChange(patientId, { reason: "patient" });

  res.json(
    formatPatientRecord({
      ...getPatientById(patientId),
      location_tags: getPatientLocationTags(patientId),
    }),
  );
});

// Tables that reference a patient and must be moved when merging a duplicate
// record into the canonical one. patient_locations has a composite PK so it
// needs conflict-tolerant handling.
const PATIENT_CHILD_TABLES = [
  "appointments",
  "consultations",
  "billing",
  "lab_reports",
  "lab_report_attachments",
  "patient_revisions",
  "patient_operator_access",
  "visit_requests",
  "patient_users",
];

// Merge a duplicate patient record (source) into the canonical one (target).
// Reassigns all child rows, then soft-deletes the source.
router.post("/:id/merge", (req, res) => {
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({
      error: "Only admin and operator accounts can merge patient records.",
    });
  }

  const targetId = Number(req.params.id);
  const sourceId = Number(req.body.source_id);

  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return res.status(400).json({ error: "A valid source_id is required." });
  }

  if (sourceId === targetId) {
    return res.status(400).json({ error: "A patient cannot be merged into itself." });
  }

  const target = getPatientById(targetId);
  const source = getPatientById(sourceId);

  if (!target) {
    return res.status(404).json({ error: "Target patient not found." });
  }

  if (!source) {
    return res.status(404).json({ error: "Source (duplicate) patient not found." });
  }

  const merge = db.transaction(() => {
    for (const table of PATIENT_CHILD_TABLES) {
      db.prepare(`UPDATE ${table} SET patient_id = ? WHERE patient_id = ?`).run(targetId, sourceId);
    }

    // Composite PK: move tags that the target doesn't already have, drop the rest.
    db.prepare(
      "UPDATE OR IGNORE patient_locations SET patient_id = ? WHERE patient_id = ?",
    ).run(targetId, sourceId);
    db.prepare("DELETE FROM patient_locations WHERE patient_id = ?").run(sourceId);

    // Soft-delete the duplicate and mark the surviving record as verified.
    db.prepare(
      "UPDATE patients SET deleted_at = datetime('now'), link_status = 'merged' WHERE id = ?",
    ).run(sourceId);
    db.prepare("UPDATE patients SET link_status = 'verified' WHERE id = ?").run(targetId);
  });

  merge();

  publishPatientDataChange(targetId, { reason: "patient" });
  publishPatientDataChange(sourceId, { reason: "patient" });

  res.json(
    formatPatientRecord({
      ...getPatientById(targetId),
      location_tags: getPatientLocationTags(targetId),
    }),
  );
});

router.patch("/:id/long-term-review", (req, res) => {
  if (!["admin", "operator", "doctor"].includes(req.auth.role)) {
    return res.status(403).json({
      error: "Only clinical staff can update long term review records.",
    });
  }

  const patientId = Number(req.params.id);
  const existing = getPatientById(patientId);

  if (!existing) {
    return res.status(404).json({ error: "Patient not found." });
  }

  const isUnderReview = parseBooleanField(req.body.is_under_review);
  const wasUnderReview = parseBooleanField(existing.is_under_review);
  const role = String(req.auth.role || "");

  if (role === "doctor" && isUnderReview && !wasUnderReview) {
    return res.status(403).json({
      error: "Only admin and operator accounts can flag patients for long term review.",
    });
  }

  const reviewReasonNote = isUnderReview ? String(req.body.review_reason_note ?? "").trim() : "";
  const reviewDueDate = isUnderReview ? normalizeReviewDueDate(req.body.review_due_date) : "";

  if (isUnderReview && !reviewReasonNote) {
    return res.status(400).json({ error: "Enter a reason for continuous follow-up tracking." });
  }

  if (isUnderReview && !reviewDueDate) {
    return res.status(400).json({ error: "Target review date is required." });
  }

  db.prepare(`
    UPDATE patients
    SET
      is_under_review = ?,
      review_reason_note = ?,
      review_due_date = ?
    WHERE id = ?
  `).run(
    isUnderReview ? 1 : 0,
    reviewReasonNote || null,
    reviewDueDate || null,
    patientId,
  );

  publishLongTermReviewChange({
    patientId,
    changedByUserId: req.auth.id,
  });
  publishPatientDataChange(patientId, { reason: "long_term_review" });

  res.json(
    formatPatientRecord({
      ...getPatientById(patientId),
      location_tags: getPatientLocationTags(patientId),
    }),
  );
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
        drug_history,
        drug_allergy_history,
        particularity,
        consultation_notes,
        next_of_kin_name,
        next_of_kin_relationship,
        next_of_kin_contact_number,
        next_of_kin_email,
        next_of_kin_address,
        status,
        ongoing_treatment,
        is_subscribed,
        insurance_provider,
        insurance_policy_number
      )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      payload.drug_history,
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
      payload.is_subscribed ? 1 : 0,
      payload.insurance_provider || "",
      payload.insurance_policy_number || "",
    );

  const patientId = Number(result.lastInsertRowid);

  if (PATIENT_TAG_ROLES.has(req.auth.role)) {
    const savedTags = updatePatientLocationTags(patientId, payload.location_tags);
    const locationField = buildPatientLocationFieldFromTags(savedTags);
    db.prepare("UPDATE patients SET location = ? WHERE id = ?").run(locationField, patientId);
  }

  notifyLinkhamPatientsIfNeeded(patientId, payload.insurance_provider, req.auth.id);

  if (req.auth.role === "operator") {
    const operatorUserId = Number(req.auth.id);
    const expiresAt = getDefaultOperatorExpiry();

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
    `).run(patientId, operatorUserId, operatorUserId, expiresAt);
  }

  const patient = {
    ...getPatientById(result.lastInsertRowid),
    location_tags: getPatientLocationTags(result.lastInsertRowid),
  };
  publishPatientDataChange(patientId, { reason: "patient" });
  res.status(201).json(patient);
});

router.put("/:id", (req, res) => {
  const patientId = Number(req.params.id);
  const existing = getPatientById(patientId);

  if (!existing) {
    return res.status(404).json({ error: "Patient not found." });
  }

  if (req.auth.role !== "operator" && !ensureDoctorPatientAccess(existing, req.auth)) {
    return res.status(403).json({
      error: "Your doctor account is not linked to a doctor profile.",
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
    location_tags: normalizeLocationTags(payload.location_tags),
    past_medical_history: payload.past_medical_history,
    past_surgical_history: payload.past_surgical_history,
    drug_history: payload.drug_history,
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
    is_subscribed: payload.is_subscribed,
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
        drug_history = ?,
        drug_allergy_history = ?,
        particularity = ?,
        consultation_notes = ?,
        next_of_kin_name = ?,
        next_of_kin_relationship = ?,
        next_of_kin_contact_number = ?,
        next_of_kin_email = ?,
        next_of_kin_address = ?,
        status = ?,
        ongoing_treatment = ?,
        is_subscribed = ?,
        insurance_provider = ?,
        insurance_policy_number = ?
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
      payload.drug_history,
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
      payload.is_subscribed ? 1 : 0,
      payload.insurance_provider || "",
      payload.insurance_policy_number || "",
      patientId,
    );

    recordPatientRevision(patientId, previousSnapshot, updatedSnapshot, req.auth.id);
  });

  updatePatient();

  notifyLinkhamPatientsIfNeeded(
    patientId,
    payload.insurance_provider,
    req.auth.id,
    existing.insurance_provider,
  );

  if (PATIENT_TAG_ROLES.has(req.auth.role)) {
    const savedTags = updatePatientLocationTags(patientId, payload.location_tags);
    const locationField = buildPatientLocationFieldFromTags(savedTags);
    db.prepare("UPDATE patients SET location = ? WHERE id = ?").run(locationField, patientId);
  }

  const updated = {
    ...getPatientById(patientId),
    location_tags: getPatientLocationTags(patientId),
  };
  publishPatientDataChange(patientId, { reason: "patient" });
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

  if (!ensureDoctorPatientAccess(patient, req.auth)) {
    return res.status(403).json({
      error: "Your doctor account is not linked to a doctor profile.",
    });
  }

  const consultationDate = String(req.body.consultation_date ?? "").trim();
  const appointmentTime = String(req.body.appointment_time ?? "").trim();
  const requestedDoctorId = Number(req.body.doctor_id);
  const normalizedNotes = normalizeConsultationNotesPayload(req.body);

  if (normalizedNotes.error) {
    return res.status(400).json({ error: normalizedNotes.error });
  }

  if (!consultationDate) {
    return res.status(400).json({ error: "Consultation date is required." });
  }

  if (!appointmentTime) {
    return res.status(400).json({ error: "Consultation time is required." });
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
          doctor_notes,
          clinical_note,
          patient_diagnosis,
          patient_prescription
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        appointmentId,
        patientId,
        doctorId,
        consultationDate,
        normalizedNotes.doctor_notes,
        normalizedNotes.clinical_note,
        normalizedNotes.patient_diagnosis,
        normalizedNotes.patient_prescription,
      ).lastInsertRowid;

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

  publishPatientDataChange(patientId, { reason: "consultation" });

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

  publishPatientDataChange(patientId, { reason: "patient" });

  res.status(204).send();
});

module.exports = router;
