/**
 * Folder pills for inventory category filters.
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

/**
 * @param {Array} folders - all folders from API (7 canonical categories)
 * @param {Array} items - active stock list for current view
 * @param {{ showAllCategories?: boolean }} options
 *   showAllCategories: true on OCS warehouse view — always show IM/IV/etc. pills even when empty
 */
export function getDisplayFolders(folders = [], items = [], { showAllCategories = false } = {}) {
  if (!folders.length) return [];
  if (showAllCategories) return folders;

  const withStock = folders.filter((folder) => getFolderIdsWithStock(items).has(String(folder.id)));
  if (withStock.length) return withStock;

  const consumable = folders.filter((folder) => folder.name === "Consumable");
  if (consumable.length) return consumable;

  return folders.slice(0, 1);
}

/** Prefer first folder that has stock, then Consumable, then first API folder. */
export function getDefaultFolderSelection(folders = [], items = []) {
  if (!folders.length) return null;
  const idsWithStock = getFolderIdsWithStock(items);
  const withStock = folders.find((folder) => idsWithStock.has(String(folder.id)));
  if (withStock) return withStock;
  const consumable = folders.find((folder) => folder.name === "Consumable");
  return consumable || folders[0];
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
