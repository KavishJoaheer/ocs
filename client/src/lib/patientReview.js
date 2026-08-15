import dayjs from "dayjs";

export function getReviewDoctorId(patient) {
  return Number(patient?.review_assigned_doctor_id || patient?.assigned_doctor_id || 0) || null;
}

export function getReviewDoctorName(patient) {
  return String(
    patient?.review_assigned_doctor_name || patient?.assigned_doctor_name || "",
  ).trim();
}

export function isPatientUnderReview(patient) {
  const value = patient?.is_under_review;
  return value === true || value === 1 || value === "1";
}

export function defaultReviewDueDateInputValue() {
  return dayjs().add(30, "day").format("YYYY-MM-DD");
}

export function formatScheduledReviewDate(value) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("DD MMM, YYYY") : "";
}

export function formatReviewAppointmentTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return "";
  }

  const hours = Number(match[1]);
  const minutes = match[2];
  if (!Number.isInteger(hours) || hours > 23) {
    return "";
  }

  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes} ${suffix}`;
}

export function formatReviewDueShort(value) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("DD MMM") : "";
}

/** Two-digit month (01–12) from review_due_date for calendar-month filters. */
export function parsePatientReviewDueMonth(reviewDueDate) {
  const raw = String(reviewDueDate || "").trim();
  if (!raw) {
    return "";
  }

  const isoPrefix = raw.length >= 10 ? raw.slice(0, 10) : raw;
  const parsed = dayjs(isoPrefix);

  return parsed.isValid() ? parsed.format("MM") : "";
}

export function formatReviewTimelineDate(value) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : "";
}
