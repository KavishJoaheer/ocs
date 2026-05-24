const { db } = require("../db");
const { ensureInventoryRowVersionColumn } = require("./inventoryQuantity");

/** @type {Map<number, { res: import('express').Response, role: string, doctorId: number|null, userId: number }>} */
const clients = new Map();
let nextClientId = 1;

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

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addInventoryStreamClient(res, auth) {
  const clientId = nextClientId;
  nextClientId += 1;

  clients.set(clientId, {
    res,
    role: auth.role,
    doctorId: auth.doctor_id ? Number(auth.doctor_id) : null,
    userId: Number(auth.id),
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

function publishInventoryChange({ itemId, changedByUserId = null } = {}) {
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

function handleInventoryStream(req, res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  addInventoryStreamClient(res, req.auth);

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
  handleInventoryStream,
  publishInventoryChange,
  shouldDeliverInventoryEvent,
};
