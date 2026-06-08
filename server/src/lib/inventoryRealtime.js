const { AsyncLocalStorage } = require("node:async_hooks");
const { db } = require("../db");
const { ensureInventoryRowVersionColumn } = require("./inventoryQuantity");

/** @type {Map<number, { res: import('express').Response, role: string, doctorId: number|null, userId: number, clientSessionId: string }>} */
const clients = new Map();
let nextClientId = 1;

/** Patient-portal SSE subscribers, keyed by an internal id → { res, patientId }. */
/** @type {Map<number, { res: import('express').Response, patientId: number }>} */
const patientClients = new Map();
let nextPatientClientId = 1;

// Request-scoped context so deep helpers (e.g. recordMovement) can fan out
// inventory changes that are correctly tagged with the originating tab's
// client_session_id without every caller having to thread it manually.
const requestContext = new AsyncLocalStorage();

function extractClientSessionId(req) {
  if (!req) return "";
  const headerId = req.headers ? req.headers["x-client-session-id"] : null;
  const queryId = req.query ? req.query.client_session_id || req.query.clientSessionId : null;
  return String(headerId || queryId || "").trim();
}

function withClientSessionContext(req, _res, next) {
  const clientSessionId = extractClientSessionId(req);
  requestContext.run({ clientSessionId }, () => next());
}

function getCurrentClientSessionId() {
  const ctx = requestContext.getStore();
  return ctx?.clientSessionId || "";
}

function shouldDeliverInventoryEvent(client, event) {
  const role = String(client.role || "");
  const doctorId = Number(client.doctorId || 0);

  if (role === "admin" || role === "operator") {
    return true;
  }

  if (role === "doctor") {
    if (event.stockScope === "ocs") {
      return true;
    }

    if (event.stockScope === "doctor" && Number(event.ownerDoctorId || 0) === doctorId) {
      return true;
    }
  }

  return false;
}

function shouldDeliverSupplyRequestEvent(client, event) {
  const role = String(client.role || "");
  if (role === "admin" || role === "operator") {
    return true;
  }

  if (role === "doctor") {
    return Number(event.doctorId || 0) === Number(client.doctorId || 0);
  }

  return false;
}

function shouldDeliverLongTermReviewEvent(client) {
  const role = String(client.role || "");
  return role === "admin" || role === "operator" || role === "doctor";
}

function shouldDeliverLinkhamPatientsEvent(client) {
  return String(client.role || "") === "linkham_admin";
}

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addInventoryStreamClient(res, auth, clientSessionId = "") {
  const clientId = nextClientId;
  nextClientId += 1;

  clients.set(clientId, {
    res,
    role: auth.role,
    doctorId: auth.doctor_id ? Number(auth.doctor_id) : null,
    userId: Number(auth.id),
    clientSessionId: String(clientSessionId || ""),
  });

  res.on("close", () => {
    clients.delete(clientId);
  });

  writeSseEvent(res, "connected", {
    ok: true,
    role: auth.role,
    doctor_id: auth.doctor_id || null,
  });

  return clientId;
}

function publishInventoryChange({
  itemId,
  changedByUserId = null,
  changedByClientSessionId = null,
} = {}) {
  ensureInventoryRowVersionColumn();

  const row = db
    .prepare(`
      SELECT
        id,
        item_name,
        stock_scope,
        owner_doctor_id,
        quantity,
        minimum_quantity,
        row_version,
        updated_at
      FROM inventory
      WHERE id = ?
    `)
    .get(Number(itemId || 0));

  if (!row) {
    return { delivered: 0 };
  }

  // Auto-fill the session id from the request context when callers don't
  // pass one explicitly (e.g. recordMovement is invoked from deep within a
  // route handler).
  const sessionId = changedByClientSessionId
    ? String(changedByClientSessionId)
    : getCurrentClientSessionId() || null;

  const event = {
    type: "inventory_change",
    itemId: Number(row.id),
    itemName: String(row.item_name || ""),
    stockScope: String(row.stock_scope || "ocs"),
    ownerDoctorId: row.owner_doctor_id ? Number(row.owner_doctor_id) : null,
    quantity: Number(row.quantity || 0),
    minimumQuantity: Number(row.minimum_quantity || 0),
    rowVersion: Number(row.row_version || 1),
    updatedAt: row.updated_at || null,
    changedByUserId: changedByUserId ? Number(changedByUserId) : null,
    changedByClientSessionId: sessionId || null,
  };

  let delivered = 0;

  for (const client of clients.values()) {
    if (!shouldDeliverInventoryEvent(client, event)) {
      continue;
    }

    try {
      writeSseEvent(client.res, "inventory_change", event);
      delivered += 1;
    } catch {
      /* client disconnected mid-write */
    }
  }

  return { delivered, event };
}

