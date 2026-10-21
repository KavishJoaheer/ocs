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

const TRAMADOL_SHARED = Object.freeze({
  format: "ocs-clinical-guide-v1",
  presentation: "50 mg/mL injection · 100 mg / 2 mL ampoule; verify local product",
  contraindications: "Tramadol/excipient allergy; acute intoxication with alcohol, opioids or other CNS depressants; uncontrolled epilepsy; MAO inhibitors now or within 14 days. Not for opioid-withdrawal treatment.",
  precautions: "Seizures can occur at therapeutic doses. Serotonin syndrome risk with SSRIs, SNRIs, TCAs and other serotonergic medicines.\nOpioids plus benzodiazepines (including diazepam), alcohol or other sedatives can cause profound sedation, respiratory depression, coma or death. Monitor respiration and consciousness.",
  side_effects: "Nausea, dizziness, vomiting, drowsiness, dry mouth, sweating and constipation. Serious risks include seizures, serotonin syndrome, respiratory depression and dependence.",
  pharmacology: "Centrally acting opioid analgesic: mu-opioid receptor activity plus inhibition of noradrenaline and serotonin reuptake. CYP2D6 forms the active M1 metabolite; ultra-rapid metabolism can cause opioid toxicity.",
  indications: "Moderate to severe pain.",
  source_title: "Tramadol injection (Zydol) · UK SmPC",
  source_url: "https://www.medicines.org.uk/emc/product/82/smpc",
  source_updated: "21 Feb 2025",
});

const TRAMADOL_PAEDIATRIC = Object.freeze({
  ...TRAMADOL_SHARED,
  population: "Paediatrics",
  routes: "Slow IV / IM · age and product restrictions apply",
  critical_warning: "Under 12 years: the linked Zydol injection is not suitable; no dose supplied here. Paediatric licensing differs between injection products and countries.\nPost-tonsillectomy/adenoidectomy: life-threatening respiratory events have occurred. Avoid routine use in children; obtain specialist guidance. Tramadol is not recommended with compromised respiratory function.",
  dose_sections: Object.freeze([
    Object.freeze({ label: "Adolescents older than 12 years · UK injection reference", dose: "50–100 mg", detail: "Slow IV or IM, every 4–6 hours if prescribed. Confirm the exact product's age licence; younger children need a separate specialist protocol." }),
  ]),
  dose_limits: "Maximum 400 mg total / 24 h. Use the lowest effective dose. No paediatric post-operative loading regimen is supplied. Renal/hepatic impairment requires individual interval adjustment.",
  administration: "IV: give over 2–3 minutes. Verify concentration and volume. Monitor respiratory rate, sedation and oxygenation; watch for shallow breathing, small pupils or excessive drowsiness.\nDo not mix in one syringe with diazepam, diclofenac, indomethacin, midazolam or piroxicam: precipitation risk.",
  notes: "Age restrictions are product-specific; this card follows the linked Zydol UK injection reference. Use the actual local product information and paediatric protocol. CYP2D6 ultra-rapid metabolisers are at particular risk even at usual doses.",
  additional_source_title: "Alternative UK injection licence · compare product-specific paediatric restrictions",
  additional_source_url: "https://www.medicines.org.uk/emc/product/13177/smpc",
});

