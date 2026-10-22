const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getClinicalGuideForItem, getInventoryItemAttributes, clinicalGuideWriteError } = require("../src/lib/clinicalGuide");
const { BUSCOPAN_IM_IV, BUSCOPAN_INJECTION_NAMES, ONDANSETRON_IM_IV, ONDANSETRON_INJECTION_NAMES, PHENERGAN_IM_IV, PHENERGAN_INJECTION_NAMES,
  TRAMADOL_IM_IV, TRAMADOL_INJECTION_NAMES, DIAZEPAM_IM_IV, DIAZEPAM_INJECTION_NAMES } = require("../src/config/clinicalGuides");

test("backend Buscopan guide matches the specified injection and catalogue aliases", () => {
  for (const item_name of BUSCOPAN_INJECTION_NAMES) {
    assert.equal(getClinicalGuideForItem({ item_name }), BUSCOPAN_IM_IV);
  }
  assert.equal(getClinicalGuideForItem({ item_name: " Buscopan 20 mg (IM / IV) " }), BUSCOPAN_IM_IV);
  assert.equal(getClinicalGuideForItem({ item_name: "Buscopan (Hyoscine Butylbromide)", folder_name: "IM Drugs" }), BUSCOPAN_IM_IV);
  assert.equal(BUSCOPAN_IM_IV.dose, "20 mg");
  assert.equal(BUSCOPAN_IM_IV.maximum, "100 mg / 24 h");
  assert.equal(BUSCOPAN_IM_IV.population, "Adults");
  assert.match(BUSCOPAN_IM_IV.administration, /do not administer to patients taking anticoagulants/);
  assert.ok(Object.isFrozen(BUSCOPAN_IM_IV));
});

test("the injection guide is not applied to oral products, combinations, other strengths or services", () => {
  for (const item_name of ["Buscopan", "Buscopan 10mg tablets", "Buscopan 20mg tablets", "Buscopan 40mg (IM/IV)", "Buscopan Compositum 20mg (IM/IV)", "Other 20mg (IM/IV)", "Buscopan (Hyoscine Butylbromide)"]) {
    assert.equal(getClinicalGuideForItem({ item_name }), null, item_name);
  }
  assert.equal(getClinicalGuideForItem({ item_name: BUSCOPAN_INJECTION_NAMES[0], item_kind: "service" }), null);
});

test("guide inputs are read-only while unchanged legacy notes remain compatible", () => {
  for (const input of [{ clinical_guide: BUSCOPAN_IM_IV }, { clinical_guide: null }, { moa_notes: "Replace notes" }, { moa_notes: {} }]) assert.ok(clinicalGuideWriteError(input));
  assert.ok(clinicalGuideWriteError({ moa_notes: "" }, { moa_notes: "Existing notes" }));
  assert.equal(clinicalGuideWriteError({ moa_notes: "Existing notes" }, { moa_notes: "Existing notes" }), null);
  assert.equal(clinicalGuideWriteError({ moa_notes: "" }), null);
  assert.equal(clinicalGuideWriteError({ minimum_quantity: 2 }), null);
});

