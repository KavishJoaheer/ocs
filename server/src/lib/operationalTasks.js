const { db } = require("../db");

const DEFAULT_POLICY = {
  dispatch_minutes: 15, urgent_dispatch_minutes: 5, assignment_minutes: 10,
  start_minutes: 30, escalation_minutes: 30,
  supply_hours: 4, supervisor_user_id: null,
};
const ACTIVE = "is_active=1 AND deleted_at IS NULL";
const schemaReady = new WeakSet();
const iso = value => new Date(value).toISOString();
function millis(value) {
  if (!value) return NaN;
  return Date.parse(/[zZ]|[+]\d\d:\d\d$/.test(value) ? value : `${String(value).replace(" ", "T")}Z`);
}
const after = (value, minutes) => iso(millis(value) + minutes * 60000);
const localDay = now => new Date(now + 4 * 3600000).toISOString().slice(0, 10);
const dayEnd = day => `${day}T13:00:00.000Z`; // 17:00 Mauritius.

function ensureOperationalTaskSchema(database = db) {
  if (schemaReady.has(database)) return;
  database.exec(`
    CREATE TABLE IF NOT EXISTS operational_task_policy (
      id INTEGER PRIMARY KEY CHECK(id=1), policy_json TEXT NOT NULL,
      initial_report_id INTEGER NOT NULL DEFAULT 0,
      enabled_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operational_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL, source_type TEXT NOT NULL, source_id INTEGER NOT NULL,
      source_version TEXT NOT NULL, patient_id INTEGER, title TEXT NOT NULL, url TEXT NOT NULL,
      owner_role TEXT NOT NULL, owner_user_id INTEGER REFERENCES users(id),
      manual_owner INTEGER NOT NULL DEFAULT 0,
      clinical_owner_id INTEGER REFERENCES users(id), priority TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
      acknowledgement_due_at TEXT NOT NULL, due_at TEXT NOT NULL,
      acknowledged_at TEXT, acknowledged_by INTEGER REFERENCES users(id),
      resolved_at TEXT, resolution_note TEXT NOT NULL DEFAULT '',
      escalation_level INTEGER NOT NULL DEFAULT 0, escalated_at TEXT,
      supervisor_user_id INTEGER REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_operational_tasks_owner ON operational_tasks(owner_user_id,status);
    CREATE INDEX IF NOT EXISTS idx_operational_tasks_due ON operational_tasks(status,due_at);
    CREATE TABLE IF NOT EXISTS operational_task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES operational_tasks(id),
      action TEXT NOT NULL, actor_user_id INTEGER REFERENCES users(id), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operational_task_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES operational_tasks(id),
      revision INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','failed','cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
      last_error TEXT, accepted_at TEXT, updated_at TEXT NOT NULL,
      UNIQUE(task_id,revision,user_id,reason)
    );
    CREATE INDEX IF NOT EXISTS idx_operational_delivery_pending ON operational_task_deliveries(status,next_attempt_at);
    CREATE TABLE IF NOT EXISTS operational_report_enrolments (
      report_id INTEGER PRIMARY KEY REFERENCES lab_reports(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS operational_worker_state (
      id INTEGER PRIMARY KEY CHECK(id=1), last_success_at TEXT, last_error TEXT
    );
    INSERT OR IGNORE INTO operational_worker_state (id) VALUES (1);
  `);
  const now = iso(Date.now());
  const reportId = database.prepare("SELECT COALESCE(MAX(id),0) AS id FROM lab_reports").get().id;
  database.prepare("INSERT OR IGNORE INTO operational_task_policy (id,policy_json,initial_report_id,enabled_at,updated_at) VALUES (1,?,?,?,?)")
    .run(JSON.stringify(DEFAULT_POLICY), reportId, now, now);
  const visitColumns = database.prepare("PRAGMA table_info(visit_requests)").all();
  for (const column of ["operational_assigned_at", "dispatch_owner_user_id", "dispatch_accepted_at", "en_route_at", "eta_updated_at"]) {
    if (!visitColumns.some(c => c.name === column)) database.exec(`ALTER TABLE visit_requests ADD COLUMN ${column} ${column === "dispatch_owner_user_id" ? "INTEGER REFERENCES users(id)" : "TEXT"}`);
  }
  schemaReady.add(database);
}

