const DIAGNOSIS_PREFIX_REGEX = /^(imp(ression)?\s*:|dx\s*-\s*|dx\s*:|diagnosis\s*:)/i;

function normalizeDiagnosisText(text) {
  let diagnosis = String(text || "").trim();

  diagnosis = diagnosis
    .replace(/^imp(ression)?\s*:/i, "")
    .replace(/^dx\s*-\s*/i, "")
    .replace(/^dx\s*:/i, "")
    .replace(/^diagnosis\s*:/i, "")
    .trim();

  diagnosis = diagnosis.replace(/\bday\s*\d+\b.*$/i, "").trim();

  diagnosis = diagnosis
    .replace(/\b\d+\s*(mg|ml)\b/gi, "")
    .replace(/\b(tablet|tablets|capsule|syrup|iv|po|od|bd|tid)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  diagnosis = diagnosis.length > 140 ? `${diagnosis.slice(0, 140).trim()}…` : diagnosis;

  return diagnosis || "General Assessment";
}

function extractDiagnosisFromNotes(rawText) {
  const lines = String(rawText || "").split("\n");
  for (const line of lines) {
    const cleanLine = String(line || "").trim();
    if (!cleanLine) continue;
    if (DIAGNOSIS_PREFIX_REGEX.test(cleanLine)) {
      return normalizeDiagnosisText(cleanLine);
    }
  }
  return "General Assessment";
}

function doctorLabelFromName(doctorName) {
  const firstName = String(doctorName || "OCS Doctor").trim().split(/\s+/)[0] || "Doctor";
  return `Dr ${firstName}`;
}

/**
 * Insurer-facing diagnosis lines only. Full notes, vitals, meds and free text
 * stay on the server and are never returned to the Linkham login.
 */
function buildInsurerTreatmentSummaries(consultationRows = []) {
  return (Array.isArray(consultationRows) ? consultationRows : [])
    .map((note, index) => {
      const diagnosis = extractDiagnosisFromNotes(note?.raw_text);
      return {
        sequenceNumber: index + 1,
        visit_date: note?.visit_date || null,
        doctor_label: doctorLabelFromName(note?.doctor_name),
        diagnosis,
        summaryString: `Diagnosis: ${diagnosis}`,
      };
    });
}

module.exports = {
  buildInsurerTreatmentSummaries,
  doctorLabelFromName,
  extractDiagnosisFromNotes,
  normalizeDiagnosisText,
};
