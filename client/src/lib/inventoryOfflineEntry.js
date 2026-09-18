const INVENTORY_QUEUE_KINDS = new Set(["inventory_deduct", "inventory_restock"]);

export function inventoryOfflineEntryQuantity(entry) {
  if (entry?.kind === "inventory_restock") {
    return Number(entry.payload?.items?.[0]?.quantity || entry.meta?.quantity || 0);
  }
  return Number(entry?.payload?.quantity || entry?.meta?.quantity || 0);
}

export function correctInventoryOfflineEntry(entry, quantity, operationId = crypto.randomUUID()) {
  if (!entry?.id || !INVENTORY_QUEUE_KINDS.has(entry.kind)) {
    throw new Error("Select a valid pending inventory update.");
  }
  const nextQuantity = Number(quantity);
  if (!Number.isInteger(nextQuantity) || nextQuantity <= 0) {
    throw new Error("Quantity must be a whole number greater than zero.");
  }
  let payload;
  if (entry.kind === "inventory_restock") {
    const items = Array.isArray(entry.payload?.items) ? entry.payload.items : [];
    if (items.length !== 1) throw new Error("This restock cannot be edited safely. Discard it and start again.");
    payload = {
      ...entry.payload,
      operation_id: operationId,
      items: [{ ...items[0], quantity: nextQuantity }],
    };
  } else {
    payload = {
      ...entry.payload,
      operation_id: operationId,
      quantity: nextQuantity,
    };
    delete payload.expected_version;
  }
  return {
    ...entry,
    payload,
    meta: { ...entry.meta, quantity: nextQuantity },
    sync_status: "pending",
    sync_error: "",
    timestamp: new Date().toISOString(),
  };
}
