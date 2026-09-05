const ACTIVE_STATUSES = ["pending", "accepted", "ready"];
const HISTORY_STATUSES = ["completed", "cancelled"];
const ALL_STATUSES = [...ACTIVE_STATUSES, ...HISTORY_STATUSES];

const EVENT_TYPES = {
  created: "request_created",
  edited: "pending_request_edited",
  accepted: "request_accepted",
  amendmentSubmitted: "amendment_submitted",
  amendmentAccepted: "amendment_accepted",
  amendmentRejected: "amendment_rejected",
  ready: "supply_marked_ready",
  cancelled: "request_cancelled",
  completed: "supply_collected",
};

const OPERATOR_TRANSITIONS = {
  pending: ["accepted", "cancelled"],
  accepted: ["ready", "cancelled"],
  ready: ["cancelled"],
};

const DOCTOR_TRANSITIONS = {
  pending: ["cancelled"],
  ready: ["completed"],
};

function normaliseStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "prepared") return "ready";
  return status;
}

function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(normaliseStatus(status));
}

function isHistoryStatus(status) {
  return HISTORY_STATUSES.includes(normaliseStatus(status));
}

function allowedTransitionsForRole(role) {
  if (role === "doctor") return DOCTOR_TRANSITIONS;
  if (role === "operator" || role === "admin") return OPERATOR_TRANSITIONS;
  return {};
}

function canTransition(role, fromStatus, toStatus) {
  const from = normaliseStatus(fromStatus);
  const to = normaliseStatus(toStatus);
  const allowed = allowedTransitionsForRole(role)[from] || [];
  return allowed.includes(to);
}

function supplyRequestStatusLabel(status, role) {
  const value = normaliseStatus(status);
  if (value === "pending") {
    return role === "doctor" ? "Requested" : "Pending";
  }
  if (value === "accepted") return "Request Accepted";
  if (value === "ready") return "Supply Ready";
  if (value === "completed") {
    if (role === "doctor") return "Supply Collected";
    if (role === "operator") return "Supply Dispatched";
    return "Completed";
  }
  if (value === "cancelled") return "Cancelled";
  return value || "Unknown";
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function snapshotItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    inventory_id: item.inventory_id ? Number(item.inventory_id) : null,
    item_name: item.item_name,
    quantity: Number(item.quantity || 0),
  }));
}

function actorFromAuth(auth) {
  return {
    userId: auth?.id ? Number(auth.id) : null,
    role: auth?.role || null,
    displayName: auth?.full_name || auth?.username || null,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  ALL_STATUSES,
  DOCTOR_TRANSITIONS,
  EVENT_TYPES,
  HISTORY_STATUSES,
  OPERATOR_TRANSITIONS,
  actorFromAuth,
  canTransition,
  isActiveStatus,
  isHistoryStatus,
  normaliseStatus,
  parseMetadata,
  snapshotItems,
  supplyRequestStatusLabel,
};