const TRAMADOL_IM_IV = Object.freeze({
  ...TRAMADOL_SHARED,
  population: "Adults",
  routes: "Slow IV / IM",
  critical_warning: "Tramadol lowers the seizure threshold and can cause respiratory depression. Combining with diazepam or other sedatives substantially increases risk; use only when alternatives are unsuitable, with close monitoring.",
  dose_sections: Object.freeze([
    Object.freeze({ label: "Usual adult analgesia", dose: "50–100 mg", detail: "Slow IV or deep IM · 1–2 mL at 50 mg/mL. Repeat every 4–6 hours according to pain and response." }),
    Object.freeze({ label: "Post-operative loading · monitored protocol only", dose: "100 mg initially", detail: "Further 50 mg doses every 10–20 minutes if required, up to 250 mg total in the first hour INCLUDING the initial dose. Follow the prescribed monitored regimen; IV doses remain slow." }),
  ]),
  dose_limits: "Usual maximum 400 mg total / 24 h, including any loading doses.\nOver 75 years: extend the interval as needed; this UK injection SmPC does not specify a universal 300 mg/day cap.\nRenal/hepatic impairment: consider longer intervals individually; do not apply a blanket 12-hour schedule.",
  administration: "IV: administer over 2–3 minutes; avoid rapid injection.\nDo not mix in one syringe with diazepam, diclofenac, indomethacin, midazolam or piroxicam: precipitation risk. Infusion dilution must follow the actual product information.",
  notes: "Use the lowest effective dose for the shortest necessary duration, with a stopping plan. Confirm the local injection licence, particularly age restrictions and severe organ impairment.",
  paediatric: TRAMADOL_PAEDIATRIC,
});

const TRAMADOL_INJECTION_NAMES = Object.freeze([
  "Tramadol 100mg/2ml", // Exact imported injectable catalogue entry.
  "Tramadol 100mg/2ml (IM/IV)",
  "Tramadol 100mg/2ml (IV/IM)",
  "Tramadol 100mg/2ml Ampoule",
  "Tramadol 50mg/ml Injection",
  "Tramal 100mg/2ml Ampoule (Box of 5)",
]);

const DIAZEPAM_SHARED = Object.freeze({
  format: "ocs-clinical-guide-v1",
  presentation: "Injection reference: 5 mg/mL · 10 mg / 2 mL; verify ampoule and excipients",
  contraindications: "Benzodiazepine/excipient allergy; severe respiratory insufficiency or respiratory depression; sleep apnoea; marked neuromuscular respiratory weakness including unstable myasthenia gravis; severe hepatic impairment; acute porphyria. Check the full product contraindications, including pregnancy restrictions.",
  precautions: "Opioids (including tramadol), alcohol and other sedatives increase respiratory-depression risk. Repeated doses can accumulate. Monitor breathing, oxygenation, blood pressure and consciousness; airway support, bag-valve-mask and suction must be available.",
  side_effects: "Drowsiness, ataxia, confusion, muscle weakness, hypotension and injection-site irritation. Apnoea, respiratory arrest and paradoxical agitation can occur.",
  pharmacology: "Long-acting benzodiazepine; positive allosteric modulator of GABA-A receptors, with anticonvulsant, anxiolytic, sedative and muscle-relaxant effects.",
  source_title: "Diazepam Injection BP · UK SmPC (hameln)",
  source_url: "https://www.medicines.org.uk/emc/product/6274/smpc",
  source_updated: "26 Nov 2025",
});

const DIAZEPAM_PAEDIATRIC = Object.freeze({
  ...DIAZEPAM_SHARED,
  population: "Paediatrics",
  routes: "Slow IV · rectal rescue uses a separate formulation",
  critical_warning: "Neonates: no routine quick-card dose supplied; specialist assessment is essential. Propylene glycol/ethanol exposure is particularly hazardous in neonates and young children.\nRepeat benzodiazepines can cause apnoea. Count doses already given by family or ambulance staff and follow the seizure escalation plan.",
  dose_sections: Object.freeze([
    Object.freeze({ label: "Seizures · 1 month–11 years · IV", dose: "0.3–0.4 mg/kg", detail: "Maximum 10 mg per dose. Give over 3–5 minutes, no faster than 2 mg/min (10 mg requires at least 5 minutes). May repeat once after 10 minutes if required under the seizure protocol." }),
    Object.freeze({ label: "Seizures · 12–17 years · IV", dose: "10 mg", detail: "Give over at least 5 minutes. May repeat once after 10 minutes if required under the seizure protocol." }),
  ]),
  dose_limits: "Use current weight in kg and verify calculated volume. In children under 5, treatment may exceed excipient exposure limits: assess benefit/risk and monitor closely. Ongoing seizures after two benzodiazepine doses need urgent escalation rather than repeated unplanned doses.",
  administration: "IV injection: use undiluted into a large vein; do not mix with other drugs. Avoid routine IM seizure treatment because absorption is unreliable.\nNo IV access: follow the individual rescue plan using the prescribed buccal or rectal medicine. Rectal solution/gel has its own strength, weight/age limits and instructions; this injection card does not supply rectal dosing.",
  indications: "Acute convulsions/status epilepticus and prolonged febrile seizures. Tetanus and procedural use require their own specialist dosing protocol.",
  notes: "Flumazenil is not routine rescue for respiratory depression after seizure treatment; support airway/ventilation. It is contraindicated when benzodiazepines control a life-threatening condition such as status epilepticus, and can precipitate seizures in dependent patients or mixed overdose. Specialist decision only.",
  additional_source_title: "Flumazenil · UK SmPC contraindications and seizure risks",
  additional_source_url: "https://www.medicines.org.uk/emc/product/6300/smpc",
});

