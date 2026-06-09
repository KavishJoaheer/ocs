import dayjs from "dayjs";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildList(items) {
  if (!items?.length) {
    return "<p><em>No items recorded.</em></p>";
  }

  return `<ul>${items.map((item) => `<li>${escapeHtml(item.name || item)}</li>`).join("")}</ul>`;
}

/**
 * Open a print-friendly window so the patient can save their records as PDF
 * via the browser's native print dialog.
 */
export function exportHealthRecordsPdf({
  patientName,
  summary,
  clinical,
  consultations,
  timeline,
}) {
  const generatedAt = dayjs().format("D MMMM YYYY, h:mm A");
  const bullets = (summary?.bullets || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  const timelineHtml = (timeline || [])
    .slice(0, 20)
    .map((event) => {
      const date = dayjs(event.date).format("D MMM YYYY");
      const title = escapeHtml(event.title);
      const subtitle = escapeHtml(event.subtitle);
      const detail = event.detail ? `<p>${escapeHtml(event.detail)}</p>` : "";
      return `
        <article class="event">
          <p class="event-date">${date}</p>
          <h3>${title}</h3>
          <p class="event-sub">${subtitle}</p>
          ${detail}
        </article>
      `;
    })
    .join("");

  const consultationHtml = (consultations || [])
    .slice(0, 15)
    .map((visit) => {
      const reports = (visit.reports || [])
        .map((report) => `<li>${escapeHtml(report.name)}</li>`)
        .join("");
      return `
        <article class="event">
          <p class="event-date">${dayjs(visit.date).format("D MMM YYYY")}</p>
          <h3>${escapeHtml(visit.diagnosis)}</h3>
          <p class="event-sub">${escapeHtml(visit.doctor_name)}</p>
          ${visit.plain_summary ? `<p>${escapeHtml(visit.plain_summary)}</p>` : ""}
          ${reports ? `<ul>${reports}</ul>` : ""}
        </article>
      `;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OCS Health Records — ${escapeHtml(patientName || "Patient")}</title>
    <style>
      body { font-family: Georgia, "Times New Roman", serif; color: #1a3d45; margin: 32px; line-height: 1.5; }
      h1 { font-size: 24px; margin: 0 0 4px; }
      h2 { font-size: 16px; margin: 28px 0 10px; color: #2d8f98; text-transform: uppercase; letter-spacing: 0.08em; }
      h3 { font-size: 15px; margin: 0 0 4px; }
      p { margin: 0 0 8px; font-size: 13px; }
      ul { margin: 0 0 12px 18px; padding: 0; font-size: 13px; }
      .meta { color: #5b7f8a; font-size: 12px; margin-bottom: 24px; }
      .summary-box { border: 1px solid #c9e8e6; background: #f4fbfb; padding: 16px 18px; border-radius: 8px; }
      .event { border-left: 3px solid #2d8f98; padding-left: 12px; margin-bottom: 16px; }
      .event-date { color: #6e949b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
      .event-sub { color: #5b7f8a; font-size: 12px; }
      @media print { body { margin: 18px; } }
    </style>
  </head>
  <body>
    <h1>Health Records Summary</h1>
    <p class="meta">${escapeHtml(patientName || "Patient")} · Generated ${generatedAt}</p>

    <div class="summary-box">
      <h2 style="margin-top:0">Overview</h2>
      <p><strong>${escapeHtml(summary?.headline || "Your health records")}</strong></p>
      ${bullets ? `<ul>${bullets}</ul>` : ""}
    </div>

    <h2>Clinical History</h2>
    <p><strong>Medical history</strong></p>
    ${buildList(clinical?.medical_history)}
    <p><strong>Allergies</strong></p>
    ${buildList(clinical?.allergy_history)}
    <p><strong>Current medications</strong></p>
    ${buildList(clinical?.drug_history)}

    <h2>Care Timeline</h2>
    ${timelineHtml || consultationHtml || "<p><em>No visits recorded yet.</em></p>"}

    <p class="meta">Read-only export from OCS Médecins patient portal. For clinical questions, contact your care team.</p>
  </body>
</html>`;

  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!printWindow) {
    throw new Error("Pop-up blocked. Allow pop-ups to download your health summary.");
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();

  window.setTimeout(() => {
    printWindow.print();
  }, 350);
}
