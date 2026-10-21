const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-action-inbox-"));
process.env.DB_PATH = path.join(directory, "test.db");
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = "10000";
const { createApp } = require("../src/app");
const { db } = require("../src/db");
const { hashPassword } = require("../src/lib/security");
const workflow = require("../src/lib/operationalTasks");
let server, base, patientId, doctorId, actors = {};
async function api(method, route, actor, body) {
  const response = await fetch(`${base}/api/operational-tasks${route}`, { method,
    headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
function visit({ assigned = false, urgency = "routine", at = new Date().toISOString() } = {}) {
  return Number(db.prepare(`INSERT INTO visit_requests (patient_id,address,reason,status,assigned_doctor_id,urgency,created_at,updated_at)
    VALUES (?,'Test address','Test request',?,?,?,?,?)`).run(patientId, assigned ? "assigned" : "pending", assigned ? doctorId : null, urgency, at, at).lastInsertRowid);
}
function task(source, kind) { return db.prepare("SELECT * FROM operational_tasks WHERE source_type='visit' AND source_id=? AND kind=?").get(source, kind); }

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  patientId = db.prepare("SELECT id FROM patients ORDER BY id LIMIT 1").get().id;
  doctorId = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get().id;
  const otherId = db.prepare("SELECT id FROM doctors WHERE id!=? ORDER BY id LIMIT 1").get(doctorId).id;
  for (const [name, role, linked] of [["admin", "admin", null], ["operator", "operator", null], ["operator2", "operator", null], ["doctor", "doctor", doctorId], ["otherDoctor", "doctor", otherId], ["lab", "lab_tech", null], ["finance", "accountant", null]]) {
    const id = Number(db.prepare("INSERT INTO users (username,full_name,password_hash,role,doctor_id) VALUES (?,?,?,?,?)")
      .run(`action.${name}`, `Action ${name}`, hashPassword("ActionTestOnly!2026"), role, linked).lastInsertRowid);
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: `action.${name}`, password: "ActionTestOnly!2026" }) });
    const signed = await response.json(); assert.equal(response.status, 200);
    actors[name] = { id, role, doctor_id: linked, token: signed.token };
  }
  // The fixture uses only the dedicated actor linked to this doctor.
  db.prepare("UPDATE users SET is_active=0 WHERE role='doctor' AND doctor_id=? AND id!=?").run(doctorId, actors.doctor.id);
});
beforeEach(() => {
  db.exec("DELETE FROM operational_task_deliveries; DELETE FROM operational_task_events; DELETE FROM operational_tasks; DELETE FROM visit_requests;");
  db.prepare("UPDATE patients SET is_under_review=0").run();
  db.prepare("UPDATE users SET operation_status='offline' WHERE role IN ('operator','admin','lab_tech')").run();
  for (const name of ["operator", "operator2", "admin", "lab"]) db.prepare("UPDATE users SET operation_status='active' WHERE id=?").run(actors[name].id);
  db.prepare("UPDATE operational_task_policy SET policy_json=? WHERE id=1").run(JSON.stringify(workflow.DEFAULT_POLICY));
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test("tasks persist, deduplicate, and distribute to available operators without requiring push subscriptions", () => {
  const first = visit(); const second = visit(); workflow.reconcileOperationalTasks();
  const original = task(first, "dispatch");
  assert.equal(original.owner_user_id, actors.operator.id);
  assert.equal(task(second, "dispatch").owner_user_id, actors.operator2.id);
  workflow.ensureOperationalTaskSchema(); workflow.reconcileOperationalTasks();
  assert.equal(task(first, "dispatch").id, original.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operational_tasks WHERE source_type='visit'").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operational_task_deliveries WHERE task_id=?").get(original.id).n, 1);
});

test("acknowledgement records responsibility but does not resolve the work; revision prevents conflicting claims", async () => {
  const id = visit(); workflow.reconcileOperationalTasks(); const original = task(id, "dispatch");
  const accepted = await api("PATCH", `/${original.id}`, actors.operator, { action: "acknowledge", revision: original.revision });
  assert.equal(accepted.status, 200); assert.equal(accepted.data.task.status, "acknowledged");
  assert.ok(accepted.data.task.acknowledged_at); assert.equal(accepted.data.task.resolved_at, null);
  assert.equal((await api("PATCH", `/${original.id}`, actors.operator2, { action: "acknowledge", revision: original.revision })).status, 409);
  assert.equal((await api("PATCH", `/${original.id}`, actors.operator, { action: "resolve", revision: accepted.data.task.revision, note: "Trying to skip source work" })).status, 400);
});

test("handover preserves deadlines, requires a note and survives reconciliation without acknowledging the new owner", async () => {
  const id = visit(); workflow.reconcileOperationalTasks(); const original = task(id, "dispatch");
  assert.equal((await api("PATCH", `/${original.id}`, actors.operator, { action: "handover", revision: original.revision, owner_user_id: actors.operator2.id })).status, 400);
  const result = await api("PATCH", `/${original.id}`, actors.operator, { action: "handover", revision: original.revision, owner_user_id: actors.operator2.id, note: "Shift handover: assignment still needed." });
  assert.equal(result.status, 200); workflow.reconcileOperationalTasks();
  const handed = task(id, "dispatch"); assert.equal(handed.owner_user_id, actors.operator2.id);
  assert.equal(handed.acknowledged_at, null); assert.equal(handed.due_at, original.due_at);
  assert.equal((await api("PATCH", `/${original.id}`, actors.operator, { action: "acknowledge", revision: handed.revision })).status, 409);
});

test("overdue checks escalate once per level, including unowned work, without a dashboard request", () => {
  const now = Date.now(); const id = visit({ at: new Date(now).toISOString(), urgency: "urgent" });
  workflow.reconcileOperationalTasks({ now }); workflow.reconcileOperationalTasks({ now: now + 6 * 60000 });
  assert.equal(task(id, "dispatch").escalation_level, 1);
  workflow.reconcileOperationalTasks({ now: now + 7 * 60000 }); assert.equal(task(id, "dispatch").escalation_level, 1);
  workflow.reconcileOperationalTasks({ now: now + 37 * 60000 }); assert.equal(task(id, "dispatch").escalation_level, 2);
  assert.equal(task(id, "dispatch").supervisor_user_id, actors.admin.id);
  db.prepare("UPDATE users SET operation_status='offline' WHERE role='operator'").run();
  const unowned = visit(); workflow.reconcileOperationalTasks();
  assert.equal(task(unowned, "dispatch").owner_user_id, null); assert.equal(task(unowned, "dispatch").escalation_level, 1);
});

test("cancellation resolves source tasks and cancels unsent pushes", async () => {
  const id = visit(); workflow.reconcileOperationalTasks(); const original = task(id, "dispatch");
  db.prepare("UPDATE visit_requests SET status='cancelled' WHERE id=?").run(id); workflow.reconcileOperationalTasks();
  const sent = []; await workflow.deliverOperationalPush({ send: async (...args) => { sent.push(args); return { ok: true }; } });
  assert.equal(task(id, "dispatch").status, "resolved"); assert.equal(sent.length, 0);
  assert.equal(db.prepare("SELECT status FROM operational_task_deliveries WHERE task_id=?").get(original.id).status, "cancelled");
});

test("doctor reassignment removes old doctor's access and cancels their pending delivery", async () => {
  const id = visit({ assigned: true }); workflow.reconcileOperationalTasks(); const original = task(id, "doctor_assignment");
  assert.equal((await api("GET", `/${original.id}/events`, actors.doctor)).status, 200);
  assert.equal((await api("GET", `/${original.id}/events`, actors.otherDoctor)).status, 404);
  assert.equal((await api("GET", `/${original.id}/events`, actors.operator)).status, 200);
  assert.equal((await api("PATCH", `/${original.id}`, actors.operator, { action: "acknowledge", revision: original.revision })).status, 403);
  db.prepare("UPDATE visit_requests SET assigned_doctor_id=?,operational_assigned_at=? WHERE id=?").run(actors.otherDoctor.doctor_id, new Date().toISOString(), id);
  workflow.reconcileOperationalTasks();
  assert.equal((await api("GET", `/${original.id}/events`, actors.doctor)).status, 404);
  const sent = []; await workflow.deliverOperationalPush({ send: async userId => { sent.push(userId); return { ok: true }; } });
  assert.ok(!sent.includes(actors.doctor.id));
  assert.equal(task(id, "doctor_assignment").acknowledged_at, null);
});

test("an assigned doctor can decline with a reason and dispatch work reopens", async () => {
  const id = visit(); workflow.reconcileOperationalTasks(); const dispatch = task(id, "dispatch");
  db.prepare("UPDATE visit_requests SET status='assigned',assigned_doctor_id=? WHERE id=?").run(doctorId, id); workflow.reconcileOperationalTasks();
  assert.equal(task(id, "dispatch").status, "resolved");
  const assignment = task(id, "doctor_assignment");
  const result = await api("PATCH", `/${assignment.id}`, actors.doctor, { action: "decline", revision: assignment.revision, note: "Unavailable for this visit; dispatch must reassign." });
  assert.equal(result.status, 200); assert.equal(db.prepare("SELECT assigned_doctor_id FROM visit_requests WHERE id=?").get(id).assigned_doctor_id, null);
  assert.equal(task(id, "dispatch").status, "open"); assert.equal(task(id, "dispatch").id, dispatch.id);
  assert.ok(db.prepare("SELECT 1 FROM operational_task_events WHERE task_id=? AND action='returned_to_dispatch'").get(dispatch.id));
});

test("due reviews use Mauritius dates, retain overdue deadlines and close after rescheduling", () => {
  const now = Date.parse("2030-01-09T21:00:00Z"); // 10 January locally.
  db.prepare("UPDATE patients SET is_under_review=1,review_assigned_doctor_id=?,review_due_date='2030-01-10' WHERE id=?").run(doctorId, patientId);
  workflow.reconcileOperationalTasks({ now });
  const review = db.prepare("SELECT * FROM operational_tasks WHERE kind='review_due' AND source_id=?").get(patientId);
  assert.equal(review.due_at, "2030-01-10T13:00:00.000Z"); assert.equal(review.owner_user_id, actors.doctor.id);
  db.prepare("UPDATE patients SET review_due_date='2030-01-15' WHERE id=?").run(patientId);
  workflow.reconcileOperationalTasks({ now }); assert.equal(db.prepare("SELECT status FROM operational_tasks WHERE id=?").get(review.id).status, "resolved");
});

test("uploading, editing and removing report attachments never creates review tasks or pushes", async () => {
  const headers = { Authorization: `Bearer ${actors.admin.token}` };
  const payload = { patient_id: String(patientId), report_title: "Already reviewed report", report_date: "2026-10-14", report_details: "Reviewed before upload." };
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) form.append(key, value);
  form.append("attachments", new Blob(["%PDF-1.4\nTest report"], { type: "application/pdf" }), "reviewed-report.pdf");
  const uploaded = await fetch(`${base}/api/lab-reports`, { method: "POST", headers, body: form });
  assert.equal(uploaded.status, 201);
  const report = await uploaded.json();
  assert.equal(report.attachments.length, 1);
  async function assertNoReportTasks() {
    const inbox = await api("GET", "/", actors.admin);
    assert.equal(inbox.status, 200);
    assert.ok(!inbox.data.tasks.some(row => row.source_type === "report"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operational_tasks WHERE kind='report_review'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operational_task_deliveries").get().n, 0);
  }
  await assertNoReportTasks();
  const edited = await fetch(`${base}/api/lab-reports/${report.id}`, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, report_details: "Updated report, already reviewed." }) });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).attachments.length, 1);
  await assertNoReportTasks();
  const downloaded = await fetch(`${base}/api/lab-reports/attachments/${report.attachments[0].id}/download`, { headers });
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), "%PDF-1.4\nTest report");
  const removed = await fetch(`${base}/api/lab-reports/attachments/${report.attachments[0].id}`, { method: "DELETE", headers });
  assert.equal(removed.status, 204);
  await assertNoReportTasks();
  assert.equal(db.prepare("SELECT report_details FROM lab_reports WHERE id=?").get(report.id).report_details, "Updated report, already reviewed.");
  db.prepare("DELETE FROM lab_reports WHERE id=?").run(report.id);
});

