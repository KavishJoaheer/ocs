import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicalGuideValues, serializeClinicalGuide, clinicalGuideSourceUrl, CLINICAL_GUIDE_FORMAT } from "./clinicalGuide.js";

test("legacy clinical notes survive editing without interpreting markup or unknown JSON", () => {
  for (const notes of ["Existing mechanism notes\nKeep these observations.", "<img src=x onerror=alert(1)>", '{"unknown":"format"}']) {
    assert.equal(clinicalGuideValues(notes).notes, notes);
    assert.equal(clinicalGuideValues(serializeClinicalGuide(clinicalGuideValues(notes))).notes, notes);
  }
});

test("structured guides preserve section boundaries and never accept review claims or object fields", () => {
  const raw = JSON.stringify({ format: CLINICAL_GUIDE_FORMAT, dose: "  Example dose  ", administration: "IV precautions\nIM precautions", reviewed: "Approved", maximum: { unsafe: "object" } });
  const guide = clinicalGuideValues(raw);
  assert.equal(guide.dose, "Example dose");
  assert.equal(guide.administration, "IV precautions\nIM precautions");
  assert.equal(guide.maximum, "");
  assert.equal(Object.hasOwn(guide, "reviewed"), false);
  assert.equal(serializeClinicalGuide(clinicalGuideValues("")), "");
});

test("clinical sources allow only HTTPS URLs without credentials", () => {
  assert.equal(clinicalGuideSourceUrl("https://www.medicines.org.uk/emc/product/890/smpc"), "https://www.medicines.org.uk/emc/product/890/smpc");
  for (const source of ["javascript:alert(1)", "data:text/html,test", "http://example.test", "https://user:secret@example.test", "not a link"]) assert.equal(clinicalGuideSourceUrl(source), null);
});
