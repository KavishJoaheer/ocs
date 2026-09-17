#!/usr/bin/env node
"use strict";

const CUTOVER_DATE = "2026-10-01";
const CONFIRMATION = "RESET_TRIAL_BILLING_2026_10_01";

const { db, initializeDatabase } = require("../db");
const { resetTrialBilling } = require("../lib/trialBillingReset");

function assertExecutionAllowed() {
  if (String(process.env.ALLOW_DB_PURGE || "").toLowerCase() !== "true") {
    throw new Error("Set ALLOW_DB_PURGE=true to authorize this destructive billing reset.");
  }
  if (String(process.env.BILLING_RESET_CONFIRM || "") !== CONFIRMATION) {
    throw new Error(`Set BILLING_RESET_CONFIRM=${CONFIRMATION} to confirm the exact reset.`);
  }
}

function printResult(result) {
  console.log(result.dryRun ? "Billing reset dry run:" : "Billing reset completed:");
  console.log(`  Cutover date: ${result.cutoverDate}`);
  console.log(`  Trial stock movements: ${result.inventoryMovementsRemoved}`);
  console.log(`  Billing idempotency receipts: ${result.billingReceiptCount}`);
  for (const [table, count] of Object.entries(result.before)) {
    console.log(`  ${table}: ${count}`);
  }
  for (const item of result.inventoryItemsRestored) {
    console.log(`  Stock restored: ${item.itemName || `#${item.itemId}`} ${item.previousQuantity} -> ${item.nextQuantity}`);
  }
}

function run() {
  initializeDatabase();
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun) assertExecutionAllowed();
  const result = resetTrialBilling(db, {
    cutoverDate: CUTOVER_DATE,
    reason: "Approved removal of trial billing before 1 October 2026 go-live",
    dryRun,
  });
  printResult(result);
  return result;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`[abort] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { CUTOVER_DATE, CONFIRMATION, assertExecutionAllowed, run };
