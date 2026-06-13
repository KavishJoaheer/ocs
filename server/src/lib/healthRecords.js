const DIAGNOSIS_PREFIX_REGEX = /^(imp(ression)?\s*:|dx\s*-\s*|dx\s*:|diagnosis\s*:)/i;
const PRESCRIBED_PREFIX_REGEX = /^prescribed\s*:/i;

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

function clampDiagnosisText(diagnosis) {
  let value = String(diagnosis || "").trim();
  if (!value) {
    return "General Assessment";
  }

  if (value.length > 140) {
    value = `${value.slice(0, 140).trim()}…`;
  }

  return value;
}

function isExcludedFromDiagnosisLine(line) {
  const cleaned = String(line || "").trim();
  if (!cleaned) {
    return true;
  }

  if (isVitalsLine(cleaned)) {
    return true;
  }

  if (SKIP_LINE_REGEX.test(cleaned)) {
    return true;
  }

  if (PRESCRIBED_PREFIX_REGEX.test(cleaned)) {
    return true;
  }

  if (PRESCRIPTION_SECTION_REGEX.test(cleaned)) {
    return true;
  }

  if (/^medication(?:\s+or\s+treatment)?\s*:/i.test(cleaned)) {
    return true;
  }

  if (INSTRUCTION_START_REGEX.test(stripListPrefix(cleaned))) {
    return true;
  }

  if (DOSAGE_REGEX.test(cleaned) && parseMedicationLine(cleaned)) {
    return true;
  }

  return false;
}

function extractDiagnosisFromNotes(notes) {
  const rawText = String(notes || "").trim();
  if (!rawText) {
    return "General Assessment";
  }

  const lines = rawText
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  for (const cleanLine of lines) {
    if (!DIAGNOSIS_PREFIX_REGEX.test(cleanLine)) {
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

    return clampDiagnosisText(diagnosis);
  }

  for (const cleanLine of lines) {
    if (isExcludedFromDiagnosisLine(cleanLine)) {
      continue;
    }

    return clampDiagnosisText(cleanLine);
  }

  return "General Assessment";
}

/** Patient-facing summary from consultation notes (excludes diagnosis lines). */
function buildPlainSummaryFromNotes(notes) {
  const rawText = String(notes || "").trim();
  if (!rawText) {
    return "";
  }

  const diagnosisLabel = extractDiagnosisFromNotes(rawText);

  const bodyLines = rawText
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .filter((line) => !DIAGNOSIS_PREFIX_REGEX.test(line))
    .filter((line) => !isExcludedFromDiagnosisLine(line))
    .filter((line) => line !== diagnosisLabel);

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

const PRESCRIPTION_SECTION_REGEX =
  /^(rx|prescriptions?|medications?|treatment plan|plan)\s*:/i;
const VITALS_LINE_REGEX =
  /^(vitals|bp|blood pressure|spo2|sp\s*o2|temp|temperature|pulse|hr|heart rate|glucose|hba1c|weight|height|bmi|o2\s*sat)/i;
const VITALS_INLINE_REGEX =
  /(?:\bbp\b|\bblood pressure\b|\bspo2\b|\bsp\s*o2\b|\btemperature\b|\btemp\b)\s*[:\-]|\b\d{2,3}\s*\/\s*\d{2,3}\s*(?:mm\s*hg)?/i;
const DOSAGE_REGEX = /\b\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|unit|units|%)\b/i;
const INSTRUCTION_START_REGEX =
  /^(take|give|apply|use|inhale|instill|dissolve|chew|swallow|inject|one|1)\b/i;
const SKIP_LINE_REGEX =
  /^(subjective|objective|assessment|findings|follow-?up|tests?\s*ordered|return visit|patient instructions?|symptoms|duration|patient concerns?|clinical impression)\s*:/i;
const BULLET_PREFIX_REGEX = /^[-•*]\s*/;
const NUMBER_PREFIX_REGEX = /^\d+[.)]\s*/;

