const PREVIEWABLE_FILE_PATTERN = /\.(pdf|png|jpe?g|gif|webp)$/i;

/**
 * Android browsers (Chrome, Samsung Internet, Huawei) have no inline PDF viewer,
 * and a top-level navigation to a `blob:` URL is dropped without any error, so
 * the tab just stays blank. Those devices must save the file instead and let the
 * system viewer open it.
 */
export function supportsInlineBlobPreview() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return !/Android/i.test(navigator.userAgent || "");
}

/** Must be called synchronously from the click handler or the pop-up is blocked. */
export function openInlinePreviewTab() {
  if (!supportsInlineBlobPreview()) {
    return null;
  }

  return window.open("about:blank", "_blank");
}

export function isPreviewableFile({ mimeType, filename } = {}) {
  const mime = String(mimeType || "");

  return (
    mime.includes("pdf") ||
    mime.startsWith("image/") ||
    PREVIEWABLE_FILE_PATTERN.test(String(filename || ""))
  );
}

export function safeDecodeFilename(value, fallback = "download") {
  const raw = String(value || "").trim();

  if (!raw) {
    return fallback;
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function closePreviewTab(previewTab) {
  if (previewTab && !previewTab.closed) {
    previewTab.close();
  }
}

/**
 * Shows a downloaded file, previewing it in `previewTab` when the browser can
 * render it and saving it to the device otherwise. Returns "preview" or "download".
 */
export function presentFileBlob({ blob, filename, mimeType, previewTab = null }) {
  const objectUrl = window.URL.createObjectURL(blob);
  const safeName = safeDecodeFilename(filename);

  if (previewTab && !previewTab.closed && isPreviewableFile({ mimeType, filename: safeName })) {
    previewTab.location.href = objectUrl;
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 120_000);
    return "preview";
  }

  closePreviewTab(previewTab);

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = safeName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately cancels the save on Android Chrome.
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
  return "download";
}