test("ondansetron injection aliases use indication-specific adult doses and explicit limits", () => {
  for (const item_name of ONDANSETRON_INJECTION_NAMES) {
    assert.equal(getClinicalGuideForItem({ item_name }), ONDANSETRON_IM_IV);
  }
  assert.equal(getClinicalGuideForItem({ item_name: " Emetino 8 mg (IM / IV) " }), ONDANSETRON_IM_IV);
  assert.equal(ONDANSETRON_IM_IV.population, "Adults");
  assert.deepEqual(ONDANSETRON_IM_IV.dose_sections.map(section => section.dose), ["4 mg", "8 mg", "Up to 16 mg"]);
  assert.match(ONDANSETRON_IM_IV.dose_sections[2].detail, /IV infusion over at least 15 minutes/);
  assert.match(ONDANSETRON_IM_IV.dose_limits, /Moderate or severe hepatic impairment: maximum 8 mg total \/ 24 h/);
  assert.match(ONDANSETRON_IM_IV.dose_limits, /Age 75\+ with CINV\/RINV: initial IV dose must not exceed 8 mg/);
  assert.match(ONDANSETRON_IM_IV.administration, /any IV dose for CINV\/RINV at age 65\+/);
  assert.match(ONDANSETRON_IM_IV.contraindications, /apomorphine/);
  assert.ok(Object.isFrozen(ONDANSETRON_IM_IV.dose_sections[0]));
  const paediatric = ONDANSETRON_IM_IV.paediatric;
  assert.equal(paediatric.population, "Paediatrics");
  assert.equal(paediatric.routes, "IV");
  assert.deepEqual(paediatric.dose_sections.map(section => section.dose), ["0.1 mg/kg", "0.15 mg/kg"]);
  assert.match(paediatric.dose_sections[0].detail, /maximum 4 mg/);
  assert.match(paediatric.dose_sections[1].detail, /maximum 8 mg per dose/);
  assert.match(paediatric.dose_sections[1].detail, /4-hour intervals/);
  assert.match(paediatric.notes, /Gastroenteritis is an off-label indication/);
  assert.match(paediatric.notes, /no general IV gastroenteritis dose is supplied/);
  assert.match(paediatric.additional_source_url, /www.nice.org.uk\/advice\/esuom34/);
  assert.doesNotMatch(JSON.stringify(paediatric), /Queensland|qld.gov.au|16 mg cap/);
  assert.ok(Object.isFrozen(paediatric));
});

test("ondansetron guide is never inferred for tablets, unknown strengths, combinations or services", () => {
  for (const item_name of ["Emetino", "Emetino 4mg tablets", "Emetino 8mg tablets", "Emetino 16mg (IM/IV)", "Ondansetron", "Ondansetron 8mg tablets", "Ondansetron 4mg + other (IM/IV)"]) {
    assert.equal(getClinicalGuideForItem({ item_name, folder_name: "IV Drugs" }), null, item_name);
  }
  assert.equal(getClinicalGuideForItem({ item_name: ONDANSETRON_INJECTION_NAMES[0], item_kind: "service" }), null);
});

test("Phenergan uses the UK injection formulation, age bands and emergency IV dilution", () => {
  for (const item_name of PHENERGAN_INJECTION_NAMES) {
    assert.equal(getClinicalGuideForItem({ item_name }), PHENERGAN_IM_IV);
  }
  assert.equal(getClinicalGuideForItem({ item_name: "Phenergan 50 mg / 2 ml Ampoule" }), PHENERGAN_IM_IV);
  assert.equal(getClinicalGuideForItem({ item_name: "Phenergan 50mg/2ml (IM/IV)" }), PHENERGAN_IM_IV);
  assert.equal(PHENERGAN_IM_IV.dose, "25–50 mg");
  assert.equal(PHENERGAN_IM_IV.source_updated, "3 Oct 2025");
  assert.match(PHENERGAN_IM_IV.administration, /10 times the original volume with water for injections/);
  assert.match(PHENERGAN_IM_IV.administration, /10 mL total \(2.5 mg\/mL\)/);
  assert.match(PHENERGAN_IM_IV.critical_warning, /Stop IV injection immediately if pain occurs/);
  assert.match(PHENERGAN_IM_IV.notes, /IM adrenaline is first-line/);
  const paediatric = PHENERGAN_IM_IV.paediatric;
  assert.match(paediatric.critical_warning, /Under 2 years: CONTRAINDICATED/);
  assert.match(paediatric.critical_warning, /fatal respiratory depression/);
  assert.deepEqual(paediatric.dose_sections.map(section => [section.label, section.dose]), [
    ["5–10 years · UK injection guidance", "6.25–12.5 mg"],
    ["Over 10 years · UK injection leaflet", "25–50 mg"],
  ]);
  assert.match(paediatric.dose_limits, /Age 2–4 years: no dose supplied/);
  assert.equal(paediatric.routes, "Deep IM");
  assert.doesNotMatch(JSON.stringify(paediatric), /0.25 mg\/kg|0.5 mg\/kg|1 mg\/kg|every 4/);
  assert.ok(Object.isFrozen(paediatric.dose_sections[0]));
  for (const item_name of ["Phenergan", "Tab Phenergan", "Phenergan 25mg tablets", "Phenergan Elixir", "Promethazine 25mg tablets", "Phenergan 50mg/ml Injection", "Phenergan 25mg + Other (IM/IV)"]) {
    assert.equal(getClinicalGuideForItem({ item_name, folder_name: "IM Drugs" }), null, item_name);
  }
  assert.equal(getClinicalGuideForItem({ item_name: PHENERGAN_INJECTION_NAMES[0], item_kind: "service" }), null);
});