test("existing report review reminders close once, keep their history and cancel unsent alerts", async () => {
  const reportId = Number(db.prepare("INSERT INTO lab_reports (patient_id,report_title,report_date,report_details) VALUES (?,'Reviewed report','2026-10-14','Reviewed before upload')").run(patientId).lastInsertRowid);
  // Recreate a task left by the previous report-review workflow.
  const visitId = visit(); workflow.reconcileOperationalTasks(); const legacy = task(visitId, "dispatch");
  db.prepare("UPDATE operational_tasks SET task_key=?,source_type='report',source_id=?,kind='report_review',title=?,owner_role='doctor',owner_user_id=?,clinical_owner_id=? WHERE id=?")
    .run(`report:${reportId}:report_review`, reportId, `Report #${reportId} awaits clinical review`, actors.doctor.id, actors.doctor.id, legacy.id);
  db.prepare("DELETE FROM visit_requests WHERE id=?").run(visitId);
  const inbox = await api("GET", "/", actors.admin);
  assert.equal(inbox.data.counts.open, 0); assert.equal(inbox.data.counts.overdue, 0); assert.equal(inbox.data.counts.escalated, 0);
  const retired = db.prepare("SELECT * FROM operational_tasks WHERE id=?").get(legacy.id);
  assert.equal(retired.status, "resolved");
  assert.match(retired.resolution_note, /step removed/);
  assert.ok(db.prepare("SELECT 1 FROM operational_task_events WHERE task_id=? AND action='created'").get(legacy.id));
  assert.equal(db.prepare("SELECT status FROM operational_task_deliveries WHERE task_id=?").get(legacy.id).status, "cancelled");
  const sent = []; await workflow.deliverOperationalPush({ send: async (...args) => { sent.push(args); return { ok: true }; } });
  assert.equal(sent.length, 0);
  const resolved = await api("GET", "/?status=resolved", actors.admin);
  assert.ok(resolved.data.tasks.some(row => row.id === legacy.id));
  const history = await api("GET", `/${legacy.id}/events`, actors.doctor);
  assert.match(history.data.events.find(row => row.action === "resolved").note, /step removed/);
  for (const action of ["acknowledge", "resolve", "flag_urgent"]) {
    assert.equal((await api("PATCH", `/${legacy.id}`, actors.admin, { action, revision: retired.revision, note: "Stale browser" })).status, 409);
  }
  db.prepare("UPDATE lab_reports SET report_details='Updated after removal' WHERE id=?").run(reportId);
  workflow.reconcileOperationalTasks();
  assert.equal(db.prepare("SELECT status FROM operational_tasks WHERE id=?").get(legacy.id).status, "resolved");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operational_task_events WHERE task_id=? AND action='resolved'").get(legacy.id).n, 1);
  assert.equal(db.prepare("SELECT report_details FROM lab_reports WHERE id=?").get(reportId).report_details, "Updated after removal");
  db.prepare("DELETE FROM lab_reports WHERE id=?").run(reportId);
});

