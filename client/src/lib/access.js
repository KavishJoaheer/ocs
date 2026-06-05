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
  linkham_admin: {
    label: "Linkham Admin",
    defaultPath: "/patients",
  },
};

export const ROUTE_ACCESS = {
  "/": ["admin", "doctor", "operator", "lab_tech", "accountant"],
  "/hcm-news": ["admin", "doctor", "operator", "lab_tech", "accountant"],
  "/patients": ["admin", "doctor", "operator", "lab_tech", "linkham_admin"],
  "/patients/:id": ["admin", "doctor", "operator", "lab_tech", "linkham_admin"],
  "/patients/add": ["admin", "doctor", "operator"],
  "/appointments": ["admin", "doctor"],
  "/doctor/current-week-roster": ["doctor"],
  "/doctor/april-roster": ["doctor"],
  "/doctor/hcm-updates": ["doctor"],
  "/doctor/scheduled-visits": ["doctor"],
  "/doctor/pending-payment": ["doctor"],
  "/doctor/patients-seen-april": ["doctor"],
  "/doctor/assigned-patients": ["doctor"],
  "/doctor/long-term-review": ["doctor"],
  "/supply-requests": ["doctor"],
  "/operator/current-week-roster": ["operator"],
  "/operator/april-roster": ["operator"],
  "/operator/scheduled-visits": ["operator"],
  "/operator/billing-status": ["operator"],
  "/operator/pending-payment": ["operator"],
  "/operator/long-term-review": ["operator"],
  "/consultations": ["admin", "doctor", "lab_tech"],
  "/consultations/:id": ["admin", "doctor", "lab_tech"],
  "/lab": ["admin", "lab_tech"],
  "/billing": ["admin", "doctor", "accountant"],
  "/admin/finance": ["admin", "doctor", "accountant"],
  "/admin/roster": ["admin"],
  "/live-report": ["admin", "doctor"],
  "/inventory": ["admin", "doctor", "operator"],
  "/stock-history": ["admin", "operator"],
  "/team-operations": ["admin"],
  "/doctors": ["admin"],
  "/admin/long-term-review": ["admin"],
};

export function getDefaultPathForRole(role) {
  return ROLE_CONFIG[role]?.defaultPath || "/";
}

export function getRoleLabel(role) {
  return ROLE_CONFIG[role]?.label || "User";
}

export const FINANCIAL_BILLING_ROLES = ["admin", "doctor", "accountant"];

export function isFinancialBillingPath(pathname = "") {
  return pathname === "/billing" || pathname.startsWith("/billing/");
}

export function canUseFinancialBilling(user) {
  return FINANCIAL_BILLING_ROLES.includes(user?.role);
}

export function canAccessPath(role, path) {
  if (!role) {
    return false;
  }

  if (ROUTE_ACCESS[path]) {
    return ROUTE_ACCESS[path].includes(role);
  }

  if (path.startsWith("/patients/") && path !== "/patients/add") {
    return ROUTE_ACCESS["/patients/:id"]?.includes(role) ?? false;
  }

  if (path.startsWith("/consultations/")) {
    return ROUTE_ACCESS["/consultations/:id"]?.includes(role) ?? false;
  }

  return false;
}

/** Admin and accountant: always. Doctors: any patient (same directory access as the Patients page). */
export function canBillPatientForUser(user, patient) {
  if (!user?.role || !patient) {
    return false;
  }
  if (user.role === "admin" || user.role === "accountant") {
    return true;
  }
  if (user.role === "doctor") {
    return Boolean(user.doctor_id);
  }
  return false;
}
