const VALID_COLLECTION_WEEKDAYS = [1, 3, 5, 6]; // Mon, Wed, Fri, Sat
const COLLECTION_WINDOW_DAYS_AHEAD = 21;
const DEFAULT_VALID_DAY_COUNT = 4;

function pad(value) {
  return String(value).padStart(2, "0");
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatCollectionLabel(date) {
  try {
    return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch (_error) {
    return toIsoDate(date);
  }
}

export function getValidCollectionDays(count = DEFAULT_VALID_DAY_COUNT) {
  const dates = [];
  const checkDate = new Date();
  let safetyCounter = 0;
  while (dates.length < count && safetyCounter < COLLECTION_WINDOW_DAYS_AHEAD) {
    checkDate.setDate(checkDate.getDate() + 1);
    safetyCounter += 1;
    if (VALID_COLLECTION_WEEKDAYS.includes(checkDate.getDay())) {
      dates.push({
        formatted: formatCollectionLabel(checkDate),
        iso: toIsoDate(checkDate),
        weekday: checkDate.getDay(),
      });
    }
  }
  return dates;
}

export function isValidCollectionWeekday(weekday) {
  return VALID_COLLECTION_WEEKDAYS.includes(Number(weekday));
}

export function describeCollectionWeekday(weekday) {
  const names = {
    1: "Monday",
    3: "Wednesday",
    5: "Friday",
    6: "Saturday",
  };
  return names[Number(weekday)] || "";
}

export { VALID_COLLECTION_WEEKDAYS };
