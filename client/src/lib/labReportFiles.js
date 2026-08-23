/** Matches server/src/routes/labReports.js MAX_ATTACHMENTS_PER_REQUEST. */
export const LAB_REPORT_MAX_NEW_FILES = 5;

/**
 * Broad enough for iOS Photos, Samsung/Huawei gallery, and PDF browse.
 * Camera capture is a separate input — putting capture on this accept list
 * makes some Android WebViews open the camera only and return one file.
 */
export const LAB_REPORT_LIBRARY_ACCEPT =
  "image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif";

export const LAB_REPORT_CAMERA_ACCEPT = "image/*";

export function labReportFileKey(file) {
  return `${file?.name || ""}::${file?.size || 0}::${file?.lastModified || 0}`;
}

/**
 * Native <input type="file"> FileLists are replaced on every pick.
 * iOS, Samsung, and Huawei WebViews almost always return one photo per
 * picker session, so new selections must be appended in JS.
 */
export function mergeLabReportFiles(existing = [], incoming = [], max = LAB_REPORT_MAX_NEW_FILES) {
  const files = [...existing];
  const seen = new Set(files.map(labReportFileKey));
  let skippedOverflow = 0;

  for (const file of incoming) {
    if (!file) {
      continue;
    }

    const key = labReportFileKey(file);
    if (seen.has(key)) {
      continue;
    }

    if (files.length >= max) {
      skippedOverflow += 1;
      continue;
    }

    seen.add(key);
    files.push(file);
  }

  return { files, skippedOverflow, max };
}
