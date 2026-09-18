import test from "node:test";
import assert from "node:assert/strict";
import {
  correctInventoryOfflineEntry,
  inventoryOfflineEntryQuantity,
} from "./inventoryOfflineEntry.js";

test("failed offline restocks show nested quantity and create a corrected retry intent", () => {
  const queued = {
    id: "queued-restock",
    kind: "inventory_restock",
    endpoint: "/inventory/restock/my-inventory",
    payload: { operation_id: "old-operation", items: [{ ocs_item_id: 12, quantity: 3 }] },
    meta: { itemName: "N/S 500ml", quantity: 3 },
    userId: 42,
    sync_status: "needs_attention",
    sync_error: "Stock changed",
  };
  assert.equal(inventoryOfflineEntryQuantity(queued), 3);

  const corrected = correctInventoryOfflineEntry(queued, 5, "new-operation");
  assert.equal(inventoryOfflineEntryQuantity(corrected), 5);
  assert.equal(corrected.payload.items[0].quantity, 5);
  assert.equal(corrected.meta.quantity, 5);
  assert.equal(corrected.sync_status, "pending");
  assert.equal(corrected.sync_error, "");
  assert.equal(corrected.payload.operation_id, "new-operation");
});