function getPolicy(database = db) {
  const saved = JSON.parse(database.prepare("SELECT policy_json FROM operational_task_policy WHERE id=1").get().policy_json);
  return Object.fromEntries(Object.entries(DEFAULT_POLICY).map(([key, value]) => [key, saved[key] ?? value]));
}
function event(database, id, action, actor, note, now) {
  database.prepare("INSERT INTO operational_task_events (task_id,action,actor_user_id,note,created_at) VALUES (?,?,?,?,?)")
    .run(id, action, actor || null, note || "", iso(now));
}
function availableUser(database, role) {
  return database.prepare(`SELECT u.id FROM users u WHERE u.role=? AND u.${ACTIVE.replaceAll(" AND ", " AND u.")}
    AND u.operation_status IN ('active','available') ORDER BY
    (SELECT COUNT(*) FROM operational_tasks t WHERE t.owner_user_id=u.id AND t.status!='resolved'), u.id LIMIT 1`).get(role)?.id || null;
}
function doctorUser(database, doctorId) {
  return doctorId ? database.prepare(`SELECT u.id FROM users u JOIN doctors d ON d.id=u.doctor_id
    WHERE u.doctor_id=? AND u.role='doctor' AND u.is_active=1 AND u.deleted_at IS NULL
      AND d.is_active=1 AND d.deleted_at IS NULL ORDER BY u.id LIMIT 1`).get(doctorId)?.id || null : null;
}
function validOwner(database, userId, role) {
  return userId ? database.prepare(`SELECT id FROM users WHERE id=? AND ${ACTIVE} AND operation_status!='offline' AND (role=? OR role='admin')`).get(userId, role)?.id || null : null;
}
function queueDelivery(database, task, userId, reason, now) {
  if (!userId) return;
  if (reason !== "new") database.prepare("UPDATE operational_task_deliveries SET status='cancelled',updated_at=? WHERE task_id=? AND revision=? AND user_id=? AND reason='new' AND status IN ('pending','failed')")
    .run(iso(now), task.id, task.revision, userId);
  database.prepare(`INSERT OR IGNORE INTO operational_task_deliveries
    (task_id,revision,user_id,reason,next_attempt_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run(task.id, task.revision, userId, reason, iso(now), iso(now));
}
function resolveTask(database, task, note, now, actor = null) {
  database.prepare("UPDATE operational_tasks SET status='resolved',resolved_at=?,resolution_note=?,updated_at=? WHERE id=? AND status!='resolved'")
    .run(iso(now), note, iso(now), task.id);
  database.prepare("UPDATE operational_task_deliveries SET status='cancelled',updated_at=? WHERE task_id=? AND status IN ('pending','failed')")
    .run(iso(now), task.id);
  event(database, task.id, "resolved", actor, note, now);
}

// Source reconciliation is independent of an open browser. Source stages, not a
// notification's read state, determine whether clinical/dispatch work is done.
function desiredTasks(database, now) {
  const policy = getPolicy(database);
  const tasks = [];
  const add = value => tasks.push(value);
  const care = (row, source) => {
    const started = source === "visit" ? ["en_route", "arrived", "in_consultation"].includes(row.status) : row.status === "in_consultation";
    const urgent = source === "visit" && row.urgency !== "routine";
    const minutes = urgent ? policy.urgent_dispatch_minutes : policy.dispatch_minutes;
    const base = { source_type: source, source_id: row.id, patient_id: row.patient_id, priority: urgent ? "urgent" : "normal", url: source === "visit" ? `/visit-requests?request=${row.id}` : `/teleconsultations?request=${row.id}` };
    if (!row.assigned_doctor_id && !started) {
      add({ ...base, kind: "dispatch", title: `${source === "visit" ? "Home visit" : "Teleconsultation"} #${row.id} needs dispatch`, owner_role: "operator",
        preferred_owner: source === "teleconsultation" ? row.accepted_by : row.dispatch_owner_user_id, source_version: String(row.created_at),
        source_acknowledged_at: source === "teleconsultation" ? row.accepted_at : row.dispatch_accepted_at,
        acknowledgement_due_at: after(row.created_at, minutes), due_at: after(row.created_at, minutes + policy.start_minutes) });
    } else if (row.assigned_doctor_id && !started) {
      const assignedAt = row.assigned_at || row.operational_assigned_at || row.updated_at || row.created_at;
      add({ ...base, kind: "doctor_assignment", title: `${source === "visit" ? "Home visit" : "Teleconsultation"} #${row.id} awaits doctor acceptance`, owner_role: "doctor",
        clinical_owner_id: doctorUser(database, row.assigned_doctor_id), source_version: `${row.assigned_doctor_id}:${row.assigned_at || row.operational_assigned_at || "assignment"}`,
        acknowledgement_due_at: after(assignedAt, policy.assignment_minutes), due_at: after(assignedAt, policy.start_minutes) });
    } else if (source === "visit" && row.status === "en_route" && row.eta_minutes != null) {
      const startedAt = row.en_route_at || row.updated_at;
      const etaBase = millis(row.eta_updated_at) > millis(startedAt) ? row.eta_updated_at : startedAt;
      add({ ...base, kind: "arrival", title: `Home visit #${row.id} arrival needs confirmation`, owner_role: "operator", preferred_owner: row.dispatch_owner_user_id,
        notify_on_creation: false, source_version: `${row.status}:${row.eta_minutes}:${row.eta_updated_at || row.en_route_at || "initial"}`,
        acknowledgement_due_at: after(etaBase, Number(row.eta_minutes)), due_at: after(etaBase, Number(row.eta_minutes)) });
    }
  };
  for (const row of database.prepare("SELECT v.* FROM visit_requests v JOIN patients p ON p.id=v.patient_id WHERE p.deleted_at IS NULL AND v.status NOT IN ('completed','cancelled')").all()) care(row, "visit");
  for (const row of database.prepare("SELECT t.* FROM teleconsultation_requests t JOIN patients p ON p.id=t.patient_id WHERE p.deleted_at IS NULL AND t.status IN ('pending','assigned','in_consultation')").all()) care(row, "teleconsultation");
  const today = localDay(now);
  for (const p of database.prepare("SELECT * FROM patients WHERE deleted_at IS NULL AND status='active' AND is_under_review=1").all()) {
    const doctor = doctorUser(database, p.review_assigned_doctor_id || p.assigned_doctor_id);
    const date = String(p.review_due_date || "").slice(0, 10);
    const parsedDate = Date.parse(`${date}T00:00:00Z`);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsedDate) && new Date(parsedDate).toISOString().slice(0, 10) === date;
    const scheduling = !validDate || !doctor;
    if (!scheduling && date > today) continue;
    const deadline = validDate ? dayEnd(date) : dayEnd(today);
    add({ kind: scheduling ? "review_scheduling" : "review_due", source_type: "review", source_id: p.id, patient_id: p.id,
      title: scheduling ? "Review appointment needs a doctor or date" : "Review appointment due", url: `/patients/${p.id}`,
      priority: "normal", owner_role: scheduling ? "operator" : "doctor", clinical_owner_id: scheduling ? null : doctor,
      source_version: `${date}:${p.review_assigned_doctor_id || p.assigned_doctor_id || 0}`, acknowledgement_due_at: deadline, due_at: deadline });
  }
  // Reports have already been reviewed before upload, so they create no inbox task.
  for (const r of database.prepare("SELECT * FROM restock_requests WHERE status IN ('pending','accepted') AND archived_at IS NULL").all()) {
    const deadline = r.status === "pending" ? after(r.created_at, policy.supply_hours * 60) : dayEnd(r.collection_date);
    add({ kind: "supply", source_type: "supply", source_id: r.id, title: `Supply request #${r.id} ${r.status === "pending" ? "needs acceptance" : "needs preparation"}`,
      url: `/supply-requests?queue=${r.status === "pending" ? "new_requests" : "pick_today"}`, priority: "normal", owner_role: "operator",
      preferred_owner: r.accepted_by_user_id, source_version: r.status, acknowledgement_due_at: deadline, due_at: deadline });
  }
  return tasks;
}

