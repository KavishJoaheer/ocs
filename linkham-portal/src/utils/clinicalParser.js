const DIAGNOSIS_PREFIX_REGEX = /^(imp(ression)?\s*:|dx\s*-\s*|dx\s*:|diagnosis\s*:)/i;

function normalizeDiagnosisText(text) {
  let diagnosis = String(text || "").trim();

  // Remove common physician prefixes (we already matched them, but keep this safe).
  diagnosis = diagnosis
    .replace(/^imp(ression)?\s*:/i, "")
    .replace(/^dx\s*-\s*/i, "")
    .replace(/^dx\s*:/i, "")
    .replace(/^diagnosis\s*:/i, "")
    .trim();

  // Remove trailing timeline tokens (e.g., "day 2", "Day 3").
  diagnosis = diagnosis.replace(/\bday\s*\d+\b.*$/i, "").trim();

  // Remove very common medication shorthand if it leaks into the extracted line.
  diagnosis = diagnosis
    .replace(/\b\d+\s*(mg|ml)\b/gi, "")
    .replace(/\b(tablet|tablet|capsule|syrup|iv|po|od|bd|tid)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Clamp length to keep UI scannable and avoid accidental huge payloads.
  diagnosis = diagnosis.length > 140 ? `${diagnosis.slice(0, 140).trim()}…` : diagnosis;

  return diagnosis || "General Assessment";
}

/**
 * Parse chronological consultation notes into a scannable insurer-facing diagnosis list.
 * The parser only extracts lines that look like physician diagnosis/impression keys (Imp/Dx/Diagnosis),
 * minimizing accidental leakage of vitals/medication prose.
 */
export function generateInsurerSummary(consultationRows) {
  if (!Array.isArray(consultationRows) || consultationRows.length === 0) return [];

  return consultationRows.map((note, index) => {
    const doctorName = note?.doctor_name || "OCS Doctor";
    const rawText = String(note?.raw_text || "").trim();

    let diagnosis = "General Assessment";

    if (rawText) {
      const lines = rawText.split("\n");
      for (const line of lines) {
        const cleanLine = String(line || "").trim();
        if (!cleanLine) continue;

        if (DIAGNOSIS_PREFIX_REGEX.test(cleanLine)) {
          diagnosis = normalizeDiagnosisText(cleanLine);
          break;
        }
      }
    }

    const firstName = String(doctorName).split(/\s+/)[0] || "Doctor";
    return {
      sequenceNumber: index + 1,
      doctorTitle: `Dr ${firstName}`,
      summaryString: `Diagnosis: ${diagnosis}`,
    };
  });
}

