import { jsPDF } from "jspdf";
import { openInlinePreviewTab, presentFileBlob } from "./fileBlobViewer.js";
import { formatCurrency, formatDate } from "./format.js";

function buildBillPdf(bill) {
  const doc = new jsPDF();
  let y = 20;
  const writeLine = (text, { gap = 7, size = 10, bold = false } = {}) => {
    if (y > 276) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(String(text || "").slice(0, 110), 14, y);
    y += gap;
  };
  const invoiceNumber = bill.invoice_number || `OCS-INV-${String(bill.id || 0).padStart(8, "0")}`;

  doc.setFontSize(16);
  doc.text("OCS Medecins — Invoice", 14, y);
  y += 10;
  writeLine(`Invoice: ${invoiceNumber}`, { size: 11, bold: true });
  writeLine(`Patient: ${bill.patient_name || bill.patient_name_snapshot || ""} (${bill.patient_identifier || bill.patient_identifier_snapshot || "No OCS number"})`);
  writeLine(`Doctor: ${bill.doctor_name || bill.doctor_name_snapshot || ""}`);
  writeLine(`Consultation: ${formatDate(bill.consultation_date || bill.consultation_date_snapshot)} · ${bill.consultation_type_snapshot || "Consultation"}`);
  writeLine(`Category: ${bill.partner_category_snapshot || "Self-pay"}`);
  writeLine(`Issued: ${formatDate(bill.issued_at || bill.created_at)} by ${bill.issued_by_name || "System"} (${bill.issued_by_role || "system"})`);
  if (bill.source_reference) writeLine(`Source reference: ${bill.source_reference}`);
  const paymentState = bill.payment_state || bill.status || "unpaid";
  writeLine(`Status: ${bill.voided_at || bill.consultation_voided_at ? "VOIDED - historical record only" : paymentState}`);
  y += 3;
  writeLine("Items", { size: 11, bold: true });
  (bill.items || []).forEach((item) => {
    const quantity = Math.max(1, Number(item.quantity || 1));
    const unitPrice = Number.isFinite(Number(item.unit_price))
      ? Number(item.unit_price)
      : Number(item.amount || 0) / quantity;
    const lineAmount = Number(item.amount || 0);
    const arithmeticMatches = Math.abs(quantity * unitPrice - lineAmount) < 0.005;
    const priceText = arithmeticMatches
      ? `${quantity} × ${formatCurrency(unitPrice)} = ${formatCurrency(lineAmount)}`
      : `${quantity} unit${quantity === 1 ? "" : "s"} · blended total ${formatCurrency(lineAmount)}`;
    writeLine(`${item.description || ""} · ${priceText} (${item.type || "Sale"})`, { gap: 6 });
  });
  y += 3;
  writeLine(`Total: ${formatCurrency(bill.total_amount)}`, { size: 12, bold: true });
  const paymentEntries = Array.isArray(bill.payments) ? bill.payments : [];
  if (paymentEntries.length) {
    y += 3;
    writeLine("Payment ledger", { size: 11, bold: true });
    paymentEntries.forEach((payment) => {
      const kind = payment.entry_type === "reversal" ? "Reversal" : "Payment";
      const reference = payment.external_reference ? ` · Ref ${payment.external_reference}` : "";
      const reason = payment.reason ? ` · ${payment.reason}` : "";
      writeLine(`${kind}: ${formatCurrency(payment.amount)} · ${payment.payment_method || ""} · ${formatDate(payment.payment_date)}${reference}${reason}`, { gap: 6 });
    });
    writeLine(`Received: ${formatCurrency(bill.payment_received_amount || 0)} · Balance: ${formatCurrency(bill.payment_balance_amount || 0)}`, { bold: true });
  }
  if (Array.isArray(bill.refunds) && bill.refunds.length) {
    y += 2;
    writeLine("Credit notes", { size: 11, bold: true });
    bill.refunds.forEach((refund) => {
      writeLine(`${refund.credit_note_number || "Credit note"}: -${formatCurrency(refund.amount)} · ${refund.refund_method || ""} · ${formatDate(refund.refund_date)}`, { gap: 6 });
    });
  }
  if (bill.void_reason) writeLine(`Void reason: ${bill.void_reason}`);
  return doc;
}

/**
 * Share the invoice PDF when the device supports it, otherwise preview it in a
 * new tab. Browsers without an inline PDF viewer save the file instead, since a
 * `blob:` navigation silently fails there. Returns "share", "preview" or "download".
 */
export async function shareOrDownloadBillPdf(bill) {
  const doc = buildBillPdf(bill);
  const blob = doc.output("blob");
  const invoiceNumber = bill.invoice_number || `OCS-INV-${String(bill.id || 0).padStart(8, "0")}`;
  const filename = `${invoiceNumber.replace(/[^a-z0-9_-]+/gi, "-")}.pdf`;
  const file = new File([blob], filename, { type: "application/pdf" });

  const canShare =
    typeof navigator !== "undefined" &&
    navigator.share &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canShare) {
    try {
      await navigator.share({ files: [file], title: `Invoice ${invoiceNumber}` });
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

export async function shareOrDownloadCreditNotePdf(creditNote, bill) {
  const doc = new jsPDF();
  const creditNumber = creditNote.credit_note_number || `OCS-CN-${String(creditNote.id || 0).padStart(8, "0")}`;
  const invoiceNumber = bill.invoice_number || `OCS-INV-${String(bill.id || 0).padStart(8, "0")}`;
  const inventoryTreatment = creditNote.disposition === "returned_to_stock"
    ? "Inventory treatment: the linked sale movement was reversed and the confirmed stock was restored."
    : creditNote.disposition === "consumed_or_wasted"
      ? "Inventory treatment: stock was not restored; the linked sale was reclassified as consumed/wasted."
      : "Inventory treatment: financial credit only; no inventory movement is linked to this credit note.";
  const rows = [
    ["OCS Medecins — Credit Note", 16, true],
    [`Credit note: ${creditNumber}`, 11, true],
    [`Original invoice: ${invoiceNumber}`, 10, false],
    [`Patient: ${bill.patient_name || bill.patient_name_snapshot || ""} (${bill.patient_identifier || bill.patient_identifier_snapshot || "No OCS number"})`, 10, false],
    [`Refund date: ${formatDate(creditNote.refund_date)}`, 10, false],
    [`Refund method: ${creditNote.refund_method || ""}`, 10, false],
    [`Amount credited: ${formatCurrency(creditNote.amount)}`, 12, true],
    [`Reason: ${creditNote.reason || ""}`, 10, false],
    ...(creditNote.external_reference ? [[`External reference: ${creditNote.external_reference}`, 10, false]] : []),
    [`Issued by: ${creditNote.issued_by_name || "System"} (${creditNote.issued_by_role || "system"})`, 10, false],
    [inventoryTreatment, 9, false],
  ];
  let y = 20;
  for (const [line, size, bold] of rows) {
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const wrapped = doc.splitTextToSize(String(line || ""), 180);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 6 + 2;
  }
  const blob = doc.output("blob");
  const filename = `${creditNumber.replace(/[^a-z0-9_-]+/gi, "-")}.pdf`;
  const file = new File([blob], filename, { type: "application/pdf" });
  const canShare = typeof navigator !== "undefined" && navigator.share && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  if (canShare) {
    try {
      await navigator.share({ files: [file], title: `Credit note ${creditNumber}` });
      return "share";
    } catch {
      // Fall through to preview/download if sharing is dismissed or unavailable.
    }
  }
  return presentFileBlob({ blob, filename, mimeType: "application/pdf", previewTab: openInlinePreviewTab() });
}
