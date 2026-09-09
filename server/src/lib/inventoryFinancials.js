const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const parse = value => {
  try { const meta = JSON.parse(value || '{}'); return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}; }
  catch { return {}; }
};
function financialAction(row) {
  const meta = parse(row.current_meta_json || row.meta_json);
  let action = String(row.movement_action_type || row.action_type || '').toLowerCase();
  if (action === 'reversal') action = String(meta.original_action_type || 'adjustment').toLowerCase();
  if (action === 'stock_out') {
    const reason = String(meta.stock_out_reason || '').toLowerCase();
    if (reason === 'sale') return 'sell';
    if (reason === 'wasted' || reason === 'expired') return 'wastage';
  }
  return action === 'expired' ? 'wastage' : action;
}
function stockFinancials(rows) {
  let sales=0, saleCost=0, loss=0, lossUnits=0, consumed=0, gross=0;
  for (const row of rows) {
    const kind=financialAction(row);
    const reversal=(row.movement_action_type || row.action_type)==='reversal';
    const sign=reversal?-1:1;
    const qty=Math.abs(Number(row.quantity || 0));
    const cost=Number(row.unit_cost_snapshot ?? row.cost_price ?? 0);
    const price=Number(row.unit_price_snapshot ?? row.selling_price ?? 0);
    if (kind !== 'restock_in') gross += qty*cost;
    if (kind === 'sell') { sales += sign*qty*price; saleCost += sign*qty*cost; }
    if (kind === 'wastage') { loss += sign*qty*cost; lossUnits += sign*qty; }
    if (['sell','wastage','remove','stock_out','adjustment'].includes(kind)) consumed += sign*qty*cost;
  }
  return {net_sales_rs:round(sales),sales_cost_rs:round(saleCost),gross_margin_rs:round(sales-saleCost),
    gross_margin_pct:sales>0?round((sales-saleCost)/sales*100):null,
    wastage_value_rs:round(loss),wastage_units:lossUnits,total_value_cost_rs:round(consumed),
    gross_movement_cost_rs:round(gross)};
}
function movementRows(db, {from, to, doctorId = null} = {}) {
  return db.prepare(`SELECT m.*, i.stock_scope, i.owner_doctor_id FROM inventory_movements m
    JOIN inventory i ON i.id=m.item_id
    WHERE (? IS NULL OR date(m.created_at,'+4 hours') >= date(?))
      AND (? IS NULL OR date(m.created_at,'+4 hours') <= date(?))
      AND (? IS NULL OR (i.stock_scope='doctor' AND i.owner_doctor_id=?))`)
    .all(from||null,from||null,to||null,to||null,doctorId,doctorId);
}
module.exports = { financialAction, stockFinancials, movementRows };