test("delivery failures retry with backoff; push acceptance does not acknowledge or resolve the task", async () => {
  const now = Date.now(); const id = visit({ at: new Date(now).toISOString() }); workflow.reconcileOperationalTasks({ now });
  const original = task(id, "dispatch"); let calls = 0;
  const send = async () => ({ ok: ++calls > 1, reason: "temporary_failure" });
  await workflow.deliverOperationalPush({ now, send }); assert.equal(calls, 1);
  await workflow.deliverOperationalPush({ now: now + 1000, send }); assert.equal(calls, 1);
  await workflow.deliverOperationalPush({ now: now + 61000, send }); assert.equal(calls, 2);
  const delivered = db.prepare("SELECT * FROM operational_task_deliveries WHERE task_id=?").get(original.id);
  assert.equal(delivered.status, "accepted"); assert.equal(delivered.attempts, 2);
  assert.equal(task(id, "dispatch").status, "open"); assert.equal(task(id, "dispatch").acknowledged_at, null);
});

test("policy updates require an administrator, validate limits and leave existing deadlines stable", async () => {
  const id = visit(); workflow.reconcileOperationalTasks(); const deadline = task(id, "dispatch").due_at;
  assert.equal((await api("PUT", "/policy", actors.operator, { dispatch_minutes: 20 })).status, 403);
  assert.equal((await api("PUT", "/policy", actors.admin, { dispatch_minutes: -1 })).status, 400);
  assert.equal((await api("PUT", "/policy", actors.admin, { supervisor_user_id: actors.doctor.id })).status, 400);
  assert.equal((await api("PUT", "/policy", actors.admin, { dispatch_minutes: 20, supervisor_user_id: actors.admin.id })).status, 200);
  workflow.reconcileOperationalTasks(); assert.equal(task(id, "dispatch").due_at, deadline);
});

