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
async function report(date=today,basis='visit') {
  return (await api('GET',`/dashboard/live-report?doctorPeriod=daily&doctorDate=${date}&locationPeriod=daily&locationDate=${date}&revenueDate=${date}&dateBasis=${basis}`)).data;
}
function row(id) {return db.prepare('SELECT * FROM inventory WHERE id = ?').get(id);}


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
  const before=await report(); assert.equal((await api('DELETE',`/patients/${ctx.patientId}`)).status,204);
  assert.equal((await report()).revenueStatement.paidRevenue,before.revenueStatement.paidRevenue);
  const detail=await api('GET',`/billing/${original.data.id}`,'doctor'); assert.equal(detail.status,200);
  assert.ok(detail.data.patient_archived_at);
  const list=await api('GET',`/billing?patientId=${ctx.patientId}`,'doctor'); assert.equal(list.data.length,1);
  const summary=await api('GET','/billing/patient-summary','doctor'); assert.ok(summary.data.some(r=>r.patient_id===ctx.patientId && r.paid_amount===700));
});

test('payments validate dates, retry harmlessly, and require documented admin correction', async () => {
  const ctx=context('Payments'); const original=await bill(ctx,fee(800)); const url=`/billing/${original.data.id}`;
  const pay={payment_method:'cash',payment_date:'2026-08-31'};
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
