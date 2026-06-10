const DIAGNOSIS_PREFIX_REGEX = /^(imp(ression)?\s*:|dx\s*-\s*|dx\s*:|diagnosis\s*:)/i;

function parsePatientReportMeta(details) {
  const trimmed = String(details || "").trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && parsed.patient_uploaded) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function extractDiagnosisFromNotes(notes) {
  const rawText = String(notes || "").trim();
  if (!rawText) {
    return "General Assessment";
  }

  for (const line of rawText.split("\n")) {
    const cleanLine = String(line || "").trim();
    if (!cleanLine || !DIAGNOSIS_PREFIX_REGEX.test(cleanLine)) {
      continue;
    }

    let diagnosis = cleanLine
      .replace(/^imp(ression)?\s*:/i, "")
      .replace(/^dx\s*-\s*/i, "")
      .replace(/^dx\s*:/i, "")
      .replace(/^diagnosis\s*:/i, "")
      .trim()
      .replace(/\bday\s*\d+\b.*$/i, "")
      .trim();

    if (diagnosis.length > 140) {
      diagnosis = `${diagnosis.slice(0, 140).trim()}…`;
    }

    return diagnosis || "General Assessment";
  }

  const fallback = rawText.length > 80 ? `${rawText.slice(0, 80).trim()}…` : rawText;
  return fallback || "General Assessment";
}

/** Patient-facing summary from consultation notes (excludes diagnosis lines). */
function buildPlainSummaryFromNotes(notes) {
  const rawText = String(notes || "").trim();
  if (!rawText) {
    return "";
  }

  const bodyLines = rawText
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .filter((line) => !DIAGNOSIS_PREFIX_REGEX.test(line));

  const text = bodyLines.join(" ").replace(/\s{2,}/g, " ").trim();
  if (!text) {
    return "";
  }

  if (text.length <= 220) {
    return text;
  }

  const sentenceEnd = text.slice(0, 220).lastIndexOf(". ");
  if (sentenceEnd > 80) {
    return `${text.slice(0, sentenceEnd + 1).trim()}`;
  }

  return `${text.slice(0, 220).trim()}…`;
}

function splitClinicalField(text) {
  return String(text || "")
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ id: index + 1, name: line }));
}

function fileTypeFromMime(mime) {
  const value = String(mime || "").toLowerCase();
  if (value === "application/pdf") return "PDF";
  if (value.startsWith("image/")) return "Image";
  return "Document";
}

const BP_REGEX =
  /(?:^|\b)(?:bp|blood pressure)\s*[:\-]?\s*(\d{2,3})\s*[/\\]\s*(\d{2,3})(?:\s*mm\s*hg)?/gi;
const GLUCOSE_REGEX =
  /(?:^|\b)(?:glucose|blood sugar|fasting glucose|random glucose|fbs|rbs|blood glucose)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mmol\/l|mg\/dl|mg\/dL)?/gi;
const HBA1C_REGEX = /(?:^|\b)(?:hba1c|hb\s*a1c|a1c)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*%?/gi;

function normalizeGlucoseUnit(unit) {
  const value = String(unit || "").toLowerCase();
  if (value.includes("mg")) return "mg/dL";
  return "mmol/L";
}

function parseVitalsFromText(text, { date, source, sourceId }) {
  const readings = {
    blood_pressure: [],
    glucose: [],
    hba1c: [],
  };

  const raw = String(text || "");
  if (!raw.trim()) {
    return readings;
  }

  for (const match of raw.matchAll(BP_REGEX)) {
    const systolic = Number(match[1]);
    const diastolic = Number(match[2]);
    if (systolic >= 70 && systolic <= 250 && diastolic >= 40 && diastolic <= 150) {
      readings.blood_pressure.push({ date, systolic, diastolic, source, source_id: sourceId });
    }
  }

  for (const match of raw.matchAll(GLUCOSE_REGEX)) {
    const value = Number(match[1]);
    if (value > 0 && value <= 40) {
      readings.glucose.push({
        date,
        value,
        unit: normalizeGlucoseUnit(match[2]),
        source,
        source_id: sourceId,
      });
    }
  }

  for (const match of raw.matchAll(HBA1C_REGEX)) {
    const value = Number(match[1]);
    if (value > 0 && value <= 20) {
      readings.hba1c.push({ date, value, source, source_id: sourceId });
    }
  }

  return readings;
}

function mergeVitalsTrends(parts) {
  const merged = {
    blood_pressure: [],
    glucose: [],
    hba1c: [],
  };

  for (const part of parts) {
    merged.blood_pressure.push(...(part.blood_pressure || []));
    merged.glucose.push(...(part.glucose || []));
    merged.hba1c.push(...(part.hba1c || []));
  }

  const sortByDate = (a, b) => String(a.date).localeCompare(String(b.date));

  merged.blood_pressure.sort(sortByDate);
  merged.glucose.sort(sortByDate);
  merged.hba1c.sort(sortByDate);

  return merged;
}

