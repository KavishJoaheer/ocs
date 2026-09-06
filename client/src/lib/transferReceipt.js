export function buildTransferReceiptPrintHtml(receipt) {
  const rows = (receipt?.items || [])
    .map(
      (line) => `
          <tr>
            <td>${line.item_name || ""}</td>
            <td>${line.batch_number || "N/A"} / ${line.expiry || "N/A"}</td>
            <td>${line.quantity || 0}</td>
            <td>${line.unit || "unit"}</td>
          </tr>
        `,
    )
    .join("");
  return `
      <html>
        <head>
          <title>Stock Transfer Note - ${receipt?.transaction_id || ""}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #111; padding: 20px; }
            .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; }
            .logo { font-weight:700; font-size:18px; }
            .meta { font-size:12px; margin: 12px 0; }
            table { width:100%; border-collapse:collapse; margin-top:12px; font-size:12px; }
            th, td { border:1px solid #111; padding:8px; text-align:left; }
            .footer { margin-top:24px; font-size:12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="logo">OCS Medecins</div>
              <div>Stock Transfer Note</div>
            </div>
            <div><strong>Transaction ID:</strong> ${receipt?.transaction_id || ""}</div>
          </div>
          <div class="meta">
            <div><strong>Date & Time:</strong> ${receipt?.date_time || ""}</div>
            <div><strong>Issued By:</strong> ${receipt?.issued_by_name || ""}</div>
            <div><strong>Received By:</strong> ${receipt?.received_by_name || ""}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Batch Number / Expiry</th>
                <th>Quantity Transferred</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="footer">
            <div>Digital Signature: ____________________</div>
            <div>Generated at: ${new Date().toLocaleString()}</div>
          </div>
        </body>
      </html>
    `;
}

export function printTransferReceipt(receipt) {
  if (!receipt) return false;
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) return false;
  printWindow.document.write(buildTransferReceiptPrintHtml(receipt));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}
