"use strict";

const { db } = require("../db");

const SYSTEM_ACTOR_LABEL = "System";
const LEGACY_STAFF_LABEL = "Legacy staff record";

function isVagueActorName(name) {
  const value = String(name || "").trim().toLowerCase();
  return !value || value === "staff" || value === "ocs user" || value === "unknown";
}

function lookupUserDisplay(userId) {
  if (!userId) return null;
  const row = db
    .prepare("SELECT full_name, username FROM users WHERE id = ?")
    .get(Number(userId));
  const name = String(row?.full_name || row?.username || "").trim();
  return name || null;
}

/**
 * Resolve a displayable audit actor.
 *
 * 1. Stored display name, unless it is vague or incorrectly labelled System.
 * 2. Current user display name from a stored user id.
 * 3. "System" only when the record is genuinely automated and has no human id.
 * 4. "Legacy staff record" for human-triggered rows with no recoverable identity.
 */
function resolveAuditActor({
  displayName = "",
  userId = null,
  automated = false,
  required = false,
} = {}) {
  const stored = String(displayName || "").trim();
  const storedIsSystem = stored.toLowerCase() === "system";
  const id = userId ? Number(userId) : null;
  const hasHumanId = Boolean(id);

  if (hasHumanId) {
    if (!isVagueActorName(stored) && !storedIsSystem) return stored;
    return lookupUserDisplay(id) || LEGACY_STAFF_LABEL;
  }

  if (automated) return SYSTEM_ACTOR_LABEL;

  if (!isVagueActorName(stored) && !storedIsSystem) return stored;

  if (required || stored) return LEGACY_STAFF_LABEL;
  return null;
}

function isAutomatedMovementMeta(meta = {}) {
  if (meta.automated === true || meta.automated === 1 || meta.automated === "true") return true;
  const role = String(meta.performed_by_role || "").trim().toLowerCase();
  return role === "system";
}

module.exports = {
  SYSTEM_ACTOR_LABEL,
  LEGACY_STAFF_LABEL,
  isVagueActorName,
  lookupUserDisplay,
  resolveAuditActor,
  isAutomatedMovementMeta,
};
