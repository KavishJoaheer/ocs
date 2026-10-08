export function getClinicalTwinMetricRoutes(role) {
  switch (role) {
    case "admin":
      return {
        longTermReview: "/admin/long-term-review",
      };
    case "operator":
      return {
        longTermReview: "/operator/long-term-review",
      };
    case "doctor":
      return {
        longTermReview: "/doctor/long-term-review",
      };
    default:
      return {
        longTermReview: "/patients",
      };
  }
}

export function getClinicalTwinMetricCopy(role) {
  switch (role) {
    case "doctor":
      return {
        longTermReview: "Practice-wide patients flagged for a review appointment",
      };
    case "operator":
      return {
        longTermReview: "Patients in active operator follow-up",
      };
    default:
      return {
        longTermReview: "Patients in active clinical follow-up",
      };
  }
}

export function resolveClinicalTwinCounts(role, { dashboard, operatorMetrics } = {}) {
  if (role === "operator") {
    return {
      longTermReviewCount: Number(operatorMetrics?.long_term_review?.active_followup_count ?? 0),
    };
  }

  if (role === "doctor") {
    const workspaceSummary = dashboard?.doctorWorkspace?.summary || {};
    const summary = dashboard?.summary || {};
    return {
      longTermReviewCount: Number(
        workspaceSummary.longTermReviewAssignedCount ?? summary.longTermReviewCount ?? 0,
      ),
    };
  }

  const summary = dashboard?.summary || {};
  return {
    longTermReviewCount: Number(summary.longTermReviewCount ?? 0),
  };
}
