// Backend-maintained UK references checked 22 October 2026; local clinical review pending.
const sections = rows => Object.freeze(rows.map(([label, dose, detail]) => Object.freeze({ label, dose, detail })));
const references = rows => Object.freeze(rows.map(([title, url]) => Object.freeze({ title, url })));
const FORMAT = "ocs-clinical-guide-v1";
const ALS = ["Adult advanced life support · RCUK 2025", "https://www.resus.org.uk/professional-library/2025-resuscitation-guidelines/adult-advanced-life-support-guidelines"];
const PLS = ["Paediatric life support · RCUK 2025", "https://www.resus.org.uk/cy/node/36439"];
const ANAPHYLAXIS = ["Anaphylaxis algorithm · RCUK", "https://www.resus.org.uk/sites/default/files/2021-04/Anaphylaxis%20algorithm%202021.pdf"];

// Explicitly withhold dosing when the requested injectable regimen lacks UK support.
function referenceOnly(shared, adultReason, childReason) {
  return Object.freeze({ format: FORMAT, ...shared, population: "Adults", dosing_unavailable: adultReason,
    paediatric: Object.freeze({ format: FORMAT, ...shared, population: "Paediatrics", dosing_unavailable: childReason }) });
}
const RANITIDINE_IM_IV = referenceOnly({
  presentation: "Aciloc injection · verify local product and regulatory status",
  critical_warning: "Ranitidine is currently unavailable in the UK according to the NHS. UK ranitidine injections were recalled over NDMA contamination concerns. This does not establish the status of an individual local batch.",
  pharmacology: "Histamine H2-receptor antagonist; reduces gastric acid secretion.",
  source_title: "Ranitidine availability · NHS", source_url: "https://www.nhs.uk/medicines/ranitidine/",
  additional_source_title: "Ranitidine injection recall · MHRA",
  additional_source_url: "https://www.gov.uk/drug-device-alerts/class-2-medicines-recall-zantac-injection-50mg-2ml-zantac-syrup-150mg-10ml-zantac-tablets-150mg-zantac-tablets-300mg-el-19-a-24",
}, "No current UK dosing reference is provided. Confirm local authorisation, batch status and a suitable alternative with pharmacy before use.",
"No paediatric or neonatal dose is provided. The supplied neonatal schedules must not be used as a UK reference; seek specialist pharmacy advice.");

const NEFOPAM_IM_IV = referenceOnly({
  presentation: "Acupan 20 mg/2 mL injection · formulation review required",
  critical_warning: "The UK NHS reference describes nefopam tablets. A matching UK injectable regimen has not been verified; oral instructions must not be applied to this ampoule.",
  pharmacology: "Centrally acting non-opioid analgesic.",
  source_title: "Nefopam formulations · NHS", source_url: "https://www.nhs.uk/medicines/nefopam/about-nefopam/",
}, "Injectable dose, interval, dilution and infusion rate are withheld pending the actual manufacturer's product information and local pharmacy review.",
"No injectable paediatric dose or age cut-off has been verified against a matching UK source. Do not automatically apply the supplied adult regimen from age 15.");

const ETAMSYLATE_IM_IV = referenceOnly({
  presentation: "Dicynone injection · verify manufacturer and strength",
  critical_warning: "The NHS describes etamsylate as not licensed in the UK. A UK-supported injectable regimen has not been verified. This notice does not determine local licensing status.",
  pharmacology: "Haemostatic agent.",
  source_title: "Etamsylate UK licensing context · NHS", source_url: "https://www.nhs.uk/medicines/tranexamic-acid/common-questions-about-tranexamic-acid/",
}, "Adult injectable dosing and topical use are withheld pending the actual product information and an approved local protocol. Ongoing bleeding requires assessment and treatment of its cause.",
"No paediatric or neonatal dose is provided. The supplied neonatal IVH-prevention schedule is not endorsed here; obtain neonatal specialist guidance and a locally approved protocol.");

