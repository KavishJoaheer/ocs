import test from "node:test";
import assert from "node:assert/strict";

import { buildTransferReceiptPrintHtml, escapePrintHtml } from "./transferReceipt.js";

test("escapePrintHtml encodes executable HTML characters", () => {
  assert.equal(
    escapePrintHtml(`<img src=x onerror="steal()">'&`),
    "&lt;img src=x onerror=&quot;steal()&quot;&gt;&#39;&amp;",
  );
});

test("transfer receipt treats stored values as text", () => {
  const malicious = `<img src=x onerror="steal()">`;
  const html = buildTransferReceiptPrintHtml({
    transaction_id: malicious,
    issued_by_name: malicious,
    received_by_name: malicious,
    items: [{ item_name: malicious, batch_number: malicious, unit: malicious }],
  });

  assert.equal(html.includes(malicious), false);
  assert.equal(html.includes("&lt;img src=x onerror=&quot;steal()&quot;&gt;"), true);
});
