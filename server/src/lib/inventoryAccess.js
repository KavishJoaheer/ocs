"use strict";

const MIN_OVERRIDE_REASON = 10;
const MIN_WRITE_OFF_NOTE_REASONS = new Set(["Damaged", "Discontinued"]);

function isAdminRole(role) {
  return role === "admin";
}

function isOperatorRole(role) {
  return role === "operator";
}

function isDoctorRole(role) {
  return role === "doctor";
}

function isWarehouseViewer(role) {
  return isAdminRole(role) || isOperatorRole(role);
}

function parseBooleanFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return value === true || raw === "1" || raw === "true" || raw === "yes";
}

function parseOperationalOverride(body = {}) {
  const flagged = parseBooleanFlag(body.operational_override);
  const reason = String(body.override_reason || "").trim();
  return { flagged, reason };
}

function assertRoutineOperatorAction(auth, body, actionLabel) {
  if (isOperatorRole(auth?.role)) {
    return { override: false, reason: "" };
  }
  if (isAdminRole(auth?.role)) {
    const { flagged, reason } = parseOperationalOverride(body);
    if (!flagged || reason.length < MIN_OVERRIDE_REASON) {
      const error = new Error(
        `${actionLabel} is an operator action. Administrators must use an operational override with a reason of at least ${MIN_OVERRIDE_REASON} characters.`,
      );
      error.status = 403;
      throw error;
    }
    return { override: true, reason };
  }
  const error = new Error(`You do not have permission to ${String(actionLabel || "perform this action").toLowerCase()}.`);
  error.status = 403;
  throw error;
}

function assertAdminCatalogueAction(auth, actionLabel = "manage catalogue items") {
  if (isAdminRole(auth?.role)) return;
  const error = new Error(`Only an administrator can ${actionLabel}.`);
  error.status = 403;
  throw error;
}

function writeOffNoteRequired(reason) {
  return MIN_WRITE_OFF_NOTE_REASONS.has(String(reason || "").trim());
}

function assertWriteOffInputs({ reason, note, confirm }) {
  const normalised = String(reason || "").trim();
  if (!["Expired", "Discontinued", "Damaged"].includes(normalised)) {
    const error = new Error("Reason must be Expired, Discontinued, or Damaged.");
    error.status = 400;
    throw error;
  }
  const trimmedNote = String(note || "").trim();
  if (writeOffNoteRequired(normalised) && trimmedNote.length < 3) {
    const error = new Error("Damaged, Discontinued, and other exceptional write-offs require an explanatory note.");
    error.status = 400;
    throw error;
  }
  if (confirm !== true && confirm !== "true") {
    const error = new Error("Confirm the write-off before applying it.");
    error.status = 400;
    throw error;
  }
  return { reason: normalised, note: trimmedNote };
}

module.exports = {
  MIN_OVERRIDE_REASON,
  assertAdminCatalogueAction,
  assertRoutineOperatorAction,
  assertWriteOffInputs,
  isAdminRole,
  isDoctorRole,
  isOperatorRole,
  isWarehouseViewer,
  parseBooleanFlag,
  parseOperationalOverride,
  writeOffNoteRequired,
};
