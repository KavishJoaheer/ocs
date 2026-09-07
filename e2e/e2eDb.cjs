const path = require("node:path");
const Database = require(path.join(__dirname, "../server/node_modules/better-sqlite3"));

function openE2eDb() {
  const dbPath = process.env.E2E_DB_PATH;
  if (!dbPath) {
    throw new Error("E2E_DB_PATH must be set by playwright.config.js");
  }
  return new Database(dbPath);
}

module.exports = { openE2eDb };
