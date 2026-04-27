-- Migration 001: patient affiliations + HCM archive status (UTF-8 safe)
-- SQLite uses UTF-8 text storage by default; values like "Santé" and "Médecin" are preserved.

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (category, name)
);

CREATE TABLE IF NOT EXISTS patient_locations (
  patient_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (patient_id, location_id),
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);

-- Backfill existing single-value location strings without data loss.
INSERT INTO locations (category, name)
SELECT DISTINCT 'Legacy Location', trim(location)
FROM patients
WHERE location IS NOT NULL
  AND trim(location) != ''
ON CONFLICT(category, name) DO NOTHING;

INSERT INTO patient_locations (patient_id, location_id)
SELECT p.id, l.id
FROM patients p
JOIN locations l
  ON l.category = 'Legacy Location'
 AND l.name = trim(p.location)
WHERE p.location IS NOT NULL
  AND trim(p.location) != ''
ON CONFLICT(patient_id, location_id) DO NOTHING;

-- HCM: ensure posts can auto-archive with explicit status.
ALTER TABLE hcm_news_posts ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
UPDATE hcm_news_posts SET status = COALESCE(NULLIF(status, ''), 'active');

COMMIT;