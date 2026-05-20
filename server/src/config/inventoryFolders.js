/** Canonical OCS inventory category pills (folder names). */
const REQUIRED_INVENTORY_FOLDERS = [
  "Consumable",
  "IM Drugs",
  "IV Drugs",
  "Wound Dressing",
  "Pediatric Drugs",
  "Oral Drugs",
  "Investigation",
];

function inventoryFolderOrderSql(columnName = "name") {
  const whenClauses = REQUIRED_INVENTORY_FOLDERS.map(
    (folderName, index) => `WHEN '${folderName.replace(/'/g, "''")}' THEN ${index + 1}`,
  );
  return `CASE ${columnName}\n        ${whenClauses.join("\n        ")}\n        ELSE 999\n      END`;
}

module.exports = {
  REQUIRED_INVENTORY_FOLDERS,
  inventoryFolderOrderSql,
};