const AMOXICILLIN_SHARED = Object.freeze({
  format: FORMAT, presentation: "500 mg amoxicillin as sodium salt · powder vial", routes: "IV preferred / IM when appropriate",
  critical_warning: "Check penicillin allergy and severe immediate reactions to other beta-lactams. Select treatment by infection, susceptibility and renal function; this card is not an empirical antibiotic pathway.",
  pharmacology: "Aminopenicillin beta-lactam antibiotic.",
  indications: "Susceptible severe respiratory, ENT and urinary infections; endocarditis/meningitis require specialist regimens.",
  contraindications: "Penicillin hypersensitivity or previous severe immediate hypersensitivity to another beta-lactam.",
  side_effects: "Rash, anaphylaxis, diarrhoea including C. difficile infection, and liver enzyme changes.",
  precautions: "Avoid in suspected infectious mononucleosis. Renal impairment increases accumulation and seizure risk; adjust the regimen using the SmPC, including dialysis instructions.",
  administration: "Linked Wockhardt 500 mg vial: IV add 10 mL water for injections (final volume 10.4 mL); IM add 2.5 mL (final volume 2.9 mL). Slow IV over 3–4 minutes; infusion over 30–60 minutes. Check the actual manufacturer's compatible fluids, stability and displacement before calculating volumes. Do not mix with aminoglycosides.",
  source_title: "Amoxicillin 500 mg injection · UK SmPC", source_url: "https://www.medicines.org.uk/emc/product/14925/smpc",
});
const AMOXICILLIN_IM_IV = Object.freeze({
  ...AMOXICILLIN_SHARED, population: "Adults",
  dose_sections: sections([
    ["Susceptible severe ENT / respiratory / urinary infection · IV", "750 mg–2 g every 8 h", "Alternative: 2 g every 12 h. Adults and children at least 40 kg; choose the prescribed indication-specific regimen."],
    ["Endocarditis / meningitis · specialist IV regimen", "1–2 g every 4–6 h", "Maximum 12 g/day; infection specialist management and appropriate combination treatment."],
  ]),
  dose_limits: "IV maximum 12 g/day. IM maximum 1 g per dose and 4 g/day. Renal impairment requires route-specific dose/interval adjustment; do not use one generic interval for all reduced GFR values.",
  paediatric: Object.freeze({
    ...AMOXICILLIN_SHARED, population: "Paediatrics",
    dose_sections: sections([
      ["Over 3 months and under 40 kg · IV infection-dependent range", "20–200 mg/kg/day", "Divide into 2–4 doses according to infection and severity. This is a daily total, not a single dose; confirm the indication-specific prescription."],
      ["Meningitis · over 3 months, under 40 kg · IV", "100–200 mg/kg/day", "Divide into 3–4 doses under specialist care."],
      ["Endocarditis · over 3 months, under 40 kg · IV", "200 mg/kg/day", "Divide into 3–4 doses under specialist care."],
    ]),
    dose_limits: "IV injection up to 25 mg/kg per dose; infusion up to 50 mg/kg per dose. IM: maximum 60 mg/kg per injection and 120 mg/kg/day in 2–6 doses. At least 40 kg: adult regimen. Renal impairment requires adjustment.",
    notes: "Neonates and infants up to 3 months need an age-, weight- and renal-specific prescription; no generic neonatal schedule is supplied here. Confirm the reconstituted concentration before withdrawing a partial vial.",
  }),
});

