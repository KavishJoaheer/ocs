const express = require("express");
const { db } = require("../db");

const router = express.Router();

function getTeamStatuses() {
  return db
    .prepare(`
      SELECT
        u.id,
        u.full_name,
        u.username,
        u.role,
        u.operation_status,
        u.operation_status_updated_at,
        d.full_name AS doctor_name
      FROM users u
      LEFT JOIN doctors d ON d.id = u.doctor_id
      WHERE u.is_active = 1
      ORDER BY
        CASE u.role
          WHEN 'admin' THEN 0
          WHEN 'doctor' THEN 1
          WHEN 'operator' THEN 2
          WHEN 'lab_tech' THEN 3
          WHEN 'accountant' THEN 4
          ELSE 5
        END,
        u.full_name ASC
    `)
    .all();
}

function getNewsPosts() {
  return db
    .prepare(`
      SELECT
        post.*,
        created_by.full_name AS created_by_name,
        updated_by.full_name AS updated_by_name
      FROM hcm_news_posts post
      LEFT JOIN users created_by ON created_by.id = post.created_by_user_id
      LEFT JOIN users updated_by ON updated_by.id = post.updated_by_user_id
      ORDER BY post.updated_at DESC, post.created_at DESC
    `)
    .all();
}

function buildPayload() {
  return {
    posts: getNewsPosts(),
    team_statuses: getTeamStatuses(),
  };
}

function normalizePayload(body) {
  return {
    title: String(body.title ?? "").trim(),
    body: String(body.body ?? "").trim(),
  };
}

function validatePayload(payload) {
  if (!payload.title) {
    return "News title is required.";
  }

  if (!payload.body) {
    return "News content is required.";
  }

  return null;
}

router.get("/", (_req, res) => {
  res.json(buildPayload());
});

router.post("/", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can publish HCM updates." });
  }

  const payload = normalizePayload(req.body);
  const validationError = validatePayload(payload);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  db.prepare(`
    INSERT INTO hcm_news_posts (
      title,
      body,
      created_by_user_id,
      updated_by_user_id
    )
    VALUES (?, ?, ?, ?)
  `).run(payload.title, payload.body, req.auth.id, req.auth.id);

  res.status(201).json(buildPayload());
});

router.put("/:id", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can edit HCM updates." });
  }

  const postId = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM hcm_news_posts WHERE id = ?").get(postId);

  if (!existing) {
    return res.status(404).json({ error: "HCM update not found." });
  }

  const payload = normalizePayload(req.body);
  const validationError = validatePayload(payload);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  db.prepare(`
    UPDATE hcm_news_posts
    SET
      title = ?,
      body = ?,
      updated_by_user_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(payload.title, payload.body, req.auth.id, postId);

  res.json(buildPayload());
});

router.delete("/:id", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can remove HCM updates." });
  }

  const postId = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM hcm_news_posts WHERE id = ?").get(postId);

  if (!existing) {
    return res.status(404).json({ error: "HCM update not found." });
  }

  db.prepare("DELETE FROM hcm_news_posts WHERE id = ?").run(postId);
  res.status(204).send();
});

module.exports = router;
