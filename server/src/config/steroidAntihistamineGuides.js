// Backend-maintained references checked 22 October 2026 against the linked UK sources.
// Keep indication, formulation and population boundaries explicit. Local review is pending.
const sections = rows => Object.freeze(rows.map(([label, dose, detail]) => Object.freeze({ label, dose, detail })));
const references = rows => Object.freeze(rows.map(([title, url]) => Object.freeze({ title, url })));
const ANAPHYLAXIS = ["Anaphylaxis · Resuscitation Council UK", "https://www.resus.org.uk/library/additional-guidance/guidance-anaphylaxis"];
const HYDROCORTISONE_PRODUCT = ["Solu-Cortef 100 mg · UK SmPC", "https://www.medicines.org.uk/emc/product/14379/smpc"];
const DEXAMETHASONE_PRODUCT = ["Dexamethasone 3.3 mg/mL · UK SmPC (base units)", "https://www.medicines.org.uk/emc/product/4659/smpc"];
const MENINGITIS = ["Meningitis · NICE NG240 recommendations", "https://www.nice.org.uk/guidance/ng240/chapter/recommendations"];
const MENINGITIS_DOSES = ["Meningitis dosing · NICE NG240 evidence review G4", "https://www.nice.org.uk/guidance/ng240/evidence/g4-corticosteroids-for-treatment-of-bacterial-meningitis-pdf-481072534206"];
const CROUP = ["Croup · NHS Highland", "https://www.rightdecisions.scot.nhs.uk/tam-treatments-and-medicines-nhs-highland/paediatric-therapeutic-guidelines/respiratory-paediatric-guidelines/croup-paediatric-guidelines/"];

const HYDROCORTISONE_SHARED = Object.freeze({
  format: "ocs-clinical-guide-v1",
  presentation: "100 mg powder vial · confirm local formulation",
  pharmacology: "Short-acting glucocorticoid with mineralocorticoid activity.",
  side_effects: "Hyperglycaemia, fluid retention, potassium loss, hypertension, mood changes and infection risk.",
  contraindications: "Product allergy; systemic fungal infection without specific treatment. Avoid live vaccines with immunosuppressive doses.",
  precautions: "Monitor glucose, electrolytes and fluid balance. Prolonged or repeated treatment may suppress adrenal function; individualise withdrawal.",
  source_title: HYDROCORTISONE_PRODUCT[0],
  source_url: HYDROCORTISONE_PRODUCT[1],
  source_updated: "18 May 2026",
});

const HYDROCORTISONE_PAEDIATRIC = Object.freeze({
  ...HYDROCORTISONE_SHARED,
  population: "Paediatrics",
  routes: "IM / IV · indication-specific",
  critical_warning: "Suspected adrenal crisis needs immediate treatment and urgent hospital care. Check glucose promptly.\nAnaphylaxis: IM adrenaline first; corticosteroids are not routine emergency treatment.",
  dose_sections: sections([
    ["Adrenal crisis · initial age-based rescue", "25 / 50 / 100 mg", "Under 1 year: 25 mg; 1–5 years: 50 mg; 6 years and over: 100 mg. Give IM or IV immediately; use ONE initial age- or weight-based regimen."],
    ["Adrenal crisis · children over 28 days", "2 mg/kg IV", "Maximum 100 mg per dose. Initial dose, then every 6 hours during severe illness. Once stable and improving: 1 mg/kg IV every 6 hours, maximum 50 mg per dose (BSPED)."],
    ["Adrenal crisis · neonates under 28 days", "4 mg/kg IV", "Initial dose, then every 6 hours during severe illness. Once stable and improving: 2 mg/kg IV every 6 hours. Specialist neonatal management; consider corrected gestational age and growth."],
  ]),
  dose_limits: "Do not routinely repeat the age-based rescue dose as maintenance. Use the hospital weight-based regimen and endocrine advice. At the neonatal age boundary, confirm the appropriate protocol.",
  administration: "For the linked 100 mg powder: reconstitute with no more than 2 mL sterile water for injections. Verify final concentration before withdrawing a child's dose; use the local paediatric IV administration protocol.",
  indications: "Acute adrenal insufficiency; severe asthma when oral steroid cannot be retained requires its own paediatric regimen.",
  notes: "Asthma doses and intervals differ from adrenal crisis: follow the linked UK acute-asthma pathway and local dose limits. Do not transfer adrenal-crisis age bands to asthma or anaphylaxis treatment. Hydrocortisone is not the standard croup steroid.",
  additional_source_title: "Adrenal crisis · BSPED consensus guidance",
  additional_source_url: "https://www.bsped.org.uk/adrenal-insufficiency",
  references: references([ANAPHYLAXIS, ["Acute asthma in children · BTS/NICE/SIGN pathway", "https://www.rightdecisions.scot.nhs.uk/asthma-pathway-bts-nice-sign-sign-244/managing-acute-asthma/management-of-acute-asthma-in-children/initial-treatment-of-acute-asthma-in-children/"]]),
});