function buildHealthSummary(patient, consultations, clinical) {
  const allergies = clinical?.allergy_history || [];
  const medicalHistory = clinical?.medical_history || [];
  const latestConsultation = consultations[0] || null;

  const bullets = [];

  if (patient?.ongoing_treatment?.trim()) {
    bullets.push(`Current care plan: ${patient.ongoing_treatment.trim()}`);
  }

  if (latestConsultation) {
    bullets.push(
      `Most recent visit on ${latestConsultation.date} with ${latestConsultation.doctor_name} — ${latestConsultation.diagnosis}.`,
    );
    if (latestConsultation.plain_summary) {
      bullets.push(latestConsultation.plain_summary);
    }
  }

  if (allergies.length > 0) {
    bullets.push(
      `Known allergies: ${allergies.map((item) => item.name).slice(0, 3).join(", ")}${allergies.length > 3 ? " and others" : ""}.`,
    );
  } else {
    bullets.push("No known drug allergies recorded.");
  }

  if (medicalHistory.length > 0) {
    bullets.push(
      `Medical history includes ${medicalHistory.map((item) => item.name).slice(0, 2).join(", ")}${medicalHistory.length > 2 ? " and more" : ""}.`,
    );
  }

  const headline = latestConsultation
    ? `Your health at a glance — last seen ${latestConsultation.date}`
    : "Your health records are ready when you need them";

  return {
    headline,
    bullets: bullets.slice(0, 4),
    last_visit_date: latestConsultation?.date || null,
    consultation_count: consultations.length,
    allergy_count: allergies.length,
    medical_history_count: medicalHistory.length,
  };
}

function buildUnifiedTimeline(consultations, reports) {
  const events = [];

  for (const consultation of consultations) {
    events.push({
      kind: "consultation",
      id: `consultation-${consultation.id}`,
      date: consultation.date,
      title: consultation.diagnosis,
      subtitle: consultation.doctor_name,
      detail: consultation.plain_summary || null,
      reports: consultation.reports || [],
    });
  }

  for (const report of reports) {
    events.push({
      kind: "report",
      id: `report-${report.id}`,
      date: report.report_date || report.uploaded_at,
      title: report.name,
      subtitle: report.requested_by || "Medical report",
      detail: report.details_preview || null,
      file_type: report.file_type,
      attachment_id: report.id,
    });
  }

  return events.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function buildHealthRecordsPayload({
  patient,
  consultationRows,
  attachmentRows,
  labReportRows,
}) {
  const attachmentsByConsultation = new Map();
  for (const row of attachmentRows) {
    if (!row.consultation_id) continue;
    const list = attachmentsByConsultation.get(row.consultation_id) || [];
    list.push({ id: row.id, name: row.original_name || row.report_title || "Report" });
    attachmentsByConsultation.set(row.consultation_id, list);
  }

  const labReportById = new Map(labReportRows.map((row) => [row.id, row]));

  const consultations = consultationRows.map((row) => ({
    id: row.id,
    date: row.consultation_date,
    doctor_name: row.doctor_name,
    diagnosis: extractDiagnosisFromNotes(row.doctor_notes),
    plain_summary: buildPlainSummaryFromNotes(row.doctor_notes),
    note_preview: buildPlainSummaryFromNotes(row.doctor_notes),
    reports: attachmentsByConsultation.get(row.id) || [],
  }));

  const reports = attachmentRows.map((row) => {
    const parentReport = labReportById.get(row.report_id);
    const details = parentReport?.report_details || "";
    const meta = parsePatientReportMeta(details);
    return {
      id: row.id,
      name: row.original_name || row.report_title || "Report",
      report_date: row.report_date || row.created_at,
      uploaded_at: row.created_at,
      file_type: fileTypeFromMime(row.mime_type),
      requested_by: meta?.requested_by || row.created_by_name || "",
      requested_by_source:
        meta?.requested_by_source || (row.created_by_name ? "OCS Doctor" : "Patient Upload"),
      details_preview: meta
        ? `Uploaded by patient${meta.requested_by ? ` · ${meta.requested_by}` : ""}`
        : details.length > 180
          ? `${details.slice(0, 180).trim()}…`
          : details,
    };
  });

  const clinical = {
    medical_history: splitClinicalField(patient?.past_medical_history),
    surgical_history: splitClinicalField(patient?.past_surgical_history),
    allergy_history: splitClinicalField(patient?.drug_allergy_history),
    drug_history: splitClinicalField(patient?.drug_history),
  };

  const vitalsParts = [];

  for (const row of consultationRows) {
    vitalsParts.push(
      parseVitalsFromText(row.doctor_notes, {
        date: row.consultation_date,
        source: "consultation",
        sourceId: row.id,
      }),
    );
  }

  for (const row of labReportRows) {
    vitalsParts.push(
      parseVitalsFromText(row.report_details, {
        date: row.report_date,
        source: "lab_report",
        sourceId: row.id,
      }),
    );
  }

  const vitals_trends = mergeVitalsTrends(vitalsParts);
  const summary = buildHealthSummary(patient, consultations, clinical);
  const timeline = buildUnifiedTimeline(consultations, reports);

  return {
    consultations,
    reports,
    clinical,
    summary,
    timeline,
    vitals_trends,
  };
}

module.exports = {
  buildHealthRecordsPayload,
  buildPlainSummaryFromNotes,
  extractDiagnosisFromNotes,
  parseVitalsFromText,
  mergeVitalsTrends,
};
