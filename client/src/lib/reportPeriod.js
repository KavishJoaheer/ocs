import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);

export const REPORT_PERIOD_OPTIONS = [
  { id: "daily", label: "Day", dateLabel: "Date" },
  { id: "weekly", label: "Week", dateLabel: "Week of" },
  { id: "monthly", label: "Month", dateLabel: "Month" },
  { id: "annual", label: "Year", dateLabel: "Year" },
];

export function getTodayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

export function normalizeReportPeriod(value, fallback = "monthly") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return REPORT_PERIOD_OPTIONS.some((option) => option.id === normalized) ? normalized : fallback;
}

export function getPeriodRange(period, anchorDateStr) {
  const today = getTodayInputValue();
  const anchor = dayjs(anchorDateStr || today);
  const d = anchor.isValid() ? anchor : dayjs(today);

  if (period === "daily") {
    const day = d.format("YYYY-MM-DD");
    return { from: day, to: day };
  }

  if (period === "weekly") {
    return {
      from: d.startOf("isoWeek").format("YYYY-MM-DD"),
      to: d.endOf("isoWeek").format("YYYY-MM-DD"),
    };
  }

  if (period === "annual") {
    return {
      from: d.startOf("year").format("YYYY-MM-DD"),
      to: d.endOf("year").format("YYYY-MM-DD"),
    };
  }

  return {
    from: d.startOf("month").format("YYYY-MM-DD"),
    to: d.endOf("month").format("YYYY-MM-DD"),
  };
}

export function formatRangeLabel(period, start, end) {
  if (!start || !end) return "";
  const from = dayjs(start);
  const to = dayjs(end);
  if (period === "daily") return from.format("dddd D MMMM YYYY");
  if (period === "weekly") return `${from.format("D MMM")} – ${to.format("D MMM YYYY")}`;
  if (period === "annual") return from.format("YYYY");
  return from.format("MMMM YYYY");
}

export function shiftAnchorDate(period, anchorDate, delta) {
  const today = getTodayInputValue();
  const current = dayjs(anchorDate || today);
  const d = current.isValid() ? current : dayjs(today);

  if (period === "daily") return d.add(delta, "day").format("YYYY-MM-DD");
  if (period === "weekly") return d.add(delta, "week").format("YYYY-MM-DD");
  if (period === "monthly") return d.add(delta, "month").startOf("month").format("YYYY-MM-DD");
  return d.add(delta, "year").startOf("year").format("YYYY-MM-DD");
}

export function canShiftPeriodForward(period, anchorDate, today = getTodayInputValue()) {
  const next = shiftAnchorDate(period, anchorDate, 1);
  return !dayjs(next).isAfter(dayjs(today), "day");
}

export function periodToBillingPreset(period) {
  if (period === "annual") return "yearly";
  if (period === "daily") return "specific";
  if (period === "weekly") return "weekly";
  return "monthly";
}

export function yearOptions(today = getTodayInputValue()) {
  const currentYear = dayjs(today).year();
  const years = [];
  for (let year = currentYear; year >= currentYear - 6; year -= 1) {
    years.push(year);
  }
  return years;
}

export function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function downloadCsv(filename, rows) {
  const lines = rows.map((row) => row.map(csvEscape).join(","));
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