const HYDROCORTISONE_IM_IV = Object.freeze({
  ...HYDROCORTISONE_SHARED,
  population: "Adults",
  routes: "IM / IV",
  critical_warning: "Anaphylaxis: IM adrenaline first. Hydrocortisone is not recommended for routine emergency treatment; never delay resuscitation for steroids.",
  dose_sections: sections([
    ["Acute adrenal crisis · initial treatment", "100 mg", "Give IV or IM immediately, with fluid resuscitation and urgent endocrine/hospital care. Do not delay treatment for tests."],
    ["Adrenal crisis · ongoing treatment", "200 mg / 24 h", "Continuous IV infusion preferred; alternatively 50 mg IV or IM every 6 hours until recovery and endocrine review."],
    ["Acute severe asthma · initial parenteral dose", "100 mg IV", "UK acute-asthma pathway option when parenteral steroid is needed; continue bronchodilators and emergency care. Further dosing follows the prescribed asthma regimen."],
  ]),
  dose_limits: "The SmPC's general 100–500 mg range is indication-dependent, not an adrenal-crisis maintenance schedule. Do not apply a single maximum or repeat interval to every indication.",
  administration: "Linked 100 mg powder: add no more than 2 mL sterile water for injections. IV administration in the SmPC takes 1–10 minutes according to dose. For infusion, reconstitute first; follow product fluid/volume instructions. IM is an alternative if IV access is unavailable.",
  indications: "Adrenal insufficiency; severe steroid-responsive illness, including asthma. Shock use requires an appropriate diagnosis/protocol, not routine administration for all shock.",
  additional_source_title: "Adult adrenal crisis · Society for Endocrinology",
  additional_source_url: "https://www.endocrinology.org/clinical-practice/clinical-guidance/adrenal-crisis/",
  references: references([ANAPHYLAXIS, ["Acute asthma in adults · BTS/NICE/SIGN pathway", "https://www.rightdecisions.scot.nhs.uk/asthma-pathway-bts-nice-sign-sign-244/managing-acute-asthma/management-of-acute-asthma-in-adults/asthma-management-algorithms-for-adults/management-of-acute-asthma-in-adults-in-general-practice/management-of-acute-asthma-in-adults-in-general-practice/"]]),
  paediatric: HYDROCORTISONE_PAEDIATRIC,
});

const DEXAMETHASONE_SHARED = Object.freeze({
  format: "ocs-clinical-guide-v1",
  presentation: "Verify base vs phosphate strength · no automatic mL conversion",
  critical_warning: "Strength check: the linked UK injection contains 3.3 mg dexamethasone base per mL, equivalent to 4 mg dexamethasone phosphate. Confirm the local Dexona label and prescription units before calculating volume.\nSteroids are not routine anaphylaxis treatment; IM adrenaline takes priority.",
  pharmacology: "Long-acting potent glucocorticoid with minimal mineralocorticoid activity.",
  side_effects: "Hyperglycaemia, agitation/insomnia, gastric irritation and infection risk; perineal discomfort can follow IV administration.",
  contraindications: "Product allergy; systemic infection without appropriate anti-infective treatment. Check the full product restrictions and excipients.",
  precautions: "Monitor glucose and mental state. Repeated courses or longer treatment can suppress adrenal function and affect growth; a short course is not a guarantee of zero risk.",
  administration: "Use slow IV administration according to the actual product and local IV protocol. Verify compatible diluent and infusion duration; do not assume one 15–30-minute schedule fits every dose. IM is not interchangeable with IV for every indication.",
  source_title: DEXAMETHASONE_PRODUCT[0],
  source_url: DEXAMETHASONE_PRODUCT[1],
  source_updated: "11 Oct 2024",
});