const CEFTRIAXONE_SHARED = Object.freeze({
  format: FORMAT, presentation: "1 g powder vial · confirm local product", routes: "IV / deep IM · indication-specific",
  pharmacology: "Third-generation cephalosporin beta-lactam antibiotic.",
  critical_warning: "NEVER give lidocaine-containing ceftriaxone intravenously. Do not mix with calcium-containing fluids or administer simultaneously. Neonatal calcium restrictions are stricter; see Paediatrics.",
  contraindications: "Cephalosporin allergy or previous severe immediate reaction to another beta-lactam. Check lidocaine contraindications before any lidocaine-containing IM preparation.",
  side_effects: "Diarrhoea, rash, blood-count changes, raised liver enzymes and biliary sludge.",
  administration: "Linked Kalceks product: 1 g IV with 10 mL water for injections, inject over 5 minutes; infusion at least 30 minutes. IM: 1 g with 3.5 mL 1% lidocaine if suitable, maximum 1 g per site. Confirm local product displacement, diluent and lidocaine age restrictions; never infer a child's volume from the vial label alone.",
  precautions: "Use calcium-free diluents. In patients older than 28 days, sequential IV calcium is possible only with thorough compatible-fluid flushing between administrations. Severe renal impairment (creatinine clearance below 10 mL/min): maximum 2 g/day; combined severe renal/hepatic impairment needs close monitoring.",
  source_title: "Ceftriaxone 1 g · UK SmPC", source_url: "https://www.medicines.org.uk/emc/product/15100/smpc",
});
const CEFTRIAXONE_IM_IV = Object.freeze({
  ...CEFTRIAXONE_SHARED, population: "Adults",
  dose_sections: sections([
    ["CAP / intra-abdominal / complicated urinary infection", "1–2 g every 24 h", "Adults and children at least 50 kg; prescribe according to infection and severity."],
    ["Meningitis / endocarditis / neutropenic fever · IV", "2–4 g/day", "Specialist regimen; doses above 2 g/day may be divided every 12 hours. Maximum 4 g/day."],
    ["Uncomplicated gonorrhoea · UK BASHH 2025", "1 g IM once", "Follow the sexual-health pathway, including testing, allergy assessment and follow-up."],
  ]),
  additional_source_title: "Gonorrhoea · BASHH 2025", additional_source_url: "https://www.bashh.org/resources/136/gonorrhoea_2025_updated_guideline/",
  paediatric: Object.freeze({
    ...CEFTRIAXONE_SHARED, population: "Paediatrics",
    critical_warning: "Contraindicated in premature infants up to a postmenstrual age of 41 weeks. In term neonates up to 28 days: contraindicated with jaundice/hyperbilirubinaemia, hypoalbuminaemia or acidosis, or if IV calcium is required/expected (even through separate lines).\nNEVER give lidocaine-containing solution IV. No neonatal dosing is provided in this card.",
    dose_sections: sections([
      ["Over 28 days–12 years, under 50 kg · CAP / intra-abdominal / UTI", "50–80 mg/kg every 24 h", "Dose depends on infection and severity; do not apply a universal 2 g paediatric maximum to all indications."],
      ["Meningitis · over 28 days–12 years, under 50 kg · IV", "80–100 mg/kg every 24 h", "Maximum 4 g/day; specialist care."],
    ]),
    dose_limits: "At least 50 kg: adult regimen. Children 12 years or younger receiving IV doses of 50 mg/kg or more need infusion. Neonates require specialist selection of an appropriate antibiotic.",
  }),
});