test("anonymous and finance callers cannot access operational or clinical actions", async () => {
  assert.equal((await api("GET", "/", null)).status, 401);
  assert.equal((await api("GET", "/", actors.finance)).status, 403);
  const training = { ...actors.admin, is_read_only: true };
  const id = visit(); workflow.reconcileOperationalTasks(); const original = task(id, "dispatch");
  assert.throws(() => workflow.updateTask(original.id, training, { action: "acknowledge", revision: original.revision }), error => error.status === 403);
});

test("legacy report review response targets are no longer exposed or accepted", async () => {
  db.prepare("UPDATE operational_task_policy SET policy_json=? WHERE id=1").run(JSON.stringify({ ...workflow.DEFAULT_POLICY, report_hours: 24 }));
  const result = await api("GET", "/policy", actors.admin);
  assert.equal(result.status, 200);
  assert.ok(!Object.hasOwn(result.data.policy, "report_hours"));
  assert.ok(!Object.hasOwn(result.data.defaults, "report_hours"));
  assert.equal((await api("PUT", "/policy", actors.admin, result.data.policy)).status, 200);
  assert.equal((await api("PUT", "/policy", actors.admin, { report_hours: 24 })).status, 400);
});

test("acknowledging overdue work keeps the supervisor's escalation deliverable", async () => {
  const now = Date.now(); const id = visit({ at: new Date(now - 20 * 60000).toISOString() });
  workflow.reconcileOperationalTasks({ now }); const original = task(id, "dispatch");
  assert.equal(original.escalation_level, 1);
  workflow.updateTask(original.id, actors.operator, { action: "acknowledge", revision: original.revision }, { now });
  const sent = []; await workflow.deliverOperationalPush({ now, send: async userId => { sent.push(userId); return { ok: true }; } });
  assert.ok(sent.includes(actors.admin.id));
  assert.equal(task(id, "dispatch").status, "acknowledged");
});