test("known Phenergan injections supply missing ingredients without replacing custom metadata", () => {
  for (const attributes of [undefined, null, "", "  ", "N/A", " n / a "]) {
    assert.equal(getInventoryItemAttributes({ item_name: "Phenergan 50mg/2ml (IM/IV)", attributes }), "Promethazine");
  }
  assert.equal(getInventoryItemAttributes({ item_name: "Phenergan 50mg/2ml (IM/IV)", attributes: "Promethazine hydrochloride" }), "Promethazine hydrochloride");
  for (const item_name of ["Tab Phenergan", "Phenergan 50mg/ml Injection", "Phenergan 25mg + Other (IM/IV)", "Unknown drug"]) {
    assert.equal(getInventoryItemAttributes({ item_name, attributes: "" }), "");
  }
  assert.equal(getInventoryItemAttributes({ item_name: "Phenergan 50mg/2ml (IM/IV)", item_kind: "service", attributes: "" }), "");
});

test("tramadol injection aliases keep adolescent restrictions separate from adult loading and elderly adjustments", () => {
  for (const item_name of TRAMADOL_INJECTION_NAMES) assert.equal(getClinicalGuideForItem({ item_name }), TRAMADOL_IM_IV);
  assert.equal(getClinicalGuideForItem({ item_name: " Tramadol 100 mg / 2 ml " }), TRAMADOL_IM_IV);
  assert.equal(getClinicalGuideForItem({ item_name: " IM Tramadol 100 mg / 2 ml ", folder_name: "IM Drugs" }), TRAMADOL_IM_IV);
  assert.equal(getInventoryItemAttributes({ item_name: "IM Tramadol 100mg/2ml", attributes: "" }), "Tramadol hydrochloride");
  assert.match(TRAMADOL_IM_IV.dose_limits, /including any loading doses/);
  assert.match(TRAMADOL_IM_IV.dose_limits, /does not specify a universal 300 mg\/day cap/);
  assert.match(TRAMADOL_IM_IV.administration, /over 2–3 minutes/);
  assert.match(TRAMADOL_IM_IV.administration, /diazepam.*midazolam/);
  const paediatric = TRAMADOL_IM_IV.paediatric;
  assert.equal(paediatric.population, "Paediatrics");
  assert.equal(paediatric.dose_sections.length, 1);
  assert.match(paediatric.dose_sections[0].label, /older than 12 years/);
  assert.match(paediatric.critical_warning, /licensing differs between injection products/);
  assert.match(paediatric.critical_warning, /tonsillectomy/);
  assert.match(paediatric.dose_limits, /No paediatric post-operative loading regimen/);
  assert.doesNotMatch(JSON.stringify(paediatric), /250 mg|100 mg initially/);
  assert.ok(Object.isFrozen(paediatric.dose_sections[0]));
  assert.ok(Object.isFrozen(TRAMADOL_IM_IV));
});

