import { jsPDF } from "jspdf";
import { openInlinePreviewTab, presentFileBlob } from "./fileBlobViewer.js";
import { formatDate, formatRupees } from "./format.js";

function downloadPdf(doc, filename) {
  const blob = doc.output("blob");
  return presentFileBlob({
    blob,
    filename,
    mimeType: "application/pdf",
    previewTab: openInlinePreviewTab(),
  });
}

function claimStatusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "settled") return "Paid to OCS";
  if (normalized === "pending") return "Pending clearance";
  return status || "Not recorded";
}

export async function downloadLinkhamStatementPdf(claims = [], { month = "", status = "all" } = {}) {
  const doc = new jsPDF();
  let y = 18;
  doc.setFontSize(14);
  doc.text("OCS Medecins — Linkham 80% statement", 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(
    `Period: ${month || "All months"}  ·  Filter: ${status || "all"}  ·  ${claims.length} claim(s)`,
    14,
    y,
  );
  y += 10;

  claims.forEach((claim, index) => {
    if (y > 270) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(11);
    doc.text(`${index + 1}. ${claim.patient_name || "Patient"}`, 14, y);
    y += 6;
    doc.setFontSize(9);
    doc.text(
      `${formatDate(claim.visit_date)}  ·  ${claim.patient_identifier || "No OCS no."}  ·  Policy ${claim.policy_number || "missing"}`,
      14,
      y,
    );
    y += 5;
    doc.text(
      `Copay ${formatRupees(claim.patient_copay_amount)}  ·  Linkham ${formatRupees(claim.linkham_share_amount)}  ·  ${claimStatusLabel(claim.linkham_claim_status)}`,
      14,
      y,
    );
    y += 8;
  });

  const monthLabel = String(month || "all").replace(/[^\d-]/g, "") || "all";
  return downloadPdf(doc, `linkham-80pct-statement-${monthLabel}.pdf`);
}

export async function downloadLinkhamClaimSummaryPdf(summary) {
  const doc = new jsPDF();
  let y = 20;
  doc.setFontSize(14);
  doc.text("Linkham coverage verification summary", 14, y);
  y += 10;
  doc.setFontSize(11);
  const lines = [
    `Patient: ${summary.patient_name || ""}`,
    `OCS number: ${summary.visit_id || summary.patient_identifier || ""}`,
    `Policy: ${summary.policy_number || "Not recorded"}`,
    `Visit date: ${formatDate(summary.visit_date)}`,
    `Doctor: ${summary.doctor_name || ""}`,
    `Total: ${formatRupees(summary.total_amount)}`,
    `Patient copay 20%: ${formatRupees(summary.patient_copay_amount)}`,
    `Linkham share 80%: ${formatRupees(summary.linkham_share_amount)}`,
    `Status: ${claimStatusLabel(summary.claim_status)}`,
    `Dispute: ${summary.dispute_status === "Flagged_Review" ? "Flagged" : "Clean"}`,
  ];
  if (summary.dispute_reason) {
    lines.push(`Reason: ${summary.dispute_reason}`);
  }
  if (summary.reviewed_by_name) {
    lines.push(`Approved by: ${summary.reviewed_by_name}`);
  }
  if (summary.settled_by_name) {
    lines.push(`Marked paid to OCS by: ${summary.settled_by_name}`);
  }

  lines.forEach((line) => {
    doc.text(String(line).slice(0, 95), 14, y);
    y += 7;
  });

  const filename = `linkham-claim-${summary.visit_id || "summary"}.pdf`;
  return downloadPdf(doc, filename);
}