/** Fan out a full inventory refresh hint after bulk DB maintenance (no warehouse mutation). */
function publishInventoryResyncBroadcast() {
  const event = {
    type: "inventory_resync",
    reason: "doctor_bag_matrix_clone",
    at: new Date().toISOString(),
  };

  let delivered = 0;

  for (const client of clients.values()) {
    try {
      writeSseEvent(client.res, "inventory_resync", event);
      delivered += 1;
    } catch {
      /* client disconnected mid-write */
    }
  }

  return { delivered, event };
}

/** Notify doctors/operators when supply request status or lines change. */
function publishSupplyRequestChange({ doctorId = null } = {}) {
  const event = {
    type: "supply_request_change",
    doctorId: doctorId ? Number(doctorId) : null,
    at: new Date().toISOString(),
  };

  let delivered = 0;

  for (const client of clients.values()) {
    if (!shouldDeliverSupplyRequestEvent(client, event)) {
      continue;
    }

    try {
      writeSseEvent(client.res, "supply_request_change", event);
      delivered += 1;
    } catch {
      /* client disconnected mid-write */
    }
  }

  return { delivered, event };
}

/** Notify all clinical roles when the practice-wide long-term review queue changes. */
function publishLongTermReviewChange({
  patientId = null,
  changedByUserId = null,
  changedByClientSessionId = null,
} = {}) {
  const sessionId = changedByClientSessionId
    ? String(changedByClientSessionId)
    : getCurrentClientSessionId() || null;

  const event = {
    type: "long_term_review_change",
    patientId: patientId ? Number(patientId) : null,
    at: new Date().toISOString(),
    changedByUserId: changedByUserId ? Number(changedByUserId) : null,
    changedByClientSessionId: sessionId || null,
  };

  let delivered = 0;

  for (const client of clients.values()) {
    if (!shouldDeliverLongTermReviewEvent(client)) {
      continue;
    }

    try {
      writeSseEvent(client.res, "long_term_review_change", event);
      delivered += 1;
    } catch {
      /* client disconnected mid-write */
    }
  }

  return { delivered, event };
}

/** Notify Linkham insurer portal when a Linkham-tagged patient record changes. */
function publishLinkhamPatientsChange({
  patientId = null,
  changedByUserId = null,
  changedByClientSessionId = null,
} = {}) {
  const sessionId = changedByClientSessionId
    ? String(changedByClientSessionId)
    : getCurrentClientSessionId() || null;

  const event = {
    type: "linkham_patients_change",
    patientId: patientId ? Number(patientId) : null,
    at: new Date().toISOString(),
    changedByUserId: changedByUserId ? Number(changedByUserId) : null,
    changedByClientSessionId: sessionId || null,
  };

  let delivered = 0;

  for (const client of clients.values()) {
    if (!shouldDeliverLinkhamPatientsEvent(client)) {
      continue;
    }

    try {
      writeSseEvent(client.res, "linkham_patients_change", event);
      delivered += 1;
    } catch {
      /* client disconnected mid-write */
    }
  }

  return { delivered, event };
}

/** Notify Linkham insurer portal when claims ledger or clearance state changes. */
function publishLinkhamClaimsChange({
  claimId = null,
  changedByUserId = null,
  changedByClientSessionId = null,
} = {}) {
  const sessionId = changedByClientSessionId
    ? String(changedByClientSessionId)
    : getCurrentClientSessionId() || null;

  const event = {
    type: "linkham_claims_change",
    claimId: claimId ? Number(claimId) : null,
    at: new Date().toISOString(),
    changedByUserId: changedByUserId ? Number(changedByUserId) : null,
    changedByClientSessionId: sessionId || null,
  };

  let delivered = 0;

  for (const client of clients.values()) {
    if (!shouldDeliverLinkhamPatientsEvent(client)) {
      continue;
    }

    try {
      writeSseEvent(client.res, "linkham_claims_change", event);
      delivered += 1;
    } catch {
      /* client disconnected mid-write */
    }
  }

  return { delivered, event };
}

