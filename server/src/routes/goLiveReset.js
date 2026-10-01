"use strict";

const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const { db, dbPath, financeAttachmentsDir } = require("../db");
const { resetTrialBilling } = require("../lib/trialBillingReset");
const { createVerifiedBackup, verifyDatabase } = require("../scripts/backupClinicData");

const router = express.Router();
const CUTOVER_DATE = "2026-10-02";
const CONFIRMATION = "RESET_TRIAL_BILLING_2026_10_02";
const BACKUP_NAME = "pre-go-live-2026-10-01";

function backupPaths() {
  const root = path.join(path.dirname(dbPath), "go-live-backups");
  const dir = path.join(root, BACKUP_NAME);
  return {
    root,
    dir,
    database: path.join(dir, "clinic.db"),
    manifest: path.join(dir, "manifest.json"),
    result: path.join(dir, "reset-result.json"),
  };
}

function verifiedExistingBackup(paths) {
  if (!fs.existsSync(paths.database) || !fs.existsSync(paths.manifest)) return null;
  const verificationDb = verifyDatabase(paths.database);
  verificationDb.close();
  const manifest = JSON.parse(fs.readFileSync(paths.manifest, "utf8"));
  if (manifest.sqlite_quick_check !== "ok" || Number(manifest.foreign_key_violations) !== 0) {
    throw new Error("The existing go-live backup did not pass its recorded integrity checks.");
  }
  return manifest;
}

function removeFinanceAttachments() {
  if (!fs.existsSync(financeAttachmentsDir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(financeAttachmentsDir, { withFileTypes: true })) {
    fs.rmSync(path.join(financeAttachmentsDir, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function totalRows(counts) {
  return Object.values(counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function previewPayload(plan, backupReady, completed, result) {
  const billingRows = Number(plan?.before?.billing || 0);
  return {
    cutover_date: CUTOVER_DATE,
    backup_name: BACKUP_NAME,
    backup_ready: backupReady,
    completed,
    result,
    counts: {
      bills: billingRows,
      billing_and_finance_rows: totalRows(plan?.before),
      supply_requests: Number(plan?.openingStock?.supplyRequests || 0),
      stock_movements: Number(plan?.openingStock?.movements || 0),
      batches: Number(plan?.openingStock?.batches || 0),
      stock_items_with_quantity: Number(plan?.openingStock?.itemsWithQuantity || 0),
    },
  };
}

function renderPage({ plan, backupReady, completed, result }) {
  const billingRows = Number(plan?.before?.billing || 0);
  const financialRows = totalRows(plan?.before) - billingRows;
  const stock = plan?.openingStock || {};
  const status = completed
    ? `<h2>Reset completed</h2><p>The database is ready for 2 October 2026.</p><pre>${JSON.stringify(result, null, 2)}</pre>`
    : `<h2>Ready for final confirmation</h2>
       <p>A verified backup ${backupReady ? "is already available" : "will be created first"}. The reset will then permanently clear the trial records shown below.</p>
       <form method="post" action="/go-live-reset/execute?confirmation=${CONFIRMATION}">
         <button type="submit">Permanently reset trial data</button>
       </form>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OCS go-live reset</title></head>
<body><main><h1>OCS go-live reset preview</h1>
<p>Cutover date: <strong>${CUTOVER_DATE}</strong></p>
<ul>
  <li>Bills: ${billingRows}</li>
  <li>Associated billing and finance rows: ${financialRows}</li>
  <li>Supply requests: ${Number(stock.supplyRequests || 0)}</li>
  <li>Stock movement records: ${Number(stock.movements || 0)}</li>
  <li>Batch records: ${Number(stock.batches || 0)}</li>
  <li>Warehouse and doctor-bag items with a non-zero quantity: ${Number(stock.itemsWithQuantity || 0)}</li>
</ul>
<p>The catalogue, folders, patients, visits, consultations, staff and selling prices remain in place. Stock quantities, non-service cost prices and expiry dates are reset.</p>
${status}</main></body></html>`;
}

router.get("/", (req, res, next) => {
  try {
    const paths = backupPaths();
    const completed = fs.existsSync(paths.result);
    const result = completed ? JSON.parse(fs.readFileSync(paths.result, "utf8")) : null;
    const plan = resetTrialBilling(db, { cutoverDate: CUTOVER_DATE, dryRun: true });
    const backupReady = Boolean(verifiedExistingBackup(paths));
    res.setHeader("Cache-Control", "no-store");
    if (String(req.query.format || "") === "json") {
      return res.json(previewPayload(plan, backupReady, completed, result));
    }
    res.type("html").send(renderPage({ plan, backupReady, completed, result }));
  } catch (error) {
    next(error);
  }
});

router.post("/execute", async (req, res, next) => {
  try {
    if (String(req.query.confirmation || "") !== CONFIRMATION) {
      return res.status(400).json({ error: "The go-live reset confirmation phrase is missing." });
    }

    const paths = backupPaths();
    if (fs.existsSync(paths.result)) {
      return res.status(409).json({ error: "The go-live reset has already been completed." });
    }

    let manifest = verifiedExistingBackup(paths);
    if (!manifest) {
      const backup = await createVerifiedBackup({
        backupRoot: paths.root,
        backupName: BACKUP_NAME,
        allowSameVolume: true,
      });
      manifest = backup.manifest;
    }

    const reset = resetTrialBilling(db, {
      cutoverDate: CUTOVER_DATE,
      reason: "Clean production opening balance for official go-live on 2 October 2026",
    });
    const financeAttachmentsRemoved = removeFinanceAttachments();
    const result = {
      completed_at: new Date().toISOString(),
      cutover_date: CUTOVER_DATE,
      backup_directory: paths.dir,
      backup_files: manifest.files.length,
      bills_removed: Number(reset.before.billing || 0),
      billing_and_finance_rows_removed: totalRows(reset.before),
      supply_requests_removed: Number(reset.openingStock.supplyRequests || 0),
      stock_movements_removed: Number(reset.openingStock.movements || 0),
      batches_removed: Number(reset.openingStock.batches || 0),
      stock_items_zeroed: Number(reset.openingStock.itemsWithQuantity || 0),
      finance_attachment_entries_removed: financeAttachmentsRemoved,
      sqlite_quick_check: db.pragma("quick_check", { simple: true }),
      foreign_key_violations: db.pragma("foreign_key_check").length,
    };
    fs.writeFileSync(paths.result, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    res.setHeader("Cache-Control", "no-store");
    if (String(req.query.format || "") === "json") {
      return res.json({ ok: true, ...result });
    }
    return res.type("html").send(renderPage({
      plan: resetTrialBilling(db, { cutoverDate: CUTOVER_DATE, dryRun: true }),
      backupReady: true,
      completed: true,
      result,
    }));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
