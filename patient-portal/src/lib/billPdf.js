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
  const writeLine = (text, { size = 10, bold = false, gap = 7 } = {}) => {
    if (y > 278) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const wrapped = doc.splitTextToSize(String(text || ""), 180);
    doc.text(wrapped, 14, y);
    y += Math.max(gap, wrapped.length * 5 + 2);
  };
  writeLine("OCS Medecins — Invoice", { size: 16, bold: true, gap: 10 });
  writeLine(`Invoice: ${bill.invoice_number || `OCS-INV-${String(bill.id || 0).padStart(8, "0")}`}`, { size: 11, bold: true });
  writeLine(`Patient: ${bill.patient_name || ""}${bill.patient_identifier ? ` (${bill.patient_identifier})` : ""}`);
  writeLine(`Doctor: ${bill.doctor_name || ""}`);
  writeLine(`Consultation: ${formatDate(bill.consultation_date)}`);
  writeLine(`Gross invoice: ${formatCurrency(bill.total_amount)}`, { bold: true });
  (bill.items || []).filter((item) => item.type === "Sale").forEach((item) => {
    writeLine(`${item.description || ""} ×${Number(item.quantity || 1)} — ${formatCurrency(item.amount)} (${item.type || "Sale"})`);
  });
  y += 3;
  writeLine("Payment ledger", { size: 11, bold: true });
  if (!(bill.payment_transactions || []).length) writeLine("No payment transactions recorded.");
  for (const payment of bill.payment_transactions || []) {
    writeLine(`${payment.entry_type === "reversal" ? "Payment reversal" : "Payment"} · ${formatDate(payment.payment_date)} · ${payment.payment_method || ""} · ${formatCurrency(payment.amount)}${payment.external_reference ? ` · ${payment.external_reference}` : ""}`);
  }
  if ((bill.credit_notes || []).length) {
    y += 3;
    writeLine("Credit notes", { size: 11, bold: true });
    for (const credit of bill.credit_notes) {
      writeLine(`${credit.credit_note_number} · ${formatDate(credit.refund_date)} · −${formatCurrency(credit.amount)} · ${credit.reason || ""}`);
    }
  }
  y += 3;
  writeLine(`Payments received: ${formatCurrency(bill.payment_received_amount)}`, { bold: true });
  writeLine(`Credit notes/refunds: ${formatCurrency(bill.refunded_amount)}`, { bold: true });
  writeLine(`Outstanding balance: ${formatCurrency(bill.payment_balance_amount)}`, { bold: true });
  writeLine(`Net collected: ${formatCurrency(bill.net_paid_amount)}`, { bold: true });
  writeLine(`Status: ${bill.status || ""}`);
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