function expandPrescriptionInstructions(text) {
  return String(text || "")
    .replace(/\btds\b/gi, "3 times a day")
    .replace(/\btid\b/gi, "3 times a day")
    .replace(/\bbd\b/gi, "twice a day")
    .replace(/\bbid\b/gi, "twice a day")
    .replace(/\bod\b/gi, "once a day")
    .replace(/\bqid\b/gi, "4 times a day")
    .replace(/\bqds\b/gi, "4 times a day")
    .replace(/\bprn\b/gi, "as needed")
    .replace(/\bpo\b/gi, "by mouth")
    .replace(/\bstat\b/gi, "immediately")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractDuration(text) {
  const value = String(text || "");
  const forDays = value.match(/\bfor\s+(\d+)\s*days?\b/i);
  if (forDays) {
    const count = Number(forDays[1]);
    return `${count} day${count === 1 ? "" : "s"}`;
  }

  const timesDays = value.match(/\bx\s*(\d+)\s*days?\b/i);
  if (timesDays) {
    const count = Number(timesDays[1]);
    return `${count} day${count === 1 ? "" : "s"}`;
  }

  const fractionDays = value.match(/\b(\d+)\s*\/\s*(\d+)\s*days?\b/i);
  if (fractionDays) {
    return `${fractionDays[1]}/${fractionDays[2]} days`;
  }

  return "";
}

function inferMedicationType(text) {
  const lower = String(text || "").toLowerCase();
  if (/\b(syrup|suspension|solution|elixir)\b/.test(lower)) return "syrup";
  if (/\b(injection|intravenous|intramuscular)\b/.test(lower) || /\b(iv|im)\b/.test(lower)) {
    return "injection";
  }
  if (/\b(cream|ointment|gel|lotion|drops)\b/.test(lower)) return "topical";
  return "tablet";
}

function stripListPrefix(line) {
  return String(line || "")
    .replace(BULLET_PREFIX_REGEX, "")
    .replace(NUMBER_PREFIX_REGEX, "")
    .trim();
}

function isVitalsLine(line) {
  const cleaned = String(line || "").trim();
  if (!cleaned) return true;
  if (VITALS_LINE_REGEX.test(cleaned)) return true;
  return VITALS_INLINE_REGEX.test(cleaned) && !DOSAGE_REGEX.test(cleaned);
}

function formatPrescriptionName(text) {
  return String(text || "")
    .replace(/^tab(?:let)?\.?\s+/i, "Tablet ")
    .replace(/^cap(?:sule)?\.?\s+/i, "Capsule ")
    .replace(/^syr(?:up)?\.?\s+/i, "Syrup ")
    .trim();
}

function parsePrescribedLine(line) {
  const cleaned = stripListPrefix(line);
  const match = cleaned.match(/^prescribed\s*:\s*(.+)$/i);
  if (!match) {
    return null;
  }

  const body = match[1].trim();
  if (!body) {
    return null;
  }

  const withDosage = parseMedicationLine(body);
  if (withDosage) {
    return withDosage;
  }

  const name = formatPrescriptionName(body);

  return {
    name,
    instructions: "",
    duration: "",
    type: inferMedicationType(body),
  };
}

function parseMedicationLine(line) {
  const cleaned = stripListPrefix(line);
  if (!cleaned || !DOSAGE_REGEX.test(cleaned)) {
    return null;
  }

  if (isVitalsLine(cleaned) && !INSTRUCTION_START_REGEX.test(cleaned)) {
    return null;
  }

  let name = cleaned;
  let instructions = "";

  const splitMatch = cleaned.match(
    /^(.+?\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|unit|units|%)(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g))?)\s*[-–—:]\s*(.+)$/i,
  );
  if (splitMatch) {
    name = splitMatch[1].trim();
    instructions = expandPrescriptionInstructions(splitMatch[2]);
  } else {
    const instructionMatch = cleaned.match(
      /^(.+?\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|unit|units|%))\s+((?:take|give|apply|use|po|tds|bd|od|tid|qds).+)$/i,
    );
    if (instructionMatch) {
      name = instructionMatch[1].trim();
      instructions = expandPrescriptionInstructions(instructionMatch[2]);
    }
  }

  const duration = extractDuration(instructions || cleaned);

  return {
    name,
    instructions,
    duration,
    type: inferMedicationType(cleaned),
  };
}

