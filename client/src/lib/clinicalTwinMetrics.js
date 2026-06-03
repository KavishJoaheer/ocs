export function getClinicalTwinMetricRoutes(role) {
  switch (role) {
    case "admin":
      return {
        longTermReview: "/admin/long-term-review",
        healthPlans: "/live-report",
      };
    case "operator":
      return {
        longTermReview: "/operator/long-term-review",
        healthPlans: "/patients?filter=subscribed",
      };
    case "doctor":
      return {
        longTermReview: "/doctor/long-term-review",
        healthPlans: "/doctor/assigned-patients?filter=subscribed",
      };
    default:
      return {
        longTermReview: "/patients",
        healthPlans: "/patients",
      };
  }
}

export function getClinicalTwinMetricCopy(role) {
  switch (role) {
    case "doctor":
      return {
        longTermReview: "Practice-wide patients flagged for long-term review",
        healthPlans: "Assigned patients on an active health plan",
      };
    case "operator":
      return {
        longTermReview: "Patients in active operator follow-up",
        healthPlans: "Active subscription patients",
      };
    default:
      return {
        longTermReview: "Patients in active clinical follow-up",
        healthPlans: "Active subscription patients across Mauritius",
      };
  }
}

export function resolveClinicalTwinCounts(role, { dashboard, operatorMetrics } = {}) {
  if (role === "operator") {
    return {
      longTermReviewCount: Number(operatorMetrics?.long_term_review?.active_followup_count ?? 0),
      healthPlansCount: Number(operatorMetrics?.health_plans?.active_subscribers_count ?? 0),
    };
  }

  if (role === "doctor") {
    const summary = dashboard?.summary || dashboard?.doctorWorkspace?.summary || {};
    return {
      longTermReviewCount: Number(
        summary.longTermReviewCount ?? summary.longTermReviewAssignedCount ?? 0,
      ),
      healthPlansCount: Number(summary.subscribedAssignedCount ?? 0),
    };
  }

  const summary = dashboard?.summary || {};
  return {
    longTermReviewCount: Number(summary.longTermReviewCount ?? 0),
    healthPlansCount: Number(summary.activeSubscriptionPatientsCount ?? 0),
  };
}
