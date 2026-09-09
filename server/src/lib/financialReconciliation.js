const { isConsultationFee } = require('./consultationFees');
const { stockFinancials, movementRows } = require('./inventoryFinancials');

function financialReconciliation(db, { doctorId = null, from = null, to = null } = {}) {
  const bills = db.prepare(`
    SELECT b.*, c.doctor_id, c.consultation_date, c.voided_at AS consultation_voided_at
    FROM billing b JOIN consultations c ON c.id = b.consultation_id
    WHERE (? IS NULL OR c.doctor_id = ?)
  `).all(doctorId, doctorId);
  const active = bills.filter(b => !b.voided_at && !b.consultation_voided_at);
  const issues = [];
  const feeGroups = new Map();
  for (const bill of active) {
    let items;
    try {
      items = JSON.parse(bill.items || '[]');
      if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object')) throw new Error('Invalid bill lines');
    } catch {
      issues.push({ type: 'invalid_bill', label: `Bill #${bill.id}: review unreadable historical line items`, bill_ids: [bill.id], amount: bill.total_amount });
      continue;
    }
    const feeCount = items.filter(isConsultationFee).length;
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
  for (const bill of bills.filter(b => (b.voided_at || b.consultation_voided_at) && b.status === 'paid')) {
    issues.push({ type: 'voided_payment', label: `Voided bill #${bill.id}: verify the collected money and any refund`, bill_ids: [bill.id], amount: bill.total_amount });
  }
  const movements = movementRows(db, { doctorId });
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
  return {
    as_of: new Date().toISOString(), issues, issue_count: issues.length,
    legacy_estimate_count: movements.filter(m => m.valuation_basis === 'legacy_estimate').length,
    stock: stockFinancials(movementRows(db, { doctorId, from, to })),
    stock_readiness: doctorId == null ? {
      unpriced_products: db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE archived_at IS NULL AND quantity > 0 AND (cost_price IS NULL OR cost_price <= 0)').get().n,
      expiry_unverified_products: db.prepare(`SELECT COUNT(DISTINCT i.id) AS n FROM inventory i WHERE i.archived_at IS NULL AND i.quantity > 0 AND (
        EXISTS (SELECT 1 FROM inventory_batches b WHERE b.item_id=i.id AND b.quantity_remaining>0 AND b.expiry_date IS NULL AND COALESCE(b.is_non_expiring,0)=0)
        OR i.quantity > COALESCE((SELECT SUM(b.quantity_remaining) FROM inventory_batches b WHERE b.item_id=i.id),0))`).get().n,
      unfinished_counts: db.prepare("SELECT COUNT(*) AS n FROM inventory_stocktake_sessions WHERE status IN ('draft','in_progress','recount_required','submitted','approved')").get().n,
    } : null,
    scope: 'Unresolved records are checked across all dates. Stock measures follow the selected movement dates.',
    accounting_note: 'OCS remainder is collected revenue less doctor commission and transport. It excludes operating expenses and is not net profit. Voided paid bills require a separate cash/refund review.',
  };
}
module.exports = { financialReconciliation };
