import { formatDisplayName } from "./formatDisplayName.js";

export const AVATAR_STYLES = {
  teal: "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white",
  amber: "bg-brand-gold text-white",
  grey: "bg-[#b0bcc0] text-white",
};

export const PRIMARY_PROFILE_ID = "primary";

/**
 * Build the active profile from the *real* signed-in patient. Previously this
 * file shipped a hardcoded family ("Varun Joaheer" + dependents) which meant
 * every patient saw the same identity. There is no family/dependents backend
 * yet, so the only profile is the authenticated patient themselves.
 */
export function buildPrimaryProfile(user) {
  const rawName = String(user?.full_name || "Your Account").trim() || "Your Account";
  const name = formatDisplayName(rawName);
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "You";
  const initials = (
    parts.length >= 2
      ? parts[0][0] + parts[parts.length - 1][0]
      : (parts[0] || "ME").slice(0, 2)
  ).toUpperCase();

  return {
    id: PRIMARY_PROFILE_ID,
    initials,
    name,
    firstName,
    relationship: "Primary Account",
    avatarVariant: "teal",
    isPrimary: true,
    possessive: "yours",
  };
}

/** No dependents backend yet — kept so existing imports stay valid. */
export const DEPENDENT_DASHBOARD = {};

export function getDefaultProfileId() {
  return PRIMARY_PROFILE_ID;
}
