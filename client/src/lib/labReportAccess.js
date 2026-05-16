export function canManageLabReportsForUser(user) {
  return ["admin", "doctor", "lab_tech", "operator"].includes(user?.role);
}

/** Lab report file attachments use `uploaded_by_user_id` as the uploader. */
export function canDeleteLabReportAttachment(user, attachment) {
  if (!user || !attachment) {
    return false;
  }

  if (user.role === "admin") {
    return true;
  }

  return Number(attachment.uploaded_by_user_id) === Number(user.id);
}