/**
 * Cross-portal patient sync. Any change to a patient's record, appointments,
 * consultations, bills, or lab reports fans out to every portal that cares:
 *  - the patient's own portal session(s) → their dashboard/records refresh live;
 *  - clinic staff (admin/operator always, the assigned doctor) → lists refresh;
 *  - the insurer portal (linkham_admin) when the patient is Linkham-insured.
 *
 * The originating tab is suppressed via changedByClientSessionId so the actor's
 * own optimistic UI is not double-applied.
 */
function publishPatientDataChange(patientId, { reason = null, changedByClientSessionId = null } = {}) {
  const pid = Number(patientId || 0);
  if (!pid) {
    return { delivered: 0 };
  }

  const patient = db
    .prepare(
      "SELECT assigned_doctor_id, insurance_provider FROM patients WHERE id = ?",
    )
    .get(pid);

  const assignedDoctorId = patient?.assigned_doctor_id ? Number(patient.assigned_doctor_id) : null;
  const isLinkhamInsured = String(patient?.insurance_provider || "").trim().toLowerCase() === "linkham";

  const sessionId = changedByClientSessionId
    ? String(changedByClientSessionId)
    : getCurrentClientSessionId() || null;

  const event = {
    type: "patient_data_change",
    patientId: pid,
    reason: reason || null,
    assignedDoctorId,
    at: new Date().toISOString(),
    changedByClientSessionId: sessionId || null,
  };

  let delivered = 0;

  // 1) The patient's own portal sessions.
  for (const client of patientClients.values()) {
    if (Number(client.patientId) !== pid) {
      continue;
    }
    try {
      writeSseEvent(client.res, "patient_data_change", event);
      delivered += 1;
    } catch {
      /* client disconnected mid-write */
    }
  }

  // 2) Staff + insurer sessions on the shared stream.
  for (const client of clients.values()) {
    const role = String(client.role || "");
    let deliver = false;

    if (role === "admin" || role === "operator" || role === "accountant" || role === "lab_tech") {
      deliver = true;
    } else if (role === "doctor") {
      deliver = assignedDoctorId !== null && Number(client.doctorId || 0) === assignedDoctorId;
    } else if (role === "linkham_admin") {
      deliver = isLinkhamInsured;
    }

    if (!deliver) {
      continue;
    }

    try {
      writeSseEvent(client.res, "patient_data_change", event);
      delivered += 1;
    } catch {
      /* client disconnected mid-write */
    }
  }

  return { delivered, event };
}

function addPatientStreamClient(res, patientId) {
  const clientId = nextPatientClientId;
  nextPatientClientId += 1;

  patientClients.set(clientId, {
    res,
    patientId: Number(patientId || 0),
  });

  res.on("close", () => {
    patientClients.delete(clientId);
  });

  writeSseEvent(res, "connected", { ok: true, patient_id: Number(patientId || 0) });

  return clientId;
}

function handlePatientPortalStream(req, res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  addPatientStreamClient(res, req.patientAuth?.patient_id);

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
  });
}

function handleInventoryStream(req, res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  addInventoryStreamClient(res, req.auth, extractClientSessionId(req));

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
  });
}

module.exports = {
  addInventoryStreamClient,
  addPatientStreamClient,
  extractClientSessionId,
  getCurrentClientSessionId,
  handleInventoryStream,
  handlePatientPortalStream,
  publishInventoryChange,
  publishPatientDataChange,
  publishInventoryResyncBroadcast,
  publishLinkhamClaimsChange,
  publishLinkhamPatientsChange,
  publishLongTermReviewChange,
  publishSupplyRequestChange,
  shouldDeliverInventoryEvent,
  shouldDeliverLinkhamPatientsEvent,
  shouldDeliverLongTermReviewEvent,
  shouldDeliverSupplyRequestEvent,
  withClientSessionContext,
};
