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