const ADRENALINE_SHARED = Object.freeze({
  format: FORMAT, presentation: "Verify strength: 1 mg/mL vs 0.1 mg/mL", routes: "IM anaphylaxis / IV or IO cardiac arrest",
  critical_warning: "Concentration and route are indication-specific: IM anaphylaxis uses 1 mg/mL (1:1000); the cardiac-arrest volumes below use 0.1 mg/mL (1:10,000). NEVER give undiluted 1 mg/mL as an IV bolus. A name such as ‘IM Adrenaline’ does not verify ampoule strength.",
  pharmacology: "Alpha- and beta-adrenergic agonist: vasoconstriction, increased cardiac activity and bronchodilation.",
  side_effects: "Tachycardia, palpitations, tremor, anxiety and hypertension; dosing errors can cause dangerous arrhythmias.",
  administration: "IM: middle outer thigh. Verify concentration, dose and volume independently, especially for children. IV/IO cardiac-arrest administration accompanies CPR and rhythm-directed resuscitation.",
  precautions: "Persistent breathing/circulation problems after two IM doses require the refractory-anaphylaxis pathway and expert support. IV adrenaline for anaphylaxis requires experienced specialists, an infusion pump and continuous monitoring; do not substitute the cardiac-arrest bolus.",
  notes: "Anaphylaxis needs emergency assessment and risk-based observation after recovery. Refractory shock and nebulised croup treatment require their own protocols; these injection doses must not be transferred to those routes/indications.",
  source_title: ANAPHYLAXIS[0], source_url: ANAPHYLAXIS[1],
  references: references([["Refractory anaphylaxis · RCUK", "https://www.resus.org.uk/sites/default/files/2021-04/Refractory%20anaphylaxis%20algorithm%202021.pdf"]]),
});
const ADRENALINE_IM_IV = Object.freeze({
  ...ADRENALINE_SHARED, population: "Adults",
  dose_sections: sections([
    ["Anaphylaxis · IM only · 1 mg/mL", "500 micrograms (0.5 mL)", "Repeat after 5 minutes if airway, breathing or circulation problems persist; call for emergency help."],
    ["Cardiac arrest · IV/IO · 0.1 mg/mL", "1 mg (10 mL)", "Non-shockable rhythm: as soon as possible; shockable rhythm: after the third shock. Repeat every 3–5 minutes during resuscitation."],
  ]),
  additional_source_title: ALS[0], additional_source_url: ALS[1],
  paediatric: Object.freeze({
    ...ADRENALINE_SHARED, population: "Paediatrics",
    dose_sections: sections([
      ["Anaphylaxis · under 6 months · IM 1 mg/mL", "100–150 micrograms (0.1–0.15 mL)", "RCUK age-based regimen; repeat after 5 minutes if ABC problems persist."],
      ["Anaphylaxis · 6 months to under 6 years · IM 1 mg/mL", "150 micrograms (0.15 mL)", "Repeat after 5 minutes if ABC problems persist."],
      ["Anaphylaxis · 6–12 years · IM 1 mg/mL", "300 micrograms (0.3 mL)", "Repeat after 5 minutes if ABC problems persist."],
      ["Anaphylaxis · over 12 years · IM 1 mg/mL", "500 micrograms (0.5 mL)", "Use 300 micrograms (0.3 mL) if small/prepubertal, per full RCUK guidance. Repeat after 5 minutes if ABC problems persist."],
      ["Cardiac arrest · IV/IO · 0.1 mg/mL", "10 micrograms/kg (0.1 mL/kg)", "Maximum 1 mg per dose. Non-shockable: as soon as possible; shockable: after third shock. Repeat every 3–5 minutes."],
    ]),
    dose_limits: "Use one anaphylaxis dosing method; do not add age- and weight-based doses. Newborn resuscitation at birth follows a separate neonatal algorithm. Use a delivery device suitable for the calculated small volume.",
    additional_source_title: PLS[0], additional_source_url: PLS[1],
    references: references([...ADRENALINE_SHARED.references.map(row => [row.title, row.url]), ["Full anaphylaxis guideline · RCUK", "https://www.resus.org.uk/sites/default/files/2021-05/Emergency%20Treatment%20of%20Anaphylaxis%20May%202021_0.pdf"]]),
  }),
});

