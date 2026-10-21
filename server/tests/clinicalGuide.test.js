const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getClinicalGuideForItem, clinicalGuideWriteError } = require("../src/lib/clinicalGuide");
const { BUSCOPAN_IM_IV, BUSCOPAN_INJECTION_NAMES, ONDANSETRON_IM_IV, ONDANSETRON_INJECTION_NAMES, PHENERGAN_IM_IV, PHENERGAN_INJECTION_NAMES } = require("../src/config/clinicalGuides");

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