const DEXAMETHASONE_PAEDIATRIC = Object.freeze({
  ...DEXAMETHASONE_SHARED,
  population: "Paediatrics",
  routes: "IV for meningitis · oral reference for croup",
  dose_sections: sections([
    ["Bacterial meningitis · over 3 months", "0.15 mg/kg IV", "Maximum 10 mg per dose; every 6 hours for up to 4 days under the meningitis protocol. NICE recommends IV dexamethasone for strongly suspected or confirmed bacterial meningitis."],
    ["Croup · oral route reference", "0.15 mg/kg orally", "NHS Highland initial dose. This is not an IV/IM instruction. If too unwell for oral treatment, obtain urgent paediatric help and follow the airway pathway; it uses nebulised budesonide as an alternative."],
  ]),
  dose_limits: "Meningitis at 28 days–3 months: infection specialist advice; no routine neonatal dose here. Continue dexamethasone for pneumococcus or Hib; stop for other identified organisms. Seek advice if the organism is unknown.",
  notes: "Meningitis: give with/before the first antibiotic if possible, but NEVER delay antibiotics. If delayed less than 12 hours, give promptly; longer delays require specialist advice.\nDo not give an injectable preparation orally without checking its formulation and an approved local protocol. Asthma and antiemetic dosing require indication-specific paediatric prescriptions.",
  indications: "Bacterial meningitis adjunct and croup, with different routes and treatment pathways. Meningitis use is off-label as described by NICE.",
  additional_source_title: MENINGITIS[0], additional_source_url: MENINGITIS[1],
  references: references([MENINGITIS_DOSES, CROUP, ANAPHYLAXIS]),
});

const DEXAMETHASONE_IM_IV = Object.freeze({
  ...DEXAMETHASONE_SHARED,
  population: "Adults",
  routes: "IM / IV · indication-specific",
  dose_sections: sections([
    ["Tumour-associated cerebral oedema · UK SmPC", "8.3 mg base IV initially", "Then 3.3 mg base IM every 6 hours in the linked product regimen. Taper under specialist direction after response; do not substitute this for a spinal-cord-compression protocol."],
    ["Metastatic spinal cord compression · neurological signs", "16 mg oral or equivalent parenteral dose", "NICE NG234: give as soon as possible, then daily while awaiting surgery/radiotherapy. Confirm the parenteral equivalent and formulation; specialist taper thereafter."],
  ]),
  dose_limits: "No universal steroid dose covers inflammation, cerebral oedema, asthma and antiemesis. Oncology/perioperative antiemetic regimens require their own prescription; do not infer a dose from a generic 4–8 mg range.",
  indications: "Steroid-responsive disease when oral treatment is unsuitable; tumour-related cerebral oedema. Metastatic spinal cord compression requires urgent specialist management.",
  notes: "For spinal cord compression, monitor glucose and provide acid suppression as NICE advises. Phosphate-based schedules must not be read as base doses. Match the regimen, prescription and ampoule units before administration.",
  additional_source_title: "Metastatic spinal cord compression · NICE NG234",
  additional_source_url: "https://www.nice.org.uk/guidance/ng234/chapter/recommendations",
  references: references([ANAPHYLAXIS]),
  paediatric: DEXAMETHASONE_PAEDIATRIC,
});