test("arrival deadlines follow the latest ETA update, ignore unrelated notes, and alert only when overdue", () => {
  const now = Date.now(); const id = visit({ assigned: true });
  db.prepare("UPDATE visit_requests SET status='en_route',eta_minutes=20,en_route_at=?,eta_updated_at=?,updated_at=? WHERE id=?")
    .run(new Date(now).toISOString(), new Date(now).toISOString(), new Date(now).toISOString(), id);
  workflow.reconcileOperationalTasks({ now }); let arrival = task(id, "arrival");
  assert.equal(arrival.due_at, new Date(now + 20 * 60000).toISOString());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operational_task_deliveries WHERE task_id=?").get(arrival.id).n, 0);
  db.prepare("UPDATE visit_requests SET eta_minutes=20,eta_updated_at=?,updated_at=? WHERE id=?")
    .run(new Date(now + 10 * 60000).toISOString(), new Date(now + 10 * 60000).toISOString(), id);
  workflow.reconcileOperationalTasks({ now: now + 10 * 60000 }); arrival = task(id, "arrival");
  assert.equal(arrival.due_at, new Date(now + 30 * 60000).toISOString());
  db.prepare("UPDATE visit_requests SET staff_notes='Ordinary team note',updated_at=? WHERE id=?").run(new Date(now + 15 * 60000).toISOString(), id);
  workflow.reconcileOperationalTasks({ now: now + 15 * 60000 }); assert.equal(task(id, "arrival").due_at, arrival.due_at);
  workflow.reconcileOperationalTasks({ now: now + 31 * 60000 }); assert.equal(task(id, "arrival").escalation_level, 1);
});

test("invalid legacy review dates become scheduling actions instead of breaking the inbox", () => {
  db.prepare("UPDATE patients SET is_under_review=1,review_assigned_doctor_id=?,review_due_date='2026-99-99' WHERE id=?").run(doctorId, patientId);
  workflow.reconcileOperationalTasks();
  const review = db.prepare("SELECT * FROM operational_tasks WHERE kind='review_scheduling' AND source_id=?").get(patientId);
  assert.ok(review); assert.ok(Number.isFinite(Date.parse(review.due_at)));
});
