const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getClinicalGuideForItem, clinicalGuideWriteError } = require("../src/lib/clinicalGuide");
const { BUSCOPAN_IM_IV, BUSCOPAN_INJECTION_NAMES } = require("../src/config/clinicalGuides");

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
