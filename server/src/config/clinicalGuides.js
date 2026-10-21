// Clinical references are maintained here and released with the backend.
// App accounts cannot author or override these guides through inventory APIs.
const BUSCOPAN_IM_IV = Object.freeze({
  format: "ocs-clinical-guide-v1",
  presentation: "20 mg/mL · 1 mL ampoule",
  population: "Adults",
  routes: "IM / IV",
  dose: "20 mg",
  dose_detail: "1 ampoule · 1 mL",
  repeat: "After 30 minutes",
  maximum: "100 mg / 24 h",
  administration: "IV: administer slowly; monitor for hypotension and severe allergic reactions.\nIM: do not administer to patients taking anticoagulants because of haematoma risk.",
  contraindications: "Hypersensitivity; narrow-angle glaucoma; myasthenia gravis; tachycardia; prostatic enlargement with urinary retention; gastrointestinal mechanical stenosis; paralytic or obstructive ileus; megacolon.",
  indications: "Acute visceral smooth-muscle spasm, including renal or biliary colic, and spasm during selected diagnostic or endoscopic procedures.",
  side_effects: "Dry mouth, blurred vision, tachycardia, constipation and urinary retention.",
  pharmacology: "Anticholinergic / antispasmodic. A quaternary ammonium compound with predominantly peripheral action; it does not readily cross the blood–brain barrier. CNS effects cannot be completely excluded.",
  notes: "Not recommended for children in the linked product guidance.",
  source_title: "Buscopan Ampoules · UK SmPC",
  source_url: "https://www.medicines.org.uk/emc/product/890/smpc",
  source_updated: "5 Jan 2026",
});

const BUSCOPAN_INJECTION_NAMES = Object.freeze([
  "Buscopan 20mg (IM/IV)",
  "Buscopan 20mg (IV/IM)",
  "Buscopan 20mg Ampoule (Box of 10)",
  "Buscopan 20mg/1ml Ampoule",
  "Buscopan 20mg/1ml (IM/IV)",
  "Buscopan Ampoules 20mg/ml",
]);

module.exports = { BUSCOPAN_IM_IV, BUSCOPAN_INJECTION_NAMES };
