# Admin operations safeguards — 9 September 2026

Payment recording checks all active bills for the visit within the same database transaction. Duplicate consultation charges, unreadable lines, and unresolved consultation fee reviews block payment, including additional-item bills. A blocked invoice creation rolls back stock deductions as well. The billing list routes blocked visits to review.

The quick payment action opens a desktop dialog or mobile sheet. The user selects a payment method, verifies the date, and confirms receipt of the full amount. The server requires explicit method/date and the current invoice version. Matching retries do not create another payment event.

On the first deployment, historical unpaid consultation charges that do not have an explicit current tariff marker are flagged for admin review. Amounts remain unchanged. An admin may retain an agreed historical rate or correct it after checking source records, with a documented reason. The migration is recorded once; subsequent starts do not reflag reviewed bills. Paid and voided bills are not repriced.

Supply requests have an overdue filter using Mauritius calendar dates and an oldest-first queue. Admins and operators can record a follow-up note, take responsibility, and see it in the audit timeline. This does not confirm collection or change stock. Closed requests cannot be reassigned or given an operational follow-up; stale updates are rejected. Packed quantities remain distinct from collected quantities.

Stock reports identify unclassified corrections and estimated historical valuations. Count increases do not count as consumption; reversing a decrease removes the corresponding consumption. Financial review also shows unpriced products, unverified expiry and unfinished stock counts. Recorded zero variance does not certify uncounted stock.

Mobile doctor revenue uses cards; desktop retains its comparison table. Mobile stock-history statistics use a compact two-column layout.

Alert settings distinguish a network failure from an unconfigured service. A device test targets only a subscription owned by the signed-in user, is rate-limited, and reports provider acceptance separately from observed device delivery. Browser/OS notification permissions still require action on the device.

## Operational verification still required

- Resolve historical duplicate bills using the original visit and payment evidence. The unpaid service-only void action retains the clinical visit and audit history. Paid or stock-linked discrepancies need documented financial/stock correction; do not assume the linked invoice total equals a refund.
- Verify old agreed fees, missing stock costs, expiry or confirmed non-expiring status, and historical movement purposes from source records.
- Finish physical stock counts and reconcile recorded payments against cash, Juice, card and IB statements. OCS remainder excludes operating expenses and is not net profit or a bank reconciliation.
- Verify overdue handovers with the doctor; collection confirmation remains a doctor action.
- Each relevant device should run its alert test and confirm the notification actually appears.

Validation: 243 isolated server tests; production build; lint with no errors and 12 existing warnings. Local Chromium checks covered payment confirmation, duplicate review, mobile revenue cards, stock history, inventory and audited supply follow-up, with no runtime errors or page overflow at the tested desktop/phone sizes. No live patient, billing, payment or stock records were edited during these checks.
