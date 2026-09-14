import test from "node:test";
import assert from "node:assert/strict";
import { canArchiveCatalogueItem, canEditCatalogue } from "./inventoryAccess.js";

test("operators and admins can edit catalogue details", () => {
  assert.equal(canEditCatalogue({ role: "operator" }), true);
  assert.equal(canEditCatalogue({ role: "admin" }), true);
  assert.equal(canEditCatalogue({ role: "doctor" }), false);
});

test("catalogue archival remains admin-only", () => {
  assert.equal(canArchiveCatalogueItem({ role: "operator" }), false);
  assert.equal(canArchiveCatalogueItem({ role: "admin" }), true);
});
