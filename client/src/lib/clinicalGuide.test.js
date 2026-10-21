import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicalGuideValues, clinicalGuideSourceUrl, clinicalGuidePopulations, CLINICAL_GUIDE_FORMAT } from "./clinicalGuide.js";

test("legacy user-editable notes and serialized payloads are not used as backend clinical guides", () => {
  for (const notes of ["Existing notes", "<img src=x onerror=alert(1)>", '{"format":"ocs-clinical-guide-v1","dose":"Untrusted dose"}', null]) {
    assert.equal(Object.values(clinicalGuideValues(notes)).some(Boolean), false);
  }
});

test("structured guides preserve section boundaries and never accept review claims or object fields", () => {
  const raw = { format: CLINICAL_GUIDE_FORMAT, dose: "  Example dose  ", critical_warning: " Under 2: contraindicated ", administration: "IV precautions\nIM precautions", reviewed: "Approved", maximum: { unsafe: "object" }, source_updated: "5 Jan 2026" };
  const guide = clinicalGuideValues(raw);
  assert.equal(guide.dose, "Example dose");
  assert.equal(guide.critical_warning, "Under 2: contraindicated");
  assert.equal(guide.administration, "IV precautions\nIM precautions");
  assert.equal(guide.maximum, "");
  assert.equal(Object.hasOwn(guide, "reviewed"), false);
  assert.equal(guide.source_updated, "5 Jan 2026");
});

test("clinical sources allow only HTTPS URLs without credentials", () => {
  assert.equal(clinicalGuideSourceUrl("https://www.medicines.org.uk/emc/product/890/smpc"), "https://www.medicines.org.uk/emc/product/890/smpc");
  for (const source of ["javascript:alert(1)", "data:text/html,test", "http://example.test", "https://user:secret@example.test", "not a link"]) assert.equal(clinicalGuideSourceUrl(source), null);
});

test("dose sections preserve indication and route details, reject malformed rows and ignore extra fields", () => {
  const dose_sections = [
    { label: " PONV ", dose: "4 mg", detail: "Slow IV or IM", reviewed: "Approved" },
    { label: "CINV", dose: "8 mg", detail: { unsafe: "object" } },
    { label: "Incomplete", dose: "16 mg" },
    null,
  ];
  const guide = clinicalGuideValues({ format: CLINICAL_GUIDE_FORMAT, dose_sections, dose_limits: "8 mg / 24 h in hepatic impairment" });
  assert.deepEqual(guide.dose_sections, [{ label: "PONV", dose: "4 mg", detail: "Slow IV or IM" }]);
  assert.equal(guide.dose_limits, "8 mg / 24 h in hepatic impairment");
  assert.equal(Object.hasOwn(clinicalGuideValues({ dose_sections }), "dose_sections"), false);
  assert.equal(Object.values(clinicalGuideValues({ format: CLINICAL_GUIDE_FORMAT, dose_sections: [null] })).some(Boolean), false);
});

test("population switching never inherits adult dose, maximum, route or administration into paediatrics", () => {
  const raw = { format: CLINICAL_GUIDE_FORMAT, population: "Adults", dose: "16 mg", maximum: "Adult limit", routes: "IM / IV", administration: "Adult infusion", paediatric: {
    format: CLINICAL_GUIDE_FORMAT, population: "Paediatrics", dose: "0.1 mg/kg", dose_limits: "4 mg maximum", routes: "IV",
  } };
  const populations = clinicalGuidePopulations(raw);
  assert.deepEqual(populations.map(row => row.label), ["Adults", "Paediatrics"]);
  assert.equal(populations[1].guide.dose, "0.1 mg/kg");
  assert.equal(populations[1].guide.maximum, "");
  assert.equal(populations[1].guide.administration, "");
  assert.equal(populations[1].guide.routes, "IV");
  assert.equal(clinicalGuidePopulations({ ...raw, paediatric: { population: "Paediatrics", dose: "Unformatted" } }).length, 1);
  assert.equal(clinicalGuidePopulations({ paediatric: raw.paediatric }).length, 1);
  assert.equal(clinicalGuidePopulations({ ...raw, paediatric: { format: CLINICAL_GUIDE_FORMAT, population: "Paediatrics" } }).length, 1);
});
