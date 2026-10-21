const FORMAT = "ocs-clinical-guide-v1";

function isClinicalGuide(raw) {
  try { return JSON.parse(raw)?.format === FORMAT; } catch { return false; }
}

function validateClinicalNotes(raw) {
  if (typeof raw !== "string" || raw.length > 50000) return "Keep clinical notes to 50,000 characters or fewer.";
  if (!isClinicalGuide(raw)) return null;
  const guide = JSON.parse(raw);
  if (Object.values(guide).some(value => typeof value !== "string")) return "Clinical guide fields must contain text.";
  if (guide.source_url) {
    try {
      const url = new URL(guide.source_url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid source");
    } catch { return "Use an HTTPS link without credentials for the clinical source."; }
  }
  return null;
}

module.exports = { isClinicalGuide, validateClinicalNotes };
