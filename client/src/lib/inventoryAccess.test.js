import test from "node:test";
import assert from "node:assert/strict";
import { canArchiveCatalogueItem, canCreateCatalogue, canEditCatalogue, canReceiveWarehouseStock } from "./inventoryAccess.js";

test("operators and admins can edit catalogue details", () => {
  assert.equal(canEditCatalogue({ role: "operator" }), true);
  assert.equal(canEditCatalogue({ role: "admin" }), true);
  assert.equal(canEditCatalogue({ role: "doctor" }), false);
});

test("operators and admins can create catalogue items", () => {
  assert.equal(canCreateCatalogue({ role: "operator" }), true);
  assert.equal(canCreateCatalogue({ role: "admin" }), true);
  assert.equal(canCreateCatalogue({ role: "doctor" }), false);
});

test("catalogue archival remains admin-only", () => {
  assert.equal(canArchiveCatalogueItem({ role: "operator" }), false);
  assert.equal(canArchiveCatalogueItem({ role: "admin" }), true);
});

test("operators can use one-item Receive and doctors cannot", () => {
  assert.equal(canReceiveWarehouseStock({ role: "operator" }), true);
  assert.equal(canReceiveWarehouseStock({ role: "admin" }), true);
  assert.equal(canReceiveWarehouseStock({ role: "doctor" }), false);
});
