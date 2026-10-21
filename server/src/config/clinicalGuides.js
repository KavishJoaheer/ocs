// Clinical references are maintained here and released with the backend.
// App accounts cannot author or override these guides through inventory APIs.
// Use UK product information and guidance as the primary reference. Australian
// secondary sources must agree for the same indication, route and population.
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

const ONDANSETRON_SHARED = Object.freeze({
  presentation: "Injection · verify ampoule strength and volume",
  contraindications: "Hypersensitivity to ondansetron or excipients; concomitant apomorphine.",
  precautions: "QT prolongation: avoid in congenital long-QT syndrome; correct low potassium and magnesium before administration. Use caution with cardiac disease or QT-prolonging medicines.\nSerotonin syndrome: monitor with serotonergic medicines, including SSRIs, SNRIs and tramadol.",
  side_effects: "Headache, constipation and warmth/flushing. Liver enzyme elevations may occur and are less common.",
  pharmacology: "Selective 5-HT3 receptor antagonist (serotonin antagonist); antiemetic.",
  source_title: "Ondansetron injection · UK SmPC (AS Kalceks)",
  source_url: "https://www.medicines.org.uk/emc/product/13193/smpc",
  source_updated: "8 Aug 2024",
});

const ONDANSETRON_PAEDIATRIC = Object.freeze({
  ...ONDANSETRON_SHARED,
  format: "ocs-clinical-guide-v1",
  population: "Paediatrics",
  routes: "IV",
  dose_sections: Object.freeze([
    Object.freeze({ label: "PONV · 1 month–17 years", dose: "0.1 mg/kg", detail: "Single slow IV dose over at least 30 seconds; maximum 4 mg. At 40 kg or above, the capped dose is 4 mg." }),
    Object.freeze({ label: "CINV · 6 months–17 years", dose: "0.15 mg/kg", detail: "IV infusion over at least 15 minutes, immediately before chemotherapy; maximum 8 mg per dose. On day 1, two further doses may be prescribed at 4-hour intervals." }),
  ]),
  dose_limits: "PONV: maximum 4 mg per dose.\nCINV: maximum 8 mg per IV dose in the linked UK SmPC.\nModerate or severe hepatic impairment: maximum 8 mg total / 24 h.",
  administration: "Confirm age, current weight in kg, ampoule concentration and calculated volume. Follow the indication-specific IV duration above.\nCINV: dilute in 25–50 mL 0.9% sodium chloride or another compatible infusion fluid; follow the prescribed oncology regimen.",
  indications: "Post-operative nausea and vomiting from 1 month; chemotherapy-induced nausea and vomiting from 6 months.",
  notes: "IV paediatric reference; do not use adult IM instructions. Younger infants and other indications need specialist guidance.\nGastroenteritis is an off-label indication. Assess hydration and follow a UK paediatric/local protocol; no general IV gastroenteritis dose is supplied here. NICE ESUOM34 is an evidence summary, published October 2014, rather than a prescribing recommendation.",
  additional_source_title: "Gastroenteritis (off-label) · NICE ESUOM34 evidence summary · Oct 2014",
  additional_source_url: "https://www.nice.org.uk/advice/esuom34/chapter/Key-points-from-the-evidence",
});

const ONDANSETRON_IM_IV = Object.freeze({
  ...ONDANSETRON_SHARED,
  format: "ocs-clinical-guide-v1",
  population: "Adults",
  routes: "IM / IV",
  dose_sections: Object.freeze([
    Object.freeze({ label: "Post-operative nausea & vomiting (PONV)", dose: "4 mg", detail: "Single dose · slow IV or IM." }),
    Object.freeze({ label: "Chemotherapy / radiotherapy (CINV/RINV)", dose: "8 mg", detail: "Initial dose · slow IV or IM before treatment." }),
    Object.freeze({ label: "Highly emetogenic chemotherapy", dose: "Up to 16 mg", detail: "Initial IV infusion over at least 15 minutes. Apply the limits below." }),
  ]),
  dose_limits: "Single IV dose: never exceed 16 mg.\nModerate or severe hepatic impairment: maximum 8 mg total / 24 h.\nAge 75+ with CINV/RINV: initial IV dose must not exceed 8 mg.",
  administration: "IV injection: administer over at least 30 seconds.\nDoses above 8 mg, or any IV dose for CINV/RINV at age 65+: dilute in 50–100 mL 0.9% sodium chloride or 5% glucose; infuse over at least 15 minutes.",
  indications: "Prevention and treatment of post-operative nausea and vomiting; chemotherapy- or radiotherapy-induced nausea and vomiting.",
  notes: "Adult initial-dose reference. Further CINV/RINV doses require the prescribed oncology regimen. Check the local Emetino product information and protocol, including pregnancy and breastfeeding guidance.",
  paediatric: ONDANSETRON_PAEDIATRIC,
});

// Explicit injectable aliases only: never infer route or strength from a brand alone.
const ONDANSETRON_INJECTION_NAMES = Object.freeze([
  "Emetino 4mg (IV/IM) box of 10",
  "Emetino 4mg (IV/IM)",
  "Emetino 4mg (IM/IV)",
  "Emetino 8mg (IM/IV)",
  "Emetino 8mg (IV/IM)",
  "Ondansetron 4mg (IM/IV)",
  "Ondansetron 4mg (IV/IM)",
  "Ondansetron 8mg (IM/IV)",
  "Ondansetron 8mg (IV/IM)",
]);

