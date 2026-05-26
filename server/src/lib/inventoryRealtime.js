const { AsyncLocalStorage } = require("node:async_hooks");
const { db } = require("../db");
const { ensureInventoryRowVersionColumn } = require("./inventoryQuantity");

/** @type {Map<number, { res: import('express').Response, role: string, doctorId: number|null, userId: number, clientSessionId: string }>} */
const clients = new Map();
let nextClientId = 1;

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
  extractClientSessionId,
  getCurrentClientSessionId,
  handleInventoryStream,
  publishInventoryChange,
  publishInventoryResyncBroadcast,
  publishSupplyRequestChange,
  shouldDeliverInventoryEvent,
  shouldDeliverSupplyRequestEvent,
  withClientSessionContext,
};
