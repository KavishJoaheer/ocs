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
// Run inside the payment transaction. Check the whole visit, including when
// the bill being paid contains only additional items.
function assertVisitReadyForPayment(db, consultationId) {
  const bills = db.prepare('SELECT id, items, fee_review_required FROM billing WHERE consultation_id=? AND voided_at IS NULL').all(consultationId);
  let feeCount = 0;
  for (const bill of bills) {
    let items;
    try {
      items = JSON.parse(bill.items || '[]');
      if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object')) throw new Error('Invalid lines');
    } catch {
      throw Object.assign(new Error(`Bill #${bill.id} has unreadable line items. An admin must review this visit before payment.`), {status:409, extra:{code:'VISIT_REVIEW_REQUIRED'}});
    }
    feeCount += items.filter(isConsultationFee).length;
  }
  if (feeCount > 1) throw Object.assign(new Error('Payment blocked: this visit has multiple consultation charges. An admin must resolve the duplicate bills first.'), {status:409, extra:{code:'DUPLICATE_VISIT_FEE', bill_ids:bills.map(b => b.id)}});
  const review = bills.find(b => b.fee_review_required);
  if (review) throw Object.assign(new Error(`Payment blocked: confirm the consultation fee on bill #${review.id} first.`), {status:409, extra:{code:'FEE_REVIEW_REQUIRED', existing_bill_id:review.id}});
}
module.exports = { CONSULTATION_FEES, isConsultationFee, assertSingleVisitFee, assertVisitReadyForPayment };