const DIAZEPAM_IM_IV = Object.freeze({
  ...DIAZEPAM_SHARED,
  population: "Adults",
  routes: "Slow IV · IM only if IV is not possible",
  critical_warning: "Rapid IV diazepam can cause apnoea, hypotension or cardiac arrest. Resuscitation equipment and trained assistance must be available. Combining with opioids such as tramadol can be fatal.",
  dose_sections: Object.freeze([
    Object.freeze({ label: "Status epilepticus / acute convulsions", dose: "10 mg IV", detail: "Slow injection; may repeat after 10 minutes if required. Persistent seizures need the emergency escalation protocol." }),
    Object.freeze({ label: "Severe acute anxiety/agitation or acute muscle spasm", dose: "10 mg", detail: "Slow IV, or IM if IV is not possible; may repeat after 4 hours if required. Individualise to response." }),
    Object.freeze({ label: "Delirium tremens", dose: "10–20 mg", detail: "IV or IM under a monitored withdrawal protocol. Further titration requires clinical supervision." }),
  ]),
  dose_limits: "Elderly/debilitated patients: no more than half the usual adult dose. Lower doses may be needed with chronic respiratory insufficiency or hepatic disease. Higher/repeated doses and renal/hepatic impairment require excipient-toxicity assessment; no single daily maximum covers every indication.",
  administration: "Slow IV injection into a large vein: no faster than 5 mg/min (1 mL/min at 5 mg/mL); a 10 mg dose takes at least 2 minutes. Monitor and keep the patient supine.\nDo not dilute for direct IV/IM injection or mix with other drugs. IV infusion has separate product-specific dilution instructions. IM absorption is variable and is reserved for when IV is not possible.",
  indications: "Acute convulsions/status epilepticus; severe acute anxiety/agitation; delirium tremens; acute muscle spasm. Tetanus and procedural sedation require separate prescribed regimens.",
  notes: "Observe under medical supervision for at least one hour after injection, longer if required. Flumazenil is not a routine substitute for airway support and may provoke seizures; use only after specialist assessment.",
  additional_source_title: "Flumazenil · UK SmPC contraindications and seizure risks",
  additional_source_url: "https://www.medicines.org.uk/emc/product/6300/smpc",
  paediatric: DIAZEPAM_PAEDIATRIC,
});

const DIAZEPAM_INJECTION_NAMES = Object.freeze([
  "Valium 10mg/2ml Ampoule",
  "Valium 10mg/2ml (IM/IV)",
  "Valium 10mg/2ml (IV/IM)",
  "Valium 5mg/ml Injection",
  "Diazepam 10mg/2ml Ampoule",
  "Diazepam 10mg/2ml (IM/IV)",
  "Diazepam 10mg/2ml (IV/IM)",
  "Diazepam 5mg/ml Injection",
]);

module.exports = { BUSCOPAN_IM_IV, BUSCOPAN_INJECTION_NAMES, ONDANSETRON_IM_IV, ONDANSETRON_INJECTION_NAMES, PHENERGAN_IM_IV, PHENERGAN_INJECTION_NAMES,
  TRAMADOL_IM_IV, TRAMADOL_INJECTION_NAMES, DIAZEPAM_IM_IV, DIAZEPAM_INJECTION_NAMES };
