import dayjs from "dayjs";

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
