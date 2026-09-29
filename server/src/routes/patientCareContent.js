const express = require("express");
const { db } = require("../db");
const { sendPushToPatientUser } = require("../lib/push");
const {
  listStaffPosts,
  normalizePatientCarePost,
  validatePatientCarePost,
} = require("../lib/patientCareContent");

const router = express.Router();

async function broadcastPublishedStory(story) {
  const patientUsers = db.prepare("SELECT id FROM patient_users WHERE is_active = 1").all();
  if (!patientUsers.length) return;
  const title = String(story.title || "A new story from OCS Care").slice(0, 120);
  const summary = String(
    story.summary || "Tap to read the latest update from your care team.",
  ).slice(0, 180);

  await Promise.allSettled(
    patientUsers.map(({ id }) =>
      sendPushToPatientUser(id, {
        title: "New from your OCS care team",
        body: `${title} — ${summary}`,
        url: "/care",
        icon: "/pwa-192.png",
        tag: `patient-care-story-${story.id || "new"}`,
      }),
    ),
  );
}

function payload() {
  return { posts: listStaffPosts() };
}

router.get("/", (_req, res) => {
  res.json(payload());
});

router.post("/", (req, res) => {
  const post = normalizePatientCarePost(req.body);
  const error = validatePatientCarePost(post);
  if (error) return res.status(400).json({ error });

  if (post.is_featured && post.status === "published") {
    db.prepare("UPDATE patient_care_posts SET is_featured = 0").run();
  }

  const result = db.prepare(`
    INSERT INTO patient_care_posts (
      title, eyebrow, summary, body, category, visual_theme, is_featured, status,
      published_at, created_by_user_id, updated_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END, ?, ?)
  `).run(
    post.title, post.eyebrow, post.summary, post.body, post.category,
    post.visual_theme, post.is_featured, post.status, post.status, req.auth.id, req.auth.id,
  );

  if (post.status === "published") {
    void broadcastPublishedStory({ ...post, id: result.lastInsertRowid }).catch((error) => {
      console.warn("[push] patient care story broadcast failed:", error?.message || error);
    });
  }

  res.status(201).json(payload());
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM patient_care_posts WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Patient story not found." });

  const post = normalizePatientCarePost(req.body);
  const error = validatePatientCarePost(post);
  if (error) return res.status(400).json({ error });

  if (post.is_featured && post.status === "published") {
    db.prepare("UPDATE patient_care_posts SET is_featured = 0 WHERE id != ?").run(id);
  }

  db.prepare(`
    UPDATE patient_care_posts
    SET title = ?, eyebrow = ?, summary = ?, body = ?, category = ?, visual_theme = ?,
        is_featured = ?, status = ?,
        published_at = CASE
          WHEN ? = 'published' AND published_at IS NULL THEN CURRENT_TIMESTAMP
          WHEN ? = 'draft' THEN NULL
          ELSE published_at
        END,
        updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    post.title, post.eyebrow, post.summary, post.body, post.category,
    post.visual_theme, post.is_featured, post.status, post.status, post.status,
    req.auth.id, id,
  );

  if (existing.status !== "published" && post.status === "published") {
    void broadcastPublishedStory({ ...post, id }).catch((error) => {
      console.warn("[push] patient care story broadcast failed:", error?.message || error);
    });
  }

  res.json(payload());
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare("DELETE FROM patient_care_posts WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: "Patient story not found." });
  res.status(204).send();
});

module.exports = router;
