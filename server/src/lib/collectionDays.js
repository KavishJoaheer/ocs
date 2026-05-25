const VALID_COLLECTION_WEEKDAYS = [1, 3, 5, 6]; // Mon, Wed, Fri, Sat
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function getWeekdayForIsoDate(value) {
  const date = parseIsoDate(value);
  return date ? date.getUTCDay() : null;
}

function isValidCollectionWeekday(weekday) {
  return VALID_COLLECTION_WEEKDAYS.includes(Number(weekday));
}

function isValidCollectionDate(value) {
  const weekday = getWeekdayForIsoDate(value);
  if (weekday === null) {
    return false;
  }
  return isValidCollectionWeekday(weekday);
}

function describeValidCollectionDays() {
  return "Mondays, Wednesdays, Fridays, and Saturdays";
}

module.exports = {
  VALID_COLLECTION_WEEKDAYS,
  describeValidCollectionDays,
  getWeekdayForIsoDate,
  isValidCollectionDate,
  isValidCollectionWeekday,
  parseIsoDate,
};
