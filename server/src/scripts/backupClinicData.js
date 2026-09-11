"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const { db, dbPath, initializeDatabase, labReportAttachmentsDir, rosterDir } = require("../db");

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function isWithin(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function copyVerifiedFile(sourcePath, destinationPath, manifestPath, files) {
  const sourceStat = fs.lstatSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Backup source is not a regular file: ${sourcePath}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);

  const sourceHash = sha256File(sourcePath);
  const destinationHash = sha256File(destinationPath);
  if (sourceHash !== destinationHash) {
    throw new Error(`Checksum mismatch while copying ${sourcePath}`);
  }

  files.push({
    path: manifestPath.split(path.sep).join("/"),
    bytes: sourceStat.size,
    sha256: destinationHash,
  });
}

function copyDirectory(sourceDir, destinationDir, manifestPrefix, files) {
  if (!fs.existsSync(sourceDir)) return;

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    const manifestPath = path.join(manifestPrefix, entry.name);

    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to follow a symlink during backup: ${sourcePath}`);
    }
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath, manifestPath, files);
      continue;
    }
    if (entry.isFile()) {
      copyVerifiedFile(sourcePath, destinationPath, manifestPath, files);
    }
  }
}

function verifyDatabase(databasePath) {
  const verificationDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = verificationDb.pragma("quick_check", { simple: true });
    const foreignKeyViolations = verificationDb.pragma("foreign_key_check");
    if (quickCheck !== "ok") {
      throw new Error(`SQLite quick_check failed: ${quickCheck}`);
    }
    if (foreignKeyViolations.length > 0) {
      throw new Error(`SQLite foreign_key_check found ${foreignKeyViolations.length} violation(s).`);
    }
    return verificationDb;
  } catch (error) {
    verificationDb.close();
    throw error;
  }
}

async function createVerifiedBackup({
  backupRoot = process.env.BACKUP_DIR,
  backupName = process.env.BACKUP_NAME || `ocs-clinic-${timestampForPath()}`,
  allowSameVolume = process.env.ALLOW_SAME_VOLUME_BACKUP === "true",
} = {}) {
  if (!backupRoot) {
    throw new Error("BACKUP_DIR is required and should point to encrypted storage outside the live data volume.");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(backupName)) {
    throw new Error("BACKUP_NAME may contain only letters, numbers, dots, underscores, and hyphens.");
  }

  initializeDatabase();

  const resolvedBackupRoot = path.resolve(backupRoot);
  const liveDataDir = path.resolve(path.dirname(dbPath));
  if (!allowSameVolume && (resolvedBackupRoot === liveDataDir || isWithin(liveDataDir, resolvedBackupRoot))) {
    throw new Error(
      "BACKUP_DIR is inside the live data volume. Use separate encrypted storage, or explicitly set ALLOW_SAME_VOLUME_BACKUP=true for a temporary local copy.",
    );
  }

  fs.mkdirSync(resolvedBackupRoot, { recursive: true });
  const finalDir = path.join(resolvedBackupRoot, backupName);
  const partialDir = `${finalDir}.partial`;
  if (fs.existsSync(finalDir) || fs.existsSync(partialDir)) {
    throw new Error(`Backup destination already exists: ${finalDir}`);
  }

  fs.mkdirSync(partialDir, { recursive: false });
  const files = [];
  let snapshotDb;

  try {
    const snapshotPath = path.join(partialDir, "clinic.db");
    await db.backup(snapshotPath);
    snapshotDb = verifyDatabase(snapshotPath);
    files.push({
      path: "clinic.db",
      bytes: fs.statSync(snapshotPath).size,
      sha256: sha256File(snapshotPath),
    });

    const attachmentRows = snapshotDb
      .prepare("SELECT id, relative_path FROM lab_report_attachments ORDER BY id")
      .all();
    for (const attachment of attachmentRows) {
      const relativePath = String(attachment.relative_path || "").trim();
      const sourcePath = path.resolve(labReportAttachmentsDir, relativePath);
      if (!relativePath || !isWithin(labReportAttachmentsDir, sourcePath)) {
        throw new Error(`Unsafe attachment path in record ${attachment.id}.`);
      }
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Attachment ${attachment.id} is referenced by the snapshot but missing: ${relativePath}`);
      }
      copyVerifiedFile(
        sourcePath,
        path.join(partialDir, "lab-report-attachments", relativePath),
        path.join("lab-report-attachments", relativePath),
        files,
      );
    }

    copyDirectory(rosterDir, path.join(partialDir, "roster"), "roster", files);
    snapshotDb.close();
    snapshotDb = null;

    const manifest = {
      format: "ocs-clinic-backup-v1",
      created_at: new Date().toISOString(),
      source_database: path.basename(dbPath),
      sqlite_quick_check: "ok",
      foreign_key_violations: 0,
      attachment_records: attachmentRows.length,
      files,
    };
    fs.writeFileSync(
      path.join(partialDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    fs.renameSync(partialDir, finalDir);
    return { backupDir: finalDir, manifest };
  } catch (error) {
    if (snapshotDb) snapshotDb.close();
    fs.rmSync(partialDir, { recursive: true, force: true });
    throw error;
  }
}

if (require.main === module) {
  createVerifiedBackup()
    .then(({ backupDir, manifest }) => {
      console.log(`Verified backup created: ${backupDir}`);
      console.log(`Files: ${manifest.files.length}; attachments: ${manifest.attachment_records}`);
    })
    .catch((error) => {
      console.error(`Backup failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { createVerifiedBackup, sha256File, verifyDatabase };
