export const FAMILY_PROFILES = [
  {
    id: "varun",
    initials: "VJ",
    name: "Varun Joaheer",
    firstName: "Varun",
    relationship: "Primary Account",
    avatarVariant: "teal",
    isPrimary: true,
    possessive: "yours",
  },
  {
    id: "aisha",
    initials: "A",
    name: "Aisha",
    firstName: "Aisha",
    relationship: "Daughter",
    avatarVariant: "amber",
    isPrimary: false,
    possessive: "hers",
  },
  {
    id: "raj",
    initials: "R",
    name: "Raj",
    firstName: "Raj",
    relationship: "Father",
    avatarVariant: "grey",
    isPrimary: false,
    possessive: "his",
  },
];

export const AVATAR_STYLES = {
  teal: "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white",
  amber: "bg-[#e8a020] text-white",
  grey: "bg-[#b0bcc0] text-white",
};

/** Mock dashboard slices shown when a dependent profile is active. */
export const DEPENDENT_DASHBOARD = {
  aisha: {
    stats: null,
    nextAppointment: null,
    recentActivity: [],
    lastConsultation: {
      doctor_name: "Avinash Sharma",
      date: "2026-05-12",
      diagnosis: "Allergic Rhinitis",
    },
    activeVisit: null,
  },
  raj: {
    stats: null,
    nextAppointment: null,
    recentActivity: [],
    lastConsultation: {
      doctor_name: "Priya Naidoo",
      date: "2026-04-18",
      diagnosis: "Hypertension Review",
    },
    activeVisit: null,
  },
};

export function getDefaultProfileId() {
  return FAMILY_PROFILES[0].id;
}

export function findProfileById(id) {
  return FAMILY_PROFILES.find((profile) => profile.id === id) || FAMILY_PROFILES[0];
}