const ATROPINE_SHARED = Object.freeze({
  format: FORMAT, presentation: "Atropine sulphate · verify ampoule concentration", routes: "IM premedication / IV emergency regimens",
  critical_warning: "Emergency bradycardia dosing below is IV, not IM. An inventory name ‘IM Atropine’ does not change the recommended emergency route. Confirm micrograms versus milligrams and the actual ampoule strength before calculating mL.",
  pharmacology: "Antimuscarinic: reduces vagal cardiac effects and secretions.",
  side_effects: "Dry mouth, blurred vision, tachycardia, urinary retention, flushing and confusion; children may develop excitation or hyperthermia.",
  precautions: "Check full product contraindications, including glaucoma, obstructive urinary/GI disease and myasthenia gravis. Monitor ECG and clinical response. Organophosphate poisoning needs urgent toxicology advice and a separate titrated regimen; bradycardia dose limits must not be applied to poisoning.",
  source_title: "Atropine sulphate 600 micrograms/mL · UK SmPC", source_url: "https://www.medicines.org.uk/emc/product/6282/smpc",
});
const ATROPINE_IM_IV = Object.freeze({
  ...ATROPINE_SHARED, population: "Adults",
  dose_sections: sections([
    ["Symptomatic bradycardia with adverse signs · IV", "500 micrograms IV", "Repeat every 3–5 minutes if necessary, maximum 3 mg. Follow the RCUK bradycardia algorithm and prepare escalation/pacing when indicated."],
    ["Anaesthetic premedication · IM", "300–600 micrograms", "30–60 minutes before anaesthesia, when prescribed by the anaesthetic team."],
  ]),
  dose_limits: "RCUK: do not use atropine in cardiac transplant patients or high-degree AV block with a wide QRS; follow the alternative bradycardia pathway. IM premedication is not a substitute for emergency IV treatment.",
  additional_source_title: ALS[0], additional_source_url: ALS[1],
  paediatric: Object.freeze({
    ...ATROPINE_SHARED, population: "Paediatrics",
    dose_sections: sections([
      ["Selected vagal / conduction-related bradycardia · IV", "20 micrograms/kg IV", "Maximum 500 micrograms per dose (RCUK 2025). Not routine treatment for hypoxic bradycardia: prioritise oxygenation, ventilation and CPR when indicated."],
      ["Anaesthetic premedication · neonates · IM", "10 micrograms/kg", "30–60 minutes before anaesthesia; specialist prescription. Do not impose a universal 100-microgram minimum."],
      ["Anaesthetic premedication · 1 month–11 years · IM", "10–30 micrograms/kg", "Maximum 600 micrograms; 30–60 minutes before anaesthesia."],
      ["Anaesthetic premedication · 12–17 years · IM", "300–600 micrograms", "30–60 minutes before anaesthesia, when prescribed."],
    ]),
    additional_source_title: PLS[0], additional_source_url: PLS[1],
  }),
});

// Explicit injectable aliases only. Never bind these guides to a tablet or service.
const ACUTE_CARE_GUIDES = Object.freeze([
  { ingredient: "Ranitidine", guide: RANITIDINE_IM_IV, names: ["Aciloc box of 5 amp", "Aciloc 50mg/2ml (IM/IV)", "Ranitidine 50mg/2ml Injection", "IM Aciloc"] },
  { ingredient: "Nefopam hydrochloride", guide: NEFOPAM_IM_IV, names: ["Acupan 20mg/2ml box of 5 amp", "Acupan 20mg/2ml (IM/IV)", "Nefopam 20mg/2ml Injection", "IM Acupan"] },
  { ingredient: "Amoxicillin sodium", guide: AMOXICILLIN_IM_IV, names: ["Amoxicillin 500mg (IM/IV)", "Amoxicillin 500mg Injection", "Amoxicillin sodium 500mg Injection", "IM Amoxicillin 500mg"] },
  { ingredient: "Ceftriaxone", guide: CEFTRIAXONE_IM_IV, names: ["Ceftriaxone 1g/ Triaxone/ Zefone IV/IM", "Ceftriaxone 1g (IM/IV)", "Ceftriaxone 1g Injection", "Triaxone 1g Injection", "Zefone 1g Injection"] },
  { ingredient: "Etamsylate", guide: ETAMSYLATE_IM_IV, names: ["Dicynone 250mg/2ml (IM/IV)", "Dicynone 250mg/2ml Injection", "Etamsylate 250mg/2ml Injection", "IM Dicynone"] },
  { ingredient: "Adrenaline (Epinephrine)", guide: ADRENALINE_IM_IV, names: ["IM Adrenaline", "Adrenaline 1mg/ml Injection", "Adrenaline 1:1000 Injection", "Adrenaline 1:10,000 Injection", "Adrenaline 1mg/10ml Injection", "Epinephrine 1mg/ml Injection"] },
  { ingredient: "Atropine sulphate", guide: ATROPINE_IM_IV, names: ["IM Atropine", "Atropine 600mcg/ml Injection", "Atropine sulphate 600mcg/ml Injection", "Atropine sulphate 1mg/ml Injection", "Atropine 1mg/ml Injection"] },
].map(row => Object.freeze({ ...row, names: Object.freeze(row.names) })));
module.exports = { ACUTE_CARE_GUIDES, RANITIDINE_IM_IV, NEFOPAM_IM_IV, AMOXICILLIN_IM_IV, CEFTRIAXONE_IM_IV, ETAMSYLATE_IM_IV, ADRENALINE_IM_IV, ATROPINE_IM_IV };
