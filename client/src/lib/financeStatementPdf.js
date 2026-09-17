import { jsPDF } from "jspdf";
import { openInlinePreviewTab, presentFileBlob } from "./fileBlobViewer.js";
import { formatCurrency, formatDate } from "./format.js";

export async function presentFinanceStatementPdf(statement) {
  const doc = new jsPDF({ orientation: "landscape" });
  let y = 16;
  const nextPage = () => {
    if (y <= 190) return;
    doc.addPage();
    y = 16;
  };
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("OCS Medecins — Finance statement", 14, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${statement.date_basis === "transaction" ? "Transaction" : "Consultation"} period: ${formatDate(statement.date_from)} to ${formatDate(statement.date_to)} · Generated ${new Date(statement.generated_at).toLocaleString("en-GB")}`, 14, y);
  y += 8;
  const totals = statement.totals || {};
  doc.setFont("helvetica", "bold");
  doc.text(`Invoices ${formatCurrency(totals.invoice_total)}   Collected ${formatCurrency(totals.payment_received_amount)}   Credits ${formatCurrency(totals.credit_note_amount)}   Outstanding ${formatCurrency(totals.outstanding_amount)}   Supply cost ${formatCurrency(totals.supply_cost_amount)}`, 14, y);
  y += 10;
  for (const row of statement.rows || []) {
    nextPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`${row.invoice_number} · ${row.patient_name} (${row.patient_identifier}) · ${row.doctor_name}`, 14, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const details = `${formatDate(row.consultation_date)} · ${row.consultation_type} · Invoice ${formatCurrency(row.invoice_total)} · Received ${formatCurrency(row.payment_received_amount)} · Credit ${formatCurrency(row.credit_note_amount)} · Balance ${formatCurrency(row.outstanding_amount)} · Supply cost ${formatCurrency(row.supply_cost_amount)} (${row.cost_quality})`;
    doc.text(doc.splitTextToSize(details, 270), 14, y);
    y += 5;
    if (row.payment_details) {
      doc.text(doc.splitTextToSize(`Payments: ${row.payment_details}`, 270), 14, y);
      y += 5;
    }
    if (row.credit_details) {
      doc.text(doc.splitTextToSize(`Credits: ${row.credit_details}`, 270), 14, y);
      y += 5;
    }
    y += 2;
  }
  const filename = `ocs-finance-${statement.date_from}-to-${statement.date_to}.pdf`;
  return presentFileBlob({
    blob: doc.output("blob"),
    filename,
    mimeType: "application/pdf",
    previewTab: openInlinePreviewTab(),
  });
}