function reconcileOperationalTasks({ database = db, now = Date.now() } = {}) {
  ensureOperationalTaskSchema(database);
  return database.transaction(() => {
    const desired = desiredTasks(database, now);
    const keys = new Set();
    for (const wanted of desired) {
      const key = `${wanted.source_type}:${wanted.source_id}:${wanted.kind}`;
      keys.add(key);
      let previous = database.prepare("SELECT * FROM operational_tasks WHERE task_key=?").get(key);
      const clinicalOwner = wanted.clinical_owner_id || null;
      const changed = previous && (previous.source_version !== wanted.source_version || previous.clinical_owner_id !== clinicalOwner
        || previous.status === "resolved");
      if (previous?.status === "resolved" && !changed) continue;
      const owner = clinicalOwner || (!changed && previous?.manual_owner ? validOwner(database, previous.owner_user_id, wanted.owner_role) : null)
        || validOwner(database, wanted.preferred_owner, wanted.owner_role)
        || (!changed && validOwner(database, previous?.owner_user_id, wanted.owner_role))
        || (wanted.owner_role === "doctor" ? null : availableUser(database, wanted.owner_role));
      const rerouted = previous && previous.owner_user_id !== owner;
      if (!previous) {
        const result = database.prepare(`INSERT INTO operational_tasks
          (task_key,kind,source_type,source_id,source_version,patient_id,title,url,owner_role,owner_user_id,clinical_owner_id,priority,acknowledgement_due_at,due_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(key, wanted.kind, wanted.source_type, wanted.source_id, wanted.source_version, wanted.patient_id || null,
          wanted.title, wanted.url, wanted.owner_role, owner, clinicalOwner, wanted.priority, wanted.acknowledgement_due_at, wanted.due_at, iso(now), iso(now));
        previous = database.prepare("SELECT * FROM operational_tasks WHERE id=?").get(result.lastInsertRowid);
        event(database, previous.id, "created", null, owner ? "Assigned to available owner" : "No available owner; supervisor attention required", now);
        if (wanted.notify_on_creation !== false) queueDelivery(database, previous, owner, "new", now);
      } else if (changed || rerouted) {
        database.prepare(`UPDATE operational_tasks SET source_version=?,title=?,url=?,owner_user_id=?,clinical_owner_id=?,priority=?,manual_owner=0,status='open',
          acknowledged_at=NULL,acknowledged_by=NULL,resolved_at=NULL,resolution_note='',escalation_level=0,escalated_at=NULL,supervisor_user_id=NULL,
          acknowledgement_due_at=?,due_at=?,revision=revision+1,updated_at=? WHERE id=?`).run(wanted.source_version, wanted.title, wanted.url, owner, clinicalOwner,
          wanted.priority, changed ? wanted.acknowledgement_due_at : previous.acknowledgement_due_at, changed ? wanted.due_at : previous.due_at, iso(now), previous.id);
        event(database, previous.id, "reassigned", null, "Source changed or previous owner is unavailable", now);
        const task = database.prepare("SELECT * FROM operational_tasks WHERE id=?").get(previous.id);
        if (wanted.notify_on_creation !== false) queueDelivery(database, task, owner, "new", now);
      }
      if (wanted.source_acknowledged_at) {
        const task = database.prepare("SELECT * FROM operational_tasks WHERE task_key=?").get(key);
        if (!task.acknowledged_at && !task.manual_owner && task.status !== "resolved") {
          database.prepare("UPDATE operational_tasks SET status='acknowledged',acknowledged_at=?,acknowledged_by=?,updated_at=? WHERE id=?")
            .run(wanted.source_acknowledged_at, owner, iso(now), task.id);
          event(database, task.id, "acknowledged", owner, "Accepted in the dispatch workflow", now);
        }
      }
    }
    for (const task of database.prepare("SELECT * FROM operational_tasks WHERE status!='resolved'").all()) {
      if (!keys.has(task.task_key)) resolveTask(database, task, task.kind === "report_review"
        ? "Separate report review step removed: reports are reviewed before upload."
        : "Source completed, cancelled, rescheduled or moved to its next stage", now);
    }
    return escalateOverdue(database, now);
  })();
}

function effectiveDeadline(task) { return task.acknowledged_at ? task.due_at : task.acknowledgement_due_at; }
function escalateOverdue(database, now) {
  const policy = getPolicy(database);
  let escalated = 0;
  for (const task of database.prepare("SELECT * FROM operational_tasks WHERE status!='resolved' AND escalation_level<2").all()) {
    const ownerAvailable = task.owner_user_id && database.prepare(`SELECT id FROM users WHERE id=? AND ${ACTIVE} AND operation_status!='offline'`).get(task.owner_user_id);
    if (ownerAvailable && millis(effectiveDeadline(task)) > now) continue;
    if (task.escalation_level && now - millis(task.escalated_at) < policy.escalation_minutes * 60000) continue;
    const supervisor = validOwner(database, policy.supervisor_user_id, "admin") || availableUser(database, "admin");
    const level = task.escalation_level + 1;
    database.prepare("UPDATE operational_tasks SET escalation_level=?,escalated_at=?,supervisor_user_id=?,updated_at=? WHERE id=?")
      .run(level, iso(now), supervisor, iso(now), task.id);
    event(database, task.id, "escalated", null, `Level ${level}: ${task.owner_user_id ? "response deadline exceeded" : "no available owner"}`, now);
    queueDelivery(database, task, task.owner_user_id, `overdue-${level}`, now);
    if (supervisor !== task.owner_user_id) queueDelivery(database, task, supervisor, `escalation-${level}`, now);
    if (level === 2) {
      for (const backup of database.prepare(`SELECT id FROM users WHERE role='admin' AND ${ACTIVE} AND operation_status!='offline'`).all()) {
        if (backup.id !== supervisor && backup.id !== task.owner_user_id) queueDelivery(database, task, backup.id, "backup-2", now);
      }
    }
    escalated++;
  }
  return { escalated };
}

function canSeeTask(actor, task) {
  if (actor.role === "admin") return true;
  if (actor.role === "lab_tech" && task.kind === "report_review") return true;
  if (actor.role === "operator" && task.kind === "doctor_assignment") return true;
  if (actor.role !== task.owner_role) return false;
  return actor.role === "doctor" ? Number(task.clinical_owner_id) === Number(actor.id) : true;
}
function decorateTask(database, task, actor, now) {
  const owner = database.prepare("SELECT full_name FROM users WHERE id=?").get(task.owner_user_id);
  const patient = task.patient_id ? database.prepare("SELECT full_name FROM patients WHERE id=? AND deleted_at IS NULL").get(task.patient_id) : null;
  const deadline = effectiveDeadline(task);
  return { ...task, resolution_note: actor.role === "lab_tech" && task.owner_role === "doctor" ? "" : task.resolution_note,
    owner_name: owner?.full_name || null, patient_name: patient?.full_name || null,
    overdue: task.status !== "resolved" && millis(deadline) <= now,
    response_due_at: deadline, can_act: !actor.is_read_only && (actor.role === "admin" || (actor.role === task.owner_role && (!task.owner_user_id || Number(task.owner_user_id) === Number(actor.id)))),
    can_acknowledge: !actor.is_read_only && (!task.clinical_owner_id || Number(task.clinical_owner_id) === Number(actor.id))
      && (actor.role === "admin" || (actor.role === task.owner_role && (!task.owner_user_id || Number(task.owner_user_id) === Number(actor.id)))),
  };
}

function updateTask(id, actor, body = {}, { database = db, now = Date.now() } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("Provide an action and its current revision."); error.status = 400; throw error;
  }
  reconcileOperationalTasks({ database, now });
  return database.transaction(() => {
    const task = database.prepare("SELECT * FROM operational_tasks WHERE id=?").get(id);
    const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
    if (!task || !canSeeTask(actor, task)) fail(404, "Action not found.");
    if (actor.is_read_only) fail(403, "Training mode is view only.");
    if (actor.role !== "admin" && actor.role !== task.owner_role) fail(403, "Only the responsible role can act on this task.");
    if (task.status === "resolved") fail(409, "This action is already resolved. Refresh the inbox.");
    if (!Number.isInteger(body.revision) || body.revision !== task.revision) fail(409, "This action has changed. Refresh the inbox before continuing.");
    if (actor.role !== "admin" && task.owner_user_id && Number(task.owner_user_id) !== Number(actor.id)) fail(409, "This action belongs to another team member. Ask for a handover.");
    const note = String(body.note || "").trim();
    if (note.length > 2000) fail(400, "Keep the note to 2,000 characters.");
    const action = body.action;
    if (action === "claim" || action === "acknowledge") {
      if (task.clinical_owner_id && Number(task.clinical_owner_id) !== Number(actor.id)) fail(403, "Only the responsible clinician can acknowledge this clinical action.");
      database.prepare("UPDATE operational_tasks SET owner_user_id=?,manual_owner=1,status='acknowledged',acknowledged_at=COALESCE(acknowledged_at,?),acknowledged_by=?,revision=revision+1,updated_at=? WHERE id=?")
        .run(actor.id, iso(now), actor.id, iso(now), id);
      event(database, id, "acknowledged", actor.id, note || "Responsibility accepted; source work remains open", now);
      if (task.escalation_level) queueDelivery(database, database.prepare("SELECT * FROM operational_tasks WHERE id=?").get(id), task.supervisor_user_id, `escalation-${task.escalation_level}`, now);
    } else if (action === "handover") {
      if (task.clinical_owner_id) fail(400, "Change the assigned doctor in the source workflow to hand over clinical work.");
      const next = validOwner(database, Number(body.owner_user_id), task.owner_role);
      if (!next || !note) fail(400, "Select an active eligible owner and provide a handover note.");
      database.prepare("UPDATE operational_tasks SET owner_user_id=?,manual_owner=1,status='open',acknowledged_at=NULL,acknowledged_by=NULL,revision=revision+1,updated_at=? WHERE id=?")
        .run(next, iso(now), id);
      event(database, id, "handed_over", actor.id, note, now);
      queueDelivery(database, database.prepare("SELECT * FROM operational_tasks WHERE id=?").get(id), next, "handover", now);
      if (task.escalation_level) queueDelivery(database, database.prepare("SELECT * FROM operational_tasks WHERE id=?").get(id), task.supervisor_user_id, `escalation-${task.escalation_level}`, now);
    } else if (action === "resolve") {
      fail(400, "Complete or reschedule this action in its source workflow.");
    } else if (action === "decline") {
      if (task.kind !== "doctor_assignment" || actor.role !== "doctor" || Number(task.clinical_owner_id) !== Number(actor.id)) fail(403, "Only the assigned doctor can decline this assignment.");
      if (!note) fail(400, "Explain why dispatch needs to reassign this request.");
      const source = task.source_type === "visit" ? "visit_requests" : "teleconsultation_requests";
      const result = database.prepare(`UPDATE ${source} SET assigned_doctor_id=NULL,status=?,updated_at=?
        WHERE id=? AND assigned_doctor_id=? AND status IN ('pending','acknowledged','assigned')`)
        .run(task.source_type === "visit" ? "acknowledged" : "pending", iso(now), task.source_id, actor.doctor_id);
      if (!result.changes) fail(409, "The request has moved on. Refresh before declining.");
      event(database, id, "declined", actor.id, note, now);
      resolveTask(database, task, "Doctor declined; returned to dispatch for reassignment", now, actor.id);
      reconcileOperationalTasks({ database, now });
      const next = database.prepare("SELECT * FROM operational_tasks WHERE source_type=? AND source_id=? AND kind='dispatch' AND status!='resolved'").get(task.source_type, task.source_id);
      if (next) event(database, next.id, "returned_to_dispatch", actor.id, note, now);
    } else fail(400, "Choose acknowledge, handover or decline.");
    return database.prepare("SELECT * FROM operational_tasks WHERE id=?").get(id);
  })();
}

async function deliverOperationalPush({ database = db, now = Date.now(), send = require("./push").sendPushToUser } = {}) {
  // Recover a send interrupted by a restart. Delivery is at-least-once; stable
  // notification tags coalesce a recovered send on supported devices.
  database.prepare("UPDATE operational_task_deliveries SET status='pending' WHERE status='sending' AND updated_at<?").run(iso(now - 5 * 60000));
  const entries = database.prepare("SELECT * FROM operational_task_deliveries WHERE status IN ('pending','failed') AND next_attempt_at<=? ORDER BY id LIMIT 40").all(iso(now));
  for (const delivery of entries) {
    const task = database.prepare("SELECT * FROM operational_tasks WHERE id=?").get(delivery.task_id);
    const user = database.prepare(`SELECT * FROM users WHERE id=? AND ${ACTIVE}`).get(delivery.user_id);
    const currentRecipient = delivery.reason === "backup-2" && task?.escalation_level === 2 && user?.role === "admin" && user.operation_status !== "offline"
      ? delivery.user_id : delivery.reason.startsWith("escalation") ? task?.supervisor_user_id : task?.owner_user_id;
    if (!task || task.status === "resolved" || task.revision !== delivery.revision || !user || Number(currentRecipient) !== delivery.user_id
      || (delivery.reason === "new" && task.acknowledged_at)) {
      database.prepare("UPDATE operational_task_deliveries SET status='cancelled',updated_at=? WHERE id=?").run(iso(now), delivery.id);
      continue;
    }
    const taken = database.prepare("UPDATE operational_task_deliveries SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('pending','failed')").run(iso(now), delivery.id);
    if (!taken.changes) continue;
    let result;
    try {
      result = await send(delivery.user_id, { title: delivery.reason.startsWith("escalation") || delivery.reason === "backup-2" ? "OCS action needs supervision" : "OCS action needs attention",
        body: task.title, url: `/action-inbox?task=${task.id}`, tag: `ocs-action-${task.id}`, icon: "/icon-192.png",
        requireInteraction: task.priority === "urgent", delivery_urgency: task.priority === "urgent" ? "high" : "normal", delivery_ttl: 300 });
    } catch (error) { result = { ok: false, reason: error.message }; }
    database.prepare("UPDATE operational_task_deliveries SET status=?,last_error=?,accepted_at=?,next_attempt_at=?,updated_at=? WHERE id=?")
      .run(result?.ok ? "accepted" : "failed", result?.ok ? null : String(result?.reason || "Push delivery unavailable").slice(0, 200), result?.ok ? iso(now) : null,
        iso(now + Math.min(3600000, 60000 * 2 ** Math.min(delivery.attempts, 6))), iso(now), delivery.id);
  }
}

let running = false;
let timer;
async function tickOperationalWorkflow() {
  if (running) return;
  running = true;
  try {
    reconcileOperationalTasks(); await deliverOperationalPush();
    db.prepare("UPDATE operational_worker_state SET last_success_at=?,last_error=NULL WHERE id=1").run(iso(Date.now()));
  } catch (error) {
    console.error("[action-inbox] workflow check failed:", error);
    try { db.prepare("UPDATE operational_worker_state SET last_error=? WHERE id=1").run(String(error.message).slice(0, 200)); } catch { /* Server logs retain the failure if storage is unavailable. */ }
  }
  finally { running = false; }
}
function startOperationalWorkflow() {
  if (timer) return;
  void tickOperationalWorkflow();
  timer = setInterval(() => void tickOperationalWorkflow(), 60000);
  timer.unref();
}
function reconcileAfterOperationalWrite(req, res, next) {
  const sourcePath = req.path;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && /^\/(patients|visit-requests|teleconsultations|patient-portal|restock-requests|team-operations|doctors)(\/|$)/.test(sourcePath)) {
    res.on("finish", () => {
      if (res.statusCode < 400) {
        try {
          reconcileOperationalTasks();
        }
        catch (error) { console.error("[action-inbox] source sync failed:", error); }
        if (process.env.NODE_ENV !== "test") void tickOperationalWorkflow();
      }
    });
  }
  next();
}

module.exports = { DEFAULT_POLICY, ensureOperationalTaskSchema, getPolicy, reconcileOperationalTasks, updateTask, canSeeTask, decorateTask,
  effectiveDeadline, deliverOperationalPush, startOperationalWorkflow, reconcileAfterOperationalWrite, tickOperationalWorkflow };