test("diazepam injection matching requires a named injectable product or the imported Valium injectable folder", () => {
  for (const item_name of DIAZEPAM_INJECTION_NAMES) assert.equal(getClinicalGuideForItem({ item_name }), DIAZEPAM_IM_IV);
  assert.equal(getClinicalGuideForItem({ item_name: "IM Valium", folder_name: "IM Drugs" }), DIAZEPAM_IM_IV);
  assert.equal(getInventoryItemAttributes({ item_name: "IM Valium", attributes: "" }), "Diazepam");
  for (const folder_name of ["IM Drugs", "IV Drugs"]) {
    assert.equal(getClinicalGuideForItem({ item_name: " Valium ", folder_name }), DIAZEPAM_IM_IV);
    assert.equal(getInventoryItemAttributes({ item_name: "Valium", folder_name, attributes: "N/A" }), "Diazepam");
  }
  for (const folder_name of [undefined, "Oral Drugs", "Consumable", "Pediatric Drugs"]) {
    assert.equal(getClinicalGuideForItem({ item_name: "Valium", folder_name }), null);
    assert.equal(getInventoryItemAttributes({ item_name: "Valium", folder_name, attributes: "" }), "");
  }
  assert.match(DIAZEPAM_IM_IV.administration, /Do not dilute for direct IV\/IM injection/);
  const paediatric = DIAZEPAM_IM_IV.paediatric;
  assert.deepEqual(paediatric.dose_sections.map(section => section.dose), ["0.3–0.4 mg/kg", "10 mg"]);
  assert.match(paediatric.dose_sections[0].detail, /Maximum 10 mg per dose/);
  assert.match(paediatric.critical_warning, /Neonates: no routine quick-card dose/);
  assert.match(paediatric.administration, /does not supply rectal dosing/);
  assert.match(paediatric.notes, /Flumazenil is not routine rescue/);
  assert.match(paediatric.notes, /contraindicated.*status epilepticus/);
  assert.doesNotMatch(JSON.stringify(paediatric), /Delirium tremens|10–20 mg|half the usual adult dose/);
  assert.ok(Object.isFrozen(paediatric.dose_sections[0]));
});

test("new injection guides reject oral, rectal, combination, unknown-strength and service items", () => {
  for (const item_name of ["Tramadol", "Tramadol 50mg tablets", "Tramadol 100mg capsules", "Tramadol 200mg/2ml (IM/IV)", "Tramadol 100mg/2ml + Other",
    "IM Tramadol 200mg/2ml", "IM Tramadol 100mg/2ml + Other", "IM Valium tablets", "IM Valium + Other",
    "Tab Valium 10mg", "Valium 10mg tablets", "Diazepam", "Diazepam 10mg rectal solution", "Diazepam 5mg/ml Oral Solution", "Diazepam 20mg/2ml (IM/IV)", "Valium + Other"]) {
    assert.equal(getClinicalGuideForItem({ item_name, folder_name: "IM Drugs" }), null, item_name);
  }
  for (const item_name of [...TRAMADOL_INJECTION_NAMES, ...DIAZEPAM_INJECTION_NAMES, "Valium"]) {
    assert.equal(getClinicalGuideForItem({ item_name, folder_name: "IM Drugs", item_kind: "service" }), null);
  }
  for (const [item_name, expected] of [["Tramadol 100mg/2ml", "Tramadol hydrochloride"], ["Valium 10mg/2ml Ampoule", "Diazepam"]]) {
    for (const attributes of [undefined, null, "", " N/A "]) assert.equal(getInventoryItemAttributes({ item_name, attributes }), expected);
    assert.equal(getInventoryItemAttributes({ item_name, attributes: "Verified local formulation" }), "Verified local formulation");
  }
});

const {
  HYDROCORTISONE_IM_IV, HYDROCORTISONE_INJECTION_NAMES,
  DEXAMETHASONE_IM_IV, DEXAMETHASONE_INJECTION_NAMES,
  CHLORPHENAMINE_IM_IV, CHLORPHENAMINE_INJECTION_NAMES,
} = require('../src/config/clinicalGuides');

