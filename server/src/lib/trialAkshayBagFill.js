"use strict";

const TRIAL_REASON = "trial-akshay-bag-plus-20";
const TRIAL_QUANTITY = 20;

function applyTrialAkshayBagFill(db) {
  const already = db.prepare(`
    SELECT id
    FROM inventory_audit_logs
    WHERE action_type = 'trial_bag_fill'
      AND reason = ?
    LIMIT 1
  `).get(TRIAL_REASON);
  if (already) return { applied: false, reason: "already_applied", items: 0 };

  const doctors = db.prepare(`
    SELECT id, full_name
    FROM doctors
    WHERE deleted_at IS NULL
      AND lower(trim(full_name)) LIKE 'akshay %'
  `).all();
  if (doctors.length !== 1) {
    return { applied: false, reason: doctors.length === 0 ? "doctor_not_found" : "ambiguous_doctor", items: 0 };
  }
  const doctor = doctors[0];

  const items = db.prepare(`
    SELECT id, item_name, quantity, cost_price
    FROM inventory
    WHERE stock_scope = 'doctor'
      AND owner_doctor_id = ?
      AND archived_at IS NULL
      AND COALESCE(item_kind, 'stock') = 'stock'
    ORDER BY id ASC
  `).all(doctor.id);

  const run = db.transaction(() => {
    const updateQuantity = db.prepare(`
      UPDATE inventory
      SET quantity = COALESCE(quantity, 0) + ?,
          row_version = COALESCE(row_version, 1) + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const insertBatch = db.prepare(`
      INSERT INTO inventory_batches (
        item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, supplier_name, received_date
      ) VALUES (?, ?, '2032-12-31', ?, 0, 'Trial fill', date('now', '+4 hours'))
    `);
    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (
        item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
        recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
      ) VALUES (?, 'in', ?, ?, ?, ?, NULL, ?, 'adjustment', 'trial_bag_fill', ?, ?)
    `);
    for (const item of items) {
      const previous = Number(item.quantity || 0);
      const next = previous + TRIAL_QUANTITY;
      updateQuantity.run(TRIAL_QUANTITY, item.id);
      insertBatch.run(item.id, TRIAL_QUANTITY, Number(item.cost_price || 0));
      insertMovement.run(
        item.id,
        TRIAL_QUANTITY,
        previous,
        next,
        doctor.id,
        "Trial fill: 20 added to every stock item in Dr Akshay's bag.",
        String(item.id),
        JSON.stringify({
          trial: true,
          reason: TRIAL_REASON,
          doctor_id: doctor.id,
          doctor_name: doctor.full_name,
        }),
      );
    }
    db.prepare(`
      INSERT INTO inventory_audit_logs (
        action_type, item_id, item_name, quantity, reason,
        target_doctor_id, target_doctor_name,
        performed_by_user_id, performed_by_role, performed_by_name, meta_json
      ) VALUES ('trial_bag_fill', NULL, 'Dr Akshay bag', ?, ?, ?, ?, NULL, 'system', 'System', ?)
    `).run(
      items.length * TRIAL_QUANTITY,
      TRIAL_REASON,
      doctor.id,
      doctor.full_name,
      JSON.stringify({ items: items.length, quantity_each: TRIAL_QUANTITY }),
    );
  });
  run();
  return { applied: true, doctor_id: doctor.id, doctor_name: doctor.full_name, items: items.length };
}

module.exports = {
  TRIAL_REASON,
  applyTrialAkshayBagFill,
};
