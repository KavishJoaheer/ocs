import dayjs from "dayjs";

const currencyFormatter = new Intl.NumberFormat("en-MU", {
  style: "currency",
  currency: "MUR",
  minimumFractionDigits: 2,
});

const rupeeFormatter = new Intl.NumberFormat("en-MU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value) {
  return currencyFormatter.format(Number(value || 0));
}

export function formatRupees(value) {
  return `Rs ${rupeeFormatter.format(Number(value || 0))}`;
}

export function formatDate(value) {
  if (!value) return "Not set";
  return dayjs(value).format("MMM D, YYYY");
}

export function calculateAgeFromDateOfBirth(value) {
  if (!value) return null;

  const birthDate = dayjs(value);

  if (!birthDate.isValid()) {
    return null;
  }

  const today = dayjs();
  let age = today.year() - birthDate.year();

  if (
    today.month() < birthDate.month() ||
    (today.month() === birthDate.month() && today.date() < birthDate.date())
  ) {
    age -= 1;
  }

  return Math.max(age, 0);
}

export function formatAgeFromDateOfBirth(value) {
  const age = calculateAgeFromDateOfBirth(value);
  return age === null ? "Age unavailable" : `${age} years old`;
}

export function formatDateTime(date, time) {
  if (!date) return "Not scheduled";
  if (!time) return dayjs(date).format("MMM D, YYYY");
  return dayjs(`${date}T${time}`).format("MMM D, YYYY [at] h:mm A");
}

export function truncate(value, limit = 110) {
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

export function formatPaymentMethod(value) {
  const normalized = String(value || "").trim().toLowerCase();

  switch (normalized) {
    case "cash":
      return "Cash";
    case "juice":
      return "Juice";
    case "card":
      return "Card";
    case "ib":
      return "IB";
    default:
      return "Not recorded";
  }
}

export function statusLabel(value) {
  const normalized = String(value || "").replace(/_/g, " ");
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}

export function statusTone(status) {
  switch (status) {
    case "available":
      return "bg-emerald-100 text-emerald-700 ring-emerald-600/20";
    case "completed":
    case "paid":
    case "active":
      return "bg-emerald-100 text-emerald-700 ring-emerald-600/20";
    case "offline":
    case "cancelled":
    case "discharged":
      return "bg-rose-100 text-rose-700 ring-rose-600/20";
    case "scheduled":
      return "bg-sky-100 text-sky-700 ring-sky-600/20";
    case "unpaid":
      return "bg-amber-100 text-amber-700 ring-amber-500/20";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-500/20";
  }
}