for (const [guide, aliases, ingredient] of [
  [HYDROCORTISONE_IM_IV, HYDROCORTISONE_INJECTION_NAMES, 'Hydrocortisone'],
  [DEXAMETHASONE_IM_IV, DEXAMETHASONE_INJECTION_NAMES, 'Dexamethasone'],
  [CHLORPHENAMINE_IM_IV, CHLORPHENAMINE_INJECTION_NAMES, 'Chlorphenamine'],
]) {
  test(`${ingredient}: exact injection aliases and missing attributes work across catalogue scopes`, () => {
    for (const item_name of aliases) {
      assert.equal(getClinicalGuideForItem({ item_name }), guide);
      for (const attributes of ['', 'N/A', null]) {
        assert.equal(getInventoryItemAttributes({ item_name, attributes }), ingredient);
      }
      assert.equal(getClinicalGuideForItem({ item_name, item_kind: 'service' }), null);
      assert.equal(getInventoryItemAttributes({ item_name, attributes: 'Verified local formulation' }), 'Verified local formulation');
      assert.equal(getClinicalGuideForItem({ item_name: `${item_name} + other drug` }), null);
    }
    assert.equal(guide.paediatric.population, 'Paediatrics');
    assert.ok(Object.isFrozen(guide));
    assert.ok(Object.isFrozen(guide.paediatric.dose_sections));
    assert.match(guide.critical_warning, /adrenaline/);
  });
}

test('steroid and chlorphenamine guides never attach to oral, topical, unknown-strength or bundled service items', () => {
  for (const item_name of ['Solu-Cortef', 'Hydrocortisone 1% cream', 'Hydrocortisone 10mg tablets', 'Solu-Cortef 500mg Injection',
    'IV Solu-cortef 100MG (Hisone) (including cannulation)', 'IV N/S + Solucortef',
    'Dexamethasone', 'Dexona 4mg tablets', 'Dexamethasone 8mg/ml Injection',
    'Chlorohistol', 'Chlorphenamine 4mg tablets', 'Chlorohistol 2mg/5ml syrup']) {
    assert.equal(getClinicalGuideForItem({ item_name, folder_name: 'IM Drugs' }), null, item_name);
    assert.equal(getInventoryItemAttributes({ item_name, attributes: '' }), '', item_name);
  }
});

test('hydrocortisone separates initial rescue, maintenance and neonatal regimens', () => {
  const adult = HYDROCORTISONE_IM_IV;
  assert.equal(adult.dose_sections[1].dose, '200 mg / 24 h');
  assert.match(adult.dose_sections[1].detail, /50 mg IV or IM every 6 hours/);
  assert.match(adult.administration, /sterile water for injections/);
  const child = adult.paediatric;
  assert.match(child.dose_sections[0].detail, /6 years and over: 100 mg/);
  assert.equal(child.dose_sections[1].dose, '2 mg/kg IV');
  assert.equal(child.dose_sections[2].dose, '4 mg/kg IV');
  assert.match(child.dose_limits, /Do not routinely repeat the age-based rescue dose/);
});

test('dexamethasone distinguishes base units, MSCC and oral croup from injectable meningitis treatment', () => {
  assert.match(DEXAMETHASONE_IM_IV.critical_warning, /3.3 mg dexamethasone base.*4 mg dexamethasone phosphate/);
  assert.match(DEXAMETHASONE_IM_IV.dose_sections[1].dose, /16 mg oral or equivalent parenteral/);
  const child = DEXAMETHASONE_IM_IV.paediatric;
  assert.match(child.dose_sections[0].detail, /Maximum 10 mg per dose/);
  assert.match(child.dose_sections[1].dose, /orally/);
  assert.match(child.dose_sections[1].detail, /not an IV\/IM instruction/);
  assert.match(child.notes, /NEVER delay antibiotics/);
  assert.match(child.dose_limits, /stop for other identified organisms/);
});

test('chlorphenamine uses weight-based infant dosing and explicit dilution without a generic repeat schedule', () => {
  assert.equal(CHLORPHENAMINE_IM_IV.maximum, '40 mg / 24 h');
  const child = CHLORPHENAMINE_IM_IV.paediatric;
  assert.equal(child.dose_sections[0].dose, '0.25 mg/kg');
  assert.match(child.administration, /0.2 mL.*2 mL total.*1 mg\/mL/);
  assert.match(child.dose_limits, /no blanket four-times-daily/);
});

