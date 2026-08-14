import { formatDisplayName } from "./formatDisplayName.js";

export const AVATAR_STYLES = {
  teal: "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white",
  amber: "bg-brand-gold text-white",
  grey: "bg-[#b0bcc0] text-white",
};

export const PRIMARY_PROFILE_ID = "primary";

const AVATAR_CYCLE = ["amber", "grey", "teal"];

function initialsFromName(name) {
  const parts = String(name || "").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (parts[0] || "ME").slice(0, 2).toUpperCase();
}

export function buildPrimaryProfile(user) {
  const rawName = String(user?.full_name || "Your Account").trim() || "Your Account";
  const name = formatDisplayName(rawName);
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "You";

  return {
    id: PRIMARY_PROFILE_ID,
    patientId: user?.patient_id || null,
    initials: initialsFromName(name),
    name,
    firstName,
    relationship: "Primary Account",
    avatarVariant: "teal",
    isPrimary: true,
    possessive: "yours",
  };
}

export function buildDependentProfile(row, index = 0) {
  const name = formatDisplayName(row.full_name);
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    id: String(row.id),
    patientId: Number(row.id),
    initials: initialsFromName(name),
    name,
    firstName: parts[0] || name,
    relationship: row.relationship || "Family member",
    avatarVariant: AVATAR_CYCLE[index % AVATAR_CYCLE.length],
    isPrimary: false,
    possessive: `${parts[0] || name}'s`,
  };
}

export function getDefaultProfileId() {
  return PRIMARY_PROFILE_ID;
}
