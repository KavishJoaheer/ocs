const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocs-financial-integrity-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';
const { createApp } = require('../src/app');
const app = createApp();
const { db } = require('../src/db');
const { hashPassword } = require('../src/lib/security');
const {
  calculateBillingTotal,
  getTodayLocal,
  offsetLocalDate,
  patientChargeableBillingItems,
  serializePatientBillingRows,
} = require('../src/lib/utils');
const { stockFinancials } = require('../src/lib/inventoryFinancials');
const today = getTodayLocal();
const tokens = {};
const doctorId = db.prepare('SELECT id FROM doctors ORDER BY id LIMIT 1').get().id;
const folderId = db.prepare('SELECT id FROM inventory_folders ORDER BY id DESC LIMIT 1').get().id;
let base, server, fixtureIndex = 0;
let quickIssueIndex = 0;

test('Mauritius financial dates do not depend on the server host timezone', () => {
  assert.equal(getTodayLocal(new Date('2026-09-17T20:15:00.000Z')), '2026-09-18');
  assert.equal(getTodayLocal(new Date('2026-09-17T19:59:59.999Z')), '2026-09-17');
});
before(async () => {
  server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const role of ['admin','doctor','operator','accountant']) {
    db.prepare('INSERT INTO users (username,full_name,password_hash,role,doctor_id) VALUES (?,?,?,?,?)')
      .run('integrity.'+role,'Integrity '+role,hashPassword('SyntheticOnly!2026'),role,role==='doctor'?doctorId:null);
    const login = await api('POST','/auth/login',null,{username:'integrity.'+role,password:'SyntheticOnly!2026'});
    assert.equal(login.status,200);
    tokens[role]=login.data.token;
  }
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(tempDir,{recursive:true,force:true});
});
async function api(method, route, role = 'admin', body) {
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(base + route, {
    method, headers: { ...(multipart ? {} : {'Content-Type':'application/json'}), ...(tokens[role] ? {Authorization:'Bearer ' + tokens[role]} : {}) },
    ...(body === undefined ? {} : {body:multipart ? body : JSON.stringify(body)}),
  });
  const raw = await res.text();
  let data; try { data = JSON.parse(raw); } catch { data = raw; }
  return {status:res.status, data};
}
function context(name, date = today) {
  const n = ++fixtureIndex;
  const patientId = Number(db.prepare("INSERT INTO patients (full_name, first_name, last_name, patient_identifier, age, contact_number, patient_contact_number, address, assigned_doctor_id) VALUES (?, ?, 'Demo', ?, 40, '57000000', '57000000', 'Audit demonstration address', ?)").run(name + ' Demo',name,'AUDIT-' + n,doctorId).lastInsertRowid);
  const appointmentId = Number(db.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status) VALUES (?, ?, ?, '09:00', 'completed')").run(patientId,doctorId,date).lastInsertRowid);
  const consultationId = Number(db.prepare("INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes) VALUES (?, ?, ?, ?, 'Isolated audit example')").run(appointmentId,patientId,doctorId,date).lastInsertRowid);
  return {patientId,appointmentId,consultationId};
}
function item(name, quantity = 20, scope = 'doctor') {
  const id = Number(db.prepare("INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id) VALUES (?, ?, ?, 2, 'unit', 10, 25, ?, ?)").run(name,folderId,quantity,scope,scope === 'doctor' ? doctorId : null).lastInsertRowid);
  const batchId = Number(db.prepare("INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status) VALUES (?, ?, '2031-12-31', 10, 0, 'usable')").run(id,quantity).lastInsertRowid);
  return {id,batchId};
}
function receivedStock(stock, supplier, quantity, deliveryNote = `DN-${randomUUID()}`) {
  const inventory = db.prepare('SELECT item_name, cost_price, selling_price, expiry_date FROM inventory WHERE id=?').get(stock.id);
  const shipmentId = Number(db.prepare(`
    INSERT INTO inventory_shipments (supplier, delivery_note, operation_id, status, total_rows, valid_rows, received_date, released_at)
    VALUES (?, ?, ?, 'released', 1, 1, ?, CURRENT_TIMESTAMP)
  `).run(supplier, deliveryNote, randomUUID(), today).lastInsertRowid);
  db.prepare(`
    INSERT INTO inventory_staging (
      folder_id, item_name, quantity, cost_price, selling_price, expiry_date, status,
      shipment_id, released_inventory_id, released_batch_id, released_at
    ) VALUES (?, ?, ?, ?, ?, '2031-12-31', 'released', ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(folderId, inventory.item_name, quantity, inventory.cost_price, inventory.selling_price, shipmentId, stock.id, stock.batchId);
  return shipmentId;
}
async function bill(ctx, lines, extra = {}) {
  const payload={consultation_id:ctx.consultationId,patient_id:ctx.patientId,items:lines,status:'unpaid',...extra};
  if (payload.status==='paid' && payload.payment_method && payload.payment_method!=='cash' && !payload.payment_reference) {
    payload.payment_reference=`TEST-${payload.payment_method}-${fixtureIndex}-${randomUUID()}`;
  }
  return api('POST','/billing/test-support/create','doctor',payload);
}
function stockLine(it,qty=2) {return {description:'Audit medicine',type:'Sale',inventory_item_id:it.id,quantity:qty,amount:25*qty};}
function fee(amount=1000) {return [{description:'Consultation fee',type:'Sale',amount}];}
function standardFee(type='Day Consultation', amount=2000) {return {description:type,type:'Sale',amount,quantity:1,is_consultation_fee:true};}
function quickIssueFields(prefix='AUDIT-RECEIPT') {
  quickIssueIndex += 1;
  return {
    source_reference:`${prefix}-${quickIssueIndex}`,
    payment_method:'cash',
    payment_date:today,
  };
}
async function report(date=today,basis='visit',selectedDoctorId=null) {
  const doctorScope=selectedDoctorId ? `&doctorId=${selectedDoctorId}` : '';
  return (await api('GET',`/dashboard/live-report?doctorPeriod=daily&doctorDate=${date}&locationPeriod=daily&locationDate=${date}&revenueDate=${date}&dateBasis=${basis}${doctorScope}`)).data;
}
function row(id) {return db.prepare('SELECT * FROM inventory WHERE id = ?').get(id);}
function completedQuickSubmission({bill,ctx,items}) {
  const doctorUserId=Number(db.prepare("SELECT id FROM users WHERE role='doctor' AND doctor_id=? ORDER BY id DESC LIMIT 1").get(doctorId).id);
  const inserted=db.prepare(`INSERT INTO billing_lite_submissions(
    consultation_id,billing_id,doctor_id,submitted_by_user_id,operation_id,item_count,
    items_json,amount_added,workflow_status
  ) VALUES (?,?,?,?,?,?,?,?, 'completed')`).run(
    ctx.consultationId,bill.id,doctorId,doctorUserId,randomUUID(),
    items.reduce((sum,line)=>sum+Number(line.quantity||0),0),JSON.stringify(items),
    items.reduce((sum,line)=>sum+Number(line.amount||0),0),
  );
  return Number(inserted.lastInsertRowid);
}
test('operators transcribe paper invoices, correct unpaid bills and record payment with an audit trail', async () => {
  const ctx=context('Operator invoice'); const it=item('Operator invoice medicine');
  const options=await api('GET','/billing/consultation-options','operator');
  assert.equal(options.status,200,JSON.stringify(options.data));
  const option=options.data.find(row=>row.id===ctx.consultationId);
  assert.ok(option); assert.equal(Object.hasOwn(option,'doctor_notes'),false);

  const missingDoctor=await api('POST','/billing/test-support/create','operator',{
    consultation_id:ctx.consultationId,patient_id:ctx.patientId,items:[standardFee()],status:'unpaid',
    source_reference:'OCS pad #doctor-required',
  });
  assert.equal(missingDoctor.status,400);
  assert.equal(missingDoctor.data.code,'BILLING_DOCTOR_REQUIRED');
  const otherDoctorId=Number(db.prepare('SELECT id FROM doctors WHERE id != ? ORDER BY id LIMIT 1').get(doctorId).id);
  const mismatchedDoctor=await api('POST','/billing/test-support/create','operator',{
    consultation_id:ctx.consultationId,patient_id:ctx.patientId,doctor_id:otherDoctorId,
    items:[standardFee()],status:'unpaid',source_reference:'OCS pad #doctor-mismatch',
  });
  assert.equal(mismatchedDoctor.status,409);
  assert.equal(mismatchedDoctor.data.code,'BILLING_DOCTOR_MISMATCH');

  const issued=await api('POST','/billing/test-support/create','operator',{
    consultation_id:ctx.consultationId,
    patient_id:ctx.patientId,
    doctor_id:doctorId,
    items:[standardFee('Day Consultation',2250),stockLine(it,1)],
    status:'unpaid',
    source_reference:'OCS pad #0142',
  });
  assert.equal(issued.status,201,JSON.stringify(issued.data));
  assert.equal(issued.data.status,'unpaid'); assert.equal(issued.data.total_amount,2275); assert.equal(row(it.id).quantity,19);
  assert.match(issued.data.invoice_number,/^OCS-INV-\d{8}$/);
  assert.equal(issued.data.source_reference,'OCS pad #0142');
  assert.equal(issued.data.issued_by_role,'operator');
  assert.equal(issued.data.issued_by_name,'Integrity operator');
  assert.equal(issued.data.patient_identifier_snapshot,'AUDIT-1');
  assert.equal(issued.data.patient_name_snapshot,'Operator invoice Demo');
  assert.equal(issued.data.doctor_id_snapshot,doctorId);
  assert.equal(issued.data.consultation_type_snapshot,'Day Consultation');
  assert.equal(issued.data.partner_category_snapshot,'Self-pay');
  assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(issued.data.updated_by_user_id).role,'operator');
  assert.ok((await api('GET','/billing','operator')).data.some(b=>b.id===issued.data.id));
  assert.equal(db.prepare("SELECT reason FROM billing_events WHERE bill_id=? AND event_type='created'").get(issued.data.id).reason,'Paper invoice: OCS pad #0142');

  const duplicateReferenceCtx=context('Duplicate operator source');
  const duplicateReference=await api('POST','/billing/test-support/create','operator',{
    consultation_id:duplicateReferenceCtx.consultationId,
    patient_id:duplicateReferenceCtx.patientId,
    doctor_id:doctorId,
    items:[standardFee()],status:'unpaid',source_reference:'  ocs   PAD #0142  ',
  });
  assert.equal(duplicateReference.status,409,JSON.stringify(duplicateReference.data));
  assert.equal(duplicateReference.data.code,'DUPLICATE_SOURCE_REFERENCE');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing WHERE consultation_id=?').get(duplicateReferenceCtx.consultationId).count,0);

  const paidCtx=context('Operator paid block');
  assert.equal((await api('POST','/billing/test-support/create','operator',{
    consultation_id:paidCtx.consultationId,patient_id:paidCtx.patientId,doctor_id:doctorId,items:[standardFee()],
    status:'paid',payment_method:'cash',payment_date:today,source_reference:'OCS pad #0143',
  })).status,403);
  const manualCtx=context('Operator manual line');
  const manual=await api('POST','/billing/test-support/create','operator',{
    consultation_id:manualCtx.consultationId,patient_id:manualCtx.patientId,doctor_id:doctorId,
    items:[standardFee(),{description:'Doctor-written dressing charge',type:'Sale',amount:500,quantity:1,is_service_charge:true}],
    status:'unpaid',source_reference:'OCS pad #0144',
  });
  assert.equal(manual.status,201,JSON.stringify(manual.data));

  const correctedItems=issued.data.items.map(line=>line.is_consultation_fee
    ? {...line,description:'Night Consultation',amount:3000}
    : line).concat({description:'Doctor-written aftercare item',type:'Sale',amount:100,quantity:1,is_service_charge:true});
  const corrected=await api('PUT',`/billing/${issued.data.id}`,'operator',{
    items:correctedItems,expected_version:issued.data.row_version,
    correction_reason:'OCS pad #0142 transcription correction',
  });
  assert.equal(corrected.status,200,JSON.stringify(corrected.data));
  assert.equal(corrected.data.total_amount,3125);
  assert.equal(row(it.id).quantity,19);
  assert.equal((await api('PUT',`/billing/${issued.data.id}`,'operator',{
    items:corrected.data.items,expected_version:corrected.data.row_version,
  })).status,400);

  const paid=await api('PATCH',`/billing/${issued.data.id}/pay`,'operator',{
    payment_method:'cash',payment_date:today,expected_version:corrected.data.row_version,
  });
  assert.equal(paid.status,200,JSON.stringify(paid.data));
  assert.equal(paid.data.status,'paid');
  assert.equal(paid.data.payment_method,'cash');
  assert.equal(db.prepare("SELECT actor_role FROM billing_events WHERE bill_id=? AND after_json LIKE '%\"status\":\"paid\"%' ORDER BY id DESC LIMIT 1").get(issued.data.id).actor_role,'operator');
  assert.equal((await api('PUT',`/billing/${issued.data.id}`,'operator',{
    items:paid.data.items,expected_version:paid.data.row_version,correction_reason:'Try to change paid invoice',
  })).status,403);
  assert.equal((await api('POST',`/billing/${issued.data.id}/void`,'operator',{reason:'Operator cannot void'})).status,403);
});

test('finance summary separates invoice status, consultation sales, supply sales and supply cost', async () => {
  const route = `/billing/finance-summary?dateFrom=${today}&dateTo=${today}&doctorId=${doctorId}`;
  const before = await api('GET', route, 'accountant');
  assert.equal(before.status, 200, JSON.stringify(before.data));

  const ctx = context('Finance summary');
  const stockedItem = item('Finance summary medicine');
  const issued = await bill(ctx, [
    standardFee(),
    stockLine(stockedItem, 1),
    { description: 'ECG interpretation', type: 'Sale', amount: 100, quantity: 1, is_service_charge: true },
  ], {
    status: 'paid',
    payment_method: 'cash',
    payment_date: today,
    operation_id: randomUUID(),
  });
  assert.equal(issued.status, 201, JSON.stringify(issued.data));

  const after = await api('GET', route, 'accountant');
  assert.equal(after.status, 200, JSON.stringify(after.data));
  assert.equal(after.data.invoice_count - before.data.invoice_count, 1);
  assert.equal(after.data.paid_invoice_count - before.data.paid_invoice_count, 1);
  assert.equal(after.data.paid_invoice_amount - before.data.paid_invoice_amount, 2125);
  assert.equal(after.data.issued_invoice_amount - before.data.issued_invoice_amount, 2125);
  assert.equal(after.data.collected_amount - before.data.collected_amount, 2125);
  assert.equal(after.data.net_collected_amount - before.data.net_collected_amount, 2125);
  assert.equal(after.data.consultation_amount - before.data.consultation_amount, 2000);
  assert.equal(after.data.supply_sold_amount - before.data.supply_sold_amount, 25);
  assert.equal(after.data.service_non_stock_amount - before.data.service_non_stock_amount, 100);
  assert.equal(after.data.supply_cost_sold_amount - before.data.supply_cost_sold_amount, 10);
  assert.equal(after.data.total_sales_amount - before.data.total_sales_amount, 2125);
  assert.equal(after.data.net_sales_amount - before.data.net_sales_amount, 2125);
  assert.equal(after.data.supply_gross_margin_amount - before.data.supply_gross_margin_amount, 15);
  const afterCash = after.data.cash_activity.by_method.find((entry) => entry.payment_method === 'cash');
  const beforeCash = before.data.cash_activity.by_method.find((entry) => entry.payment_method === 'cash');
  assert.equal(afterCash.collected_amount - beforeCash.collected_amount, 2125);
  assert.equal(after.data.cash_activity.collected_amount - before.data.cash_activity.collected_amount, 2125);
  assert.equal(after.data.cash_activity.net_amount - before.data.cash_activity.net_amount, 2125);
  assert.equal(after.data.receivables_aging.reduce((sum, entry) => sum + entry.invoice_count, 0), after.data.pending_invoice_count);
  assert.equal(typeof after.data.cost_quality.margin_is_complete, 'boolean');
  assert.ok(after.data.follow_up_assignees.some((entry) => entry.role === 'accountant'));
  assert.ok(after.data.doctors.some((doctor) => doctor.id === doctorId));
  assert.ok(after.data.by_doctor.some((doctor) => doctor.doctor_id === doctorId));

  const credit = await api('POST', `/billing/${issued.data.id}/refunds`, 'accountant', {
    amount: 100,
    refund_method: 'cash',
    refund_date: today,
    reason: 'Reverse the ECG interpretation service charge',
    operation_id: randomUUID(),
  });
  assert.equal(credit.status, 201, JSON.stringify(credit.data));
  const afterCredit = await api('GET', route, 'accountant');
  assert.equal(afterCredit.data.credit_note_amount - before.data.credit_note_amount, 100);
  assert.equal(afterCredit.data.net_collected_amount - before.data.net_collected_amount, 2025);
  assert.equal(afterCredit.data.total_sales_amount - before.data.total_sales_amount, 2125);
  assert.equal(afterCredit.data.net_sales_amount - before.data.net_sales_amount, 2025);
  assert.equal(afterCredit.data.cash_activity.refunded_amount - before.data.cash_activity.refunded_amount, 100);
  assert.equal(afterCredit.data.cash_activity.net_amount - before.data.cash_activity.net_amount, 2025);

  const statement = await api('GET', `/billing/finance-statement?dateFrom=${today}&dateTo=${today}&doctorId=${doctorId}`, 'accountant');
  assert.equal(statement.status, 200, JSON.stringify(statement.data));
  const statementRow = statement.data.rows.find((row) => row.invoice_number === issued.data.invoice_number);
  assert.equal(statementRow.invoice_total, 2125);
  assert.equal(statementRow.payment_received_amount, 2125);
  assert.equal(statementRow.credit_note_amount, 100);
  assert.equal(statementRow.supply_cost_amount, 10);
  assert.match(statementRow.payment_details, /cash/);
  const csv = await api('GET', `/billing/finance-statement.csv?dateFrom=${today}&dateTo=${today}&doctorId=${doctorId}`, 'accountant');
  assert.equal(csv.status, 200);
  assert.match(csv.data, /invoice_number/);
  assert.match(csv.data, new RegExp(issued.data.invoice_number));

  const denied = await api('GET', route, 'doctor');
  assert.equal(denied.status, 403);
});

test('expense, supplier payable, cash/accrual and approval ledgers remain auditable', async () => {
  const beforeAccrual = await api('GET', `/finance/summary?dateFrom=${today}&dateTo=${today}&basis=accrual`, 'accountant');
  const beforeCash = await api('GET', `/finance/summary?dateFrom=${today}&dateTo=${today}&basis=cash`, 'accountant');
  const expenseOperation = randomUUID();
  const expenseDocument = new FormData();
  Object.entries({ expense_date: today, category: 'fuel', payee: 'Audit Fuel Station',
    description: 'Home visit fuel expense', amount: '600', external_reference: 'FUEL-TEST-001',
    operation_id: expenseOperation }).forEach(([key,value]) => expenseDocument.append(key,value));
  expenseDocument.append('receipt', new Blob(['audit receipt'], {type:'application/pdf'}), 'fuel-receipt.pdf');
  const submittedExpense = await api('POST', '/finance/expenses', 'accountant', expenseDocument);
  assert.equal(submittedExpense.status, 201, JSON.stringify(submittedExpense.data));
  assert.equal(submittedExpense.data.approval_status, 'submitted');
  assert.equal((await api('POST', `/finance/expenses/${submittedExpense.data.id}/decision`, 'accountant', {
    action: 'approved', note: 'Accountant cannot self-approve this expense.', operation_id: randomUUID(),
  })).status, 403);
  const approvedExpense = await api('POST', `/finance/expenses/${submittedExpense.data.id}/decision`, 'admin', {
    action: 'approved', note: 'Fuel receipt and visit log reviewed.', operation_id: randomUUID(),
  });
  assert.equal(approvedExpense.status, 200, JSON.stringify(approvedExpense.data));
  assert.equal(approvedExpense.data.approval_status, 'approved');
  const expensePayment = await api('POST', `/finance/expenses/${submittedExpense.data.id}/payments`, 'accountant', {
    amount: 400, payment_date: today, payment_method: 'card', external_reference: 'CARD-FUEL-001', operation_id: randomUUID(),
  });
  assert.equal(expensePayment.status, 201, JSON.stringify(expensePayment.data));
  assert.equal(expensePayment.data.outstanding_amount, 200);

  const stock = item('Supplier costing medicine', 12, 'ocs');
  const shipmentId = receivedStock(stock, 'Audit Medical Supplier', 12);
  const supplierInvoice = await api('POST', '/finance/supplier-invoices', 'accountant', {
    supplier_name: 'Audit Medical Supplier', invoice_number: `SUP-${fixtureIndex}-${randomUUID()}`,
    invoice_date: today, due_date: today, delivery_note: 'DN-AUDIT-001', other_amount: 50,
    shipment_id: shipmentId,
    operation_id: randomUUID(),
    lines: [{ inventory_item_id: stock.id, batch_id: stock.batchId, description: 'Supplier costing medicine', quantity: 12, unit_cost: 17.5 }],
  });
  assert.equal(supplierInvoice.status, 201, JSON.stringify(supplierInvoice.data));
  assert.equal(supplierInvoice.data.total_amount, 260);
  const approvedSupplier = await api('POST', `/finance/supplier-invoices/${supplierInvoice.data.id}/decision`, 'admin', {
    action: 'approved', note: 'Invoice matched to delivery and stock batch.', operation_id: randomUUID(),
  });
  assert.equal(approvedSupplier.status, 200, JSON.stringify(approvedSupplier.data));
  assert.equal(db.prepare('SELECT unit_cost FROM inventory_batches WHERE id=?').get(stock.batchId).unit_cost, 17.5);
  assert.equal(db.prepare('SELECT cost_price FROM inventory WHERE id=?').get(stock.id).cost_price, 17.5);
  const supplierPayment = await api('POST', `/finance/supplier-invoices/${supplierInvoice.data.id}/payments`, 'accountant', {
    amount: 160, payment_date: today, payment_method: 'bank_transfer', external_reference: 'BANK-SUP-001', operation_id: randomUUID(),
  });
  assert.equal(supplierPayment.status, 201, JSON.stringify(supplierPayment.data));
  assert.equal(supplierPayment.data.outstanding_amount, 100);

  const accrual = await api('GET', `/finance/summary?dateFrom=${today}&dateTo=${today}&basis=accrual`, 'accountant');
  const cash = await api('GET', `/finance/summary?dateFrom=${today}&dateTo=${today}&basis=cash`, 'accountant');
  assert.equal(accrual.status, 200, JSON.stringify(accrual.data));
  assert.equal(cash.status, 200, JSON.stringify(cash.data));
  assert.equal(accrual.data.accrued_expense_amount - beforeAccrual.data.accrued_expense_amount, 600);
  assert.equal(cash.data.paid_expense_amount - beforeCash.data.paid_expense_amount, 400);
  assert.equal(cash.data.supplier_payment_amount - beforeCash.data.supplier_payment_amount, 160);
  assert.equal(accrual.data.revenue_label, 'Net sales');
  assert.equal(accrual.data.revenue_amount, accrual.data.net_sales_amount);
  assert.equal(accrual.data.gross_result_amount, accrual.data.gross_profit_amount);
  assert.equal(cash.data.revenue_label, 'Net collections');
  assert.equal(cash.data.revenue_amount, cash.data.collected_cash_amount);
  assert.equal(cash.data.gross_result_amount, cash.data.collected_cash_amount - cash.data.supplier_payment_amount);
  assert.equal(accrual.data.net_result_label, 'Net profit');
  assert.equal(cash.data.net_result_label, 'Net cash result');
  assert.throws(() => db.prepare('UPDATE finance_expenses SET amount=1 WHERE id=?').run(submittedExpense.data.id), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM finance_supplier_payments WHERE supplier_invoice_id=?').run(supplierInvoice.data.id), /immutable/);

  const expensePaymentId = expensePayment.data.payments[0].id;
  assert.equal((await api('POST', `/finance/expenses/${submittedExpense.data.id}/payments/${expensePaymentId}/reversal`, 'accountant', {
    reversal_date: today, reason: 'Accountant cannot reverse without administrator approval.', operation_id: randomUUID(),
  })).status, 403);
  const expenseReversal = await api('POST', `/finance/expenses/${submittedExpense.data.id}/payments/${expensePaymentId}/reversal`, 'admin', {
    reversal_date: today, reason: 'Correcting the test payment reference safely.', operation_id: randomUUID(),
  });
  assert.equal(expenseReversal.status, 201, JSON.stringify(expenseReversal.data));
  assert.equal(expenseReversal.data.outstanding_amount, 600);
  assert.throws(() => db.prepare('DELETE FROM finance_expense_payment_reversals WHERE payment_id=?').run(expensePaymentId), /immutable/);
  const expenseRepayment = await api('POST', `/finance/expenses/${submittedExpense.data.id}/payments`, 'accountant', {
    amount: 400, payment_date: today, payment_method: 'card', external_reference: 'CARD-FUEL-002', operation_id: randomUUID(),
  });
  assert.equal(expenseRepayment.status, 201, JSON.stringify(expenseRepayment.data));
  assert.equal(expenseRepayment.data.outstanding_amount, 200);

  const supplierPaymentId = supplierPayment.data.payments[0].id;
  const supplierReversal = await api('POST', `/finance/supplier-invoices/${supplierInvoice.data.id}/payments/${supplierPaymentId}/reversal`, 'admin', {
    reversal_date: today, reason: 'Correcting the supplier bank reference safely.', operation_id: randomUUID(),
  });
  assert.equal(supplierReversal.status, 201, JSON.stringify(supplierReversal.data));
  assert.equal(supplierReversal.data.outstanding_amount, 260);
  const supplierRepayment = await api('POST', `/finance/supplier-invoices/${supplierInvoice.data.id}/payments`, 'accountant', {
    amount: 160, payment_date: today, payment_method: 'bank_transfer', external_reference: 'BANK-SUP-002', operation_id: randomUUID(),
  });
  assert.equal(supplierRepayment.status, 201, JSON.stringify(supplierRepayment.data));
  assert.equal(supplierRepayment.data.outstanding_amount, 100);

  const close = await api('GET', `/finance/monthly-close?month=${today.slice(0, 7)}`, 'accountant');
  assert.equal(close.status, 200, JSON.stringify(close.data));
  assert.equal(close.data.readiness.ready, false);
  assert.ok(close.data.readiness.blockers.length > 0);
  const statement = await api('GET', `/finance/statement.csv?dateFrom=${today}&dateTo=${today}&basis=accrual`, 'accountant');
  assert.equal(statement.status, 200);
  assert.match(statement.data, /Gross profit/);

  const historicClose = await api('GET', '/finance/monthly-close?month=2000-01', 'admin');
  assert.equal(historicClose.status, 200, JSON.stringify(historicClose.data));
  assert.equal(historicClose.data.readiness.ready, true, JSON.stringify(historicClose.data));
  const signed = await api('POST', '/finance/monthly-close', 'admin', {
    month: '2000-01', notes: 'Verified empty historical finance period.', operation_id: randomUUID(),
  });
  assert.equal(signed.status, 201, JSON.stringify(signed.data));
  const lockedDocument = new FormData();
  Object.entries({ expense_date: '2000-01-15', category: 'miscellaneous', payee: 'Locked period test',
    description: 'Must not enter a signed month', amount: '1', operation_id: randomUUID() })
    .forEach(([key,value]) => lockedDocument.append(key,value));
  lockedDocument.append('receipt', new Blob(['locked'], {type:'application/pdf'}), 'locked.pdf');
  assert.equal((await api('POST', '/finance/expenses', 'accountant', lockedDocument)).status, 409);
});

test('receivables ageing and append-only follow-up ownership support collection accountability', async () => {
  const ctx=context('Follow-up accountability');
  const invoice=await bill(ctx,[standardFee()],{operation_id:randomUUID()});
  assert.equal(invoice.status,201,JSON.stringify(invoice.data));
  const summary=await api('GET',`/billing/finance-summary?dateFrom=${today}&dateTo=${today}&doctorId=${doctorId}`,'accountant');
  const todayBucket=summary.data.receivables_aging.find((entry)=>entry.key==='today');
  assert.ok(todayBucket.invoice_count>=1,JSON.stringify(summary.data.receivables_aging));
  const assignee=summary.data.follow_up_assignees.find((entry)=>entry.role==='operator');
  const followUp=await api('POST',`/billing/${invoice.data.id}/follow-ups`,'accountant',{
    assigned_to_user_id:assignee.id,note:'Called patient and requested payment confirmation.',
    last_contact_date:today,next_follow_up_date:today,status:'open',
  });
  assert.equal(followUp.status,201,JSON.stringify(followUp.data));
  assert.equal(followUp.data.assigned_to_user_id,assignee.id);
  assert.throws(()=>db.prepare('UPDATE billing_follow_ups SET note=? WHERE id=?').run('Changed later',followUp.data.id),/append-only/);
  const list=await api('GET',`/billing?paginated=1&ageBucket=today&status=unpaid&search=${encodeURIComponent(invoice.data.invoice_number)}`,'accountant');
  assert.equal(list.status,200,JSON.stringify(list.data));
  assert.equal(list.data.bills[0].follow_up_assigned_to_user_id,assignee.id);
  assert.equal(list.data.bills[0].follow_up_next_date,today);
});

test('supplier approval closes delivery follow-up and revalues stock already used', async () => {
  const stock = item('Late supplier price medicine', 12, 'ocs');
  const shipmentId = receivedStock(stock, 'Late Price Supplier', 12);

  let reconciliation = await api('GET', '/billing/reconciliation', 'accountant');
  let delivery = reconciliation.data.stock_readiness.deliveries_without_invoice
    .find((entry) => Number(entry.id) === shipmentId);
  assert.ok(delivery, JSON.stringify(reconciliation.data.stock_readiness));
  assert.equal(delivery.invoice_status, 'missing');

  db.prepare('UPDATE inventory SET quantity=10,row_version=row_version+1 WHERE id=?').run(stock.id);
  db.prepare('UPDATE inventory_batches SET quantity_remaining=10,row_version=row_version+1 WHERE id=?').run(stock.batchId);
  db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, action_type, quantity, previous_quantity, next_quantity,
      unit_cost_snapshot, unit_price_snapshot, valuation_basis, meta_json
    ) VALUES (?, 'out', 'stock_out', 2, 12, 10, 10, 25, 'batch_actual', ?)
  `).run(stock.id, JSON.stringify({ stock_out_reason: 'wasted', business_date: today }));

  const invoice = await api('POST', '/finance/supplier-invoices', 'accountant', {
    supplier_name: 'Late Price Supplier',
    invoice_number: `SUP-LATE-${randomUUID()}`,
    invoice_date: today,
    delivery_note: `DN-LATE-INVOICE-${randomUUID()}`,
    shipment_id: shipmentId,
    operation_id: randomUUID(),
    lines: [{
      inventory_item_id: stock.id,
      batch_id: stock.batchId,
      description: 'Late supplier price medicine',
      quantity: 12,
      unit_cost: 12,
    }],
  });
  assert.equal(invoice.status, 201, JSON.stringify(invoice.data));

  reconciliation = await api('GET', '/billing/reconciliation', 'accountant');
  delivery = reconciliation.data.stock_readiness.deliveries_without_invoice
    .find((entry) => Number(entry.id) === shipmentId);
  assert.ok(delivery, JSON.stringify(reconciliation.data.stock_readiness));
  assert.equal(delivery.invoice_status, 'submitted');
  assert.equal(Number(delivery.linked_invoice_id), Number(invoice.data.id));

  const approved = await api('POST', `/finance/supplier-invoices/${invoice.data.id}/decision`, 'admin', {
    action: 'approved',
    note: 'Matched against the supplier delivery and quantities.',
    operation_id: randomUUID(),
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(Number(db.prepare('SELECT unit_cost FROM inventory_batches WHERE id=?').get(stock.batchId).unit_cost), 12);
  assert.equal(Number(db.prepare('SELECT cost_price FROM inventory WHERE id=?').get(stock.id).cost_price), 12);
  assert.equal(approved.data.cost_variances.length, 1);
  assert.equal(Number(approved.data.cost_variances[0].remaining_quantity), 10);
  assert.equal(Number(approved.data.cost_variances[0].consumed_quantity), 2);
  assert.equal(Number(approved.data.cost_variances[0].variance_amount), 4);

  reconciliation = await api('GET', '/billing/reconciliation', 'accountant');
  assert.equal(
    reconciliation.data.stock_readiness.deliveries_without_invoice
      .some((entry) => Number(entry.id) === shipmentId),
    false,
  );
  const accounting = await api('GET', `/accounting/workspace?from=${today}&to=${today}`, 'accountant');
  assert.equal(accounting.status, 200, JSON.stringify(accounting.data));
  const varianceJournal = accounting.data.journals.find(
    (entry) => entry.reference_type === 'supplier_cost_variance'
      && Number(entry.reference_id) === Number(approved.data.cost_variances[0].id),
  );
  assert.ok(varianceJournal, JSON.stringify(accounting.data.journals));
  assert.equal(Number(varianceJournal.amount), 4);
  assert.equal(accounting.data.statements.trial_balance.is_balanced, true);
});

test('supplier invoices cannot claim unrelated, partial, or already approved receipt batches', async () => {
  const supplier = 'Receipt Match Supplier';
  const stock = item(`Receipt match ${randomUUID()}`, 8, 'ocs');
  const other = item(`Other receipt ${randomUUID()}`, 4, 'ocs');
  const shipmentId = receivedStock(stock, supplier, 8);
  const baseInvoice = {
    supplier_name: supplier, invoice_date: today, delivery_note: `DN-MATCH-${randomUUID()}`,
    shipment_id: shipmentId,
    lines: [{ inventory_item_id: stock.id, batch_id: stock.batchId, description: 'Receipt match stock', quantity: 8, unit_cost: 12 }],
  };
  async function submit(patch = {}) {
    return api('POST', '/finance/supplier-invoices', 'accountant', {
      ...baseInvoice, invoice_number: `MATCH-${randomUUID()}`, operation_id: randomUUID(), ...patch,
    });
  }
  assert.equal((await submit({ shipment_id: null })).status, 400);
  assert.equal((await submit({ supplier_name: 'Different Supplier' })).status, 400);
  assert.equal((await submit({ lines: [{ ...baseInvoice.lines[0], batch_id: other.batchId, inventory_item_id: other.id }] })).status, 400);
  assert.equal((await submit({ lines: [{ ...baseInvoice.lines[0], quantity: 4 }] })).status, 400);
  assert.equal((await submit({ lines: [baseInvoice.lines[0], baseInvoice.lines[0]] })).status, 400);

  const first = await submit();
  const competing = await submit({ lines: [{ ...baseInvoice.lines[0], unit_cost: 15 }] });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(competing.status, 201, JSON.stringify(competing.data));
  const approved = await api('POST', `/finance/supplier-invoices/${first.data.id}/decision`, 'admin', {
    action: 'approved', note: 'Matched to one received batch.', operation_id: randomUUID(),
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const duplicate = await api('POST', `/finance/supplier-invoices/${competing.data.id}/decision`, 'admin', {
    action: 'approved', note: 'Second invoice for the same batch.', operation_id: randomUUID(),
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));
  assert.equal(db.prepare('SELECT unit_cost FROM inventory_batches WHERE id=?').get(stock.batchId).unit_cost, 12);
  assert.equal(db.prepare(`SELECT action FROM finance_supplier_invoice_events WHERE supplier_invoice_id=? ORDER BY id DESC LIMIT 1`).get(competing.data.id).action, 'submitted');
  assert.equal((await submit()).status, 409);
  const catalogue = await api('GET', '/finance/supplier-catalogue', 'accountant');
  assert.equal(catalogue.status, 200);
  assert.equal(catalogue.data.shipments.some((entry) => Number(entry.id) === shipmentId), false);
  const receipt = await api('GET', `/finance/supplier-shipments/${shipmentId}`, 'accountant');
  assert.deepEqual(receipt.data.shipment.lines, []);
});

test('supplier invoice references are unique regardless of supplier or number capitalization', async () => {
  const supplier = `Case Supplier ${randomUUID()}`;
  const firstStock = item(`Case first ${randomUUID()}`, 2, 'ocs');
  const secondStock = item(`Case second ${randomUUID()}`, 3, 'ocs');
  const firstShipment = receivedStock(firstStock, supplier, 2);
  const secondShipment = receivedStock(secondStock, supplier, 3);
  const number = `CASE-${randomUUID()}`;
  const first = await api('POST', '/finance/supplier-invoices', 'accountant', {
    supplier_name: supplier, invoice_number: number, invoice_date: today,
    delivery_note: 'First receipt', shipment_id: firstShipment, operation_id: randomUUID(),
    lines: [{ inventory_item_id: firstStock.id, batch_id: firstStock.batchId, description: 'First stock', quantity: 2, unit_cost: 10 }],
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const duplicate = await api('POST', '/finance/supplier-invoices', 'accountant', {
    supplier_name: supplier.toLowerCase(), invoice_number: number.toLowerCase(), invoice_date: today,
    delivery_note: 'Second receipt', shipment_id: secondShipment, operation_id: randomUUID(),
    lines: [{ inventory_item_id: secondStock.id, batch_id: secondStock.batchId, description: 'Second stock', quantity: 3, unit_cost: 10 }],
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));
});

test('quick Receive is visible in finance follow-up and can be invoiced from its released batch', async () => {
  const stock = item(`Quick finance ${randomUUID()}`, 2, 'ocs');
  const supplier = `Quick supplier ${randomUUID()}`;
  const received = await api('POST', `/inventory/items/${stock.id}/ocs-actions`, 'operator', {
    action_type: 'stock_in', quantity: 3, expiry_date: '2031-12-31',
    supplier_name: supplier, received_date: today,
    delivery_note: `QUICK-DN-${randomUUID()}`, operation_id: randomUUID(),
  });
  assert.equal(received.status, 201, JSON.stringify(received.data));
  const shipmentId = Number(received.data.shipment_id);
  const batchId = Number(db.prepare(`
    SELECT released_batch_id FROM inventory_staging WHERE shipment_id=? AND status='released'
  `).get(shipmentId)?.released_batch_id);
  assert.ok(batchId);
  const before = await api('GET', '/billing/reconciliation', 'accountant');
  assert.equal(before.status, 200);
  assert.ok(before.data.stock_readiness.deliveries_without_invoice.some((row) => Number(row.id) === shipmentId));
  const invoice = await api('POST', '/finance/supplier-invoices', 'accountant', {
    supplier_name: supplier, invoice_number: `QUICK-INV-${randomUUID()}`, invoice_date: today,
    delivery_note: 'Quick receipt invoice', shipment_id: shipmentId, operation_id: randomUUID(),
    lines: [{ inventory_item_id: stock.id, batch_id: batchId, description: 'Quick received stock', quantity: 3, unit_cost: 10 }],
  });
  assert.equal(invoice.status, 201, JSON.stringify(invoice.data));
  const approved = await api('POST', `/finance/supplier-invoices/${invoice.data.id}/decision`, 'admin', {
    action: 'approved', note: 'Matched to quick receipt.', operation_id: randomUUID(),
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const after = await api('GET', '/billing/reconciliation', 'accountant');
  assert.equal(after.status, 200);
  assert.equal(after.data.stock_readiness.deliveries_without_invoice.some((row) => Number(row.id) === shipmentId), false);
});

test('a delivery follow-up stays open until every released line has an approved invoice', async () => {
  const supplier = 'Two Line Supplier';
  const firstStock = item(`First received ${randomUUID()}`, 3, 'ocs');
  const secondStock = item(`Second received ${randomUUID()}`, 5, 'ocs');
  const shipmentId = receivedStock(firstStock, supplier, 3);
  db.prepare(`
    INSERT INTO inventory_staging (
      folder_id, item_name, quantity, cost_price, selling_price, expiry_date, status,
      shipment_id, released_inventory_id, released_batch_id, released_at
    ) VALUES (?, ?, 5, 10, 25, '2031-12-31', 'released', ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(folderId, 'Second received', shipmentId, secondStock.id, secondStock.batchId);
  db.prepare('UPDATE inventory_shipments SET total_rows=2,valid_rows=2 WHERE id=?').run(shipmentId);
  for (const [stock, quantity] of [[firstStock, 3], [secondStock, 5]]) {
    const invoice = await api('POST', '/finance/supplier-invoices', 'accountant', {
      supplier_name: supplier, invoice_number: `TWO-${randomUUID()}`, invoice_date: today,
      delivery_note: `DN-TWO-${randomUUID()}`, shipment_id: shipmentId, operation_id: randomUUID(),
      lines: [{ inventory_item_id: stock.id, batch_id: stock.batchId, description: 'Received stock', quantity, unit_cost: 10 }],
    });
    assert.equal(invoice.status, 201, JSON.stringify(invoice.data));
    const decision = await api('POST', `/finance/supplier-invoices/${invoice.data.id}/decision`, 'admin', {
      action: 'approved', note: 'Matched to received line.', operation_id: randomUUID(),
    });
    assert.equal(decision.status, 200, JSON.stringify(decision.data));
    const reconciliation = await api('GET', '/billing/reconciliation', 'accountant');
    const stillOpen = reconciliation.data.stock_readiness.deliveries_without_invoice.some((row) => Number(row.id) === shipmentId);
    assert.equal(stillOpen, stock.id === firstStock.id);
    const receipt = await api('GET', `/finance/supplier-shipments/${shipmentId}`, 'accountant');
    assert.equal(receipt.status, 200);
    assert.equal(receipt.data.shipment.lines.length, stock.id === firstStock.id ? 1 : 0);
  }
});


test('invoice retries have one financial and stock effect, including concurrent and legacy clients', async () => {
  const ctx=context('Retry'); const it=item('Retry medicine'); const id=randomUUID();
  const [a,b]=await Promise.all([bill(ctx,[stockLine(it)],{operation_id:id}),bill(ctx,[stockLine(it)],{operation_id:id})]);
  assert.equal(a.status,201,JSON.stringify(a.data)); assert.equal(b.data.id,a.data.id);
  assert.equal(row(it.id).quantity,18);
  const mismatch=await bill(ctx,[stockLine(it,1)],{operation_id:id}); assert.equal(mismatch.status,409);
  const separate=await bill(ctx,[stockLine(it)],{operation_id:randomUUID()});
  assert.equal(separate.status,201); assert.notEqual(separate.data.id,a.data.id); assert.equal(row(it.id).quantity,16);
  const legacy=context('Legacy retry'); const first=await bill(legacy,fee()); const repeat=await bill(legacy,fee());
  assert.equal(first.data.id,repeat.data.id);
});

test('inventory-linked edits preserve stock lines and allow unrelated fee changes', async () => {
  const ctx=context('Edit'); const it=item('Edit medicine'); const original=await bill(ctx,[...fee(),stockLine(it)]);
  const items=original.data.items.map(i=>i.inventory_item_id?i:{...i,amount:1200});
  const edited=await api('PUT',`/billing/${original.data.id}`,'doctor',{items,correction_reason:'Adjusted consultation fee after source review',expected_version:original.data.row_version});
  assert.equal(edited.status,200,JSON.stringify(edited.data)); assert.equal(edited.data.total_amount,1250);
  assert.equal(row(it.id).quantity,18);
  const stripped=await api('PUT',`/billing/${original.data.id}`,'doctor',{items:fee()}); assert.equal(stripped.status,400);
  const stale=await api('PUT',`/billing/${original.data.id}`,'doctor',{items,expected_version:original.data.row_version}); assert.equal(stale.status,409);
  assert.equal(db.prepare('SELECT total_amount FROM billing WHERE id=?').get(original.data.id).total_amount,1250);
});

test('paid consultations cannot be deleted or used to reverse recognised revenue and stock', async () => {
  const ctx=context('Paid void protection'); const it=item('Paid void protection medicine');
  const original=await bill(ctx,[...fee(),stockLine(it)],{status:'paid',payment_method:'cash',payment_date:today});
  const before=await report();
  const blocked=await api('DELETE',`/consultations/${ctx.consultationId}`,'admin',{reason:'Incorrect visit entered during testing'});
  assert.equal(blocked.status,409,JSON.stringify(blocked.data));
  assert.equal(blocked.data.code,'PAID_CONSULTATION_VOID_BLOCKED');
  assert.equal((await api('DELETE',`/consultations/${ctx.consultationId}`,'doctor',{reason:'Doctor cannot void paid visit'})).status,403);
  assert.equal(row(it.id).quantity,18);
  const after=await report(); assert.equal(after.revenueStatement.paidRevenue,before.revenueStatement.paidRevenue);
  assert.ok(after.billingRevenueReport.rows.some(r=>r.bill_id===original.data.id));
  const detail=await api('GET',`/billing/${original.data.id}`,'doctor'); assert.equal(detail.status,200);
  assert.ok(!detail.data.history.some(e=>e.event_type==='voided'));
  assert.equal(db.prepare('SELECT voided_at FROM consultations WHERE id=?').get(ctx.consultationId).voided_at,null);
});

test('an admin can void an unpaid consultation with a documented stock reversal', async () => {
  const ctx=context('Unpaid void'); const it=item('Unpaid void medicine');
  const original=await bill(ctx,[...fee(),stockLine(it)]);
  assert.equal((await api('DELETE',`/consultations/${ctx.consultationId}`,'admin')).status,400);
  const result=await api('DELETE',`/consultations/${ctx.consultationId}`,'admin',{reason:'Duplicate unpaid consultation entered'});
  assert.equal(result.status,204,JSON.stringify(result.data)); assert.equal(row(it.id).quantity,20);
  const detail=await api('GET',`/billing/${original.data.id}`,'doctor'); assert.equal(detail.status,200);
  assert.ok(detail.data.history.some(e=>e.event_type==='voided'));
  assert.equal((await api('DELETE',`/consultations/${ctx.consultationId}`,'admin',{reason:'Duplicate unpaid consultation entered'})).status,204);
});

test('billing locks a consultation doctor and date while allowing note corrections', async () => {
  const ctx=context('Locked visit dimensions');
  const original=await bill(ctx,fee(900));
  const changedDate='2026-08-30';
  const dateAttempt=await api('PUT',`/consultations/${ctx.consultationId}`,'admin',{
    doctor_id:doctorId,consultation_date:changedDate,doctor_notes:'Corrected note text',
  });
  assert.equal(dateAttempt.status,409,JSON.stringify(dateAttempt.data));
  assert.equal(dateAttempt.data.code,'BILLED_CONSULTATION_DIMENSIONS_LOCKED');
  const otherDoctor=Number(db.prepare("INSERT INTO doctors(full_name,specialization) VALUES ('Financial reassignment test','General Practice')").run().lastInsertRowid);
  const doctorAttempt=await api('PUT',`/consultations/${ctx.consultationId}`,'admin',{
    doctor_id:otherDoctor,consultation_date:today,doctor_notes:'Corrected note text',
  });
  assert.equal(doctorAttempt.status,409,JSON.stringify(doctorAttempt.data));
  const noteOnly=await api('PUT',`/consultations/${ctx.consultationId}`,'doctor',{
    consultation_date:today,doctor_notes:'Corrected note without changing financial dimensions',
  });
  assert.equal(noteOnly.status,200,JSON.stringify(noteOnly.data));
  assert.equal(noteOnly.data.doctor_notes,'Corrected note without changing financial dimensions');
  assert.equal(noteOnly.data.doctor_id,doctorId);
  assert.equal(noteOnly.data.consultation_date,today);
  assert.equal((await api('GET',`/billing/${original.data.id}`)).data.total_amount,900);
});

test('billing rejects negative, non-numeric, and fractional-cent amounts at API and database boundaries', async () => {
  for (const amount of [-1, 10.001, 'not-money', '']) {
    const ctx=context(`Invalid money ${String(amount)}`);
    const response=await bill(ctx,[{description:'Invalid amount',type:'Sale',amount}],{operation_id:randomUUID()});
    assert.equal(response.status,400,JSON.stringify(response.data));
    assert.match(response.data.error,/amount/i);
  }
  const stockItem=item('Zero quantity bypass medicine');
  for (const quantity of [0,-1,1.5,'not-a-quantity']) {
    const ctx=context(`Invalid stock quantity ${String(quantity)}`);
    const response=await bill(ctx,[{
      description:'Zero quantity bypass medicine',type:'Sale',inventory_item_id:stockItem.id,
      quantity,amount:25,
    }],{operation_id:randomUUID()});
    assert.equal(response.status,400,JSON.stringify(response.data));
    assert.match(response.data.error,/quantity/i);
  }
  assert.equal(row(stockItem.id).quantity,20);
  const ctx=context('Invalid money update'); const original=await bill(ctx,fee(800));
  assert.equal((await api('PUT',`/billing/${original.data.id}`,'admin',{
    items:[{description:'Invalid correction',type:'Sale',amount:-0.01}],
    correction_reason:'Invalid negative correction attempt',expected_version:original.data.row_version,
  })).status,400);
  assert.throws(()=>db.prepare(`INSERT INTO billing(consultation_id,patient_id,items,total_amount,status)
    VALUES (?,?,?,-1,'unpaid')`).run(ctx.consultationId,ctx.patientId,JSON.stringify(fee(-1))),/non-negative currency/);
  assert.throws(()=>db.prepare(`UPDATE billing SET items=?,total_amount=10.001 WHERE id=?`)
    .run(JSON.stringify(fee(10.001)),original.data.id),/non-negative currency/);
});

test('archived patients retain historical billing and revenue with existing doctor access scope', async () => {
  const ctx=context('Archive'); const original=await bill(ctx,fee(700),{status:'paid',payment_method:'cash',payment_date:today});
  const before=await report(); assert.equal((await api('DELETE',`/patients/${ctx.patientId}`,'admin',{reason:'Archive duplicate financial test patient'})).status,204);
  assert.equal((await report()).revenueStatement.paidRevenue,before.revenueStatement.paidRevenue);
  const detail=await api('GET',`/billing/${original.data.id}`,'doctor'); assert.equal(detail.status,200);
  assert.ok(detail.data.patient_archived_at);
  const list=await api('GET',`/billing?patientId=${ctx.patientId}`,'doctor'); assert.equal(list.data.length,1);
  const summary=await api('GET','/billing/patient-summary','doctor'); assert.ok(summary.data.some(r=>r.patient_id===ctx.patientId && r.paid_amount===700));
});

test('service charges cannot impersonate a stocked supply and bypass inventory', async () => {
  item('Protected saline ampoule');
  const bypass=await bill(context('Manual stock bypass'),[{
    description:'  protected   saline ampoule ',type:'Sale',amount:250,is_service_charge:true,
  }],{operation_id:randomUUID()});
  assert.equal(bypass.status,409,JSON.stringify(bypass.data));
  assert.equal(bypass.data.code,'STOCK_ITEM_REQUIRES_SELECTION');
  const typoBypass=await bill(context('Typo stock bypass'),[{
    description:'Protectd saline ampule',type:'Sale',amount:250,is_service_charge:true,
  }],{operation_id:randomUUID()});
  assert.equal(typoBypass.status,409,JSON.stringify(typoBypass.data));
  assert.equal(typoBypass.data.code,'STOCK_ITEM_REQUIRES_SELECTION');

  const service=await bill(context('Legitimate non-stock service'),[{
    description:'Home nursing coordination',type:'Sale',amount:250,is_service_charge:true,
  }],{operation_id:randomUUID()});
  assert.equal(service.status,201,JSON.stringify(service.data));
});

test('archived stock cannot be selected or billed and accountants cannot rewrite invoice lines', async () => {
  const archivedCtx=context('Archived catalogue item');
  const archived=item('Archived catalogue medicine');
  db.prepare("UPDATE inventory SET archived_at=CURRENT_TIMESTAMP WHERE id=?").run(archived.id);
  const options=await api('GET',`/billing/inventory-options/by-consultation/${archivedCtx.consultationId}`,'doctor');
  assert.equal(options.status,200,JSON.stringify(options.data));
  assert.ok(!options.data.some(entry=>entry.id===archived.id));
  const blocked=await bill(archivedCtx,[stockLine(archived)],{operation_id:randomUUID()});
  assert.equal(blocked.status,400,JSON.stringify(blocked.data));
  assert.equal(row(archived.id).quantity,20);

  const financeCtx=context('Finance role boundaries');
  const invoice=await bill(financeCtx,[standardFee()],{operation_id:randomUUID()});
  assert.equal(invoice.status,201,JSON.stringify(invoice.data));
  const edited=await api('PUT',`/billing/${invoice.data.id}`,'accountant',{
    items:[{...standardFee(),amount:1}],expected_version:invoice.data.row_version,
    correction_reason:'Finance should not rewrite charges',
  });
  assert.equal(edited.status,403,JSON.stringify(edited.data));
  const paid=await api('PATCH',`/billing/${invoice.data.id}/pay`,'accountant',{
    payment_method:'cash',payment_date:today,expected_version:invoice.data.row_version,
  });
  assert.equal(paid.status,200,JSON.stringify(paid.data));
  assert.equal(paid.data.total_amount,2000);
});

test("doctors cannot read another doctor's invoices through a shared patient", async () => {
  const ctx=context('Shared patient invoice privacy');
  const ownBill=await bill(ctx,[standardFee('Day Consultation',700)],{
    status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID(),
  });
  assert.equal(ownBill.status,201,JSON.stringify(ownBill.data));
  const otherDoctor=Number(db.prepare("INSERT INTO doctors(full_name,specialization) VALUES ('Other invoice doctor','General Practice')").run().lastInsertRowid);
  const appointmentId=Number(db.prepare("INSERT INTO appointments(patient_id,doctor_id,appointment_date,appointment_time,status) VALUES (?,?,?,'14:00','completed')").run(ctx.patientId,otherDoctor,today).lastInsertRowid);
  const consultationId=Number(db.prepare("INSERT INTO consultations(appointment_id,patient_id,doctor_id,consultation_date,doctor_notes) VALUES (?,?,?,?, 'Other doctor visit')").run(appointmentId,ctx.patientId,otherDoctor,today).lastInsertRowid);
  const foreignBillId=Number(db.prepare(`
    INSERT INTO billing(consultation_id,patient_id,items,total_amount,status,doctor_id_snapshot,doctor_name_snapshot)
    VALUES (?,?,?,?, 'unpaid',?, 'Other invoice doctor')
  `).run(consultationId,ctx.patientId,JSON.stringify(fee(650)),650,otherDoctor).lastInsertRowid);
  db.prepare(`
    UPDATE billing
    SET finalized_at=CURRENT_TIMESTAMP, issued_at=CURRENT_TIMESTAMP,
      doctor_id_snapshot=?, doctor_name_snapshot='Other invoice doctor'
    WHERE id=?
  `).run(otherDoctor,foreignBillId);
  const foreignVersion=db.prepare('SELECT row_version FROM billing WHERE id=?').get(foreignBillId).row_version;
  const foreignPayment=await api('PATCH',`/billing/${foreignBillId}/pay`,'operator',{
    amount:650,payment_method:'cash',payment_date:today,operation_id:randomUUID(),expected_version:foreignVersion,
  });
  assert.equal(foreignPayment.status,200,JSON.stringify(foreignPayment.data));

  const denied=await api('GET',`/billing/${foreignBillId}`,'doctor');
  assert.equal(denied.status,403,JSON.stringify(denied.data));
  const deniedCreate=await api('POST','/billing/test-support/create','doctor',{
    consultation_id:consultationId,patient_id:ctx.patientId,items:[standardFee()],status:'unpaid',
  });
  assert.equal(deniedCreate.status,403,JSON.stringify(deniedCreate.data));
  assert.equal(deniedCreate.data.code,'DOCTOR_CONSULTATION_SCOPE');
  const consultationOptions=await api('GET','/billing/consultation-options','doctor');
  assert.equal(consultationOptions.status,200);
  assert.equal(consultationOptions.data.some((entry)=>Number(entry.id)===consultationId),false);
  const visible=await api('GET',`/billing?patientId=${ctx.patientId}`,'doctor');
  assert.equal(visible.data.some((entry)=>entry.id===foreignBillId),false);
  const scopedSummary=await api('GET',`/billing/patient-summary?dateBasis=payment&dateFrom=${today}&dateTo=${today}`,'doctor');
  const scopedPatient=scopedSummary.data.find((entry)=>entry.patient_id===ctx.patientId);
  assert.ok(scopedPatient,JSON.stringify(scopedSummary.data));
  assert.equal(scopedPatient.total_billed,700);
  assert.equal(scopedPatient.gross_collected_amount,700);
  assert.equal(scopedPatient.paid_amount,700);
  assert.equal((await api('GET',`/billing/${foreignBillId}`,'admin')).status,200);
});

test('permanent deletion anonymizes a billed patient while preserving invoice and accounting snapshots', async () => {
  const ctx=context('Permanent financial retention');
  db.prepare("UPDATE patients SET insurance_provider='Corporate Partner', patient_id_number='ID-SECRET' WHERE id=?").run(ctx.patientId);
  const original=await bill(ctx,[standardFee('Review Consultation',2000)]);
  assert.equal(original.status,201,JSON.stringify(original.data));
  const invoiceNumber=original.data.invoice_number;
  const patientIdentifier=original.data.patient_identifier_snapshot;

  const purged=await api('DELETE',`/patients/${ctx.patientId}/permanent`,'admin');
  assert.equal(purged.status,200,JSON.stringify(purged.data));
  assert.equal(purged.data.financial_records_retained,true);

  const patient=db.prepare('SELECT * FROM patients WHERE id=?').get(ctx.patientId);
  assert.ok(patient);
  assert.ok(patient.deleted_at);
  assert.equal(patient.full_name,`Deleted patient #${ctx.patientId}`);
  assert.equal(patient.patient_identifier,`PURGED-${ctx.patientId}`);
  assert.equal(patient.patient_id_number,'');
  assert.equal(patient.contact_number,'');
  assert.equal(db.prepare('SELECT doctor_notes FROM consultations WHERE id=?').get(ctx.consultationId).doctor_notes,'');

  const retained=await api('GET',`/billing/${original.data.id}`,'admin');
  assert.equal(retained.status,200,JSON.stringify(retained.data));
  assert.equal(retained.data.invoice_number,invoiceNumber);
  assert.equal(retained.data.patient_name,'Deleted patient');
  assert.equal(retained.data.patient_identifier,patientIdentifier);
  assert.equal(retained.data.doctor_name,original.data.doctor_name);
  assert.equal(retained.data.consultation_date,original.data.consultation_date);
  assert.equal(retained.data.consultation_type_snapshot,'Review Consultation');
  assert.equal(retained.data.partner_category_snapshot,'Corporate Partner');
  assert.equal(retained.data.total_amount,2000);
});

test('payments validate dates, retry harmlessly, and remain immutable', async () => {
  const ctx=context('Payments'); const original=await bill(ctx,fee(800)); const url=`/billing/${original.data.id}`;
  const pay={payment_method:'cash',payment_date:'2026-08-31',expected_version:original.data.row_version,operation_id:randomUUID()};
  for(const date of ['not-a-date','2026-02-30','2026-13-01']) {
    assert.equal((await api('PATCH',url+'/pay','doctor',{...pay,payment_date:date})).status,400);
  }
  const paid=await api('PATCH',url+'/pay','doctor',pay); assert.equal(paid.status,200,JSON.stringify(paid.data));
  const n=paid.data.history.length;
  const retry=await api('PATCH',url+'/pay','doctor',pay); assert.equal(retry.status,200); assert.equal(retry.data.history.length,n);
  assert.equal((await api('PATCH',url+'/pay','doctor',{payment_method:'card',payment_date:'2026-09-01'})).status,409);
  const correction={items:paid.data.items,status:'paid',payment_method:'card',payment_date:'2026-09-01',expected_version:paid.data.row_version};
  assert.equal((await api('PUT',url,'admin',correction)).status,409);
  assert.equal((await api('PUT',url,'doctor',{...correction,correction_reason:'Corrected the collection date'})).status,409);
  const changed=await api('PUT',url,'admin',{...correction,correction_reason:'Corrected the collection date'});
  assert.equal(changed.status,409,JSON.stringify(changed.data));
  const transaction=db.prepare('SELECT * FROM billing_payment_transactions WHERE billing_id=?').get(original.data.id);
  assert.equal(transaction.amount,800);assert.equal(transaction.payment_method,'cash');assert.equal(transaction.payment_date,'2026-08-31');
  assert.throws(()=>db.prepare('UPDATE billing_payment_transactions SET payment_date=? WHERE id=?').run('2026-09-01',transaction.id),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM billing_payment_transactions WHERE id=?').run(transaction.id),/immutable/);
  assert.equal((await bill(context('Invalid paid create'),fee(),{status:'paid',payment_method:'cash',payment_date:'2026-02-30'})).status,400);
});

test('credit notes are immutable, idempotent, balance-limited and reduce net collections without restoring stock', async () => {
  const ctx=context('Formal credit note');
  const it=item('Refunded treatment medicine');
  const original=await bill(ctx,[standardFee(),stockLine(it,1)],{
    status:'paid',payment_method:'card',payment_date:today,operation_id:randomUUID(),
  });
  assert.equal(original.status,201,JSON.stringify(original.data));
  assert.equal(original.data.total_amount,2025);
  assert.equal(row(it.id).quantity,19);
  const before=await report(today,'payment');
  const operationId=randomUUID();
  const payload={
    amount:500,
    refund_method:'card',
    refund_date:today,
    reason:'Duplicate card charge confirmed by finance',
    external_reference:`CARD-REF-${fixtureIndex}`,
    operation_id:operationId,
  };

  assert.equal((await api('POST',`/billing/${original.data.id}/refunds`,'doctor',payload)).status,403);
  const issued=await api('POST',`/billing/${original.data.id}/refunds`,'admin',payload);
  assert.equal(issued.status,201,JSON.stringify(issued.data));
  assert.match(issued.data.credit_note.credit_note_number,/^OCS-CN-\d{8}$/);
  assert.equal(issued.data.credit_note.allocation_type,'service_non_stock');
  assert.equal(issued.data.credit_note.inventory_restored,false);
  assert.equal(issued.data.bill.total_amount,2025);
  assert.equal(issued.data.bill.refunded_amount,500);
  assert.equal(issued.data.bill.net_paid_amount,1525);
  assert.equal(row(it.id).quantity,19,'a financial refund must not invent a stock return');
  const firstAllocation=db.prepare('SELECT * FROM billing_refund_allocations WHERE refund_id=?').get(issued.data.credit_note.id);
  assert.equal(firstAllocation.allocation_type,'service_non_stock');
  assert.equal(firstAllocation.submission_id,null);
  assert.equal(firstAllocation.amount,500);

  const replay=await api('POST',`/billing/${original.data.id}/refunds`,'admin',payload);
  assert.equal(replay.status,201,JSON.stringify(replay.data));
  assert.equal(replay.data.credit_note.id,issued.data.credit_note.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_refunds WHERE billing_id=?').get(original.data.id).count,1);
  const reusedReference=await api('POST',`/billing/${original.data.id}/refunds`,'admin',{
    ...payload,operation_id:randomUUID(),
  });
  assert.equal(reusedReference.status,409,JSON.stringify(reusedReference.data));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_refunds WHERE billing_id=?').get(original.data.id).count,1);
  const legitimateSecondRefund=await api('POST',`/billing/${original.data.id}/refunds`,'admin',{
    ...payload,external_reference:`CARD-REF-SECOND-${fixtureIndex}`,operation_id:randomUUID(),
  });
  assert.equal(legitimateSecondRefund.status,201,JSON.stringify(legitimateSecondRefund.data));
  assert.notEqual(legitimateSecondRefund.data.credit_note.id,issued.data.credit_note.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_refunds WHERE billing_id=?').get(original.data.id).count,2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_refund_allocations WHERE billing_id=? AND allocation_type=?').get(original.data.id,'service_non_stock').count,2);
  const downgrade=await api('PUT',`/billing/${original.data.id}`,'admin',{
    items:issued.data.bill.items,status:'unpaid',expected_version:issued.data.bill.row_version,
    correction_reason:'Attempt to reopen a refunded paid invoice',
  });
  assert.equal(downgrade.status,409,JSON.stringify(downgrade.data));
  const reducedItems=issued.data.bill.items.map((line,index)=>index===0?{...line,amount:100}:line);
  const reduced=await api('PUT',`/billing/${original.data.id}`,'admin',{
    items:reducedItems,status:'paid',payment_method:'card',payment_date:today,
    expected_version:issued.data.bill.row_version,correction_reason:'Attempt to reduce a refunded invoice',
  });
  assert.equal(reduced.status,409,JSON.stringify(reduced.data));
  assert.throws(
    ()=>db.prepare("UPDATE billing SET status='unpaid' WHERE id=?").run(original.data.id),
    /Paid invoice financial lines are immutable/,
  );
  assert.equal((await api('POST',`/billing/${original.data.id}/refunds`,'admin',{
    ...payload,amount:1600,external_reference:'SECOND-OVER-REFUND',operation_id:randomUUID(),
  })).status,409);

  const listed=(await api('GET',`/billing?patientId=${ctx.patientId}`,'admin')).data[0];
  assert.equal(listed.refunded_amount,1000);
  assert.equal(listed.net_paid_amount,1025);
  const summary=(await api('GET','/billing/patient-summary','admin')).data.find(entry=>entry.patient_id===ctx.patientId);
  assert.equal(summary.paid_amount,1025);
  assert.equal(summary.refunded_amount,1000);
  const after=await report(today,'payment');
  assert.equal(after.revenueStatement.paidRevenue,before.revenueStatement.paidRevenue-1000);
  assert.equal(after.revenueStatement.refundedRevenue,before.revenueStatement.refundedRevenue+1000);
  assert.throws(()=>db.prepare('UPDATE billing_refunds SET reason=? WHERE id=?').run('Changed later',issued.data.credit_note.id),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM billing_refunds WHERE id=?').run(issued.data.credit_note.id),/immutable/);
  assert.throws(()=>db.prepare('UPDATE billing_refund_allocations SET amount=1 WHERE refund_id=?').run(issued.data.credit_note.id),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM billing_refund_allocations WHERE refund_id=?').run(issued.data.credit_note.id),/immutable/);
});

test('billing wastage requires an explicit reason and consumes only the confirmed batch', async () => {
  const ctx=context('Traced billing wastage');
  const it=item('Traced wastage medicine',10);
  db.prepare('UPDATE inventory_batches SET unit_cost=7 WHERE id=?').run(it.batchId);
  const otherBatchId=Number(db.prepare("INSERT INTO inventory_batches (item_id,quantity_remaining,expiry_date,unit_cost,is_non_expiring,status) VALUES (?,?, '2030-06-30',10,0,'usable')").run(it.id,3).lastInsertRowid);
  db.prepare('UPDATE inventory SET quantity=13 WHERE id=?').run(it.id);
  const options=await api('GET',`/billing/inventory-options/by-consultation/${ctx.consultationId}`,'doctor');
  const option=options.data.find(entry=>entry.id===it.id);
  assert.ok(option.batches.some(batch=>batch.id===it.batchId));
  assert.ok(option.batches.some(batch=>batch.id===otherBatchId));

  const baseLine={description:'Traced wastage medicine',type:'Wastage',inventory_item_id:it.id,quantity:2,amount:0};
  const missingReason=await bill(ctx,[baseLine],{operation_id:randomUUID()});
  assert.equal(missingReason.status,400);
  assert.equal(row(it.id).quantity,13);
  const missingBatch=await bill(ctx,[{...baseLine,wastage_reason:'Ampoule broke during setup'}],{operation_id:randomUUID()});
  assert.equal(missingBatch.status,400);
  assert.equal(row(it.id).quantity,13);

  const recorded=await bill(ctx,[{
    ...baseLine,
    wastage_reason:'Ampoule broke during treatment setup',
    batch_id:it.batchId,
  }],{operation_id:randomUUID()});
  assert.equal(recorded.status,201,JSON.stringify(recorded.data));
  assert.equal(recorded.data.total_amount,0,'wastage must not be charged to the patient');
  assert.equal(recorded.data.items[0].amount,14,'wastage uses the confirmed batch cost, not the mutable catalogue cost');
  assert.equal(row(it.id).quantity,11);
  assert.equal(db.prepare('SELECT quantity_remaining FROM inventory_batches WHERE id=?').get(it.batchId).quantity_remaining,8);
  assert.equal(db.prepare('SELECT quantity_remaining FROM inventory_batches WHERE id=?').get(otherBatchId).quantity_remaining,3);
  const movement=db.prepare("SELECT * FROM inventory_movements WHERE item_id=? AND action_type='wastage' ORDER BY id DESC LIMIT 1").get(it.id);
  const meta=JSON.parse(movement.meta_json);
  assert.equal(meta.wastage_reason,'Ampoule broke during treatment setup');
  assert.equal(meta.selected_batch_id,it.batchId);
  assert.equal(meta.allocations[0].batch_id,it.batchId);
});

test('patient billing output contains chargeable lines only and keeps invoice and payment dates distinct', () => {
  const items=[
    standardFee('Day Consultation',2000),
    {description:'Broken ampoule',type:'Wastage',amount:15,quantity:1,inventory_item_id:999},
    {description:'Internal stock correction',type:'Adjustment',amount:10,quantity:1,inventory_item_id:998},
  ];
  assert.deepEqual(patientChargeableBillingItems(items).map(item=>item.description),['Day Consultation']);
  const serialized=serializePatientBillingRows([{
    id:999,total_amount:2000,status:'paid',items:JSON.stringify(items),
    issued_at:'2026-09-01 10:00:00',created_at:'2026-09-01 09:59:00',
    consultation_date:'2026-08-31',payment_date:'2026-09-03',
    payment_received_amount:2000,payment_balance_amount:0,refunded_amount:0,
  }]);
  assert.equal(serialized.bills[0].items_summary,'Day Consultation');
  assert.equal(serialized.bills[0].date,'2026-09-01 10:00:00');
  assert.equal(serialized.bills[0].invoice_date,'2026-09-01 10:00:00');
  assert.equal(serialized.bills[0].consultation_date,'2026-08-31');
  assert.equal(serialized.bills[0].last_payment_date,'2026-09-03');
});

test('payment-date reporting posts a credit note on its refund date without rewriting the original collection day', async () => {
  const yesterday=offsetLocalDate(-1);
  const ctx=context('Later period refund',yesterday);
  const original=await bill(ctx,[standardFee()],{
    status:'paid',payment_method:'juice',payment_date:yesterday,operation_id:randomUUID(),
  });
  assert.equal(original.status,201,JSON.stringify(original.data));
  const yesterdayBefore=await report(yesterday,'payment');
  const todayBefore=await report(today,'payment');
  const credited=await api('POST',`/billing/${original.data.id}/refunds`,'accountant',{
    amount:600,refund_method:'juice',refund_date:today,
    reason:'Partial refund agreed after finance review',external_reference:`JUICE-REFUND-${fixtureIndex}`,operation_id:randomUUID(),
  });
  assert.equal(credited.status,201,JSON.stringify(credited.data));
  const yesterdayAfter=await report(yesterday,'payment');
  const todayAfter=await report(today,'payment');
  assert.equal(yesterdayAfter.revenueStatement.paidRevenue,yesterdayBefore.revenueStatement.paidRevenue);
  assert.equal(todayAfter.revenueStatement.paidRevenue,todayBefore.revenueStatement.paidRevenue-600);
  assert.equal(todayAfter.revenueStatement.refundedRevenue,todayBefore.revenueStatement.refundedRevenue+600);
  const juice=todayAfter.revenueStatement.paymentMethodBreakdown.find(row=>row.method==='juice');
  const juiceBefore=todayBefore.revenueStatement.paymentMethodBreakdown.find(row=>row.method==='juice');
  assert.equal(juice.amount,juiceBefore.amount-600);
  const refundDoctor=todayAfter.doctorReport.rows.find(row=>row.doctor_id===doctorId);
  assert.ok(refundDoctor,'a refund-only period must retain the responsible doctor row');
  const refundDoctorBefore=todayBefore.doctorReport.rows.find(row=>row.doctor_id===doctorId);
  assert.equal(refundDoctor.paid,Number(refundDoctorBefore?.paid || 0)-600);
  const creditNote=todayAfter.billingRevenueReport.creditNotes.find(row=>row.billing_id===original.data.id);
  assert.ok(creditNote,'payment-period exports need the underlying credit-note detail');
  assert.equal(creditNote.reason,'Partial refund agreed after finance review');
});

test('historical movement prices and allocation costs remain stable after catalogue edits', async () => {
  const ctx=context('Prices'); const it=item('Snapshot price medicine');
  db.prepare('UPDATE inventory_batches SET unit_cost=7 WHERE id=?').run(it.batchId);
  const created=await bill(ctx,[stockLine(it)]); assert.equal(created.status,201);
  const history=async()=>(await api('GET','/inventory/activity-history?search=Snapshot%20price%20medicine')).data;
  const before=await history(); assert.equal(before.rows[0].value_rs,50); assert.equal(before.analytics.total_value_cost_rs,14);
  assert.equal((await api('PUT',`/inventory/items/${it.id}?doctorId=${doctorId}`,'admin',{
    cost_price:40,selling_price:100,adjustment_note:'Supplier price list updated for this catalogue item',
  })).status,200);
  const after=await history(); assert.equal(after.rows[0].value_rs,50); assert.equal(after.analytics.total_value_cost_rs,14);
  require('../src/lib/financialIntegritySchema').ensureFinancialIntegritySchema(db);
  assert.equal((await history()).rows[0].value_rs,50);
});

function deduction(it, extra={}) {return {action_type:'stock_out',reason:'Wasted',quantity:1,batch_id:it.batchId,note:'Packaging was damaged during transport',expected_version:row(it.id).row_version,operation_id:randomUUID(),...extra};}

test('doctor stock-out losses enter loss metrics and filters; operation receipts prevent replay', async () => {
  const it=item('Loss metric medicine'); const body=deduction(it,{quantity:2}); const url=`/inventory/items/${it.id}/actions`;
  const first=await api('POST',url,'doctor',body); assert.equal(first.status,201,JSON.stringify(first.data));
  assert.equal((await api('POST',url,'doctor',body)).status,201); assert.equal(row(it.id).quantity,18);
  const history=(await api('GET','/inventory/activity-history?search=Loss%20metric%20medicine&actions=wastage')).data;
  assert.equal(history.total,1); assert.equal(history.analytics.wastage_value_rs,20);
  assert.equal(db.prepare('SELECT SUM(a.quantity) AS qty FROM inventory_movement_allocations a JOIN inventory_movements m ON m.id=a.movement_id WHERE m.item_id=?').get(it.id).qty,2);
});

test('two queued deductions for one item both sync; a lost-response retry does not deduct again', async () => {
  const it=item('Offline medicine'); const version=row(it.id).row_version;
  const entries=[1,2].map(id=>({id,kind:'inventory_deduct',method:'POST',endpoint:`/inventory/items/${it.id}/actions`,payload:deduction(it,{expected_version:version}),meta:{itemId:it.id,itemName:'Offline medicine'}}));
  // Simulate the first request committing while the response was lost.
  assert.equal((await api('POST',entries[0].endpoint,'doctor',entries[0].payload)).status,201);
  class ApiError extends Error {constructor(result){super(result.data.error);this.status=result.status;this.data=result.data;}}
  const sandbox={console,Number,Set,Promise,CustomEvent:class{},window:{dispatchEvent(){}},ApiError,toast:{error(){},success(){}},isBrowserOffline:()=>false,isNetworkFailure:()=>false,notifyDoctorBagInventoryUpdated(){},listOfflineMutations:async()=>entries.slice(),countOfflineMutations:async()=>entries.length,removeOfflineMutation:async id=>entries.splice(entries.findIndex(e=>e.id===id),1),enqueueOfflineMutation:async e=>e,api:{post:async(endpoint,payload)=>{const r=await api('POST',endpoint,'doctor',payload);if(r.status>=400)throw new ApiError(r);return r.data;}}};
  const source=fs.readFileSync(path.resolve(__dirname,'../../client/src/lib/inventoryOfflineSync.js'),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'').replace(/\bexport\s+/g,'');
  vm.runInNewContext(source+'\n globalThis.auditFns={setOfflineQueueUserContext,flushOfflineQueue};',sandbox);
  sandbox.auditFns.setOfflineQueueUserContext(1);
  const [a,b]=await Promise.all([sandbox.auditFns.flushOfflineQueue(),sandbox.auditFns.flushOfflineQueue()]);
  assert.equal(a.synced,2); assert.equal(a.remaining,0); assert.equal(b.synced,2); assert.equal(row(it.id).quantity,18);
});

test('payment-date drilldown and summary retain date basis and doctor scope', async () => {
  const ctx=context('Drilldown','2026-08-10');
  const original=await bill(ctx,fee(900),{status:'paid',payment_method:'cash',payment_date:'2026-09-09'});
  const qs=`dateFrom=2026-09-01&dateTo=2026-09-30&dateBasis=payment&patientId=${ctx.patientId}&doctorId=${doctorId}`;
  const list=await api('GET','/billing?'+qs); assert.equal(list.status,200,JSON.stringify(list.data));
  assert.ok(list.data.some(b=>b.id===original.data.id));
  const summary=await api('GET','/billing/patient-summary?'+qs); assert.ok(summary.data.some(p=>p.patient_id===ctx.patientId && p.paid_amount===900));
  assert.equal((await api('GET',`/billing?${qs}&status=unpaid`)).data.length,0);
  const beforePartial=await report('2026-09-09','payment',doctorId);
  const payment=original.data.payments.find(entry=>entry.entry_type==='payment');
  const reversed=await api('POST',`/billing/${original.data.id}/payments/${payment.payment_transaction_id}/reverse`,'accountant',{
    reversal_date:'2026-09-09',reason:'Reopen the invoice to verify payment-basis outstanding reporting',operation_id:randomUUID(),
  });
  assert.equal(reversed.status,201,JSON.stringify(reversed.data));
  const partial=await api('PATCH',`/billing/${original.data.id}/pay`,'accountant',{
    amount:300,payment_method:'cash',payment_date:'2026-09-09',operation_id:randomUUID(),expected_version:reversed.data.bill.row_version,
  });
  assert.equal(partial.status,200,JSON.stringify(partial.data));
  assert.equal(partial.data.payment_balance_amount,600);
  const unpaidList=await api('GET',`/billing?${qs}&status=unpaid`);
  assert.ok(unpaidList.data.some(entry=>entry.id===original.data.id));
  const afterPartial=await report('2026-09-09','payment',doctorId);
  assert.equal(afterPartial.revenueStatement.unpaidRevenue,beforePartial.revenueStatement.unpaidRevenue+600);
});

test('transport counts each visit, not unique patients or invoices, and excludes voided consultations', async () => {
  const date=offsetLocalDate(-30); const ctx=context('Transport',date);
  const appointmentId=Number(db.prepare("INSERT INTO appointments(patient_id,doctor_id,appointment_date,appointment_time,status) VALUES (?,?,?,'17:00','completed')").run(ctx.patientId,doctorId,date).lastInsertRowid);
  const second=Number(db.prepare("INSERT INTO consultations(appointment_id,patient_id,doctor_id,consultation_date,doctor_notes) VALUES (?,?,?,?,'Review visit')").run(appointmentId,ctx.patientId,doctorId,date).lastInsertRowid);
  const a=await bill(ctx,fee(2000),{status:'paid',payment_method:'cash',payment_date:date}); assert.equal(a.status,201);
  await bill({...ctx,consultationId:second},fee(2000));
  await bill(ctx,fee(100),{operation_id:randomUUID()});
  const r=await report(date); assert.equal(r.revenueStatement.transportVisitCount,2);
  assert.equal(r.revenueStatement.transportBenefits,600); assert.equal(r.revenueStatement.doctorCommission,800);
  assert.equal(r.revenueStatement.doctorNetRevenue,1400);
  assert.equal(r.doctorReport.rows.find(row=>row.doctor_id===doctorId).transportBenefits,600);
  await api('DELETE',`/consultations/${second}`,'admin',{reason:'Duplicate review consultation entry'});
  assert.equal((await report(date)).revenueStatement.transportBenefits,300);
});

test('stock history filters use Mauritius calendar days and CSV uses the same selection', async () => {
  const it=item('Midnight medicine'); await api('POST',`/inventory/items/${it.id}/actions`,'doctor',deduction(it));
  db.prepare("UPDATE inventory_activity_history SET timestamp='2026-09-08 21:00:00' WHERE movement_id IN (SELECT id FROM inventory_movements WHERE item_id=?)").run(it.id);
  const history=await api('GET','/inventory/activity-history?search=Midnight%20medicine&dateFrom=2026-09-09&dateTo=2026-09-09');
  assert.equal(history.data.total,1);
  assert.equal((await api('GET','/inventory/activity-history?search=Midnight%20medicine&dateFrom=2026-09-08&dateTo=2026-09-08')).data.total,0);
});


test('monthly transport equals the sum of days for repeat visits by the same doctor', async () => {
  const ctx=context('Monthly transport','2027-02-10');
  const secondAppointment=Number(db.prepare("INSERT INTO appointments(patient_id,doctor_id,appointment_date,appointment_time,status) VALUES (?,?,'2027-02-12','11:00','completed')").run(ctx.patientId,doctorId).lastInsertRowid);
  db.prepare("INSERT INTO consultations(appointment_id,patient_id,doctor_id,consultation_date,doctor_notes) VALUES (?,?,?,'2027-02-12','Follow up performed')").run(secondAppointment,ctx.patientId,doctorId);
  const day1=await report('2027-02-10'); const day2=await report('2027-02-12');
  const month=await api('GET',`/dashboard/live-report?doctorPeriod=monthly&doctorDate=2027-02-10&doctorId=${doctorId}`);
  assert.equal(month.data.revenueStatement.transportBenefits,600);
  assert.equal(month.data.revenueStatement.transportBenefits,day1.revenueStatement.transportBenefits+day2.revenueStatement.transportBenefits);
});

test('failed invoice creation does not reserve the retry key or partially deduct stock', async () => {
  const ctx=context('Atomic retry'); const it=item('Atomic retry medicine',1); const operation_id=randomUUID();
  const failed=await bill(ctx,[stockLine(it,2)],{operation_id}); assert.equal(failed.status,409);
  assert.equal(row(it.id).quantity,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operation_receipts WHERE operation_id=?').get(operation_id).n,0);
  db.prepare('UPDATE inventory SET quantity=3 WHERE id=?').run(it.id);
  db.prepare('UPDATE inventory_batches SET quantity_remaining=3 WHERE id=?').run(it.batchId);
  const retried=await bill(ctx,[stockLine(it,2)],{operation_id}); assert.equal(retried.status,201);
  assert.equal(row(it.id).quantity,1);
});

test('offline queue does not acknowledge a saved deduction before IndexedDB commits', async () => {
  let transaction;
  const sandbox={console,crypto:{randomUUID},Date,Promise,window:{},indexedDB:{open(){
    const request={};
    queueMicrotask(()=>{
      request.result={close(){},transaction(){
        transaction={objectStore:()=>({put(){}}),abort(){this.onabort?.();}};
        return transaction;
      }};
      request.onsuccess();
    });
    return request;
  }}};
  const source=fs.readFileSync(path.resolve(__dirname,'../../client/src/lib/offlineQueue.js'),'utf8').replace(/\bexport\s+/g,'');
  vm.runInNewContext(source+'\n globalThis.enqueue = enqueueOfflineMutation;',sandbox);
  let acknowledged=false;
  const save=sandbox.enqueue({kind:'inventory_deduct',userId:1,payload:{quantity:1}}).then(()=>{acknowledged=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(transaction); assert.equal(acknowledged,false);
  transaction.oncomplete(); await save; assert.equal(acknowledged,true);
});

test('current tariffs migrate once without repricing bills, and automatic fees require review', async () => {
  const fees=(await api('GET','/billing/consultation-fees','doctor')).data;
  assert.equal(fees['Day Consultation'],2000);assert.equal(fees['Night Consultation'],3000);assert.equal(fees['Review Consultation'],2000);
  const ctx=context('Automatic fee review');db.prepare('DELETE FROM consultations WHERE id=?').run(ctx.consultationId);
  const created=await api('POST','/consultations','doctor',{appointment_id:ctx.appointmentId,consultation_date:today,doctor_notes:'Saved consultation for fee review'});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const state=await api('GET',`/billing/visit/${created.data.id}`,'doctor'); const original=state.data.bills[0];
  assert.equal(original.total_amount,2000);assert.equal(original.fee_review_required,1);
  assert.equal(original.history[0].actor_name,'Integrity doctor');
  const pay={payment_method:'cash',payment_date:today};
  assert.equal((await api('PATCH',`/billing/${original.id}/pay`,'doctor',pay)).status,409);
  const items=original.items.map(i=>({...i,description:'Night Consultation',amount:3000}));
  const confirmed=await api('PUT',`/billing/${original.id}`,'doctor',{items,status:'unpaid',confirm_consultation_fee:true,expected_version:original.row_version});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));assert.equal(confirmed.data.total_amount,3000);assert.equal(confirmed.data.fee_review_required,0);
  const finalized=await api('POST',`/billing/quick/visits/${created.data.id}/capture`,'doctor',{
    operation_id:randomUUID(),...quickIssueFields('TARIFF'),consultation_fee:{type:'Night Consultation',amount:3000},items:[],
  });
  assert.equal(finalized.status,201,JSON.stringify(finalized.data));
  const finalBill=(await api('GET',`/billing/${original.id}`,'doctor')).data;
  assert.equal(finalBill.status,'paid');
  assert.equal(finalBill.payment_received_amount,3000);
  assert.equal(finalBill.payment_balance_amount,0);
  const actionQueue=await api('GET','/billing/quick/operator-queue?status=actionable','operator');
  assert.equal(actionQueue.data.submissions.some(entry=>entry.bill_id===original.id),false);
  const duplicate=await bill({...ctx,consultationId:created.data.id},fee(2000),{operation_id:randomUUID()});
  assert.equal(duplicate.status,409);assert.equal(duplicate.data.existing_bill_id,original.id);
  const additional=await bill({...ctx,consultationId:created.data.id},[{description:'Additional procedure',type:'Sale',amount:100,is_service_charge:true}],{operation_id:randomUUID()});assert.equal(additional.status,201);
  db.prepare("UPDATE consultation_fee_types SET default_amount=2100 WHERE type_name='Day Consultation'").run();
  require('../src/lib/financialIntegritySchema').ensureFinancialIntegritySchema(db);
  assert.equal(db.prepare("SELECT default_amount FROM consultation_fee_types WHERE type_name='Day Consultation'").get().default_amount,2100);
  assert.equal((await api('GET',`/billing/${original.id}`)).data.total_amount,3000);
  db.prepare("UPDATE consultation_fee_types SET default_amount=2000 WHERE type_name='Day Consultation'").run();
});

test('explicit consultation types create the correct fee and concurrent fee creation is unique', async () => {
  const ctx=context('Review type');db.prepare('DELETE FROM consultations WHERE id=?').run(ctx.consultationId);
  const c=await api('POST','/consultations','doctor',{appointment_id:ctx.appointmentId,consultation_date:today,doctor_notes:'Review consultation',consultation_type:'Review Consultation'});
  assert.equal(c.status,201);const b=(await api('GET',`/billing/visit/${c.data.id}`,'doctor')).data.bills[0];
  assert.equal(b.items[0].description,'Review Consultation');assert.equal(b.total_amount,2000);assert.equal(b.fee_review_required,0);
  const separate=context('Concurrent fee');
  const results=await Promise.all([bill(separate,fee(2000),{operation_id:randomUUID()}),bill(separate,fee(2000),{operation_id:randomUUID()})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
});

async function fieldSale(ctx,it,extra={}) {
  return api('POST',`/inventory/items/${it.id}/actions`,'doctor',deduction(it,{
    reason:'Sale',patient_id:ctx.patientId,consultation_id:ctx.consultationId,quantity:2,...extra,
  }));
}

test('eight-day-old dispensing links by its visit and keeps its original price without stock deduction', async () => {
  const date=db.prepare("SELECT date('now','+4 hours','-8 days') AS day").get().day;
  const ctx=context('Delayed same visit',date);const it=item('Delayed linked medicine');
  assert.equal((await fieldSale(ctx,it,{dispensed_on:date})).status,201);
  const datedHistory=await api('GET',`/inventory/activity-history?dateFrom=${date}&dateTo=${date}&search=Delayed%20linked%20medicine`);
  assert.equal(datedHistory.status,200,JSON.stringify(datedHistory.data));assert.equal(datedHistory.data.total,1);
  assert.equal(db.prepare("SELECT date(created_at,'+4 hours') AS day FROM inventory_movements WHERE item_id=?").get(it.id).day,today);
  await api('PUT',`/inventory/items/${it.id}?doctorId=${doctorId}`,'admin',{selling_price:100});
  const first=await bill(ctx,[stockLine(it)],{operation_id:randomUUID()});assert.equal(first.status,201,JSON.stringify(first.data));
  assert.equal(first.data.total_amount,50);assert.equal(row(it.id).quantity,18);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE item_id=?').get(it.id).n,1);
  const h=(await api('GET','/inventory/activity-history?search=Delayed%20linked%20medicine')).data.rows[0];
  assert.equal(h.billing_id,first.data.id);assert.equal(h.billing_status,'Billed');assert.equal(h.value_rs,50);
  assert.equal(JSON.parse(h.meta_json).billing_status,'Pending Manual Entry'); // original event is retained
  assert.ok(first.data.items[0].dispensing_movement_ids.length);
});

test('consultation-linked dispensing removes visit ambiguity while partial and cross-visit reuse stay blocked', async () => {
  const ctx=context('Ambiguous visits');const it=item('Ambiguous medicine');
  const secondAppointment=Number(db.prepare("INSERT INTO appointments(patient_id,doctor_id,appointment_date,appointment_time,status) VALUES (?,?,?,'18:00','completed')").run(ctx.patientId,doctorId,today).lastInsertRowid);
  const secondId=Number(db.prepare("INSERT INTO consultations(appointment_id,patient_id,doctor_id,consultation_date,doctor_notes) VALUES (?,?,?,?,'Second visit')").run(secondAppointment,ctx.patientId,doctorId,today).lastInsertRowid);
  const missingVisit=await fieldSale(ctx,it,{consultation_id:null});
  assert.equal(missingVisit.status,400);assert.equal(missingVisit.data.code,'CONSULTATION_REQUIRED');assert.equal(row(it.id).quantity,20);
  assert.equal((await fieldSale(ctx,it)).status,201);
  const m=db.prepare('SELECT id FROM inventory_movements WHERE item_id=?').get(it.id).id;
  const line={...stockLine(it),dispensing_movement_ids:[m]};
  assert.equal((await bill(ctx,[{...line,quantity:1}],{operation_id:randomUUID()})).status,409);assert.equal(row(it.id).quantity,18);
  const op=randomUUID();const accepted=await bill(ctx,[stockLine(it)],{operation_id:op});assert.equal(accepted.status,201,JSON.stringify(accepted.data));
  assert.equal((await bill(ctx,[stockLine(it)],{operation_id:op})).data.id,accepted.data.id);
  assert.equal((await bill({...ctx,consultationId:secondId},[line],{operation_id:randomUUID()})).status,409);
  const other=context('Other patient');assert.equal((await bill(other,[line],{operation_id:randomUUID()})).status,409);
  assert.equal(row(it.id).quantity,18);
});

test('consultation-linked pending attachment uses frozen sale price and invoice void requires a physical disposition', async () => {
  const ctx=context('Pending automatic');const it=item('Frozen pending medicine');
  await fieldSale(ctx,it,{dispensed_on:today});await api('PUT',`/inventory/items/${it.id}?doctorId=${doctorId}`,'admin',{selling_price:100});
  const created=await bill(ctx,[standardFee(),stockLine(it)],{operation_id:randomUUID()});assert.equal(created.status,201,JSON.stringify(created.data));
  const b=(await api('GET',`/billing/visit/${ctx.consultationId}`,'doctor')).data.bills[0];
  assert.equal(b.total_amount,2050);assert.equal(row(it.id).quantity,18);
  const h=(await api('GET','/inventory/activity-history?search=Frozen%20pending%20medicine')).data.rows[0];assert.equal(h.billing_id,b.id);assert.equal(h.value_rs,50);
  const missingDisposition=await api('DELETE',`/consultations/${ctx.consultationId}`,'admin',{reason:'Duplicate clinical note in test'});
  assert.equal(missingDisposition.status,409);assert.equal(missingDisposition.data.code,'FIELD_SALE_DISPOSITION_REQUIRED');
  assert.equal((await api('DELETE',`/consultations/${ctx.consultationId}`,'admin',{reason:'Duplicate clinical note in test',field_sale_disposition:'consumed_or_wasted'})).status,204);
  assert.equal(row(it.id).quantity,18);
  assert.equal(JSON.parse(db.prepare("SELECT meta_json FROM inventory_movements WHERE item_id=? AND action_type='stock_out'").get(it.id).meta_json).billing_status,'Voided - Consumed/Wasted');
  const review=(await api('GET','/billing/reconciliation','doctor')).data;
  assert.ok(!review.issues.some(i=>i.type==='unbilled_dispensing'&&i.movement_id===h.movement_id));assert.equal(review.stock,undefined);
});

test('sale, price changes and reversal reconcile financial aggregates and sale-filter CSV', async () => {
  const ctx=context('Net reversal');const it=item('Net reversal medicine');
  const b=await bill(ctx,[stockLine(it)]);assert.equal(b.status,201);
  const summary=async()=> (await api('GET',`/inventory?doctorId=${doctorId}`)).data.summary.total_monthly_sales_rs;
  const before=await summary();await api('PUT',`/inventory/items/${it.id}?doctorId=${doctorId}`,'admin',{selling_price:100});assert.equal(await summary(),before);
  assert.equal((await api('DELETE',`/consultations/${ctx.consultationId}`,'admin',{reason:'Synthetic net reversal test'})).status,204);
  assert.equal(await summary(),before-50);
  const h=(await api('GET','/inventory/activity-history?search=Net%20reversal%20medicine&actions=sell')).data;
  assert.equal(h.total,2);assert.equal(h.net_value_rs,0);assert.equal(h.analytics.net_sales_rs,0);assert.equal(h.analytics.total_value_cost_rs,0);assert.equal(h.analytics.gross_margin_pct,null);
  const csv=await api('GET','/inventory/activity-history/export.csv?search=Net%20reversal%20medicine&actions=sell');assert.equal(csv.status,200);assert.ok(csv.data.includes('-50.00'));assert.ok(csv.data.includes('Invoice number'));
});

test('admin can void an unpaid duplicate service bill without losing the visit or stock', async () => {
  const ctx=context('Duplicate resolution');const b=await bill(ctx,fee(2000));
  const duplicateId=Number(db.prepare("INSERT INTO billing(consultation_id,patient_id,items,total_amount,status) VALUES (?,?,?,2000,'unpaid')").run(ctx.consultationId,ctx.patientId,JSON.stringify(fee(2000))).lastInsertRowid);
  const review=await api('GET','/billing/reconciliation');assert.ok(review.data.issues.some(i=>i.type==='duplicate_fee'&&i.bill_ids.includes(duplicateId)));
  const duplicate=(await api('GET',`/billing/${duplicateId}`)).data;
  const body={reason:'Duplicate consultation fee confirmed',expected_version:duplicate.row_version};
  assert.equal((await api('POST',`/billing/${duplicateId}/void`,'doctor',body)).status,403);
  assert.equal((await api('POST',`/billing/${duplicateId}/void`,'admin',{...body,expected_version:99})).status,409);
  const resolved=await api('POST',`/billing/${duplicateId}/void`,'admin',body);assert.equal(resolved.status,200);assert.ok(resolved.data.voided_at);assert.equal(resolved.data.history[0].actor_name,'Integrity admin');
  assert.equal(db.prepare('SELECT voided_at FROM consultations WHERE id=?').get(ctx.consultationId).voided_at,null);
  assert.ok(!(await api('GET','/billing/reconciliation')).data.issues.some(i=>i.type==='duplicate_fee'&&i.bill_ids.includes(duplicateId)));
  assert.equal((await api('GET',`/billing/${b.data.id}`)).data.total_amount,2000);
});

test('reconnect refreshes financial, inventory and supply views and ignores an obsolete stream', async () => {
  const events=[],sources=[],timers=new Map();let timerId=0;
  class FakeSource {constructor(){this.handlers={};sources.push(this);}addEventListener(name,fn){this.handlers[name]=fn;}close(){}}
  const sandbox={console,Set,Number,String,Boolean,Promise,EventSource:FakeSource,window:{setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}},api:{post:async()=>({token:'synthetic'})},getStoredAuthToken:()=> 'synthetic',resolveApiPath:x=>x,getClientSessionId:()=> 'tab-test',DOCTOR_BAG_INVENTORY_EVENT:'bag',OCS_INVENTORY_EVENT:'ocs'};
  for(const name of ['notifyDoctorBagInventoryUpdated','notifyLinkhamClaimsUpdated','notifyLinkhamPatientsUpdated','notifyLongTermReviewUpdated','notifyOcsInventoryUpdated','notifyPatientsLiveUpdated','notifySupplyRequestsUpdated'])sandbox[name]=()=>events.push(name);
  const source=fs.readFileSync(path.resolve(__dirname,'../../client/src/lib/inventoryRealtimeSync.js'),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'').replace(/\bexport\s+/g,'');
  vm.runInNewContext(source+'\nglobalThis.start=startInventoryRealtimeSync;',sandbox);
  sandbox.start({role:'doctor',id:1,doctor_id:1});await new Promise(r=>setImmediate(r));sources[0].handlers.connected();events.length=0;
  sources[0].onerror();for(const fn of [...timers.values()])fn();await new Promise(r=>setImmediate(r));sources[1].handlers.connected();
  assert.ok(events.includes('notifyPatientsLiveUpdated'));assert.ok(events.includes('notifyDoctorBagInventoryUpdated'));assert.ok(events.includes('notifySupplyRequestsUpdated'));
  events.length=0;sources[0].handlers.connected();assert.equal(events.length,0);
});

test('financial review catches duplicate lines and malformed history, and excludes reversed pending dispensing', async () => {
  const ctx=context('Legacy review edge');
  const b=await bill(ctx,fee(2000));
  db.prepare('UPDATE billing SET items=?,total_amount=4000 WHERE id=?').run(JSON.stringify([...fee(2000),...fee(2000)]),b.data.id);
  let review=await api('GET','/billing/reconciliation');
  assert.equal(review.status,200);
  assert.ok(review.data.issues.some(i=>i.type==='duplicate_fee' && i.bill_ids.includes(b.data.id)));
  db.exec('DROP TRIGGER billing_amount_guard_insert; DROP TRIGGER billing_amount_guard_update;');
  db.prepare('UPDATE billing SET items=? WHERE id=?').run('null',b.data.id);
  require('../src/lib/financialIntegritySchema').ensureFinancialIntegritySchema(db);
  review=await api('GET','/billing/reconciliation');
  assert.equal(review.status,200);
  assert.ok(review.data.issues.some(i=>i.type==='invalid_bill' && i.bill_ids.includes(b.data.id)));
  db.prepare('UPDATE billing SET items=?,total_amount=2000 WHERE id=?').run(JSON.stringify(fee(2000)),b.data.id);
  db.prepare('UPDATE billing SET total_amount=1999 WHERE id=?').run(b.data.id);
  review=await api('GET','/billing/reconciliation');
  assert.ok(review.data.issues.some(i=>i.type==='invoice_total_mismatch' && i.bill_ids.includes(b.data.id)));
  db.prepare('UPDATE billing SET total_amount=2000 WHERE id=?').run(b.data.id);

  const stockCtx=context('Movement reconciliation');const billedItem=item('Movement reconciliation medicine');
  const stockBill=await bill(stockCtx,[stockLine(billedItem,1)],{operation_id:randomUUID()});
  assert.equal(stockBill.status,201,JSON.stringify(stockBill.data));
  const detachedItems=stockBill.data.items.map(line=>line.inventory_item_id?{
    ...line,inventory_movement_ids:[],dispensing_movement_ids:[],
  }:line);
  db.prepare('UPDATE billing SET items=? WHERE id=?').run(JSON.stringify(detachedItems),stockBill.data.id);
  review=await api('GET','/billing/reconciliation');
  assert.ok(review.data.issues.some(i=>i.type==='invoice_line_missing_movement' && i.bill_ids.includes(stockBill.data.id)));
  assert.ok(review.data.issues.some(i=>i.type==='orphan_billed_movement' && i.bill_ids.includes(stockBill.data.id)));

  const pendingCtx=context('Reversed pending');const it=item('Reversed pending medicine');
  await fieldSale(pendingCtx,it);
  const m=db.prepare('SELECT * FROM inventory_movements WHERE item_id=?').get(it.id);
  const metadata={...JSON.parse(m.meta_json),original_action_type:'stock_out',reversed_movement_id:m.id};
  db.prepare("INSERT INTO inventory_movements(item_id,movement_type,action_type,quantity,meta_json,unit_cost_snapshot,unit_price_snapshot) VALUES (?,'in','reversal',?,?,?,?)")
    .run(it.id,m.quantity,JSON.stringify(metadata),m.unit_cost_snapshot,m.unit_price_snapshot);
  review=await api('GET','/billing/reconciliation');
  assert.equal(review.status,200);
  assert.ok(!review.data.issues.some(i=>i.type==='unbilled_dispensing' && i.movement_id===m.id));
  const reverse=db.prepare("SELECT id FROM inventory_movements WHERE item_id=? AND action_type='reversal'").get(it.id);
  assert.ok(!review.data.issues.some(i=>i.type==='unbilled_dispensing' && i.movement_id===reverse.id));
});

test('all payment routes block legacy duplicate fees, including an additional-item invoice', async () => {
  const ctx=context('Legacy duplicate payment');
  const first=await bill(ctx,fee(1500));
  const duplicateId=Number(db.prepare("INSERT INTO billing (consultation_id,patient_id,items,total_amount,status,payment_method,payment_date) VALUES (?,?,?,2000,'paid','juice',?)").run(ctx.consultationId,ctx.patientId,JSON.stringify(fee(2000)),today).lastInsertRowid);
  const extra=await bill(ctx,[{description:'Additional service',amount:100,type:'Sale',is_service_charge:true}]);
  const pay=await api('PATCH',`/billing/${first.data.id}/pay`,'admin',{payment_method:'cash',payment_date:today,expected_version:first.data.row_version});
  assert.equal(pay.status,409); assert.equal(pay.data.code,'DUPLICATE_VISIT_FEE');
  const listed=await api('GET',`/billing?patientId=${ctx.patientId}`);
  assert.equal(listed.data.find(b=>b.id===first.data.id).payment_block.code,'DUPLICATE_VISIT_FEE');
  const extraPay=await api('PATCH',`/billing/${extra.data.id}/pay`,'admin',{payment_method:'cash',payment_date:today,expected_version:extra.data.row_version});
  assert.equal(extraPay.status,409); assert.equal(extraPay.data.code,'DUPLICATE_VISIT_FEE');
  const put=await api('PUT',`/billing/${extra.data.id}`,'admin',{items:extra.data.items,status:'paid',payment_method:'card',payment_date:today,expected_version:extra.data.row_version});
  assert.equal(put.status,409); assert.equal(db.prepare('SELECT status FROM billing WHERE id=?').get(extra.data.id).status,'unpaid');
  const it=item('Blocked paid invoice medicine');
  const created=await bill(ctx,[stockLine(it)],{status:'paid',payment_method:'cash',payment_date:today});
  assert.equal(created.status,409); assert.equal(row(it.id).quantity,20,'blocked payment rolls back stock deduction');
  const voided=await api('POST',`/billing/${first.data.id}/void`,'admin',{reason:'Verified duplicate against original visit receipt',expected_version:first.data.row_version});
  assert.equal(voided.status,200);
  const resolved=await api('PATCH',`/billing/${extra.data.id}/pay`,'admin',{payment_method:'card',payment_date:today,external_reference:`CARD-DUP-${fixtureIndex}`,operation_id:randomUUID(),expected_version:extra.data.row_version});
  assert.equal(resolved.status,200);
  assert.equal(db.prepare('SELECT status FROM billing WHERE id=?').get(duplicateId).status,'paid');
});

test('legacy fee migration preserves amounts, is repeatable, and requires an audited admin review', async () => {
  const ctx=context('Legacy tariff review'); const original=await bill(ctx,fee(1500));
  const {ensureFinancialIntegritySchema}=require('../src/lib/financialIntegritySchema');
  db.prepare("DELETE FROM financial_migrations WHERE name='legacy_unpaid_fee_review_20260909'").run();
  ensureFinancialIntegritySchema(db);
  let current=(await api('GET',`/billing/${original.data.id}`)).data;
  assert.equal(current.total_amount,1500); assert.equal(current.legacy_fee_review_required,1);
  const payload={items:current.items,confirm_consultation_fee:true,correction_reason:'Original booking confirms the agreed legacy Rs 1500 fee',expected_version:current.row_version};
  const doctor=await api('PUT',`/billing/${current.id}`,'doctor',payload); assert.equal(doctor.status,403);
  const noReason=await api('PUT',`/billing/${current.id}`,'admin',{...payload,correction_reason:''}); assert.equal(noReason.status,403);
  const admin=await api('PUT',`/billing/${current.id}`,'admin',payload); assert.equal(admin.status,200,JSON.stringify(admin.data));
  assert.equal(admin.data.total_amount,1500); assert.equal(admin.data.fee_review_required,0);
  assert.equal(admin.data.legacy_fee_review_required,0);
  assert.ok(admin.data.history.some(event=>event.reason===payload.correction_reason));
  ensureFinancialIntegritySchema(db);
  current=(await api('GET',`/billing/${original.data.id}`)).data;
  assert.equal(current.fee_review_required,0,'restart must not reflag an admin-reviewed fee');
});

test('payment shortcut requires explicit method and date and retains version protection', async () => {
  const ctx=context('Explicit payment'); const original=await bill(ctx,fee());
  assert.equal((await api('PATCH',`/billing/${original.data.id}/pay`,'admin',{})).status,400);
  assert.equal((await api('PATCH',`/billing/${original.data.id}/pay`,'admin',{payment_method:'cash'})).status,400);
  const edited=await api('PUT',`/billing/${original.data.id}`,'admin',{items:fee(2000),correction_reason:'Adjusted consultation fee after source review',expected_version:original.data.row_version});
  assert.equal(edited.status,200);
  const stale=await api('PATCH',`/billing/${original.data.id}/pay`,'admin',{payment_method:'cash',payment_date:today,expected_version:original.data.row_version});
  assert.equal(stale.status,409);
  assert.equal(db.prepare('SELECT status FROM billing WHERE id=?').get(original.data.id).status,'unpaid');
});

test('stock corrections distinguish additions from consumption and surface incomplete classifications', () => {
  const {stockFinancials}=require('../src/lib/inventoryFinancials');
  const results=stockFinancials([
    {action_type:'adjustment',movement_type:'adjustment',quantity:5,previous_quantity:10,next_quantity:15,unit_cost_snapshot:10,valuation_basis:'legacy_estimate'},
    {action_type:'adjustment',movement_type:'adjustment',quantity:2,previous_quantity:10,next_quantity:8,unit_cost_snapshot:10},
    {action_type:'reversal',movement_type:'in',quantity:2,unit_cost_snapshot:10,meta_json:JSON.stringify({original_action_type:'adjustment'})},
  ]);
  assert.equal(results.total_value_cost_rs,0);
  assert.equal(results.unclassified_movement_count,3);
  assert.equal(results.estimated_movement_count,1);
  const historic=stockFinancials([{action_type:'correction',direction:'adjustment',quantity:4,previous_quantity:10,next_quantity:6,cost_price:10}]);
  assert.equal(historic.total_value_cost_rs,40); assert.equal(historic.unclassified_movement_count,1);
  const counted=stockFinancials([{
    action_type:'adjustment', movement_type:'in', quantity:3, previous_quantity:4, next_quantity:7,
    unit_cost_snapshot:8, valuation_basis:'stocktake',
    meta_json: JSON.stringify({ reference_type:'stocktake_session', valuation_basis:'stocktake_surplus' }),
  }]);
  assert.equal(counted.total_value_cost_rs,0);
  assert.equal(counted.unclassified_movement_count,0);
  assert.equal(counted.stocktake_surplus_rs,24);
  assert.equal(counted.stocktake_shortage_rs,0);
  const shortCount=stockFinancials([{
    action_type:'adjustment', movement_type:'out', quantity:2, previous_quantity:7, next_quantity:5,
    unit_cost_snapshot:8, valuation_basis:'recorded_price',
    meta_json: JSON.stringify({ stocktake_session_id:4, reference_type:'stocktake_session', valuation_basis:'batch_allocation' }),
  }]);
  assert.equal(shortCount.total_value_cost_rs,0);
  assert.equal(shortCount.stocktake_shortage_rs,16);
  assert.equal(shortCount.unclassified_movement_count,0);
  assert.equal(shortCount.stocktake_net_rs,-16);
});

test('supply follow-up retains stock and status, records the actor, and blocks closed or stale requests', async () => {
  const now='2026-09-01 00:00:00';
  const id=Number(db.prepare("INSERT INTO restock_requests (doctor_id,requested_by_user_id,collection_date,collection_day,status,note,updated_at) VALUES (?,(SELECT id FROM users WHERE username='integrity.doctor'),'2026-09-07',1,'ready','Synthetic follow-up',?)").run(doctorId,now).lastInsertRowid);
  const data={note:'Verified collection outstanding; check with doctor on next shift',take_ownership:true,expected_updated_at:now};
  const unauthorised=await api('POST',`/restock-requests/${id}/follow-up`,'doctor',data); assert.equal(unauthorised.status,403);
  const follow=await api('POST',`/restock-requests/${id}/follow-up`,'admin',data); assert.equal(follow.status,200,JSON.stringify(follow.data));
  assert.equal(follow.data.request.status,'ready'); assert.ok(follow.data.request.assigned_to_user_id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM restock_request_events WHERE request_id=? AND event_type='collection_follow_up'").get(id).n,1);
  assert.equal((await api('POST',`/restock-requests/${id}/follow-up`,'admin',data)).status,409);
  db.prepare("UPDATE restock_requests SET status='completed' WHERE id=?").run(id);
  assert.equal((await api('POST',`/restock-requests/${id}/follow-up`,'admin',{...data,expected_updated_at:follow.data.request.updated_at})).status,409);
  assert.equal((await api('POST',`/restock-requests/${id}/assign`,'admin',{})).status,409);
});

test('device alert test targets only the caller device, limits retries and does not claim delivery', async () => {
  const webpush=require('web-push');
  const original=webpush.sendNotification;
  const calls=[];
  webpush.sendNotification=async (subscription,payload)=>{calls.push({subscription,payload:JSON.parse(payload)});return {statusCode:201};};
  try {
    const {saveUserPushSubscription}=require('../src/lib/push');
    const adminId=db.prepare("SELECT id FROM users WHERE username='integrity.admin'").get().id;
    const doctorUserId=db.prepare("SELECT id FROM users WHERE username='integrity.doctor'").get().id;
    saveUserPushSubscription(adminId,{endpoint:'https://example.invalid/admin-device',keys:{p256dh:'test',auth:'test'}});
    saveUserPushSubscription(doctorUserId,{endpoint:'https://example.invalid/doctor-device',keys:{p256dh:'test',auth:'test'}});
    const other=await api('POST','/push/test-device','admin',{endpoint:'https://example.invalid/doctor-device'});
    assert.equal(other.status,404); assert.equal(calls.length,0);
    const own=await api('POST','/push/test-device','admin',{endpoint:'https://example.invalid/admin-device'});
    assert.equal(own.status,200,JSON.stringify(own.data)); assert.equal(own.data.accepted,true);
    assert.match(own.data.message,/does not prove delivery/);
    assert.equal(calls.length,1); assert.equal(calls[0].subscription.endpoint,'https://example.invalid/admin-device');
    assert.equal((await api('POST','/push/test-device','admin',{endpoint:'https://example.invalid/admin-device'})).status,429);
    assert.equal(calls.length,1);
  } finally { webpush.sendNotification=original; }
});

test('overdue supply calculation uses Mauritius day boundaries and excludes closed requests', () => {
  const code=fs.readFileSync(path.join(__dirname,'../../client/src/lib/supplyRequests.js'),'utf8').replace(/^import .*;$/gm,'').replaceAll('export ','');
  const sandbox={};vm.createContext(sandbox);vm.runInContext(code+';this.overdue=supplyRequestOverdueDays;',sandbox);
  const request={status:'ready',collection_date:'2026-09-07'};
  assert.equal(sandbox.overdue(request,new Date('2026-09-07T19:59:59Z')),0);
  assert.equal(sandbox.overdue(request,new Date('2026-09-07T20:00:00Z')),1);
  assert.equal(sandbox.overdue({...request,status:'completed'},new Date('2026-09-09')),0);
  assert.equal(sandbox.overdue({...request,collection_date:'2026-02-30'},new Date('2026-09-09')),0);
});

test('financial reports use frozen commission and transport rates', async () => {
  const before=await report(today,'visit');
  const beforeDoctor=before.doctorReport.rows.find(row=>row.doctor_id===doctorId) || {};
  const ctx=context('Frozen revenue rates');
  const invoice=await bill(ctx,fee(1000),{
    status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID(),
  });
  assert.equal(invoice.status,201,JSON.stringify(invoice.data));
  db.prepare('UPDATE billing SET doctor_commission_rate_snapshot=0.33,ocs_commission_rate_snapshot=0.22 WHERE id=?').run(invoice.data.id);
  db.prepare('UPDATE consultations SET transport_benefit_snapshot=123 WHERE id=?').run(ctx.consultationId);
  const after=await report(today,'visit');
  const afterDoctor=after.doctorReport.rows.find(row=>row.doctor_id===doctorId);
  assert.equal(Number((afterDoctor.doctorCommission-Number(beforeDoctor.doctorCommission||0)).toFixed(2)),330);
  assert.equal(Number((afterDoctor.ocsCommission-Number(beforeDoctor.ocsCommission||0)).toFixed(2)),220);
  assert.equal(Number((afterDoctor.transportBenefits-Number(beforeDoctor.transportBenefits||0)).toFixed(2)),123);
  assert.equal(after.revenueStatement.shareRates.rateBasis,'invoice_snapshot');
  assert.equal(after.revenueStatement.shareRates.transportBasis,'consultation_snapshot');
});

test('payment ledger supports partial and split receipts without allowing invoice rewrites', async () => {
  const ctx=context('Split payment ledger');
  const original=await bill(ctx,[standardFee()],{operation_id:randomUUID()});
  const firstOperation=randomUUID();
  const first=await api('PATCH',`/billing/${original.data.id}/pay`,'operator',{
    amount:500,payment_method:'cash',payment_date:today,operation_id:firstOperation,expected_version:original.data.row_version,
  });
  assert.equal(first.status,200,JSON.stringify(first.data));
  assert.equal(first.data.status,'unpaid');assert.equal(first.data.payment_state,'partial');
  assert.equal(first.data.payment_received_amount,500);assert.equal(first.data.payment_balance_amount,1500);
  const replay=await api('PATCH',`/billing/${original.data.id}/pay`,'operator',{
    amount:500,payment_method:'cash',payment_date:today,operation_id:firstOperation,expected_version:original.data.row_version,
  });
  assert.equal(replay.status,200,JSON.stringify(replay.data));assert.equal(replay.data.payment_count,1);
  const mismatchedReplay=await api('PATCH',`/billing/${original.data.id}/pay`,'operator',{
    amount:600,payment_method:'cash',payment_date:today,operation_id:firstOperation,expected_version:original.data.row_version,
  });
  assert.equal(mismatchedReplay.status,409,JSON.stringify(mismatchedReplay.data));
  assert.equal(mismatchedReplay.data.code,'PAYMENT_OPERATION_MISMATCH');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_payment_transactions WHERE operation_id=?').get(firstOperation).count,1);
  const locked=await api('PUT',`/billing/${original.data.id}`,'admin',{
    items:[standardFee('Day Consultation',2100)],status:'unpaid',expected_version:first.data.row_version,correction_reason:'Attempt after partial payment',
  });
  assert.equal(locked.status,409,JSON.stringify(locked.data));
  const second=await api('PATCH',`/billing/${original.data.id}/pay`,'operator',{
    amount:1500,payment_method:'juice',payment_date:today,external_reference:`JUICE-SPLIT-${fixtureIndex}`,
    operation_id:randomUUID(),expected_version:first.data.row_version,
  });
  assert.equal(second.status,200,JSON.stringify(second.data));
  assert.equal(second.data.status,'paid');assert.equal(second.data.payment_state,'paid');
  assert.equal(second.data.payment_count,2);assert.equal(second.data.payment_balance_amount,0);
  assert.deepEqual(second.data.payments.map((payment)=>payment.amount),[500,1500]);
});

test('payment corrections use an immutable compensating reversal and reopen the balance', async () => {
  const ctx=context('Payment reversal');
  const original=await bill(ctx,[standardFee()],{status:'paid',payment_method:'card',payment_date:today,operation_id:randomUUID()});
  assert.equal(original.status,201,JSON.stringify(original.data));
  const payment=original.data.payments.find(entry=>entry.entry_type==='payment');
  assert.ok(payment);
  const operationId=randomUUID();
  const reversed=await api('POST',`/billing/${original.data.id}/payments/${payment.payment_transaction_id}/reverse`,'accountant',{
    reversal_date:today,
    reason:'Card receipt was entered against the wrong invoice',
    external_reference:`CARD-REV-${fixtureIndex}`,
    operation_id:operationId,
  });
  assert.equal(reversed.status,201,JSON.stringify(reversed.data));
  assert.equal(reversed.data.bill.status,'unpaid');
  assert.equal(reversed.data.bill.payment_received_amount,0);
  assert.equal(reversed.data.bill.payment_balance_amount,2000);
  assert.deepEqual(reversed.data.bill.payments.map(entry=>entry.amount),[2000,-2000]);
  const replay=await api('POST',`/billing/${original.data.id}/payments/${payment.payment_transaction_id}/reverse`,'accountant',{
    reversal_date:today,reason:'Card receipt was entered against the wrong invoice',external_reference:`CARD-REV-${fixtureIndex}`,operation_id:operationId,
  });
  assert.equal(replay.status,201);assert.equal(replay.data.reversal_id,reversed.data.reversal_id);
  assert.throws(()=>db.prepare('UPDATE billing_payment_reversals SET reason=? WHERE id=?').run('Changed',reversed.data.reversal_id),/immutable/);
  const replacement=await api('PATCH',`/billing/${original.data.id}/pay`,'accountant',{
    amount:2000,payment_method:'cash',payment_date:today,operation_id:randomUUID(),expected_version:reversed.data.bill.row_version,
  });
  assert.equal(replacement.status,200,JSON.stringify(replacement.data));
  assert.equal(replacement.data.payment_received_amount,2000);
});

test('partially paid supply corrections become usable after the immutable receipt reversal', async () => {
  const ctx=context('Partial supply correction');
  const it=item('Partial correction supply',20);
  const draft=await bill(ctx,[standardFee()],{operation_id:randomUUID()});
  const originalIssueFields=quickIssueFields('PARTIAL-CORRECTION');
  const captured=await api('POST',`/billing/quick/visits/${ctx.consultationId}/capture`,'doctor',{
    operation_id:randomUUID(),...originalIssueFields,consultation_fee:{type:'Day Consultation',amount:2000},
    items:[{inventory_item_id:it.id,quantity:1,unit_price:25}],
  });
  assert.equal(captured.status,201,JSON.stringify(captured.data));
  const issued=(await api('GET',`/billing/${draft.data.id}`,'operator')).data;
  const issuedReceipt=issued.payments.find(entry=>entry.entry_type==='payment');
  const issuedReversal=await api('POST',`/billing/${draft.data.id}/payments/${issuedReceipt.payment_transaction_id}/reverse`,'accountant',{
    reversal_date:today,reason:'Reopen the paid invoice to test a partial receipt correction',operation_id:randomUUID(),
  });
  assert.equal(issuedReversal.status,201,JSON.stringify(issuedReversal.data));
  const part=await api('PATCH',`/billing/${draft.data.id}/pay`,'operator',{
    amount:500,payment_method:'cash',payment_date:today,operation_id:randomUUID(),expected_version:issuedReversal.data.bill.row_version,
  });
  assert.equal(part.status,200,JSON.stringify(part.data));
  const blocked=await api('POST',`/billing/quick/submissions/${captured.data.submission.submission_id}/reverse`,'operator',{
    operation_id:randomUUID(),reason:'Supply quantity was entered incorrectly',
  });
  assert.equal(blocked.status,409,JSON.stringify(blocked.data));
  assert.equal(blocked.data.code,'PARTIAL_PAYMENT_REVERSAL_REQUIRED');
  const receipt=part.data.payments.find(entry=>entry.entry_type==='payment' && entry.amount===500);
  const receiptReversal=await api('POST',`/billing/${draft.data.id}/payments/${receipt.payment_transaction_id}/reverse`,'accountant',{
    reversal_date:today,reason:'Receipt reversed before correcting the supply line',operation_id:randomUUID(),
  });
  assert.equal(receiptReversal.status,201,JSON.stringify(receiptReversal.data));
  const corrected=await api('POST',`/billing/quick/submissions/${captured.data.submission.submission_id}/reverse`,'operator',{
    operation_id:randomUUID(),reason:'Supply quantity was entered incorrectly',
  });
  assert.equal(corrected.status,200,JSON.stringify(corrected.data));
  assert.equal(row(it.id).quantity,20);
  const reissued=await api('POST',`/billing/quick/visits/${ctx.consultationId}/capture`,'doctor',{
    operation_id:randomUUID(),...originalIssueFields,consultation_fee:{type:'Day Consultation',amount:2000},items:[],
  });
  assert.equal(reissued.status,201,JSON.stringify(reissued.data));
  const reopened=(await api('GET',`/billing/${draft.data.id}`,'operator')).data;
  assert.equal(reopened.status,'paid');
  assert.equal(reopened.payment_received_amount,2000);
  assert.equal(reopened.payment_balance_amount,0);
});

test('paid supply corrections issue a credit note and restore only confirmed returned stock', async () => {
  const ctx=context('Paid supply correction');
  const it=item('Returned paid supply',20);
  const draft=await bill(ctx,[standardFee()],{operation_id:randomUUID()});
  assert.equal(draft.status,201,JSON.stringify(draft.data));
  const captured=await api('POST',`/billing/quick/visits/${ctx.consultationId}/capture`,'doctor',{
    operation_id:randomUUID(),
    ...quickIssueFields('PAID-RETURN'),
    consultation_fee:{type:'Day Consultation',amount:2000},
    items:[{inventory_item_id:it.id,quantity:1}],
  });
  assert.equal(captured.status,201,JSON.stringify(captured.data));
  assert.equal(row(it.id).quantity,19);
  const paid=(await api('GET',`/billing/${draft.data.id}`,'doctor')).data;
  assert.equal(paid.status,'paid');
  assert.equal(paid.payment_received_amount,2025);
  const serviceRefund=await api('POST',`/billing/${draft.data.id}/refunds`,'accountant',{
    amount:100,refund_method:'cash',refund_date:today,
    reason:'Consultation service goodwill credit approved by finance',operation_id:randomUUID(),
  });
  assert.equal(serviceRefund.status,201,JSON.stringify(serviceRefund.data));
  const correctionPayload={
    disposition:'returned_to_stock',refund_method:'cash',refund_date:today,
    reason:'Supply was billed but returned unopened to the doctor bag',operation_id:randomUUID(),
  };
  const corrected=await api('POST',`/billing/quick/submissions/${captured.data.submission.submission_id}/paid-correction`,'accountant',correctionPayload);
  assert.equal(corrected.status,201,JSON.stringify(corrected.data));
  assert.equal(corrected.data.credit_note.amount,25);
  assert.equal(corrected.data.credit_note.allocation_type,'supply_submission');
  assert.equal(corrected.data.stock_restored,true);
  assert.equal(row(it.id).quantity,20);
  assert.equal(db.prepare('SELECT disposition FROM billing_supply_corrections WHERE id=?').get(corrected.data.correction_id).disposition,'returned_to_stock');
  const supplyAllocation=db.prepare('SELECT * FROM billing_refund_allocations WHERE refund_id=?').get(corrected.data.credit_note.id);
  assert.equal(supplyAllocation.allocation_type,'supply_submission');
  assert.equal(supplyAllocation.submission_id,captured.data.submission.submission_id);
  assert.equal(supplyAllocation.amount,25);
  const replay=await api('POST',`/billing/quick/submissions/${captured.data.submission.submission_id}/paid-correction`,'accountant',correctionPayload);
  assert.equal(replay.status,201,JSON.stringify(replay.data));
  assert.equal(replay.data.correction_id,corrected.data.correction_id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_refunds WHERE billing_id=?').get(draft.data.id).count,2);
});

test('active paid legacy submissions are derived as completed and remain correctable', async () => {
  const ctx=context('Legacy paid submission correction');
  const it=item('Legacy paid submission supply',20);
  const draft=await bill(ctx,[standardFee()],{operation_id:randomUUID()});
  const captured=await api('POST',`/billing/quick/visits/${ctx.consultationId}/capture`,'doctor',{
    operation_id:randomUUID(),...quickIssueFields('LEGACY-PAID'),consultation_fee:{type:'Day Consultation',amount:2000},
    items:[{inventory_item_id:it.id,quantity:1,unit_price:25}],
  });
  assert.equal(captured.status,201,JSON.stringify(captured.data));
  assert.equal((await api('GET',`/billing/${draft.data.id}`,'accountant')).data.status,'paid');
  db.prepare("UPDATE billing_lite_submissions SET workflow_status='awaiting_operator' WHERE id=?").run(captured.data.submission.submission_id);
  const legacyDetail=(await api('GET',`/billing/${draft.data.id}`,'accountant')).data;
  assert.equal(legacyDetail.quick_submissions.find(entry=>entry.id===captured.data.submission.submission_id).workflow_status,'completed');
  const corrected=await api('POST',`/billing/quick/submissions/${captured.data.submission.submission_id}/paid-correction`,'accountant',{
    disposition:'returned_to_stock',refund_method:'cash',refund_date:today,
    reason:'Legacy paid submission returned unopened to stock',operation_id:randomUUID(),
  });
  assert.equal(corrected.status,201,JSON.stringify(corrected.data));
  assert.equal(row(it.id).quantity,20);
});

test('consumed paid-supply corrections reclassify the sale as wastage without restoring stock', async () => {
  const ctx=context('Consumed paid supply correction');
  const it=item('Consumed paid supply',20);
  const draft=await bill(ctx,[standardFee()],{operation_id:randomUUID()});
  const captured=await api('POST',`/billing/quick/visits/${ctx.consultationId}/capture`,'doctor',{
    operation_id:randomUUID(),...quickIssueFields('CONSUMED-CORRECTION'),consultation_fee:{type:'Day Consultation',amount:2000},
    items:[{inventory_item_id:it.id,quantity:1,unit_price:25}],
  });
  assert.equal(captured.status,201,JSON.stringify(captured.data));
  assert.equal((await api('GET',`/billing/${draft.data.id}`,'doctor')).data.status,'paid');
  const corrected=await api('POST',`/billing/quick/submissions/${captured.data.submission.submission_id}/paid-correction`,'accountant',{
    disposition:'consumed_or_wasted',refund_method:'cash',refund_date:today,
    reason:'Supply charge refunded because the consumed item was not billable',operation_id:randomUUID(),
  });
  assert.equal(corrected.status,201,JSON.stringify(corrected.data));
  assert.equal(corrected.data.stock_restored,false);
  assert.equal(row(it.id).quantity,19);
  const movements=db.prepare('SELECT * FROM inventory_movements WHERE item_id=? ORDER BY id').all(it.id);
  assert.deepEqual(movements.map(entry=>entry.action_type),['sell','reversal','wastage']);
  const totals=stockFinancials(movements);
  assert.equal(totals.net_sales_rs,0);
  assert.equal(totals.sales_cost_rs,0);
  assert.equal(totals.wastage_value_rs,10);
  assert.equal(totals.total_value_cost_rs,10);
});

test('paid corrections reject reversed submissions after a replacement has been issued', async () => {
  const ctx=context('Superseded paid correction');
  const it=item('Superseded paid correction supply',20);
  const draft=await bill(ctx,[standardFee()],{operation_id:randomUUID()});
  const originalIssueFields=quickIssueFields('SUPERSEDED');
  const first=await api('POST',`/billing/quick/visits/${ctx.consultationId}/capture`,'doctor',{
    operation_id:randomUUID(),...originalIssueFields,consultation_fee:{type:'Day Consultation',amount:2000},
    items:[{inventory_item_id:it.id,quantity:1,unit_price:25}],
  });
  assert.equal(first.status,201,JSON.stringify(first.data));
  const firstBill=(await api('GET',`/billing/${draft.data.id}`,'accountant')).data;
  const firstPayment=firstBill.payments.find(entry=>entry.entry_type==='payment');
  const firstPaymentReversal=await api('POST',`/billing/${draft.data.id}/payments/${firstPayment.payment_transaction_id}/reverse`,'accountant',{
    reversal_date:today,reason:'Reverse receipt before replacing the supply submission',operation_id:randomUUID(),
  });
  assert.equal(firstPaymentReversal.status,201,JSON.stringify(firstPaymentReversal.data));
  const reversed=await api('POST',`/billing/quick/submissions/${first.data.submission.submission_id}/reverse`,'operator',{
    operation_id:randomUUID(),reason:'The original supply selection was entered incorrectly',
  });
  assert.equal(reversed.status,200,JSON.stringify(reversed.data));
  const replacement=await api('POST',`/billing/quick/visits/${ctx.consultationId}/capture`,'doctor',{
    operation_id:randomUUID(),...originalIssueFields,consultation_fee:{type:'Day Consultation',amount:2000},
    items:[{inventory_item_id:it.id,quantity:1,unit_price:25}],
  });
  assert.equal(replacement.status,201,JSON.stringify(replacement.data));
  assert.equal((await api('GET',`/billing/${draft.data.id}`,'operator')).data.status,'paid');
  const beforeRefunds=db.prepare('SELECT COUNT(*) AS count FROM billing_refunds WHERE billing_id=?').get(draft.data.id).count;
  const staleCorrection=await api('POST',`/billing/quick/submissions/${first.data.submission.submission_id}/paid-correction`,'accountant',{
    disposition:'returned_to_stock',refund_method:'cash',refund_date:today,
    reason:'Attempt to correct the superseded supply submission',operation_id:randomUUID(),
  });
  assert.equal(staleCorrection.status,409,JSON.stringify(staleCorrection.data));
  assert.equal(staleCorrection.data.code,'SUBMISSION_NOT_ACTIVE');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_refunds WHERE billing_id=?').get(draft.data.id).count,beforeRefunds);
  assert.equal(row(it.id).quantity,19);
});

test('paid corrections restore or reclassify pre-dispensed stock without losing the original batch', async () => {
  const returnedCtx=context('Returned pre-dispensed correction');
  const returnedItem=item('Returned pre-dispensed supply',20);
  assert.equal((await fieldSale(returnedCtx,returnedItem)).status,201);
  const returnedMovement=db.prepare('SELECT id FROM inventory_movements WHERE item_id=? ORDER BY id DESC LIMIT 1').get(returnedItem.id).id;
  const returnedLine={...stockLine(returnedItem,2),dispensing_movement_ids:[returnedMovement]};
  const returnedBill=await bill(returnedCtx,[standardFee(),returnedLine],{
    status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID(),
  });
  assert.equal(returnedBill.status,201,JSON.stringify(returnedBill.data));
  const returnedSubmission=completedQuickSubmission({bill:returnedBill.data,ctx:returnedCtx,items:[returnedLine]});
  const returnedCorrection=await api('POST',`/billing/quick/submissions/${returnedSubmission}/paid-correction`,'accountant',{
    disposition:'returned_to_stock',refund_method:'cash',refund_date:today,
    reason:'The unopened pre-dispensed supplies were returned to their original batch',operation_id:randomUUID(),
  });
  assert.equal(returnedCorrection.status,201,JSON.stringify(returnedCorrection.data));
  assert.equal(returnedCorrection.data.stock_restored,true);
  assert.equal(row(returnedItem.id).quantity,20);
  const returnedMovements=db.prepare('SELECT * FROM inventory_movements WHERE item_id=? ORDER BY id').all(returnedItem.id);
  assert.deepEqual(returnedMovements.map(entry=>entry.action_type),['stock_out','reversal']);
  assert.equal(stockFinancials(returnedMovements).net_sales_rs,0);
  const returnedAudit=db.prepare("SELECT details_json FROM billing_quick_events WHERE submission_id=? AND event_type='paid_supply_corrected'").get(returnedSubmission);
  assert.deepEqual(JSON.parse(returnedAudit.details_json).original_movement_ids,[returnedMovement]);

  const consumedCtx=context('Consumed pre-dispensed correction');
  const consumedItem=item('Consumed pre-dispensed supply',20);
  assert.equal((await fieldSale(consumedCtx,consumedItem)).status,201);
  const consumedMovement=db.prepare('SELECT id FROM inventory_movements WHERE item_id=? ORDER BY id DESC LIMIT 1').get(consumedItem.id).id;
  const consumedLine={...stockLine(consumedItem,2),dispensing_movement_ids:[consumedMovement]};
  const consumedBill=await bill(consumedCtx,[standardFee(),consumedLine],{
    status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID(),
  });
  assert.equal(consumedBill.status,201,JSON.stringify(consumedBill.data));
  const consumedSubmission=completedQuickSubmission({bill:consumedBill.data,ctx:consumedCtx,items:[consumedLine]});
  const consumedCorrection=await api('POST',`/billing/quick/submissions/${consumedSubmission}/paid-correction`,'accountant',{
    disposition:'consumed_or_wasted',refund_method:'cash',refund_date:today,
    reason:'The pre-dispensed supplies were consumed but their charge was not billable',operation_id:randomUUID(),
  });
  assert.equal(consumedCorrection.status,201,JSON.stringify(consumedCorrection.data));
  assert.equal(consumedCorrection.data.stock_restored,false);
  assert.equal(row(consumedItem.id).quantity,18);
  const consumedMovements=db.prepare('SELECT * FROM inventory_movements WHERE item_id=? ORDER BY id').all(consumedItem.id);
  assert.deepEqual(consumedMovements.map(entry=>entry.action_type),['stock_out','reversal','wastage']);
  const consumedTotals=stockFinancials(consumedMovements);
  assert.equal(consumedTotals.net_sales_rs,0);
  assert.equal(consumedTotals.sales_cost_rs,0);
  assert.equal(consumedTotals.wastage_value_rs,20);

  const reconciliation=await api('GET','/billing/reconciliation','accountant');
  assert.equal(reconciliation.status,200,JSON.stringify(reconciliation.data));
  const affectedBillIds=new Set([returnedBill.data.id,consumedBill.data.id]);
  const affectedMovementIds=new Set([...returnedMovements,...consumedMovements].map(entry=>entry.id));
  const falseExceptions=reconciliation.data.issues.filter(issue=>(issue.bill_ids||[]).some(id=>affectedBillIds.has(id)) || affectedMovementIds.has(issue.movement_id));
  assert.deepEqual(falseExceptions,[]);
});

test('payment reversals reduce commission and multiple invoices count transport once', async () => {
  const before=await report(today,'payment');
  const beforeDoctor=before.doctorReport.rows.find(row=>row.doctor_id===doctorId) || {};
  const reversalCtx=context('Commission reversal report');
  const paid=await bill(reversalCtx,fee(1000),{status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID()});
  assert.equal(paid.status,201,JSON.stringify(paid.data));
  const receipt=paid.data.payments.find(entry=>entry.entry_type==='payment');
  const reversed=await api('POST',`/billing/${paid.data.id}/payments/${receipt.payment_transaction_id}/reverse`,'accountant',{
    reversal_date:today,reason:'Reverse the receipt to verify commission reporting',operation_id:randomUUID(),
  });
  assert.equal(reversed.status,201,JSON.stringify(reversed.data));
  const afterReversal=await report(today,'payment');
  const reversedDoctor=afterReversal.doctorReport.rows.find(row=>row.doctor_id===doctorId) || {};
  assert.equal(Number((Number(reversedDoctor.doctorCommission||0)-Number(beforeDoctor.doctorCommission||0)).toFixed(2)),0);
  assert.equal(Number((Number(reversedDoctor.ocsCommission||0)-Number(beforeDoctor.ocsCommission||0)).toFixed(2)),0);

  const transportBefore=Number(reversedDoctor.transportBenefits||0);
  const transportCtx=context('Transport once for two invoices');
  db.prepare('UPDATE consultations SET transport_benefit_snapshot=123 WHERE id=?').run(transportCtx.consultationId);
  const first=await bill(transportCtx,fee(500),{status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID()});
  const second=await bill(transportCtx,[{description:'Additional clinical service',type:'Sale',amount:700,quantity:1,is_service_charge:true}],{status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID()});
  assert.equal(first.status,201,JSON.stringify(first.data));
  assert.equal(second.status,201,JSON.stringify(second.data));
  const afterTransport=await report(today,'payment');
  const transportDoctor=afterTransport.doctorReport.rows.find(row=>row.doctor_id===doctorId);
  assert.equal(Number((transportDoctor.transportBenefits-transportBefore).toFixed(2)),123);
});

test('payment-basis transport is recognized once on the final settlement date', async () => {
  const firstPaymentDate=offsetLocalDate(-35);
  const beforeFirst=await report(firstPaymentDate,'payment',doctorId);
  const beforeFinal=await report(today,'payment',doctorId);
  const ctx=context('Cross-period transport settlement',firstPaymentDate);
  db.prepare('UPDATE consultations SET transport_benefit_snapshot=137 WHERE id=?').run(ctx.consultationId);
  const firstInvoice=await bill(ctx,[standardFee('Day Consultation',1000)],{operation_id:randomUUID()});
  const secondInvoice=await bill(ctx,[{description:'Additional clinical service',type:'Sale',amount:1000,quantity:1,is_service_charge:true}],{operation_id:randomUUID()});
  assert.equal(firstInvoice.status,201,JSON.stringify(firstInvoice.data));
  assert.equal(secondInvoice.status,201,JSON.stringify(secondInvoice.data));
  const firstPaid=await api('PATCH',`/billing/${firstInvoice.data.id}/pay`,'operator',{
    amount:1000,payment_method:'cash',payment_date:firstPaymentDate,operation_id:randomUUID(),expected_version:firstInvoice.data.row_version,
  });
  assert.equal(firstPaid.status,200,JSON.stringify(firstPaid.data));
  const afterFirst=await report(firstPaymentDate,'payment',doctorId);
  assert.equal(Number((afterFirst.revenueStatement.transportBenefits-beforeFirst.revenueStatement.transportBenefits).toFixed(2)),0);
  const secondPaid=await api('PATCH',`/billing/${secondInvoice.data.id}/pay`,'operator',{
    amount:1000,payment_method:'cash',payment_date:today,operation_id:randomUUID(),expected_version:secondInvoice.data.row_version,
  });
  assert.equal(secondPaid.status,200,JSON.stringify(secondPaid.data));
  const afterFinal=await report(today,'payment',doctorId);
  assert.equal(Number((afterFinal.revenueStatement.transportBenefits-beforeFinal.revenueStatement.transportBenefits).toFixed(2)),137);
  assert.equal(afterFinal.revenueStatement.transportVisitCount-beforeFinal.revenueStatement.transportVisitCount,1);
});

test('accounting invariant matrix stays balanced through billing, payment, refund, reversal, stock correction and reporting', async () => {
  const beforeVisitReport=await report(today,'visit',doctorId);
  const beforePaymentReport=await report(today,'payment',doctorId);
  const billIds=[];
  const refundCtx=context('Invariant refund lifecycle');
  const matrixWastageItem=item('Invariant non-chargeable wastage',20);
  const refundable=await bill(refundCtx,[standardFee(),{
    description:'Invariant non-chargeable wastage',type:'Wastage',inventory_item_id:matrixWastageItem.id,
    quantity:1,amount:0,wastage_reason:'Invariant matrix damaged ampoule',batch_id:matrixWastageItem.batchId,
  }],{status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID()});
  assert.equal(refundable.status,201,JSON.stringify(refundable.data));
  assert.equal(refundable.data.total_amount,2000);
  assert.equal(refundable.data.items.find(line=>line.type==='Wastage').amount,10);
  assert.equal(row(matrixWastageItem.id).quantity,19);
  billIds.push(refundable.data.id);
  const refund=await api('POST',`/billing/${refundable.data.id}/refunds`,'accountant',{
    amount:250,refund_method:'cash',refund_date:today,reason:'Invariant matrix partial refund',operation_id:randomUUID(),
  });
  assert.equal(refund.status,201,JSON.stringify(refund.data));

  const reversalCtx=context('Invariant receipt reversal');
  const reversible=await bill(reversalCtx,[standardFee()],{status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID()});
  assert.equal(reversible.status,201,JSON.stringify(reversible.data));
  billIds.push(reversible.data.id);
  const receipt=reversible.data.payments.find(entry=>entry.entry_type==='payment');
  const receiptReversal=await api('POST',`/billing/${reversible.data.id}/payments/${receipt.payment_transaction_id}/reverse`,'accountant',{
    reversal_date:today,reason:'Invariant matrix receipt reversal',operation_id:randomUUID(),
  });
  assert.equal(receiptReversal.status,201,JSON.stringify(receiptReversal.data));
  const replacementReceipt=await api('PATCH',`/billing/${reversible.data.id}/pay`,'accountant',{
    amount:2000,payment_method:'cash',payment_date:today,operation_id:randomUUID(),expected_version:receiptReversal.data.bill.row_version,
  });
  assert.equal(replacementReceipt.status,200,JSON.stringify(replacementReceipt.data));

  const stockCtx=context('Invariant stock correction');
  const stockItem=item('Invariant corrected supply',20);
  const stockDraft=await bill(stockCtx,[standardFee()],{operation_id:randomUUID()});
  const stockCapture=await api('POST',`/billing/quick/visits/${stockCtx.consultationId}/capture`,'doctor',{
    operation_id:randomUUID(),...quickIssueFields('INVARIANT-STOCK'),consultation_fee:{type:'Day Consultation',amount:2000},
    items:[{inventory_item_id:stockItem.id,quantity:1,unit_price:25}],
  });
  assert.equal(stockCapture.status,201,JSON.stringify(stockCapture.data));
  billIds.push(stockDraft.data.id);
  assert.equal((await api('GET',`/billing/${stockDraft.data.id}`,'accountant')).data.status,'paid');
  const stockCorrection=await api('POST',`/billing/quick/submissions/${stockCapture.data.submission.submission_id}/paid-correction`,'accountant',{
    disposition:'consumed_or_wasted',refund_method:'cash',refund_date:today,
    reason:'Invariant matrix non-billable consumed supply',operation_id:randomUUID(),
  });
  assert.equal(stockCorrection.status,201,JSON.stringify(stockCorrection.data));

  for (const billId of billIds) {
    const invoice=(await api('GET',`/billing/${billId}`,'accountant')).data;
    assert.equal(calculateBillingTotal(invoice.items),Number(invoice.total_amount.toFixed(2)));
    assert.ok(invoice.finalized_at);
    assert.ok(invoice.payment_received_amount>=0);
    assert.ok(invoice.payment_balance_amount>=0);
    assert.equal(Number((invoice.payment_received_amount+invoice.payment_balance_amount).toFixed(2)),Number(invoice.total_amount.toFixed(2)));
  }
  assert.equal(row(stockItem.id).quantity,19);
  const stockTotals=stockFinancials(db.prepare('SELECT * FROM inventory_movements WHERE item_id=? ORDER BY id').all(stockItem.id));
  assert.equal(stockTotals.net_sales_rs,0);
  assert.equal(stockTotals.sales_cost_rs,0);
  assert.equal(stockTotals.wastage_value_rs,10);

  const placeholders=billIds.map(()=>'?').join(',');
  const invoiceTotal=Number(db.prepare(`SELECT COALESCE(SUM(total_amount),0) AS total FROM billing WHERE id IN (${placeholders})`).get(...billIds).total);
  const ledgerTotal=Number(db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM billing_payment_ledger WHERE billing_id IN (${placeholders})`).get(...billIds).total);
  const refundTotal=Number(db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM billing_refunds WHERE billing_id IN (${placeholders})`).get(...billIds).total);
  const expectedNet=Number((ledgerTotal-refundTotal).toFixed(2));
  const expectedDoctorCommission=Number(db.prepare(`
    SELECT COALESCE(SUM((
      COALESCE((SELECT SUM(ledger.amount) FROM billing_payment_ledger ledger WHERE ledger.billing_id=b.id),0)
      - COALESCE((SELECT SUM(refund.amount) FROM billing_refunds refund WHERE refund.billing_id=b.id),0)
    ) * b.doctor_commission_rate_snapshot),0) AS total
    FROM billing b WHERE b.id IN (${placeholders})
  `).get(...billIds).total.toFixed(2));
  const expectedOcsCommission=Number(db.prepare(`
    SELECT COALESCE(SUM((
      COALESCE((SELECT SUM(ledger.amount) FROM billing_payment_ledger ledger WHERE ledger.billing_id=b.id),0)
      - COALESCE((SELECT SUM(refund.amount) FROM billing_refunds refund WHERE refund.billing_id=b.id),0)
    ) * b.ocs_commission_rate_snapshot),0) AS total
    FROM billing b WHERE b.id IN (${placeholders})
  `).get(...billIds).total.toFixed(2));
  const consultationIds=[refundCtx.consultationId,reversalCtx.consultationId,stockCtx.consultationId];
  const transportTotal=Number(db.prepare(`SELECT COALESCE(SUM(transport_benefit_snapshot),0) AS total FROM consultations WHERE id IN (${consultationIds.map(()=>'?').join(',')})`).get(...consultationIds).total);
  const visitReport=await report(today,'visit',doctorId);
  const paymentReport=await report(today,'payment',doctorId);
  for (const [after,before] of [[visitReport,beforeVisitReport],[paymentReport,beforePaymentReport]]) {
    assert.equal(Number((after.revenueStatement.totalRevenue-before.revenueStatement.totalRevenue).toFixed(2)),after===visitReport?invoiceTotal:ledgerTotal);
    assert.equal(Number((after.revenueStatement.refundedRevenue-before.revenueStatement.refundedRevenue).toFixed(2)),refundTotal);
    assert.equal(Number((after.revenueStatement.paidRevenue-before.revenueStatement.paidRevenue).toFixed(2)),expectedNet);
    assert.equal(Number((after.revenueStatement.unpaidRevenue-before.revenueStatement.unpaidRevenue).toFixed(2)),0);
    assert.equal(Number((after.revenueStatement.doctorCommission-before.revenueStatement.doctorCommission).toFixed(2)),expectedDoctorCommission);
    assert.equal(Number((after.revenueStatement.ocsCommission-before.revenueStatement.ocsCommission).toFixed(2)),expectedOcsCommission);
    assert.equal(Number((after.revenueStatement.transportBenefits-before.revenueStatement.transportBenefits).toFixed(2)),transportTotal);
    assert.equal(after.revenueStatement.transportVisitCount-before.revenueStatement.transportVisitCount,consultationIds.length);
    assert.equal(Number((after.revenueStatement.ocsRemainder-before.revenueStatement.ocsRemainder).toFixed(2)),Number((expectedNet-expectedDoctorCommission-transportTotal).toFixed(2)));
    const cash=after.revenueStatement.paymentMethodBreakdown.find(entry=>entry.method==='cash').amount;
    const beforeCash=before.revenueStatement.paymentMethodBreakdown.find(entry=>entry.method==='cash').amount;
    assert.equal(Number((cash-beforeCash).toFixed(2)),expectedNet);
  }
  const reconciliation=await api('GET','/billing/reconciliation','accountant');
  const affected=new Set(billIds);
  const lifecycleExceptions=reconciliation.data.issues.filter(issue=>(issue.bill_ids||[]).some(id=>affected.has(id)));
  assert.deepEqual(lifecycleExceptions,[]);
});

test('future financial dates and zero-priced supply sales are blocked without side effects', async () => {
  const future=offsetLocalDate(1);
  const ctx=context('Future date block');
  const invoice=await bill(ctx,[standardFee()],{operation_id:randomUUID()});
  const futurePayment=await api('PATCH',`/billing/${invoice.data.id}/pay`,'admin',{
    amount:2000,payment_method:'cash',payment_date:future,operation_id:randomUUID(),expected_version:invoice.data.row_version,
  });
  assert.equal(futurePayment.status,400,JSON.stringify(futurePayment.data));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_payment_transactions WHERE billing_id=?').get(invoice.data.id).count,0);
  assert.equal((await api('GET',`/billing/day-close?date=${future}`,'accountant')).status,400);

  const paid=await api('PATCH',`/billing/${invoice.data.id}/pay`,'admin',{
    amount:2000,payment_method:'cash',payment_date:today,operation_id:randomUUID(),expected_version:invoice.data.row_version,
  });
  assert.equal(paid.status,200,JSON.stringify(paid.data));
  const futureRefund=await api('POST',`/billing/${invoice.data.id}/refunds`,'admin',{
    amount:100,refund_method:'cash',refund_date:future,reason:'Future refund date must not post',operation_id:randomUUID(),
  });
  assert.equal(futureRefund.status,400,JSON.stringify(futureRefund.data));

  const zero=item('Zero sale price item');
  db.prepare('UPDATE inventory SET selling_price=0 WHERE id=?').run(zero.id);
  const zeroCtx=context('Zero price block');
  const zeroBill=await bill(zeroCtx,[stockLine(zero,1)],{operation_id:randomUUID()});
  assert.equal(zeroBill.status,409,JSON.stringify(zeroBill.data));
  assert.equal(zeroBill.data.code,'SUPPLY_PRICE_REQUIRED');
  assert.equal(row(zero.id).quantity,20);

  const noCost=item('Missing cost price item');
  db.prepare('UPDATE inventory SET cost_price=0 WHERE id=?').run(noCost.id);
  const noCostCtx=context('Missing cost block');
  const noCostBill=await bill(noCostCtx,[stockLine(noCost,1)],{operation_id:randomUUID()});
  assert.equal(noCostBill.status,409,JSON.stringify(noCostBill.data));
  assert.equal(noCostBill.data.code,'SUPPLY_COST_REQUIRED');
  assert.equal(row(noCost.id).quantity,20);
});

test('legacy credit notes must be classified and finance lists remain searchable and paginated', async () => {
  const ctx=context('Legacy allocation search target');
  const original=await bill(ctx,[standardFee()],{
    status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID(),
  });
  assert.equal(original.status,201,JSON.stringify(original.data));

  const refundId=Number(db.prepare(`
    INSERT INTO billing_refunds (
      credit_note_number,billing_id,amount,refund_method,refund_date,reason,
      external_reference,issued_by_user_id,issued_by_name,issued_by_role,operation_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `OCS-CN-LEGACY-${fixtureIndex}`,original.data.id,125,'cash',today,
    'Imported historical credit before allocation controls',null,null,'Legacy import','admin',randomUUID(),
  ).lastInsertRowid);

  const before=await api('GET','/billing/reconciliation','accountant');
  assert.equal(before.status,200,JSON.stringify(before.data));
  assert.ok(before.data.issues.some(issue=>issue.type==='refund_allocation_missing' && issue.refund_id===refundId));

  const classified=await api('POST',`/billing/refunds/${refundId}/allocation`,'accountant',{
    allocation_type:'service_non_stock',
    reason:'Verified against the signed historical consultation credit note',
  });
  assert.equal(classified.status,201,JSON.stringify(classified.data));
  assert.equal(classified.data.allocation.refund_id,refundId);
  assert.equal(classified.data.allocation.amount,125);
  assert.equal(classified.data.allocation.allocation_type,'service_non_stock');
  assert.equal((await api('POST',`/billing/refunds/${refundId}/allocation`,'accountant',{
    allocation_type:'service_non_stock',reason:'Attempted duplicate historical classification',
  })).status,409);
  const event=db.prepare("SELECT * FROM billing_events WHERE bill_id=? AND event_type='refund_allocation_reconciled'").get(original.data.id);
  assert.ok(event);
  assert.match(event.reason,/signed historical consultation/i);

  const after=await api('GET','/billing/reconciliation','accountant');
  assert.equal(after.status,200,JSON.stringify(after.data));
  assert.equal(after.data.issues.some(issue=>issue.type==='refund_allocation_missing' && issue.refund_id===refundId),false);

  const bills=await api('GET',`/billing?paginated=1&search=${encodeURIComponent('Legacy allocation search')}&limit=10&offset=0`,'accountant');
  assert.equal(bills.status,200,JSON.stringify(bills.data));
  assert.equal(bills.data.total,1);
  assert.equal(bills.data.bills[0].id,original.data.id);
  const doctorName=db.prepare('SELECT full_name FROM doctors WHERE id=?').get(doctorId).full_name;
  const billsByDoctor=await api('GET',`/billing?paginated=1&search=${encodeURIComponent(doctorName)}&limit=100&offset=0`,'accountant');
  assert.equal(billsByDoctor.status,200,JSON.stringify(billsByDoctor.data));
  assert.ok(billsByDoctor.data.bills.some(entry=>entry.id===original.data.id));
  const patients=await api('GET',`/billing/patient-summary?paginated=1&search=${encodeURIComponent('Legacy allocation search')}&limit=10&offset=0`,'accountant');
  assert.equal(patients.status,200,JSON.stringify(patients.data));
  assert.equal(patients.data.total,1);
  assert.equal(patients.data.patients[0].patient_id,ctx.patientId);
  assert.equal(patients.data.totals.total_billed,2000);
  assert.equal(patients.data.totals.refunded_amount,125);
});

test('historical supply credits require and record the physical stock outcome', async () => {
  const ctx=context('Legacy supply credit');
  const stock=item('Legacy credited supply',20);
  const original=await bill(ctx,[standardFee(),stockLine(stock,1)],{
    status:'paid',payment_method:'cash',payment_date:today,operation_id:randomUUID(),
  });
  assert.equal(original.status,201,JSON.stringify(original.data));
  assert.equal(row(stock.id).quantity,19);
  const submittedItems=original.data.items.filter(line=>Number(line.inventory_item_id||0)===stock.id);
  const submissionId=completedQuickSubmission({bill:original.data,ctx,items:submittedItems});
  const refundId=Number(db.prepare(`
    INSERT INTO billing_refunds (
      credit_note_number,billing_id,amount,refund_method,refund_date,reason,
      external_reference,issued_by_user_id,issued_by_name,issued_by_role,operation_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `OCS-CN-LEGACY-SUPPLY-${fixtureIndex}`,original.data.id,25,'cash',today,
    'Imported historical supply credit note',null,null,'Legacy import','admin',randomUUID(),
  ).lastInsertRowid);

  const missingDisposition=await api('POST',`/billing/refunds/${refundId}/allocation`,'accountant',{
    allocation_type:'supply_submission',submission_id:submissionId,
    reason:'Verified against the historical supply return record',operation_id:randomUUID(),
  });
  assert.equal(missingDisposition.status,400,JSON.stringify(missingDisposition.data));
  assert.equal(row(stock.id).quantity,19);

  const classified=await api('POST',`/billing/refunds/${refundId}/allocation`,'accountant',{
    allocation_type:'supply_submission',submission_id:submissionId,
    disposition:'returned_to_stock',
    reason:'Verified unopened return against the historical stock sheet',operation_id:randomUUID(),
  });
  assert.equal(classified.status,201,JSON.stringify(classified.data));
  assert.equal(classified.data.allocation.submission_id,submissionId);
  assert.equal(classified.data.correction.disposition,'returned_to_stock');
  assert.equal(row(stock.id).quantity,20);
  const correction=db.prepare('SELECT * FROM billing_supply_corrections WHERE refund_id=?').get(refundId);
  assert.ok(correction);
  assert.deepEqual(JSON.parse(correction.original_movement_ids_json),submittedItems.flatMap(line=>line.inventory_movement_ids));
  assert.ok(JSON.parse(correction.reversal_movement_ids_json).length>0);
  const reconciled=await api('GET','/billing/reconciliation','accountant');
  assert.equal(reconciled.status,200,JSON.stringify(reconciled.data));
  assert.equal(reconciled.data.issues.some(issue=>issue.refund_id===refundId),false);
});

test('doctor reconciliation never exposes another doctor credit note', async () => {
  const otherDoctorId=Number(db.prepare('SELECT id FROM doctors WHERE id != ? ORDER BY id LIMIT 1').get(doctorId).id);
  const patientId=Number(db.prepare("INSERT INTO patients (full_name,first_name,last_name,patient_identifier,age,contact_number,patient_contact_number,address,assigned_doctor_id) VALUES ('Scoped Other Doctor','Scoped','Doctor',?,40,'57000000','57000000','Scope test',?)")
    .run(`AUDIT-OTHER-${++fixtureIndex}`,otherDoctorId).lastInsertRowid);
  const appointmentId=Number(db.prepare("INSERT INTO appointments (patient_id,doctor_id,appointment_date,appointment_time,status) VALUES (?,?,?,'09:30','completed')")
    .run(patientId,otherDoctorId,today).lastInsertRowid);
  const consultationId=Number(db.prepare("INSERT INTO consultations (appointment_id,patient_id,doctor_id,consultation_date,doctor_notes) VALUES (?,?,?,?, 'Other doctor scope')")
    .run(appointmentId,patientId,otherDoctorId,today).lastInsertRowid);
  const otherBill=await api('POST','/billing/test-support/create','admin',{
    consultation_id:consultationId,patient_id:patientId,items:[standardFee()],status:'paid',
    payment_method:'cash',payment_date:today,operation_id:randomUUID(),
  });
  assert.equal(otherBill.status,201,JSON.stringify(otherBill.data));
  const refundId=Number(db.prepare(`
    INSERT INTO billing_refunds (
      credit_note_number,billing_id,amount,refund_method,refund_date,reason,
      external_reference,issued_by_user_id,issued_by_name,issued_by_role,operation_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `OCS-CN-OTHER-${fixtureIndex}`,otherBill.data.id,100,'cash',today,
    'Other doctor historical credit note',null,null,'Legacy import','admin',randomUUID(),
  ).lastInsertRowid);

  const doctorReview=await api('GET','/billing/reconciliation','doctor');
  assert.equal(doctorReview.status,200,JSON.stringify(doctorReview.data));
  assert.equal(doctorReview.data.issues.some(issue=>issue.refund_id===refundId),false);
  assert.equal(doctorReview.data.issues.some(issue=>issue.type==='day_close_missing'),false);
  const financeReview=await api('GET','/billing/reconciliation','accountant');
  assert.ok(financeReview.data.issues.some(issue=>issue.refund_id===refundId && issue.type==='refund_allocation_missing'));
  const classified=await api('POST',`/billing/refunds/${refundId}/allocation`,'accountant',{
    allocation_type:'service_non_stock',reason:'Verified other doctor historical consultation credit',
  });
  assert.equal(classified.status,201,JSON.stringify(classified.data));

  const priorDate=offsetLocalDate(-2);
  const priorCtx=context('Scoped reconciliation prior day',priorDate);
  const priorBill=await bill(priorCtx,[standardFee()],{
    status:'paid',payment_method:'cash',payment_date:priorDate,operation_id:randomUUID(),
  });
  assert.equal(priorBill.status,201,JSON.stringify(priorBill.data));
  const todayOnly=await api('GET',`/billing/reconciliation?dateFrom=${today}&dateTo=${today}`,'accountant');
  assert.equal(todayOnly.status,200,JSON.stringify(todayOnly.data));
  assert.equal(todayOnly.data.issues.some(issue=>issue.type==='day_close_missing' && issue.business_date===priorDate),false);
});

test('finance receives reminders for prior financial days that have not been closed', async () => {
  const yesterday=offsetLocalDate(-1);
  const reminderCtx=context('Outstanding day close',yesterday);
  const paid=await bill(reminderCtx,[standardFee()],{
    status:'paid',payment_method:'cash',payment_date:yesterday,operation_id:randomUUID(),
  });
  assert.equal(paid.status,201,JSON.stringify(paid.data));
  assert.equal((await api('GET','/billing/day-close/outstanding','doctor')).status,403);
  const outstanding=await api('GET','/billing/day-close/outstanding','accountant');
  assert.equal(outstanding.status,200,JSON.stringify(outstanding.data));
  const reminder=outstanding.data.dates.find(entry=>entry.business_date===yesterday);
  assert.ok(reminder,JSON.stringify(outstanding.data));
  assert.ok(reminder.expected_total>=2000);

  db.prepare(`INSERT INTO billing_system_settings(id,cutover_date,reset_reason)
    VALUES (1,?,'Financial day close gate test')
    ON CONFLICT(id) DO UPDATE SET cutover_date=excluded.cutover_date,reset_reason=excluded.reset_reason`).run(yesterday);
  const nextCtx=context('Mandatory prior close gate');
  const nextInvoice=await bill(nextCtx,[standardFee()],{operation_id:randomUUID()});
  const blocked=await api('PATCH',`/billing/${nextInvoice.data.id}/pay`,'accountant',{
    amount:2000,payment_method:'cash',payment_date:today,operation_id:randomUUID(),expected_version:nextInvoice.data.row_version,
  });
  assert.equal(blocked.status,409,JSON.stringify(blocked.data));
  assert.equal(blocked.data.code,'PRIOR_DAY_CLOSE_REQUIRED');
  assert.equal(blocked.data.business_date,yesterday);

  const preview=await api('GET',`/billing/day-close?date=${yesterday}`,'accountant');
  const settlements=Object.fromEntries(['juice','card','ib'].map(method=>[method,{
    amount:preview.data.expected_totals[method].expected,
    reference:Math.abs(Number(preview.data.expected_totals[method].expected||0))>=0.005 ? `GATE-${method}-${fixtureIndex}` : '',
  }]));
  const closed=await api('POST','/billing/day-close','accountant',{
    business_date:yesterday,counted_cash:preview.data.expected_totals.cash.expected,settlements,
    notes:'Named finance sign-off before the next business day.',operation_id:randomUUID(),
  });
  assert.equal(closed.status,201,JSON.stringify(closed.data));
  const permitted=await api('PATCH',`/billing/${nextInvoice.data.id}/pay`,'accountant',{
    amount:2000,payment_method:'cash',payment_date:today,operation_id:randomUUID(),expected_version:nextInvoice.data.row_version,
  });
  assert.equal(permitted.status,200,JSON.stringify(permitted.data));
  db.prepare("UPDATE billing_system_settings SET cutover_date=NULL WHERE id=1").run();
});

test('finance can close a day once and closed dates reject later payments and refunds', async () => {
  const unpaidCtx=context('Closed day payment block');
  const unpaid=await bill(unpaidCtx,[standardFee()],{operation_id:randomUUID()});
  assert.equal(unpaid.status,201,JSON.stringify(unpaid.data));
  const refundableCtx=context('Closed day refund block');
  const refundable=await bill(refundableCtx,[standardFee()],{
    status:'paid',payment_method:'card',payment_date:today,operation_id:randomUUID(),
  });
  assert.equal(refundable.status,201,JSON.stringify(refundable.data));

  assert.equal((await api('GET',`/billing/day-close?date=${today}`,'doctor')).status,403);
  const preview=await api('GET',`/billing/day-close?date=${today}`,'accountant');
  assert.equal(preview.status,200,JSON.stringify(preview.data));
  assert.equal(preview.data.closing,null);
  assert.ok(preview.data.expected_totals.card.outflow >= 400, JSON.stringify(preview.data.expected_totals));
  assert.ok(preview.data.expected_totals.ib.outflow >= 160, JSON.stringify(preview.data.expected_totals));
  const operationId=randomUUID();
  const settlements=Object.fromEntries(['juice','card','ib'].map(method=>[method,{
    amount:preview.data.expected_totals[method].expected,
    reference:Math.abs(Number(preview.data.expected_totals[method].expected||0))>=0.005
      ? `CLOSE-${method}-${fixtureIndex}` : '',
  }]));
  const payload={
    business_date:today,
    counted_cash:preview.data.expected_totals.cash.expected,
    settlements,
    notes:'Daily finance settlement matched to recorded collections.',
    operation_id:operationId,
  };
  const closed=await api('POST','/billing/day-close','accountant',payload);
  assert.equal(closed.status,201,JSON.stringify(closed.data));
  assert.equal(closed.data.variance_total,0);
  assert.equal(closed.data.closed_by_role,'accountant');
  const replay=await api('POST','/billing/day-close','accountant',payload);
  assert.equal(replay.status,201,JSON.stringify(replay.data));
  assert.equal(replay.data.id,closed.data.id);
  assert.equal((await api('POST','/billing/day-close','accountant',{...payload,operation_id:randomUUID()})).status,409);
  assert.throws(()=>db.prepare('UPDATE financial_day_closings SET notes=? WHERE id=?').run('Changed later',closed.data.id),/immutable/);

  const adjustmentOperation=randomUUID();
  const adjusted=await api('POST',`/billing/day-close/${closed.data.id}/adjustments`,'accountant',{
    cash_delta:10,
    settlement_deltas:{juice:0,card:-5,ib:0},
    settlement_references:{juice:'',card:`CORRECTED-CARD-${fixtureIndex}`,ib:''},
    reason:'Corrected cash count and card settlement from signed close sheet.',
    operation_id:adjustmentOperation,
  });
  assert.equal(adjusted.status,201,JSON.stringify(adjusted.data));
  assert.equal(adjusted.data.adjustments.length,1);
  assert.equal(adjusted.data.effective_counted_cash,closed.data.counted_cash+10);
  assert.equal(adjusted.data.effective_variance_total,5);
  const adjustedReplay=await api('POST',`/billing/day-close/${closed.data.id}/adjustments`,'accountant',{
    cash_delta:10,settlement_deltas:{juice:0,card:-5,ib:0},settlement_references:{juice:'',card:`CORRECTED-CARD-${fixtureIndex}`,ib:''},
    reason:'Corrected cash count and card settlement from signed close sheet.',operation_id:adjustmentOperation,
  });
  assert.equal(adjustedReplay.status,201);assert.equal(adjustedReplay.data.adjustments.length,1);
  const adjustmentId=adjusted.data.adjustments[0].id;
  assert.throws(()=>db.prepare('UPDATE financial_day_close_adjustments SET reason=? WHERE id=?').run('Changed later',adjustmentId),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM financial_day_close_adjustments WHERE id=?').run(adjustmentId),/immutable/);

  const latePayment=await api('PATCH',`/billing/${unpaid.data.id}/pay`,'accountant',{
    payment_method:'cash',payment_date:today,expected_version:unpaid.data.row_version,
  });
  assert.equal(latePayment.status,409,JSON.stringify(latePayment.data));
  assert.equal(latePayment.data.code,'FINANCIAL_DAY_CLOSED');
  const lateRefund=await api('POST',`/billing/${refundable.data.id}/refunds`,'accountant',{
    amount:100,refund_method:'card',refund_date:today,
    reason:'Refund requested after finance day was closed',external_reference:`CARD-CLOSED-${fixtureIndex}`,operation_id:randomUUID(),
  });
  assert.equal(lateRefund.status,409,JSON.stringify(lateRefund.data));
  assert.equal(lateRefund.data.code,'FINANCIAL_DAY_CLOSED');
});