const { ACUTE_CARE_GUIDES, RANITIDINE_IM_IV, NEFOPAM_IM_IV, ETAMSYLATE_IM_IV, AMOXICILLIN_IM_IV, CEFTRIAXONE_IM_IV, ADRENALINE_IM_IV, ATROPINE_IM_IV } = require('../src/config/acuteCareClinicalGuides');
for (const entry of ACUTE_CARE_GUIDES) {
  test(`${entry.ingredient}: exact injectable aliases, ingredient fallback and independent age groups`, () => {
    for (const item_name of entry.names) {
      assert.equal(getClinicalGuideForItem({ item_name }), entry.guide);
      assert.equal(getInventoryItemAttributes({ item_name, attributes: 'N/A' }), entry.ingredient);
      assert.equal(getInventoryItemAttributes({ item_name, attributes: 'Custom metadata' }), 'Custom metadata');
      assert.equal(getClinicalGuideForItem({ item_name, item_kind: 'service' }), null);
      assert.equal(getClinicalGuideForItem({ item_name: `${item_name} tablets` }), null);
    }
    assert.equal(entry.guide.population, 'Adults');
    assert.equal(entry.guide.paediatric.population, 'Paediatrics');
    assert.ok(Object.isFrozen(entry.guide));
    assert.ok(Object.isFrozen(entry.guide.paediatric));
    for (const guide of [entry.guide, entry.guide.paediatric]) {
      assert.match(guide.source_url, /^https:\/\//);
      assert.ok(guide.dosing_unavailable || guide.dose_sections.length);
    }
  });
}
test('unverified UK injectable regimens expose notices without prescribing instructions', () => {
  for (const drug of [RANITIDINE_IM_IV, NEFOPAM_IM_IV, ETAMSYLATE_IM_IV]) {
    for (const guide of [drug, drug.paediatric]) {
      assert.ok(guide.dosing_unavailable);
      for (const field of ['dose', 'dose_sections', 'repeat', 'maximum', 'administration']) assert.equal(guide[field], undefined);
    }
  }
  for (const item_name of ['Aciloc', 'Acupan 30mg tablets', 'Amoxicillin 500mg', 'Co-amoxiclav 500mg Injection', 'Dicynone tablets', 'IM Ceftriaxone 1g + lidocaine']) {
    assert.equal(getClinicalGuideForItem({ item_name }), null);
  }
});
test('acute-care corrections retain route, concentration, age and daily-total boundaries', () => {
  assert.match(AMOXICILLIN_IM_IV.administration, /30–60 minutes/);
  assert.match(AMOXICILLIN_IM_IV.paediatric.dose_sections[0].detail, /daily total, not a single dose/);
  assert.match(CEFTRIAXONE_IM_IV.administration, /over 5 minutes/);
  assert.match(CEFTRIAXONE_IM_IV.paediatric.critical_warning, /postmenstrual age of 41 weeks/);
  assert.match(CEFTRIAXONE_IM_IV.paediatric.critical_warning, /even through separate lines/);
  assert.equal(CEFTRIAXONE_IM_IV.dose_sections[2].dose, '1 g IM once');
  assert.match(ADRENALINE_IM_IV.critical_warning, /NEVER give undiluted 1 mg\/mL/);
  assert.match(ADRENALINE_IM_IV.dose_sections[1].detail, /third shock/);
  assert.equal(ADRENALINE_IM_IV.paediatric.dose_sections[0].dose, '100–150 micrograms (0.1–0.15 mL)');
  assert.match(ATROPINE_IM_IV.critical_warning, /IV, not IM/);
  assert.equal(ATROPINE_IM_IV.paediatric.dose_sections[1].dose, '10 micrograms/kg');
  assert.match(ATROPINE_IM_IV.paediatric.dose_sections[0].detail, /Maximum 500 micrograms/);
});
