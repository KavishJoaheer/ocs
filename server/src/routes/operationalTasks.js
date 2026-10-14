const express = require("express");
const { db } = require("../db");
const { DEFAULT_POLICY, getPolicy, reconcileOperationalTasks, updateTask, canSeeTask, decorateTask } = require("../lib/operationalTasks");
const router = express.Router();

router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
function visible(req, status = "active") {
  const rows = db.prepare(status === "resolved"
    ? "SELECT * FROM operational_tasks WHERE status='resolved' ORDER BY resolved_at DESC"
    : "SELECT * FROM operational_tasks WHERE status!='resolved' ORDER BY escalation_level DESC,acknowledgement_due_at,id").all();
  const scoped = rows.filter(task => canSeeTask(req.auth, task));
  return (status === "resolved" ? scoped.slice(0, 100) : scoped).map(task => decorateTask(db, task, req.auth, Date.now()));
}
router.get("/", (req, res) => {
  reconcileOperationalTasks();
  const active = visible(req);
  const tasks = req.query.status === "resolved" ? visible(req, "resolved") : active;
  const owners = db.prepare("SELECT id,full_name,role,operation_status FROM users WHERE is_active=1 AND deleted_at IS NULL AND role IN ('admin','operator','doctor','lab_tech') ORDER BY full_name").all();
  res.json({ tasks, counts: { open: active.length, overdue: active.filter(t => t.overdue).length, unowned: active.filter(t => !t.owner_user_id).length,
    escalated: active.filter(t => t.escalation_level).length, mine: active.filter(t => Number(t.owner_user_id) === Number(req.auth.id)).length },
    owners: req.auth.role === "admin" ? owners : owners.filter(u => [req.auth.role, "admin"].includes(u.role)),
    policy: getPolicy(),
    ...(req.auth.role === "admin" ? { worker: db.prepare("SELECT * FROM operational_worker_state WHERE id=1").get() } : {}),
  });
});
router.get("/summary", (req, res) => {
  const tasks = visible(req);
  res.json({ open: tasks.length, overdue: tasks.filter(t => t.overdue).length, unowned: tasks.filter(t => !t.owner_user_id).length });
});
router.get("/policy", (_req, res) => res.json({ policy: getPolicy(), defaults: DEFAULT_POLICY }));
router.put("/policy", (req, res) => {
  if (req.auth.role !== "admin") return res.status(403).json({ error: "Only administrators can change response targets." });
  const policy = getPolicy();
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "Provide the response targets to update." });
  for (const [key, value] of Object.entries(req.body)) {
    if (!Object.hasOwn(DEFAULT_POLICY, key)) return res.status(400).json({ error: "Unknown response target." });
    if (key === "supervisor_user_id") {
      if (value !== null && (!Number.isInteger(value) || !db.prepare("SELECT id FROM users WHERE id=? AND role='admin' AND is_active=1 AND deleted_at IS NULL").get(value))) {
        return res.status(400).json({ error: "Choose an active administrator as the escalation supervisor." });
      }
    } else if (!Number.isInteger(value) || value < 1 || value > (key.endsWith("hours") ? 168 : 1440)) {
      return res.status(400).json({ error: "Response targets must be positive whole numbers within seven days (hours) or one day (minutes)." });
    }
    policy[key] = value;
  }
  db.transaction(() => {
    db.prepare("UPDATE operational_task_policy SET policy_json=?,updated_by=?,updated_at=? WHERE id=1").run(JSON.stringify(policy), req.auth.id, new Date().toISOString());
    // Existing accepted deadlines remain stable; new source stages use the new policy.
  })();
  res.json({ policy });
});
router.get("/:id/events", (req, res) => {
  reconcileOperationalTasks();
  const task = db.prepare("SELECT * FROM operational_tasks WHERE id=?").get(Number(req.params.id));
  if (!task || !canSeeTask(req.auth, task)) return res.status(404).json({ error: "Action not found." });
  const events = db.prepare(`SELECT e.*,u.full_name AS actor_name FROM operational_task_events e LEFT JOIN users u ON u.id=e.actor_user_id
    WHERE task_id=? ORDER BY e.id`).all(task.id);
  const deliveries = db.prepare(`SELECT user_id,reason,status,attempts,last_error,accepted_at,updated_at FROM operational_task_deliveries WHERE task_id=? ORDER BY id DESC`).all(task.id);
  res.json({ events: req.auth.role === "lab_tech" && task.owner_role === "doctor"
    ? events.map(entry => ({ ...entry, note: ["resolved", "acknowledged"].includes(entry.action) ? "" : entry.note })) : events, deliveries });
});
router.patch("/:id", (req, res) => {
  try { res.json({ task: decorateTask(db, updateTask(Number(req.params.id), req.auth, req.body), req.auth, Date.now()) }); }
  catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
});

module.exports = router;
