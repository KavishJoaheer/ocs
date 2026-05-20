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
