const CONSULTATION_FEES = Object.freeze({
  'Day Consultation': 2000,
  'Night Consultation': 3000,
  'Review Consultation': 2000,
});
function isConsultationFee(line) {
  return Boolean(line) && !line.inventory_item_id && line.type !== 'Wastage' && line.type !== 'Adjustment'
    && (line.is_consultation_fee === true || /^(?:(?:day|night|review)\s+)?consultation(?:\s+(?:fee|charge))?$/i.test(String(line.description || '').trim()));
}
function assertSingleVisitFee(db, consultationId, items, exceptBillId = 0) {
  const fees = items.filter(isConsultationFee);
  if (fees.length > 1) throw Object.assign(new Error('A visit can have only one consultation charge.'), {status:409});
  if (!fees.length) return;
  const other = db.prepare('SELECT id, items FROM billing WHERE consultation_id=? AND id!=? AND voided_at IS NULL').all(consultationId, exceptBillId)
    .find(b => {
      let existingItems;
      try {
        existingItems = JSON.parse(b.items || '[]');
        if (!Array.isArray(existingItems)) throw new Error('Invalid bill lines');
      } catch {
        throw Object.assign(new Error(`Bill #${b.id} has unreadable historical line items. An admin must review it before another consultation charge can be added.`), {status:409});
      }
      return existingItems.some(isConsultationFee);
    });
  if (other) throw Object.assign(new Error(`This visit already has a consultation charge on bill #${other.id}. Open that bill to review the fee or record payment.`), {status:409, extra:{code:'VISIT_FEE_EXISTS', existing_bill_id:other.id}});
}
module.exports = { CONSULTATION_FEES, isConsultationFee, assertSingleVisitFee };
