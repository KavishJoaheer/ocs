const { isConsultationFee } = require('./consultationFees');
const { stockFinancials, movementRows } = require('./inventoryFinancials');
const { calculateBillingTotal, normalizeBillingItems } = require('./utils');

function financialReconciliation(db, { doctorId = null, from = null, to = null } = {}) {
  const bills = db.prepare(`
    SELECT b.*, c.doctor_id, c.consultation_date, c.voided_at AS consultation_voided_at
    FROM billing b JOIN consultations c ON c.id = b.consultation_id
    WHERE (? IS NULL OR c.doctor_id = ?)
      AND (? IS NULL OR date(c.consultation_date) >= date(?))
      AND (? IS NULL OR date(c.consultation_date) <= date(?))
  `).all(doctorId, doctorId, from, from, to, to);
  const active = bills.filter(b => !b.voided_at && !b.consultation_voided_at);
  const issues = [];
  const feeGroups = new Map();
  const billItems = new Map();
  for (const bill of active) {
    let items;
    try {
      items = JSON.parse(bill.items || '[]');
      if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object')) throw new Error('Invalid bill lines');
    } catch {
      issues.push({ type: 'invalid_bill', label: `Bill #${bill.id}: review unreadable historical line items`, bill_ids: [bill.id], amount: bill.total_amount });
      continue;
    }
    const normalizedItems = normalizeBillingItems(items);
    billItems.set(Number(bill.id), normalizedItems);
    const calculatedTotal = calculateBillingTotal(normalizedItems);
    if (Math.abs(calculatedTotal - Number(bill.total_amount || 0)) >= 0.005) {
      issues.push({
        type: 'invoice_total_mismatch',
        label: `Bill #${bill.id}: stored total does not match its sale lines`,
        bill_ids: [bill.id],
        amount: Number((Number(bill.total_amount || 0) - calculatedTotal).toFixed(2)),
        expected_amount: calculatedTotal,
        recorded_amount: Number(bill.total_amount || 0),
      });
    }
    const feeCount = normalizedItems.filter(isConsultationFee).length;
    if (!feeCount) continue;
    const group = feeGroups.get(bill.consultation_id) || [];
    group.push({ bill, feeCount });
    feeGroups.set(bill.consultation_id, group);
  }
  for (const [visit, group] of feeGroups) {
    if (group.reduce((count, entry) => count + entry.feeCount, 0) > 1) {
      issues.push({
        type: 'duplicate_fee', label: `Visit #${visit}: multiple consultation charges`,
        bill_ids: group.map(({ bill }) => bill.id),
        amount: group.reduce((amount, { bill }) => amount + Number(bill.total_amount), 0),
      });
    }
  }
  for (const bill of active.filter(b => b.fee_review_required)) {
    issues.push({ type: 'fee_review', label: `Bill #${bill.id}: ${bill.legacy_fee_review_required ? 'admin must verify the historical fee against source records' : 'confirm consultation type and fee'}`, bill_ids: [bill.id], amount: bill.total_amount });
  }
  const paymentTotals = new Map(db.prepare(`
    SELECT ledger.billing_id, SUM(ledger.amount) AS amount
    FROM billing_payment_ledger ledger
    JOIN billing bill ON bill.id = ledger.billing_id
    JOIN consultations consultation ON consultation.id = bill.consultation_id
    WHERE (? IS NULL OR consultation.doctor_id = ?)
      AND (? IS NULL OR date(consultation.consultation_date) >= date(?))
      AND (? IS NULL OR date(consultation.consultation_date) <= date(?))
    GROUP BY ledger.billing_id
  `).all(doctorId, doctorId, from, from, to, to).map((row) => [Number(row.billing_id), Number(row.amount || 0)]));
  for (const bill of active) {
    const received = paymentTotals.get(Number(bill.id)) || 0;
    const total = Number(bill.total_amount || 0);
    if ((bill.status === 'paid' && Math.abs(received - total) >= 0.005) ||
        (bill.status === 'unpaid' && received >= total - 0.005 && total > 0)) {
      issues.push({
        type: 'payment_status_mismatch',
        label: `Bill #${bill.id}: payment transactions do not match invoice status`,
        bill_ids: [bill.id],
        amount: Number((received - total).toFixed(2)),
        received_amount: received,
        invoice_amount: total,
      });
    }
    if (received > 0 && !bill.finalized_at) {
      issues.push({
        type: 'payment_before_finalization',
        label: `Bill #${bill.id}: payment exists before quick billing was finalised`,
        bill_ids: [bill.id], amount: received,
      });
    }
  }
  const undocumentedRefunds = db.prepare(`
    SELECT refund.id, refund.billing_id, refund.amount, refund.refund_method
    FROM billing_refunds refund
    JOIN billing bill ON bill.id = refund.billing_id
    JOIN consultations consultation ON consultation.id = bill.consultation_id
    WHERE refund.refund_method != 'cash'
      AND length(trim(COALESCE(refund.external_reference, ''))) < 3
      AND (? IS NULL OR consultation.doctor_id = ?)
      AND (? IS NULL OR date(consultation.consultation_date) >= date(?))
      AND (? IS NULL OR date(consultation.consultation_date) <= date(?))
  `).all(doctorId, doctorId, from, from, to, to);
  for (const refund of undocumentedRefunds) {
    issues.push({
      type: 'refund_reference_missing',
      label: `Credit note #${refund.id}: ${String(refund.refund_method || '').toUpperCase()} provider reference is missing`,
      bill_ids: [refund.billing_id], amount: Number(refund.amount || 0), refund_id: refund.id,
    });
  }
  const refundAllocationIssues = db.prepare(`
    SELECT
      refund.id,
      refund.billing_id,
      refund.amount AS refund_amount,
      allocation.id AS allocation_id,
      allocation.amount AS allocation_amount
    FROM billing_refunds refund
    JOIN billing bill ON bill.id = refund.billing_id
    JOIN consultations consultation ON consultation.id = bill.consultation_id
    LEFT JOIN billing_refund_allocations allocation ON allocation.refund_id = refund.id
    WHERE (allocation.id IS NULL OR abs(refund.amount - allocation.amount) >= 0.005)
      AND (? IS NULL OR consultation.doctor_id = ?)
      AND (? IS NULL OR date(consultation.consultation_date) >= date(?))
      AND (? IS NULL OR date(consultation.consultation_date) <= date(?))
    ORDER BY refund.id ASC
  `).all(doctorId, doctorId, from, from, to, to);
  for (const refund of refundAllocationIssues) {
    const missing = !refund.allocation_id;
    issues.push({
      type: missing ? 'refund_allocation_missing' : 'refund_allocation_mismatch',
      label: missing
        ? `Credit note #${refund.id}: classify the refund before further supply corrections`
        : `Credit note #${refund.id}: allocated amount does not match the immutable credit note`,
      bill_ids: [refund.billing_id],
      amount: Number(refund.refund_amount || 0),
      refund_id: Number(refund.id),
      allocated_amount: Number(refund.allocation_amount || 0),
    });
  }
  const supplyAllocationIssues = db.prepare(`
    SELECT refund.id, refund.billing_id, refund.amount, allocation.submission_id
    FROM billing_refund_allocations allocation
    JOIN billing_refunds refund ON refund.id = allocation.refund_id
    JOIN billing bill ON bill.id = refund.billing_id
    JOIN consultations consultation ON consultation.id = bill.consultation_id
    LEFT JOIN billing_supply_corrections correction ON correction.refund_id = refund.id
    WHERE allocation.allocation_type = 'supply_submission'
      AND correction.id IS NULL
      AND (? IS NULL OR consultation.doctor_id = ?)
      AND (? IS NULL OR date(consultation.consultation_date) >= date(?))
      AND (? IS NULL OR date(consultation.consultation_date) <= date(?))
    ORDER BY refund.id ASC
  `).all(doctorId, doctorId, from, from, to, to);
  for (const refund of supplyAllocationIssues) {
    issues.push({
      type: 'supply_refund_correction_missing',
      label: `Credit note #${refund.id}: supply credit has no documented physical stock outcome`,
      bill_ids: [refund.billing_id],
      amount: Number(refund.amount || 0),
      refund_id: Number(refund.id),
      submission_id: Number(refund.submission_id || 0),
    });
  }
  for (const bill of bills.filter(b => (b.voided_at || b.consultation_voided_at) && b.status === 'paid')) {
    issues.push({ type: 'voided_payment', label: `Voided bill #${bill.id}: verify the collected money and any refund`, bill_ids: [bill.id], amount: bill.total_amount });
  }
  const movements = movementRows(db, { doctorId, from, to });
  const metadata = new Map();
  for (const movement of movements) {
    try {
      const meta = JSON.parse(movement.meta_json || '{}');
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Invalid movement metadata');
      metadata.set(movement.id, meta);
    } catch {
      issues.push({ type: 'invalid_movement', label: `Stock movement #${movement.id}: review unreadable historical references`, movement_id: movement.id, bill_ids: [], amount: 0 });
    }
  }
  const reversed = new Set(movements.filter(m => m.action_type === 'reversal')
    .map(m => Number(metadata.get(m.id)?.reversed_movement_id)));
  const correctedMovementIds = new Set();
  const correctionMovementIds = new Set();
  for (const correction of db.prepare(`
    SELECT original_movement_ids_json, reversal_movement_ids_json
    FROM billing_supply_corrections
  `).all()) {
    try {
      for (const id of JSON.parse(correction.original_movement_ids_json || '[]')) correctedMovementIds.add(Number(id));
    } catch {
      // The correction row itself remains visible to finance if legacy JSON is unreadable.
    }
    try {
      for (const id of JSON.parse(correction.reversal_movement_ids_json || '[]')) correctionMovementIds.add(Number(id));
    } catch {
      // Unreadable correction evidence remains visible through its original movement checks.
    }
  }
  const movementById = new Map(movements.map((movement) => [Number(movement.id), movement]));
  const claimedMovementIds = new Map();
  for (const bill of active) {
    const items = billItems.get(Number(bill.id)) || [];
    for (const [index, line] of items.entries()) {
      if (!line.inventory_item_id || Number(line.quantity || 0) <= 0) continue;
      const movementIds = [...new Set([
        ...(line.inventory_movement_ids || []),
        ...(line.dispensing_movement_ids || []),
      ].map(Number).filter(Boolean))];
      if (!movementIds.length) {
        issues.push({
          type: 'invoice_line_missing_movement',
          label: `Bill #${bill.id} line ${index + 1}: inventory item has no stock movement reference`,
          bill_ids: [bill.id], amount: Number(line.amount || 0), inventory_item_id: Number(line.inventory_item_id),
        });
        continue;
      }
      let linkedQuantity = 0;
      let linkedValue = 0;
      let hasCompleteMovementPricing = true;
      let lineHasInvalidMovement = false;
      for (const movementId of movementIds) {
        const movement = movementById.get(movementId);
        if (!movement || (reversed.has(movementId) && !correctedMovementIds.has(movementId))) {
          lineHasInvalidMovement = true;
          issues.push({
            type: 'invoice_line_invalid_movement',
            label: `Bill #${bill.id} line ${index + 1}: stock movement #${movementId} is missing or reversed`,
            bill_ids: [bill.id], movement_id: movementId, amount: Number(line.amount || 0),
          });
          continue;
        }
        const movementMeta = metadata.get(movementId) || {};
        if (Number(movement.item_id) !== Number(line.inventory_item_id) ||
            (movementMeta.billing_id && Number(movementMeta.billing_id) !== Number(bill.id))) {
          lineHasInvalidMovement = true;
          issues.push({
            type: 'invoice_line_movement_mismatch',
            label: `Bill #${bill.id} line ${index + 1}: stock movement #${movementId} belongs to another item or bill`,
            bill_ids: [bill.id], movement_id: movementId, amount: Number(line.amount || 0),
          });
          continue;
        }
        if (claimedMovementIds.has(movementId) && claimedMovementIds.get(movementId) !== Number(bill.id)) {
          lineHasInvalidMovement = true;
          issues.push({
            type: 'movement_claimed_twice',
            label: `Stock movement #${movementId}: referenced by more than one invoice`,
            bill_ids: [claimedMovementIds.get(movementId), Number(bill.id)], movement_id: movementId, amount: 0,
          });
        } else {
          claimedMovementIds.set(movementId, Number(bill.id));
        }
        linkedQuantity += Math.abs(Number(movement.quantity || 0));
        const unitValue = Number(line.type === 'Sale'
          ? movement.unit_price_snapshot
          : movement.unit_cost_snapshot);
        if (!Number.isFinite(unitValue) || unitValue <= 0) hasCompleteMovementPricing = false;
        else linkedValue += Math.abs(Number(movement.quantity || 0)) * unitValue;
      }
      if (!lineHasInvalidMovement && linkedQuantity !== Number(line.quantity || 0)) {
        issues.push({
          type: 'invoice_line_quantity_mismatch',
          label: `Bill #${bill.id} line ${index + 1}: billed quantity ${line.quantity} does not match ${linkedQuantity} linked stock unit(s)`,
          bill_ids: [bill.id], amount: Number(line.amount || 0), inventory_item_id: Number(line.inventory_item_id),
        });
      }
      if (!lineHasInvalidMovement && hasCompleteMovementPricing && Math.abs(Number(line.amount || 0) - linkedValue) >= 0.005) {
        issues.push({
          type: 'invoice_line_value_mismatch',
          label: `Bill #${bill.id} line ${index + 1}: recorded line value does not match linked stock movement value`,
          bill_ids: [bill.id], amount: Number((Number(line.amount || 0) - linkedValue).toFixed(2)),
          billed_amount: Number(line.amount || 0), movement_amount: Number(linkedValue.toFixed(2)),
          inventory_item_id: Number(line.inventory_item_id),
        });
      }
    }
  }
  for (const movement of movements) {
    if (reversed.has(Number(movement.id))) continue;
    if (correctionMovementIds.has(Number(movement.id))) continue;
    const linkedBillId = Number(metadata.get(movement.id)?.billing_id || 0);
    if (linkedBillId && billItems.has(linkedBillId) && !claimedMovementIds.has(Number(movement.id))) {
      issues.push({
        type: 'orphan_billed_movement',
        label: `Stock movement #${movement.id}: points to bill #${linkedBillId} but no invoice line references it`,
        bill_ids: [linkedBillId], movement_id: Number(movement.id), amount: 0,
      });
    }
  }
  const unclosedDates = doctorId == null ? db.prepare(`
    WITH financial_activity(business_date) AS (
      SELECT transaction_date FROM billing_payment_ledger
      UNION
      SELECT refund_date FROM billing_refunds
    )
    SELECT activity.business_date
    FROM financial_activity activity
    LEFT JOIN financial_day_closings closing ON closing.business_date = activity.business_date
    WHERE closing.id IS NULL
      AND activity.business_date < date('now', '+4 hours')
      AND (? IS NULL OR activity.business_date >= date(?))
      AND (? IS NULL OR activity.business_date <= date(?))
    ORDER BY activity.business_date ASC
  `).all(from, from, to, to) : [];
  for (const row of unclosedDates) {
    issues.push({
      type: 'day_close_missing',
      label: `Finance day ${row.business_date}: settlement has not been closed`,
      bill_ids: [], amount: 0, business_date: row.business_date,
    });
  }
  for (const movement of movements) {
    const meta = metadata.get(movement.id);
    if (movement.action_type !== 'stock_out' || reversed.has(movement.id)
      || meta?.stock_out_reason !== 'Sale' || meta?.billing_status !== 'Pending Manual Entry') continue;
    issues.push({
      type: 'unbilled_dispensing', label: `Dispensing #${movement.id}: ${movement.quantity} unit(s) awaiting a bill`,
      bill_ids: [], movement_id: movement.id, consultation_id: meta.consultation_id || null,
      patient_id: meta.patient_id, amount: Math.round(movement.quantity * movement.unit_price_snapshot * 100) / 100,
    });
  }
  const stock = stockFinancials(movementRows(db, { doctorId, from, to }));
  const supplierCostVariance = doctorId == null
    ? Number(db.prepare(`
        SELECT COALESCE(SUM(variance_amount), 0) AS amount
        FROM finance_supplier_cost_variances variance
        JOIN finance_supplier_invoices invoice ON invoice.id = variance.supplier_invoice_id
        WHERE (? IS NULL OR date(invoice.invoice_date) >= date(?))
          AND (? IS NULL OR date(invoice.invoice_date) <= date(?))
      `).get(from, from, to, to)?.amount || 0)
    : 0;
  return {
    as_of: new Date().toISOString(), issues, issue_count: issues.length,
    legacy_estimate_count: movements.filter(m => m.valuation_basis === 'legacy_estimate').length,
    stock: {
      ...stock,
      supplier_cost_variance_rs: Math.round(supplierCostVariance * 100) / 100,
    },
    stock_readiness: doctorId == null ? {
      unpriced_products: db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE archived_at IS NULL AND quantity > 0 AND (cost_price IS NULL OR cost_price <= 0)').get().n,
      zero_sale_price_products: db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE archived_at IS NULL AND quantity > 0 AND (selling_price IS NULL OR selling_price <= 0)').get().n,
      expiry_unverified_products: db.prepare(`SELECT COUNT(DISTINCT i.id) AS n FROM inventory i WHERE i.archived_at IS NULL AND i.quantity > 0 AND (
        EXISTS (SELECT 1 FROM inventory_batches b WHERE b.item_id=i.id AND b.quantity_remaining>0 AND b.expiry_date IS NULL AND COALESCE(b.is_non_expiring,0)=0)
        OR i.quantity > COALESCE((SELECT SUM(b.quantity_remaining) FROM inventory_batches b WHERE b.item_id=i.id),0))`).get().n,
      unfinished_counts: db.prepare("SELECT COUNT(*) AS n FROM inventory_stocktake_sessions WHERE status IN ('draft','in_progress','recount_required','submitted','approved')").get().n,
      unfinished_count_sessions: db.prepare(`
        SELECT s.id, s.status, s.created_at, s.folder_id, s.owner_doctor_id,
          f.name AS folder_name, d.full_name AS doctor_name,
          counter.full_name AS counter_name,
          (SELECT COUNT(*) FROM inventory_stocktake_session_items si WHERE si.session_id = s.id) AS item_count,
          (SELECT COUNT(*) FROM inventory_stocktake_session_items si
            WHERE si.session_id = s.id AND si.physical_quantity IS NOT NULL AND COALESCE(si.left_unchanged, 0) = 0) AS counted_count
        FROM inventory_stocktake_sessions s
        LEFT JOIN inventory_folders f ON f.id = s.folder_id
        LEFT JOIN doctors d ON d.id = s.owner_doctor_id
        LEFT JOIN users counter ON counter.id = COALESCE(s.assigned_counter_user_id, s.created_by_user_id)
        WHERE s.status IN ('draft','in_progress','recount_required','submitted','approved')
        ORDER BY s.id DESC
        LIMIT 20
      `).all().map((row) => ({
        id: Number(row.id),
        status: row.status,
        created_at: row.created_at,
        counter_name: row.counter_name || "",
        item_count: Number(row.item_count || 0),
        counted_count: Number(row.counted_count || 0),
        location: row.owner_doctor_id
          ? `${String(row.doctor_name || "Doctor").trim()}'s bag`
          : (row.folder_name || (row.folder_id ? "Folder" : "All OCS folders")),
      })),
      deliveries_without_invoice_count: db.prepare(`
        SELECT COUNT(*) AS n FROM inventory_shipments s
        WHERE COALESCE(s.status, '') != 'cancelled'
          AND NOT EXISTS (
            SELECT 1
            FROM finance_supplier_invoices i
            WHERE i.shipment_id = s.id
              AND COALESCE((
                SELECT e.action
                FROM finance_supplier_invoice_events e
                WHERE e.supplier_invoice_id = i.id
                ORDER BY e.id DESC
                LIMIT 1
              ), 'submitted') = 'approved'
          )
      `).get().n,
      deliveries_without_invoice: db.prepare(`
        SELECT
          s.id, s.supplier, s.delivery_note, s.received_date, s.status,
          (
            SELECT i.id FROM finance_supplier_invoices i
            WHERE i.shipment_id = s.id
            ORDER BY i.id DESC LIMIT 1
          ) AS linked_invoice_id,
          (
            SELECT e.action
            FROM finance_supplier_invoice_events e
            JOIN finance_supplier_invoices i ON i.id = e.supplier_invoice_id
            WHERE i.shipment_id = s.id
            ORDER BY i.id DESC, e.id DESC
            LIMIT 1
          ) AS invoice_status
        FROM inventory_shipments s
        WHERE COALESCE(s.status, '') != 'cancelled'
          AND NOT EXISTS (
            SELECT 1
            FROM finance_supplier_invoices i
            WHERE i.shipment_id = s.id
              AND COALESCE((
                SELECT e.action
                FROM finance_supplier_invoice_events e
                WHERE e.supplier_invoice_id = i.id
                ORDER BY e.id DESC
                LIMIT 1
              ), 'submitted') = 'approved'
          )
        ORDER BY s.id DESC
        LIMIT 8
      `).all().map((row) => ({
        id: Number(row.id),
        supplier: row.supplier || "",
        delivery_note: row.delivery_note || "",
        received_date: row.received_date || "",
        status: row.status || "",
        linked_invoice_id: row.linked_invoice_id ? Number(row.linked_invoice_id) : null,
        invoice_status: row.invoice_status || "missing",
      })),
    } : null,
    scope: from || to
      ? 'Invoice and stock exceptions follow the selected date range and doctor scope.'
      : 'Unresolved records are checked across all dates and respect the selected doctor scope.',
    accounting_note: 'OCS remainder is collected revenue less doctor commission and transport. It excludes operating expenses and is not net profit. Voided paid bills require a separate cash/refund review.',
  };
}
module.exports = { financialReconciliation };
