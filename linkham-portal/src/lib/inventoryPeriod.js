import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);

export const INVENTORY_PERIOD_PRESETS = [
  { id: "yearly", label: "Yearly" },
  { id: "monthly", label: "Monthly" },
  { id: "weekly", label: "Weekly" },
];

export function inventoryTodayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

export function getInventoryDateRange(preset, anchorDateStr) {
  const anchor = dayjs(anchorDateStr || inventoryTodayInputValue());
  if (!anchor.isValid()) {
    const today = inventoryTodayInputValue();
    return { from: today, to: today };
  }

  switch (preset) {
    case "yearly":
      return {
        from: anchor.startOf("year").format("YYYY-MM-DD"),
        to: anchor.endOf("year").format("YYYY-MM-DD"),
      };
    case "monthly":
      return {
        from: anchor.startOf("month").format("YYYY-MM-DD"),
        to: anchor.endOf("month").format("YYYY-MM-DD"),
      };
    case "weekly":
      return {
        from: anchor.startOf("isoWeek").format("YYYY-MM-DD"),
        to: anchor.endOf("isoWeek").format("YYYY-MM-DD"),
      };
    default:
      return {
        from: anchor.startOf("month").format("YYYY-MM-DD"),
        to: anchor.endOf("month").format("YYYY-MM-DD"),
      };
  }
}

export function formatInventoryPeriodLabel(preset, dateFrom, dateTo) {
  const from = dayjs(dateFrom);
  const to = dayjs(dateTo);

  if (preset === "yearly" && from.isValid()) {
    return from.format("YYYY");
  }
  if (preset === "monthly" && from.isValid()) {
    return from.format("MMMM YYYY");
  }
  if (preset === "weekly" && from.isValid() && to.isValid()) {
    return `${from.format("DD MMM")} – ${to.format("DD MMM YYYY")}`;
  }
  if (from.isValid() && to.isValid()) {
    return `${from.format("DD/MM/YYYY")} – ${to.format("DD/MM/YYYY")}`;
  }

  return "Selected period";
}
