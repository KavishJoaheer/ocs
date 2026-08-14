function getPatientPortalOrigin() {
  return String(
    process.env.PATIENT_PORTAL_ORIGIN ||
      process.env.CLIENT_ORIGIN ||
      "http://localhost:5174",
  ).replace(/\/$/, "");
}

function isSmtpConfigured() {
  return Boolean(String(process.env.SMTP_HOST || "").trim());
}

async function sendMail({ to, subject, text, html }) {
  const host = String(process.env.SMTP_HOST || "").trim();
  if (!host) {
    if (process.env.NODE_ENV !== "test") {
      console.info(`[mailer] SMTP_HOST is not set; skipped email to ${to}: ${subject}`);
    }
    return { sent: false, reason: "smtp_unconfigured" };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    console.warn("[mailer] nodemailer is not installed; skipped send.");
    return { sent: false, reason: "nodemailer_missing" };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER || "noreply@ocs.local",
    to,
    subject,
    text,
    html: html || text,
  });

  return { sent: true };
}

async function sendPatientPasswordResetEmail({ to, resetUrl }) {
  const subject = "Reset your OCS Care password";
  const text = [
    "We received a request to reset your OCS Care password.",
    "",
    `Open this link to choose a new password (it expires in 1 hour):`,
    resetUrl,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  return sendMail({ to, subject, text });
}

module.exports = {
  getPatientPortalOrigin,
  isSmtpConfigured,
  sendMail,
  sendPatientPasswordResetEmail,
};
