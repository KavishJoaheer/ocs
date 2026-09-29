const { db } = require("../db");

const CATEGORIES = new Set(["update", "wellbeing", "guide", "newsletter"]);
const THEMES = new Set(["teal", "gold", "coral", "indigo"]);
const STATUSES = new Set(["draft", "published"]);

function estimateReadMinutes(body) {
  const words = String(body || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 210));
}

function normalizePatientCarePost(input = {}) {
  return {
    title: String(input.title || "").trim(),
    eyebrow: String(input.eyebrow || "").trim().slice(0, 60),
    summary: String(input.summary || "").trim(),
    body: String(input.body || "").trim(),
    category: CATEGORIES.has(input.category) ? input.category : "update",
    visual_theme: THEMES.has(input.visual_theme) ? input.visual_theme : "teal",
    is_featured: input.is_featured ? 1 : 0,
    status: STATUSES.has(input.status) ? input.status : "draft",
  };
}

function validatePatientCarePost(post) {
  if (!post.title) return "A title is required.";
  if (!post.summary) return "A short preview is required.";
  if (!post.body) return "Article content is required.";
  if (post.title.length > 140) return "Keep the title under 140 characters.";
  if (post.summary.length > 280) return "Keep the preview under 280 characters.";
  return null;
}

function serializePost(row) {
  if (!row) return null;
  return {
    ...row,
    is_featured: Boolean(row.is_featured),
    is_read: Boolean(row.is_read),
    is_saved: Boolean(row.is_saved),
    read_minutes: estimateReadMinutes(row.body),
  };
}

function listStaffPosts() {
  return db.prepare(`
    SELECT
      post.*,
      created_by.full_name AS created_by_name,
      updated_by.full_name AS updated_by_name
    FROM patient_care_posts post
    LEFT JOIN users created_by ON created_by.id = post.created_by_user_id
    LEFT JOIN users updated_by ON updated_by.id = post.updated_by_user_id
    ORDER BY
      CASE post.status WHEN 'draft' THEN 0 ELSE 1 END,
      COALESCE(post.published_at, post.updated_at) DESC,
      post.id DESC
  `).all().map(serializePost);
}

function listPatientPosts(patientUserId) {
  return db.prepare(`
    SELECT
      post.*,
      CASE WHEN reads.post_id IS NULL THEN 0 ELSE 1 END AS is_read,
      CASE WHEN saves.post_id IS NULL THEN 0 ELSE 1 END AS is_saved
    FROM patient_care_posts post
    LEFT JOIN patient_care_post_reads reads
      ON reads.post_id = post.id AND reads.patient_user_id = ?
    LEFT JOIN patient_care_post_saves saves
      ON saves.post_id = post.id AND saves.patient_user_id = ?
    WHERE post.status = 'published'
    ORDER BY post.is_featured DESC, post.published_at DESC, post.id DESC
  `).all(patientUserId, patientUserId).map(serializePost);
}

module.exports = {
  listPatientPosts,
  listStaffPosts,
  normalizePatientCarePost,
  serializePost,
  validatePatientCarePost,
};
