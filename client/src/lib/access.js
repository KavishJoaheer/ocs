export const ROLE_CONFIG = {
  admin: {
    label: "Admin",
    defaultPath: "/",
  },
  doctor: {
    label: "Doctor",
    defaultPath: "/",
  },
  operator: {
    label: "Operator",
    defaultPath: "/",
  },
  lab_tech: {
    label: "Lab Tech",
    defaultPath: "/",
  },
  accountant: {
    label: "Accountant",
    defaultPath: "/",
  },
};

export const ROUTE_ACCESS = {
  "/": ["admin", "doctor", "operator", "lab_tech", "accountant"],
  "/hcm-news": ["admin", "doctor", "operator", "lab_tech", "accountant"],
  "/patients": ["admin", "doctor", "operator", "lab_tech"],
  "/patients/:id": ["admin", "doctor", "operator", "lab_tech"],
  "/appointments": ["admin", "doctor"],
  "/doctor/current-week-roster": ["doctor"],
  "/doctor/april-roster": ["doctor"],
  "/doctor/hcm-updates": ["doctor"],
  "/doctor/scheduled-visits": ["doctor"],
  "/doctor/pending-payment": ["doctor"],
  "/doctor/patients-seen-april": ["doctor"],
  "/doctor/assigned-patients": ["doctor"],
  "/operator/current-week-roster": ["operator"],
  "/operator/april-roster": ["operator"],
  "/operator/scheduled-visits": ["operator"],
  "/operator/billing-status": ["operator"],
  "/operator/pending-payment": ["operator"],
  "/operator/long-term-review": ["operator"],
  "/operator/review-appointments-april": ["operator"],
  "/consultations": ["admin", "doctor", "lab_tech"],
  "/lab": ["admin", "lab_tech"],
  "/billing": ["admin", "doctor", "accountant"],
  "/live-report": ["admin"],
  "/inventory": ["admin", "doctor", "lab_tech"],
  "/team-operations": ["admin"],
  "/doctors": ["admin"],
};

export function getDefaultPathForRole(role) {
  return ROLE_CONFIG[role]?.defaultPath || "/";
}

export function getRoleLabel(role) {
  return ROLE_CONFIG[role]?.label || "User";
}

export function canAccessPath(role, path) {
  if (!role) {
    return false;
  }

  if (path.startsWith("/patients/")) {
    return ROUTE_ACCESS["/patients/:id"]?.includes(role) ?? false;
  }

  return ROUTE_ACCESS[path]?.includes(role) ?? false;
}
