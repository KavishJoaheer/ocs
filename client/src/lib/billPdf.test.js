import test from "node:test";
import assert from "node:assert/strict";
import { buildBillPdf } from "./billPdf.js";

test("invoice PDF shows gross, payments, credits, balance and net collection separately", () => {
  const output = buildBillPdf({
    id: 42,
    invoice_number: "OCS-INV-00000042",
    patient_name: "PDF Test Patient",
    patient_identifier: "OCS-PDF-42",
    doctor_name: "Dr PDF",
    consultation_date: "2026-09-17",
    consultation_type_snapshot: "Day Consultation",
    issued_at: "2026-09-17",
    issued_by_name: "Finance Test",
    issued_by_role: "accountant",
    status: "paid",
    items: [{ description: "Day Consultation", type: "Sale", quantity: 1, amount: 2000 }],
    total_amount: 2000,
    payments: [{ entry_type: "payment", amount: 2000, payment_method: "cash", payment_date: "2026-09-17" }],
    refunds: [{ credit_note_number: "OCS-CN-00000001", amount: 250, refund_method: "cash", refund_date: "2026-09-17" }],
    payment_received_amount: 2000,
    payment_balance_amount: 0,
    refunded_amount: 250,
    net_paid_amount: 1750,
  }).output();

  for (const label of ["Total", "Payments received", "Credit notes/refunds", "Outstanding balance", "Net collected"]) {
    assert.match(output, new RegExp(label));
  }
});
