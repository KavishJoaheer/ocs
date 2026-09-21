"use strict";

const ExcelJS = require("exceljs");

function excelDateToIso(value) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function excelSerialToIso(serial) {
  const wholeDays = Math.round(Number(serial));
  const utc = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86400000);
  return excelDateToIso(utc);
}

function looksLikeExcelDateFormat(numFmt) {
  const format = String(numFmt || "").toLowerCase();
  if (!format || format === "general") return false;
  return /[ymd]/.test(format) && !/[hms]/.test(format.replace(/am\/pm|a\/p/g, ""));
}

function formatShipmentValue(value, numFmt) {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return excelDateToIso(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    if (looksLikeExcelDateFormat(numFmt)) return excelSerialToIso(value);
    if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
    return String(value);
  }
  if (typeof value === "object") {
    if (value.result != null) return formatShipmentValue(value.result, numFmt);
    if (typeof value.text === "string") return value.text.trim();
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || "").join("").trim();
    }
  }
  return String(value).trim();
}

function shipmentCellText(cell) {
  if (cell && typeof cell === "object" && typeof cell.address === "string") {
    return formatShipmentValue(cell.value, cell.numFmt);
  }
  return formatShipmentValue(cell);
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks));
  const sheets = workbook.worksheets.map((sheet) => {
    const rows = [];
    const lastRow = sheet.rowCount || 0;
    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const width = Math.max(row.cellCount || 0, 12);
      const cells = [];
      for (let col = 1; col <= width; col += 1) cells.push(shipmentCellText(row.getCell(col)));
      if (cells.some((value) => String(value || "").trim())) rows.push({ row: rowNumber, cells });
    }
    return { name: sheet.name, state: sheet.state, rows };
  });
  process.stdout.write(JSON.stringify(sheets));
}

main().catch((error) => {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
});