const CHLORPHENAMINE_SHARED = Object.freeze({
  format: "ocs-clinical-guide-v1",
  presentation: "10 mg/mL injection · verify Chlorohistol ampoule",
  critical_warning: "Anaphylaxis: IM adrenaline first. Antihistamines do not treat airway, breathing or circulation compromise and must not delay emergency treatment. Their later role is relief of skin symptoms after stabilisation.",
  pharmacology: "Sedating first-generation H1 antihistamine with anticholinergic effects.",
  side_effects: "Drowsiness, dizziness, dry mouth, blurred vision and urinary retention; children may become paradoxically excited.",
  contraindications: "Product allergy; MAO inhibitor treatment now or within the last 14 days.",
  precautions: "Avoid additive sedation with alcohol, opioids or sedatives. Caution with glaucoma, epilepsy, prostatic hypertrophy, cardiovascular or hepatic disease.",
  indications: "Acute allergic symptoms including urticaria, angioedema and severe itching.",
  source_title: "Chlorphenamine 10 mg/mL · UK SmPC",
  source_url: "https://www.medicines.org.uk/emc/product/10595/smpc",
  source_updated: "26 Nov 2025",
  additional_source_title: ANAPHYLAXIS[0], additional_source_url: ANAPHYLAXIS[1],
});

const CHLORPHENAMINE_PAEDIATRIC = Object.freeze({
  ...CHLORPHENAMINE_SHARED,
  population: "Paediatrics",
  routes: "Slow IV / IM / SC",
  dose_sections: sections([
    ["1 month to under 1 year", "0.25 mg/kg", "Use current weight; no approximate fixed infant dose."],
    ["1–5 years", "2.5–5 mg OR 0.20 mg/kg", "Choose one prescribed calculation method."],
    ["6–11 years", "5–10 mg OR 0.20 mg/kg", "Age bands are displayed without overlap; see the source for its 6–12-year band."],
    ["12–17 years", "10–20 mg OR 0.20 mg/kg", "Confirm the adolescent prescription; do not add age- and weight-based doses."],
  ]),
  dose_limits: "Under 1 month: specialist guidance. Confirm repeat intervals and daily limits; no blanket four-times-daily paediatric regimen is provided in this SmPC.",
  administration: "Slow IV over 1 minute. For small infant volumes: 0.2 mL of 10 mg/mL solution made up to 2 mL total with 0.9% saline yields 1 mg/mL; use immediately. Verify concentration and volume independently.",
});

const CHLORPHENAMINE_IM_IV = Object.freeze({
  ...CHLORPHENAMINE_SHARED,
  population: "Adults", routes: "Slow IV / IM / SC",
  dose: "10–20 mg", dose_detail: "1–2 mL only at 10 mg/mL",
  maximum: "40 mg / 24 h",
  administration: "Give IV over 1 minute to reduce hypotension/CNS stimulation. IM or SC are permitted by the UK reference; verify the local product.",
  paediatric: CHLORPHENAMINE_PAEDIATRIC,
});

// Include exact local catalogue names; never use substring matching for drug guides.
const HYDROCORTISONE_INJECTION_NAMES = Object.freeze([
  "Solu-cortef 100MG IM/IV (Hisone)", "Solu-Cortef 100mg (IM/IV)", "Solu-Cortef 100mg (IV/IM)",
  "Solu-Cortef 100mg Injection", "Solu-Cortef 100mg Vial", "Hydrocortisone 100mg (IM/IV)",
  "Hydrocortisone 100mg Injection", "Hisone 100mg Injection",
]);
const DEXAMETHASONE_INJECTION_NAMES = Object.freeze([
  "Dexamethasone 4mg/ Dexona", "Dexamethasone 4mg (IM/IV)", "Dexamethasone 4mg (IV/IM)",
  "Dexamethasone 4mg/ml Injection", "Dexamethasone 3.3mg/ml Injection", "Dexona 4mg Injection",
]);
const CHLORPHENAMINE_INJECTION_NAMES = Object.freeze([
  "Chlorohistol 10mg/1ml box of 5 amp", "Chlorohistol 10mg/1ml (IM/IV)", "Chlorohistol 10mg/1ml (IV/IM)",
  "Chlorohistol 10mg (IM/IV)", "Chlorohistol 10mg (IV/IM)", "Chlorohistol 10mg/ml Injection",
  "Chlorphenamine 10mg/ml Injection", "Chlorphenamine 10mg (IM/IV)",
]);

module.exports = { HYDROCORTISONE_IM_IV, HYDROCORTISONE_INJECTION_NAMES, DEXAMETHASONE_IM_IV, DEXAMETHASONE_INJECTION_NAMES, CHLORPHENAMINE_IM_IV, CHLORPHENAMINE_INJECTION_NAMES };
