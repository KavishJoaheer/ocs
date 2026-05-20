/**
 * Folder pills: show categories that have stock in the active view.
 * Falls back to Consumable (or first folder) when everything is empty.
 */
export function getFolderIdsWithStock(items = []) {
  const ids = new Set();
  items.forEach((item) => {
    if (item?.folder_id != null && item.folder_id !== "") {
      ids.add(String(item.folder_id));
    }
  });
  return ids;
}

export function getDisplayFolders(folders = [], items = []) {
  if (!folders.length) return [];

  const withStock = folders.filter((folder) => getFolderIdsWithStock(items).has(String(folder.id)));
  if (withStock.length) return withStock;

  const consumable = folders.filter((folder) => folder.name === "Consumable");
  if (consumable.length) return consumable;

  return folders.slice(0, 1);
}

/** Query string for GET /inventory and mutation responses that return full workspace payload. */
export function buildInventoryListQuery({
  contextDoctorId = "",
  doctorContext = "my",
  includeDoctorContext = false,
  includeAdminFilters = false,
  adminPeriodRange = null,
  activityStaffUserId = "",
} = {}) {
  const query = new URLSearchParams();
  if (contextDoctorId) query.set("doctorId", String(contextDoctorId));
  if (includeDoctorContext) query.set("context", doctorContext);
  if (includeAdminFilters && adminPeriodRange) {
    query.set("dateFrom", adminPeriodRange.from);
    query.set("dateTo", adminPeriodRange.to);
    if (activityStaffUserId) query.set("activityUserId", String(activityStaffUserId));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}
