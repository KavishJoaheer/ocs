import { jsPDF } from "jspdf";
import { formatCurrency, formatDate } from "./format.js";

export async function shareOrDownloadBillPdf(bill) {
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

  const blob = doc.output("blob");
  const file = new File([blob], `invoice-${bill.id}.pdf`, { type: "application/pdf" });

  if (navigator.share && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Invoice #${bill.id}` });
      return;
    } catch {
      /* user cancelled or share failed */
    }
  }

  doc.save(`invoice-${bill.id}.pdf`);
}