/** Patient-facing prescriptions parsed from free-text consultation notes. */
function extractPrescriptionsFromNotes(notes) {
  const rawText = String(notes || "").trim();
  if (!rawText) {
    return [];
  }

  const lines = rawText
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  const prescriptions = [];
  let inPrescriptionSection = false;
  let awaitingInstructions = false;

  for (const line of lines) {
    if (DIAGNOSIS_PREFIX_REGEX.test(line) || isVitalsLine(line)) {
      awaitingInstructions = false;
      continue;
    }

    if (SKIP_LINE_REGEX.test(line)) {
      inPrescriptionSection = false;
      awaitingInstructions = false;
      continue;
    }

    if (PRESCRIPTION_SECTION_REGEX.test(line)) {
      inPrescriptionSection = true;
      const inlineMedication = line.replace(PRESCRIPTION_SECTION_REGEX, "").trim();
      if (inlineMedication) {
        const parsed = parseMedicationLine(inlineMedication);
        if (parsed) {
          prescriptions.push(parsed);
          awaitingInstructions = !parsed.instructions;
        }
      }
      continue;
    }

    if (/^medication(?:\s+or\s+treatment)?\s*:/i.test(line)) {
      inPrescriptionSection = true;
      continue;
    }

    const prescribedParsed = parsePrescribedLine(line);
    if (prescribedParsed) {
      prescriptions.push(prescribedParsed);
      awaitingInstructions = !prescribedParsed.instructions;
      continue;
    }

    const parsed = parseMedicationLine(line);
    if (parsed) {
      prescriptions.push(parsed);
      awaitingInstructions = !parsed.instructions;
      continue;
    }

    if (awaitingInstructions && INSTRUCTION_START_REGEX.test(stripListPrefix(line))) {
      const last = prescriptions[prescriptions.length - 1];
      if (last && !last.instructions) {
        last.instructions = expandPrescriptionInstructions(stripListPrefix(line));
        last.duration = extractDuration(last.instructions) || last.duration;
      }
      awaitingInstructions = false;
      continue;
    }

    if (inPrescriptionSection && BULLET_PREFIX_REGEX.test(line)) {
      const bulletContent = stripListPrefix(line);
      if (/^(medication|treatment)\b/i.test(bulletContent) && !DOSAGE_REGEX.test(bulletContent)) {
        continue;
      }
      const bulletParsed = parseMedicationLine(bulletContent);
      if (bulletParsed) {
        prescriptions.push(bulletParsed);
        awaitingInstructions = !bulletParsed.instructions;
      }
      continue;
    }

    awaitingInstructions = false;
  }

  return prescriptions.map((item, index) => ({
    id: index + 1,
    name: item.name,
    dosage: item.instructions || item.name,
    instructions: item.instructions || "",
    duration: item.duration || "",
    type: item.type || "tablet",
  }));
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

function resolveConsultationDiagnosis(row) {
  const structured = String(row.patient_diagnosis || "").trim();
  if (structured) {
    return structured;
  }

  return extractDiagnosisFromNotes(row.doctor_notes);
}

function resolveConsultationPrescriptions(row) {
  const structuredRx = String(row.patient_prescription || "").trim();
  if (structuredRx) {
    return extractPrescriptionsFromNotes(`Prescribed: ${structuredRx}`);
  }

  return extractPrescriptionsFromNotes(row.doctor_notes);
}

function resolveConsultationPlainSummary(row) {
  const structuredRx = String(row.patient_prescription || "").trim();
  if (structuredRx) {
    return structuredRx.length <= 220 ? structuredRx : `${structuredRx.slice(0, 220).trim()}…`;
  }

  return buildPlainSummaryFromNotes(row.doctor_notes);
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
    diagnosis: resolveConsultationDiagnosis(row),
    plain_summary: resolveConsultationPlainSummary(row),
    note_preview: resolveConsultationPlainSummary(row),
    prescriptions: resolveConsultationPrescriptions(row),
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
  extractPrescriptionsFromNotes,
  parseVitalsFromText,
  mergeVitalsTrends,
};
