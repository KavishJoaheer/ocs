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
  const posts = db.prepare(`
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

  const patientUser = db.prepare(`
    SELECT id, full_name, welcome_story_created_at, welcome_story_read_at
    FROM patient_users
    WHERE id = ? AND is_active = 1
  `).get(patientUserId);

  if (!patientUser?.welcome_story_created_at) {
    return posts;
  }

  const firstName = String(patientUser.full_name || "")
    .trim()
    .split(/\s+/)[0] || "there";
  const welcomePost = serializePost({
    id: "welcome",
    title: `Welcome to OCS Care, ${firstName}.`,
    eyebrow: "Your OCS care space",
    summary:
      "Your appointments, health records, billing and OCS updates now have one secure home.",
    body: [
      `Welcome, ${firstName}. We’re happy to have you with us.`,
      "This is your secure space to request a home visit, follow appointments, view your health records and billing, and stay connected through Care Stories.",
      "Here in Care Stories, you’ll find general health information, clinic news and thoughtful updates from OCS. For medical advice specific to you, please contact your doctor or the clinic.",
      "Thank you for choosing OCS Médecins. We’re honoured to be part of your care journey.",
    ].join("\n\n"),
    category: "update",
    visual_theme: "teal",
    is_featured: patientUser.welcome_story_read_at ? 0 : 1,
    status: "published",
    published_at: patientUser.welcome_story_created_at,
    created_at: patientUser.welcome_story_created_at,
    updated_at: patientUser.welcome_story_created_at,
    is_read: Boolean(patientUser.welcome_story_read_at),
    is_saved: false,
    is_system_message: true,
    can_save: false,
  });

  return welcomePost.is_read ? [...posts, welcomePost] : [welcomePost, ...posts];
}

module.exports = {
  listPatientPosts,
  listStaffPosts,
  normalizePatientCarePost,
  serializePost,
  validatePatientCarePost,
};
