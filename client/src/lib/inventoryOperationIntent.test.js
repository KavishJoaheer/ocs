import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operationIdForIntent } from "./inventoryOperationIntent.js";

describe("inventory operation intent", () => {
  it("reuses the identity for a retry and changes it for a different intent", () => {
    const ref = { current: null };
    const first = operationIdForIntent(ref, { item: 7, quantity: 2 });
    assert.equal(operationIdForIntent(ref, { item: 7, quantity: 2 }), first);
    assert.notEqual(operationIdForIntent(ref, { item: 7, quantity: 3 }), first);
    ref.current = null;
    assert.notEqual(operationIdForIntent(ref, { item: 7, quantity: 2 }), first);
  });
});
