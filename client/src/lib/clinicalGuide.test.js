import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicalGuideValues, clinicalGuideSourceUrl, CLINICAL_GUIDE_FORMAT } from "./clinicalGuide.js";

test("legacy user-editable notes and serialized payloads are not used as backend clinical guides", () => {
  for (const notes of ["Existing notes", "<img src=x onerror=alert(1)>", '{"format":"ocs-clinical-guide-v1","dose":"Untrusted dose"}', null]) {
    assert.equal(Object.values(clinicalGuideValues(notes)).some(Boolean), false);
  }
});

test("structured guides preserve section boundaries and never accept review claims or object fields", () => {
  const raw = { format: CLINICAL_GUIDE_FORMAT, dose: "  Example dose  ", administration: "IV precautions\nIM precautions", reviewed: "Approved", maximum: { unsafe: "object" }, source_updated: "5 Jan 2026" };
  const guide = clinicalGuideValues(raw);
  assert.equal(guide.dose, "Example dose");
  assert.equal(guide.administration, "IV precautions\nIM precautions");
  assert.equal(guide.maximum, "");
  assert.equal(Object.hasOwn(guide, "reviewed"), false);
  assert.equal(guide.source_updated, "5 Jan 2026");
});

test("clinical sources allow only HTTPS URLs without credentials", () => {
  assert.equal(clinicalGuideSourceUrl("https://www.medicines.org.uk/emc/product/890/smpc"), "https://www.medicines.org.uk/emc/product/890/smpc");
  for (const source of ["javascript:alert(1)", "data:text/html,test", "http://example.test", "https://user:secret@example.test", "not a link"]) assert.equal(clinicalGuideSourceUrl(source), null);
});
