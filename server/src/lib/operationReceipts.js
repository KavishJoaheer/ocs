const { createHash } = require('node:crypto');
const { db } = require('../db');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function operationFor(req, scope, { legacyWindow = false } = {}) {
  const { operation_id, expected_version, ...intent } = req.body;
  // Versions are concurrency metadata, not the identity of a stock operation.
  const requestHash = createHash('sha256').update(JSON.stringify(stable(intent))).digest('hex');
  const supplied = operation_id || req.get('Idempotency-Key');
  if (supplied && (typeof supplied !== 'string' || supplied.length > 128 || !/^[\w:.-]+$/.test(supplied))) {
    throw Object.assign(new Error('Invalid operation ID.'), {status:400});
  }
  const id = supplied || (legacyWindow ? `legacy:${requestHash}` : null);
  const actorId = Number(req.auth.id);
  return {
    read() {
      if (!id) return null;
      const row = db.prepare(`SELECT * FROM operation_receipts WHERE actor_id=? AND scope=? AND operation_id=?
        ${!supplied && legacyWindow ? "AND created_at >= datetime('now', '-60 seconds')" : ''}`).get(actorId, scope, id);
      if (!row) return null;
      if (row.request_hash !== requestHash) throw Object.assign(new Error('This operation ID was already used with different details.'), {status:409});
      return JSON.parse(row.result_json);
    },
    save(result) {
      if (!id) return;
      db.prepare(`INSERT INTO operation_receipts(actor_id, scope, operation_id, request_hash, result_json)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(actor_id, scope, operation_id) DO UPDATE SET
        request_hash=excluded.request_hash, result_json=excluded.result_json, created_at=CURRENT_TIMESTAMP`)
        .run(actorId, scope, id, requestHash, JSON.stringify(result));
    },
  };
}
module.exports = { operationFor };
