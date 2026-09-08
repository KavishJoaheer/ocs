export function getTimeOfDayGreeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function getOperatorDisplayName(user) {
  const fullName = String(user?.full_name || "").trim();
  if (fullName) {
    return fullName.split(/\s+/)[0];
  }
  return String(user?.username || "Operator").trim() || "Operator";
}

export function getOperatorInitials(user) {
  const fullName = String(user?.full_name || "").trim();
  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return parts[0].slice(0, 1).toUpperCase();
    }
    return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
  }

  const username = String(user?.username || "O").trim();
  return username.slice(0, 1).toUpperCase() || "O";
}

export function formatVisitRequestStatus(count) {
  const value = Number(count || 0);
  if (value === 0) return "No requests waiting";
  if (value === 1) return "request waiting";
  return "requests waiting";
}

export function formatVisitRequestSupport(count) {
  const value = Number(count || 0);
  if (value === 0) return "Monitoring OCS Care live";
  return "Requests received from OCS Care";
}

export function formatReviewCardSupport(count) {
  const value = Number(count || 0);
  if (value === 0) return "No patients currently due";
  if (value === 1) return "patient due for follow-up";
  return "patients due for follow-up";
}

export function formatLowStockNotice(count) {
  const value = Number(count || 0);
  if (value === 1) return "1 item below minimum stock";
  return `${value} items below minimum stock`;
}

export function formatHealthPlanCount(count) {
  const value = Number(count || 0);
  if (value === 1) return "1 subscribed";
  return `${value} subscribed`;
}

export function formatHcmUnread(count) {
  const value = Number(count || 0);
  if (value === 1) return "1 unread";
  return `${value} unread`;
}

export function isOperatorLive(status) {
  return status === "active" || status === "available";
}
