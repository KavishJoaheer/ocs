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
const { getTodayLocal } = require('../src/lib/utils');
const today = getTodayLocal();
const tokens = {};
const doctorId = db.prepare('SELECT id FROM doctors ORDER BY id LIMIT 1').get().id;
const folderId = db.prepare('SELECT id FROM inventory_folders ORDER BY id DESC LIMIT 1').get().id;
let base, server, fixtureIndex = 0;
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
  const res = await fetch(base + route, {
    method, headers: { 'Content-Type':'application/json', ...(tokens[role] ? {Authorization:'Bearer ' + tokens[role]} : {}) },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
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
async function bill(ctx, lines, extra = {}) {
  return api('POST','/billing','doctor',{consultation_id:ctx.consultationId,patient_id:ctx.patientId,items:lines,status:'unpaid',...extra});
}
function stockLine(it,qty=2) {return {description:'Audit medicine',type:'Sale',inventory_item_id:it.id,quantity:qty,amount:25*qty};}
function fee(amount=1000) {return [{description:'Consultation fee',type:'Sale',amount}];}
function standardFee(type='Day Consultation', amount=2000) {return {description:type,type:'Sale',amount,quantity:1,is_consultation_fee:true};}
async function report(date=today,basis='visit') {
  return (await api('GET',`/dashboard/live-report?doctorPeriod=daily&doctorDate=${date}&locationPeriod=daily&locationDate=${date}&revenueDate=${date}&dateBasis=${basis}`)).data;
}
function row(id) {return db.prepare('SELECT * FROM inventory WHERE id = ?').get(id);}

test('operators can issue reconciled unpaid invoices without payment or correction powers', async () => {
  const ctx=context('Operator invoice'); const it=item('Operator invoice medicine');
  const options=await api('GET','/billing/consultation-options','operator');
  assert.equal(options.status,200,JSON.stringify(options.data));
  const option=options.data.find(row=>row.id===ctx.consultationId);
  assert.ok(option); assert.equal(Object.hasOwn(option,'doctor_notes'),false);

  const issued=await api('POST','/billing','operator',{
    consultation_id:ctx.consultationId,
    patient_id:ctx.patientId,
    items:[standardFee(),stockLine(it,1)],
    status:'unpaid',
  });
  assert.equal(issued.status,201,JSON.stringify(issued.data));
  assert.equal(issued.data.status,'unpaid'); assert.equal(row(it.id).quantity,19);
  assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(issued.data.updated_by_user_id).role,'operator');
  assert.ok((await api('GET','/billing','operator')).data.some(b=>b.id===issued.data.id));

  const paidCtx=context('Operator paid block');
  assert.equal((await api('POST','/billing','operator',{
    consultation_id:paidCtx.consultationId,patient_id:paidCtx.patientId,items:[standardFee()],
    status:'paid',payment_method:'cash',payment_date:today,
  })).status,403);
  const manualCtx=context('Operator manual block');
  assert.equal((await api('POST','/billing','operator',{
    consultation_id:manualCtx.consultationId,patient_id:manualCtx.patientId,
    items:[standardFee(),{description:'Custom service',type:'Sale',amount:500,quantity:1}],status:'unpaid',
  })).status,403);
  assert.equal((await api('PUT',`/billing/${issued.data.id}`,'operator',{items:issued.data.items})).status,403);
  assert.equal((await api('PATCH',`/billing/${issued.data.id}/pay`,'operator',{payment_method:'cash',payment_date:today})).status,403);
  assert.equal((await api('POST',`/billing/${issued.data.id}/void`,'operator',{reason:'Operator cannot void'})).status,403);
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
  const edited=await api('PUT',`/billing/${original.data.id}`,'doctor',{items,expected_version:original.data.row_version});
  assert.equal(edited.status,200,JSON.stringify(edited.data)); assert.equal(edited.data.total_amount,1250);
  assert.equal(row(it.id).quantity,18);
  const stripped=await api('PUT',`/billing/${original.data.id}`,'doctor',{items:fee()}); assert.equal(stripped.status,400);
  const stale=await api('PUT',`/billing/${original.data.id}`,'doctor',{items,expected_version:original.data.row_version}); assert.equal(stale.status,409);
  assert.equal(db.prepare('SELECT total_amount FROM billing WHERE id=?').get(original.data.id).total_amount,1250);
});

test('voiding reverses stock and excludes revenue, keeps audit details and blocks later payments', async () => {
  const ctx=context('Void'); const it=item('Void medicine');
  const original=await bill(ctx,[...fee(),stockLine(it)],{status:'paid',payment_method:'cash',payment_date:today});
  const before=await report();
  const result=await api('DELETE',`/consultations/${ctx.consultationId}`,'admin',{reason:'Incorrect visit entered during testing'});
  assert.equal(result.status,204,JSON.stringify(result.data)); assert.equal(row(it.id).quantity,20);
  const after=await report(); assert.equal(after.revenueStatement.paidRevenue,before.revenueStatement.paidRevenue-1050);
  assert.ok(!after.billingRevenueReport.rows.some(r=>r.bill_id===original.data.id));
  assert.ok(!(await api('GET','/billing')).data.some(r=>r.id===original.data.id));
  const detail=await api('GET',`/billing/${original.data.id}`,'doctor'); assert.equal(detail.status,200);
  assert.ok(detail.data.history.some(e=>e.event_type==='voided'));
  const voidedList=await api('GET','/billing?status=voided','doctor');
  assert.ok(voidedList.data.some(b=>b.id===original.data.id));
  assert.equal((await api('PATCH',`/billing/${original.data.id}/pay`,'admin',{payment_method:'cash',payment_date:today})).status,409);
  assert.equal((await api('PUT',`/billing/${original.data.id}`,'admin',{items:original.data.items,correction_reason:'Should still be blocked'})).status,409);
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

test('payments validate dates, retry harmlessly, and require documented admin correction', async () => {
  const ctx=context('Payments'); const original=await bill(ctx,fee(800)); const url=`/billing/${original.data.id}`;
  const pay={payment_method:'cash',payment_date:'2026-08-31',expected_version:original.data.row_version};
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
  assert.equal(changed.status,200,JSON.stringify(changed.data)); assert.equal(changed.data.payment_date,'2026-09-01');
  const event=changed.data.history[0]; assert.equal(JSON.parse(event.before_json).payment_date,'2026-08-31');
  assert.equal(event.reason,'Corrected the collection date'); assert.ok(event.actor_id);
  assert.equal(event.actor_name,'Integrity admin');
  db.prepare("UPDATE users SET full_name='Renamed administrator' WHERE id=?").run(event.actor_id);
  assert.equal((await api('GET',url)).data.history[0].actor_name,'Integrity admin');
  db.prepare("UPDATE users SET full_name='Integrity admin' WHERE id=?").run(event.actor_id);
  assert.throws(()=>db.prepare('DELETE FROM billing_events WHERE id=?').run(event.id),/append-only/);
  assert.equal((await bill(context('Invalid paid create'),fee(),{status:'paid',payment_method:'cash',payment_date:'2026-02-30'})).status,400);
});

test('historical movement prices and allocation costs remain stable after catalogue edits', async () => {
  const ctx=context('Prices'); const it=item('Snapshot price medicine');
  db.prepare('UPDATE inventory_batches SET unit_cost=7 WHERE id=?').run(it.batchId);
  const created=await bill(ctx,[stockLine(it)]); assert.equal(created.status,201);
  const history=async()=>(await api('GET','/inventory/activity-history?search=Snapshot%20price%20medicine')).data;
  const before=await history(); assert.equal(before.rows[0].value_rs,50); assert.equal(before.analytics.total_value_cost_rs,14);
  assert.equal((await api('PUT',`/inventory/items/${it.id}?doctorId=${doctorId}`,'admin',{cost_price:40,selling_price:100})).status,200);
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
});

test('transport counts each visit, not unique patients or invoices, and excludes voided consultations', async () => {
  const date='2027-01-15'; const ctx=context('Transport',date);
  const appointmentId=Number(db.prepare("INSERT INTO appointments(patient_id,doctor_id,appointment_date,appointment_time,status) VALUES (?,?,?,'17:00','completed')").run(ctx.patientId,doctorId,date).lastInsertRowid);
  const second=Number(db.prepare("INSERT INTO consultations(appointment_id,patient_id,doctor_id,consultation_date,doctor_notes) VALUES (?,?,?,?,'Review visit')").run(appointmentId,ctx.patientId,doctorId,date).lastInsertRowid);
  const a=await bill(ctx,fee(2000),{status:'paid',payment_method:'cash',payment_date:date}); assert.equal(a.status,201);
  await bill({...ctx,consultationId:second},fee(2000),{status:'paid',payment_method:'cash',payment_date:date});
  await bill(ctx,fee(100),{operation_id:randomUUID()});
  const r=await report(date); assert.equal(r.revenueStatement.transportVisitCount,2);
  assert.equal(r.revenueStatement.transportBenefits,600); assert.equal(r.revenueStatement.doctorCommission,1600);
  assert.equal(r.revenueStatement.doctorNetRevenue,2200);
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
  const confirmed=await api('PUT',`/billing/${original.id}`,'doctor',{items,status:'paid',...pay,confirm_consultation_fee:true,expected_version:original.row_version});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));assert.equal(confirmed.data.total_amount,3000);assert.equal(confirmed.data.fee_review_required,0);
  const duplicate=await bill({...ctx,consultationId:created.data.id},fee(2000),{operation_id:randomUUID()});
  assert.equal(duplicate.status,409);assert.equal(duplicate.data.existing_bill_id,original.id);
  const additional=await bill({...ctx,consultationId:created.data.id},[{description:'Additional procedure',type:'Sale',amount:100}],{operation_id:randomUUID()});assert.equal(additional.status,201);
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
  return api('POST',`/inventory/items/${it.id}/actions`,'doctor',deduction(it,{reason:'Sale',patient_id:ctx.patientId,quantity:2,...extra}));
}

test('eight-day-old dispensing links by its visit and keeps its original price without stock deduction', async () => {
  const date=db.prepare("SELECT date('now','+4 hours','-8 days') AS day").get().day;
  const ctx=context('Delayed same visit',date);const it=item('Delayed linked medicine');
  assert.equal((await fieldSale(ctx,it,{dispensed_on:date})).status,201);
  db.prepare("UPDATE inventory_movements SET created_at=datetime('now','-8 days') WHERE item_id=?").run(it.id);
  await api('PUT',`/inventory/items/${it.id}?doctorId=${doctorId}`,'admin',{selling_price:100});
  const first=await bill(ctx,[stockLine(it)],{operation_id:randomUUID()});assert.equal(first.status,201,JSON.stringify(first.data));
  assert.equal(first.data.total_amount,50);assert.equal(row(it.id).quantity,18);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE item_id=?').get(it.id).n,1);
  const h=(await api('GET','/inventory/activity-history?search=Delayed%20linked%20medicine')).data.rows[0];
  assert.equal(h.billing_id,first.data.id);assert.equal(h.billing_status,'Billed');assert.equal(h.value_rs,50);
  assert.equal(JSON.parse(h.meta_json).billing_status,'Pending Manual Entry'); // original event is retained
  assert.ok(first.data.items[0].dispensing_movement_ids.length);
});

test('ambiguous and partial dispensing blocks new deductions; explicit visit reconciliation and retries work', async () => {
  const ctx=context('Ambiguous visits');const it=item('Ambiguous medicine');
  const secondAppointment=Number(db.prepare("INSERT INTO appointments(patient_id,doctor_id,appointment_date,appointment_time,status) VALUES (?,?,?,'18:00','completed')").run(ctx.patientId,doctorId,today).lastInsertRowid);
  const secondId=Number(db.prepare("INSERT INTO consultations(appointment_id,patient_id,doctor_id,consultation_date,doctor_notes) VALUES (?,?,?,?,'Second visit')").run(secondAppointment,ctx.patientId,doctorId,today).lastInsertRowid);
  assert.equal((await fieldSale(ctx,it)).status,201);
  const m=db.prepare('SELECT id FROM inventory_movements WHERE item_id=?').get(it.id).id;
  assert.equal((await bill(ctx,[stockLine(it)],{operation_id:randomUUID()})).status,409);assert.equal(row(it.id).quantity,18);
  const line={...stockLine(it),dispensing_movement_ids:[m]};
  assert.equal((await bill(ctx,[{...line,quantity:1}],{operation_id:randomUUID()})).status,409);assert.equal(row(it.id).quantity,18);
  const op=randomUUID();const accepted=await bill(ctx,[line],{operation_id:op});assert.equal(accepted.status,201,JSON.stringify(accepted.data));
  assert.equal((await bill(ctx,[line],{operation_id:op})).data.id,accepted.data.id);
  assert.equal((await bill({...ctx,consultationId:secondId},[line],{operation_id:randomUUID()})).status,409);
  const other=context('Other patient');assert.equal((await bill(other,[line],{operation_id:randomUUID()})).status,409);
  assert.equal(row(it.id).quantity,18);
});

test('pending attachment uses frozen sale price and an invoice void does not invent a physical field return', async () => {
  const ctx=context('Pending automatic');db.prepare('DELETE FROM consultations WHERE id=?').run(ctx.consultationId);const it=item('Frozen pending medicine');
  await fieldSale(ctx,it,{dispensed_on:today});await api('PUT',`/inventory/items/${it.id}?doctorId=${doctorId}`,'admin',{selling_price:100});
  const c=await api('POST','/consultations','doctor',{appointment_id:ctx.appointmentId,consultation_date:today,doctor_notes:'Delayed documentation',consultation_type:'Day Consultation'});assert.equal(c.status,201);
  const b=(await api('GET',`/billing/visit/${c.data.id}`,'doctor')).data.bills[0];
  assert.equal(b.total_amount,2050);assert.equal(row(it.id).quantity,18);
  const h=(await api('GET','/inventory/activity-history?search=Frozen%20pending%20medicine')).data.rows[0];assert.equal(h.billing_id,b.id);assert.equal(h.value_rs,50);
  assert.equal((await api('DELETE',`/consultations/${c.data.id}`,'admin',{reason:'Duplicate clinical note in test'})).status,204);
  assert.equal(row(it.id).quantity,18);
  assert.equal(JSON.parse(db.prepare('SELECT meta_json FROM inventory_movements WHERE item_id=?').get(it.id).meta_json).billing_status,'Pending Manual Entry');
  const review=(await api('GET','/billing/reconciliation','doctor')).data;
  assert.ok(review.issues.some(i=>i.type==='unbilled_dispensing'&&i.movement_id===h.movement_id));assert.equal(review.stock,undefined);
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
  db.prepare('UPDATE billing SET items=? WHERE id=?').run('null',b.data.id);
  review=await api('GET','/billing/reconciliation');
  assert.equal(review.status,200);
  assert.ok(review.data.issues.some(i=>i.type==='invalid_bill' && i.bill_ids.includes(b.data.id)));
  db.prepare('UPDATE billing SET items=?,total_amount=2000 WHERE id=?').run(JSON.stringify(fee(2000)),b.data.id);
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
  const extra=await bill(ctx,[{description:'Additional service',amount:100,type:'Sale'}]);
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
  const resolved=await api('PATCH',`/billing/${extra.data.id}/pay`,'admin',{payment_method:'card',payment_date:today,expected_version:extra.data.row_version});
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
  const edited=await api('PUT',`/billing/${original.data.id}`,'admin',{items:fee(2000),expected_version:original.data.row_version});
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
