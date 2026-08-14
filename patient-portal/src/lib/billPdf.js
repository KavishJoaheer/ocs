import { jsPDF } from "jspdf";
import dayjs from "dayjs";
import { openInlinePreviewTab, presentFileBlob } from "./fileBlobViewer.js";

const currencyFormatter = new Intl.NumberFormat("en-MU", {
  style: "currency",
  currency: "MUR",
  minimumFractionDigits: 2,
});

function formatCurrency(value) {
  return currencyFormatter.format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "Not set";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : String(value);
}

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

export async function shareOrDownloadBillPdf(bill) {
  const doc = buildBillPdf(bill);
  const blob = doc.output("blob");
  const filename = `invoice-${bill.id}.pdf`;
  const file = new File([blob], filename, { type: "application/pdf" });

  const canShare =
    typeof navigator !== "undefined" &&
    navigator.share &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canShare) {
    try {
      await navigator.share({ files: [file], title: `Invoice #${bill.id}` });
      return "share";
    } catch {
      // Sharing was dismissed or unavailable: fall back to preview/save below.
    }
  }

  return presentFileBlob({
    blob,
    filename,
    mimeType: "application/pdf",
    previewTab: openInlinePreviewTab(),
  });
}
