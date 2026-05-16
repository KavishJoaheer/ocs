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

export function formatReviewTimelineDate(value) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : "";
}
