import { jsPDF } from "jspdf";
import { formatCurrency, formatDate } from "./format.js";

function buildBillPdf(bill) {
  const doc = new jsPDF();
  let y = 20;
  doc.setFontSize(16);
  doc.text("OCS Medecins — Invoice", 14, y);
  y += 10;
  doc.setFontSize(11);
  doc.text(`Invoice #${bill.id}`, 14, y);
  y += 7;
  doc.text(`Patient: ${bill.patient_name || ""}`, 14, y);
  y += 7;
  doc.text(`Consultation: ${formatDate(bill.consultation_date)}`, 14, y);
  y += 7;
  doc.text(`Total: ${formatCurrency(bill.total_amount)}`, 14, y);
  y += 7;
  doc.text(`Status: ${bill.status || ""}`, 14, y);
  y += 10;
  (bill.items || []).forEach((item) => {
    const line = `${item.description || ""} — ${formatCurrency(item.amount)} (${item.type || "Sale"})`;
    doc.text(line.slice(0, 95), 14, y);
    y += 6;
    if (y > 280) {
      doc.addPage();
      y = 20;
    }
  });
  return doc;
}

function openPdfBlobInNewTab(blob, revokeDelayMs = 120_000) {
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
}

/**
 * Open invoice PDF in a new browser tab (inline). Uses Web Share when available;
 * avoids doc.save() so the browser does not force download.
 */
export async function shareOrDownloadBillPdf(bill) {
  const doc = buildBillPdf(bill);
  const blob = doc.output("blob");
  const file = new File([blob], `invoice-${bill.id}.pdf`, { type: "application/pdf" });

  const canShare =
    typeof navigator !== "undefined" &&
    navigator.share &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (!canShare) {
    openPdfBlobInNewTab(blob);
    return;
  }

  const previewTab = window.open("about:blank", "_blank");
  try {
    await navigator.share({ files: [file], title: `Invoice #${bill.id}` });
    if (previewTab && !previewTab.closed) {
      previewTab.close();
    }
  } catch {
    const url = URL.createObjectURL(blob);
    if (previewTab && !previewTab.closed) {
      previewTab.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } else {
      openPdfBlobInNewTab(blob);
    }
  }
}
