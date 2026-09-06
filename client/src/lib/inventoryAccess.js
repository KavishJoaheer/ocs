export function isAdminUser(user) {
  return user?.role === "admin";
}

export function isOperatorUser(user) {
  return user?.role === "operator";
}

export function isDoctorUser(user) {
  return user?.role === "doctor";
}

export function canManageWarehouseView(user) {
  return isAdminUser(user) || isOperatorUser(user);
}

export function canReceiveWarehouseStock(user) {
  return isOperatorUser(user) || isAdminUser(user);
}

export function canWriteOffWarehouseStock(user) {
  return isOperatorUser(user) || isAdminUser(user);
}

export function canTransferToDoctorBag(user) {
  return isOperatorUser(user) || isAdminUser(user);
}

export function canImportShipments(user) {
  return isOperatorUser(user) || isAdminUser(user);
}

export function canCountStocktake(user) {
  return isOperatorUser(user) || isAdminUser(user);
}

export function canReviewStocktake(user) {
  return isAdminUser(user);
}

export function canEditCatalogue(user) {
  return isAdminUser(user);
}

export function canArchiveCatalogueItem(user) {
  return isAdminUser(user);
}

export function canApplyExceptionalCorrection(user) {
  return isAdminUser(user);
}

export function requiresOperationalOverride(user) {
  return isAdminUser(user);
}

export const TOUCH_TARGET_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center";

export const INVENTORY_MENU_ITEM_CLASS =
  "flex w-full min-h-11 items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d8f98]";

export const MIN_OVERRIDE_REASON = 10;

export function withOperationalOverride(user, payload = {}, overrideReason = "") {
  if (!requiresOperationalOverride(user)) return payload;
  return {
    ...payload,
    operational_override: true,
    override_reason: String(overrideReason || "").trim(),
  };
}

export function isPositiveWholeNumber(value) {
  const qty = Number(value);
  return Number.isInteger(qty) && qty > 0;
}

export function isNonNegativeNumber(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0;
}

export function todayLocalDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

export function isPastLocalDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return raw < todayLocalDate();
}

export function formatAllocationExpiry(row) {
  if (row?.is_non_expiring) return "Non-expiring";
  if (row?.expired) return `${row.expiry_date || "No date"} · expired`;
  return row?.expiry_date || "No expiry";
}