const PHENERGAN_SHARED = Object.freeze({
  format: "ocs-clinical-guide-v1",
  presentation: "25 mg/mL injection · verify ampoule volume",
  contraindications: "Promethazine/phenothiazine or excipient allergy; coma or CNS depression; age under 2 years. Avoid with MAO inhibitors or within 14 days of stopping them.",
  precautions: "Avoid alcohol and other sedatives, including opioids: CNS and respiratory depression can be potentiated. Assess QT risk, electrolytes and seizure history. Avoid in suspected Reye’s syndrome.",
  side_effects: "Sedation, dry mouth, blurred vision, hypotension, urinary retention; dystonia/EPS, paradoxical excitation and QT prolongation may occur.",
  pharmacology: "Sedating first-generation H1 antihistamine; phenothiazine with anticholinergic and antiemetic properties.",
  source_title: "Phenergan injection · UK SmPC",
  source_url: "https://www.medicines.org.uk/emc/product/1100/smpc",
  source_updated: "3 Oct 2025",
});

const PHENERGAN_PAEDIATRIC = Object.freeze({
  ...PHENERGAN_SHARED,
  population: "Paediatrics",
  routes: "Deep IM",
  critical_warning: "Under 2 years: CONTRAINDICATED — potentially fatal respiratory depression.\nTissue injury: never inject subcutaneously or intra-arterially; local necrosis can occur.",
  dose_sections: Object.freeze([
    Object.freeze({ label: "5–10 years · UK injection guidance", dose: "6.25–12.5 mg", detail: "Deep IM. Confirm the prescribed indication and dose." }),
    Object.freeze({ label: "Over 10 years · UK injection leaflet", dose: "25–50 mg", detail: "Deep IM; individual prescription required." }),
  ]),
  dose_limits: "Age 2–4 years: no dose supplied in the linked UK injection guidance; seek specialist advice. Do not extrapolate from older children or use a generic mg/kg sedation schedule.",
  administration: "This paediatric card covers deep IM only. Emergency IV administration requires a specialist protocol. Monitor respiratory status and sedation; children may develop paradoxical agitation.",
  indications: "Allergic conditions; paediatric sedation and preoperative sedation as described in the injection guidance. Use only for the prescribed indication.",
  notes: "Motion-sickness and routine antiemetic dosing are not listed in section 4.1 of this injection SmPC. Oral-product instructions and age restrictions must not be transferred to injection products. Confirm repeat dosing with the prescriber.",
  additional_source_title: "Paediatric age bands · UK Phenergan injection leaflet",
  additional_source_url: "https://www.medicines.org.uk/emc/product/1100/pil",
});

const PHENERGAN_IM_IV = Object.freeze({
  ...PHENERGAN_SHARED,
  population: "Adults",
  routes: "Deep IM · IV in emergency",
  critical_warning: "Severe tissue injury: extravasation or accidental intra-arterial injection may cause necrosis and gangrene. Never inject subcutaneously or intra-arterially. Stop IV injection immediately if pain occurs.",
  dose: "25–50 mg",
  dose_detail: "Usual UK injection dose · deep IM",
  dose_limits: "UK SmPC maximum parenteral dose: 100 mg. Confirm repeat timing with the prescription; no routine 4–6-hour or 24-hour regimen is supplied here.",
  administration: "Deep IM is the standard route. Emergency IV only: dilute to 10 times the original volume with water for injections immediately before use. Example: 1 mL (25 mg) made up to 10 mL total (2.5 mg/mL). Inject slowly; follow the local IV protocol for rate, access and monitoring.",
  indications: "Symptomatic treatment of allergic conditions; adult sedation/insomnia and adjunctive preoperative sedation, as listed in the UK injection SmPC.",
  notes: "Anaphylaxis: IM adrenaline is first-line. Antihistamines must not delay adrenaline and do not treat airway, breathing or circulation problems (Resuscitation Council UK).\nNausea/vomiting is not listed in section 4.1 of this injection SmPC; use an appropriate prescribed protocol.",
  additional_source_title: "Anaphylaxis · Resuscitation Council UK guidance",
  additional_source_url: "https://www.resus.org.uk/library/additional-guidance/guidance-anaphylaxis",
  paediatric: PHENERGAN_PAEDIATRIC,
});

const PHENERGAN_INJECTION_NAMES = Object.freeze([
  "Phenergan inj box of 5",
  "Phenergan 50mg/2ml Ampoule (Box of 10)",
  "Phenergan 50mg/2ml Ampoule",
  "Phenergan 50mg/2ml (IM/IV)",
  "Phenergan 50mg/2ml (IV/IM)",
  "Phenergan 25mg/ml Injection",
  "Phenergan 25mg/1ml Ampoule",
  "Phenergan 25mg (IM/IV)",
  "Phenergan 25mg (IV/IM)",
  "Promethazine 25mg/ml Injection",
  "Promethazine 50mg/2ml Ampoule",
]);

module.exports = { BUSCOPAN_IM_IV, BUSCOPAN_INJECTION_NAMES, ONDANSETRON_IM_IV, ONDANSETRON_INJECTION_NAMES, PHENERGAN_IM_IV, PHENERGAN_INJECTION_NAMES };
