// Exact SKU matches only: other sizes, colours and similarly named items stay.
const WITHDRAWN_INVENTORY_NAMES = Object.freeze([
  "Tegaderm 9x25cm",
  "Lovenox 0.2ml",
  "Lovenox 0.6ml",
  "Needle Black box",
  "Needle Purple box",
  "Adhesive Tape",
  "Alcohol 500ml",
]);

function removeWithdrawnInventory(db) {
  const keys = WITHDRAWN_INVENTORY_NAMES.map((name) => name.toLowerCase());
  const placeholders = keys.map(() => "?").join(", ");
  const matchesName = `lower(trim(item_name)) IN (${placeholders})`;
  const itemIds = `SELECT id FROM inventory WHERE ${matchesName}
    AND stock_scope IN ('ocs', 'doctor')`;
  const batchIds = `SELECT id FROM inventory_batches WHERE item_id IN (${itemIds})`;
  const movementIds = `SELECT id FROM inventory_movements WHERE item_id IN (${itemIds})`;

  return db.transaction(() => {
    // JSON billing links are not foreign keys. Never leave clinical dispensing
    // or bills pointing at deleted stock; ordinary FK restrictions remain on.
    for (const [table, column] of [["billing", "items"], ["billing_lite_submissions", "items_json"]]) {
      const linked = db.prepare(`
        SELECT 1 FROM ${table}, json_tree(
          CASE WHEN json_valid(${column}) THEN ${column} ELSE '[]' END
        ) AS entry
        WHERE entry.key IN ('inventory_item_id', 'inventory_id')
          AND CAST(entry.value AS INTEGER) IN (${itemIds})
        LIMIT 1
      `).get(...keys);
      if (linked) throw new Error("Inventory cleanup blocked by linked billing records.");
    }
    const clinicalMovement = db.prepare(`
      SELECT 1 FROM inventory_movements
      WHERE item_id IN (${itemIds}) AND (
        reference_type LIKE '%bill%' OR reference_type LIKE '%consultation%'
        OR json_extract(meta_json, '$.patient_id') IS NOT NULL
        OR json_extract(meta_json, '$.billing_id') IS NOT NULL
        OR json_extract(meta_json, '$.consultation_id') IS NOT NULL
      ) LIMIT 1
    `).get(...keys);
    if (clinicalMovement) throw new Error("Inventory cleanup blocked by linked clinical dispensing.");

    // Even nullable SET NULL references must stay intact: a pending collection
    // must not silently lose its catalogue or batch allocation.
    for (const table of [
      "restock_request_items", "restock_request_amendment_items",
      "restock_request_fulfillment_items", "inventory_reservations",
    ]) {
      if (db.prepare(`SELECT 1 FROM ${table} WHERE inventory_id IN (${itemIds}) LIMIT 1`).get(...keys)) {
        throw new Error("Inventory cleanup blocked by linked restock records.");
      }
    }

    db.prepare(`DELETE FROM inventory_activity_history
      WHERE movement_id IN (${movementIds}) OR ${matchesName}`).run(...keys, ...keys);
    db.prepare(`DELETE FROM inventory_audit_logs
      WHERE item_id IN (${itemIds}) OR ${matchesName}`).run(...keys, ...keys);
    db.prepare(`DELETE FROM inventory_movement_allocations
      WHERE movement_id IN (${movementIds})`).run(...keys);
    db.prepare(`DELETE FROM inventory_batch_quarantine_events
      WHERE batch_id IN (${batchIds})`).run(...keys);
    db.prepare(`DELETE FROM inventory_stocktake_session_items
      WHERE inventory_id IN (${itemIds})`).run(...keys);
    db.prepare(`DELETE FROM inventory_staging WHERE ${matchesName}`).run(...keys);
    // Batches, movements and legacy stocktakes cascade from the inventory row.
    // Supplier invoice restrictions roll back the entire cleanup if present.
    const result = db.prepare(`DELETE FROM inventory WHERE id IN (${itemIds})`).run(...keys);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ocs_catalog_exclusions'").get()) {
      db.prepare(`DELETE FROM ocs_catalog_exclusions
        WHERE item_name_key IN (${placeholders})`).run(...keys);
    }
    return { removed: result.changes };
  }).immediate();
}

module.exports = { WITHDRAWN_INVENTORY_NAMES, removeWithdrawnInventory };
