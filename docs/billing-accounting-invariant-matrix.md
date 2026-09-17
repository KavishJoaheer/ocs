# Billing accounting-invariant matrix

This matrix is the permanent release gate for OCS VP billing. It covers the complete financial lifecycle from invoice issue through reporting and the related physical-stock effects.

## Release gate

Billing changes are acceptable only when all of the following are true:

1. `server/tests/financialIntegrity.test.js` passes in full.
2. The accounting lifecycle matrix below passes without a reconciliation exception for any affected bill or movement.
3. The complete server and client test suites pass.
4. Billing production changes introduce no new P1 or P2 Bugbot finding.

Until those conditions remain green, billing work is restricted to defect fixes, tests, reconciliation, accessibility, and simplification that does not add a new financial path.

## Invariant matrix

| Stage | Required invariant | Permanent coverage |
| --- | --- | --- |
| Billing | One active financial issue per visit; immutable snapshots; chargeable Sale-line sum equals invoice total; non-chargeable wastage/adjustment amounts remain excluded; supplies link to real movements; retries have one effect. | Invoice retry, duplicate-fee, finalisation, price, inventory-link, non-chargeable-wastage and lifecycle-matrix tests. |
| Payment | Only a finalised active invoice accepts receipts; receipt operations are idempotent and immutable; received plus balance equals invoice total. | Payment validation, split-payment, finalisation and lifecycle-matrix tests. |
| Refund | Credit notes are immutable, idempotent and balance-limited; they reduce net collections without silently changing physical stock. | Credit-note, payment-date reporting and lifecycle-matrix tests. |
| Payment reversal | A reversal is a compensating ledger entry, never an edit; it reopens the exact balance and can be followed by a replacement receipt. | Payment-correction and lifecycle-matrix tests. |
| Supply correction | Only the active completed submission can be corrected once; returned stock restores the original batch; consumed stock becomes wastage; both remove sale and COGS once. | Paid-correction, superseded-submission, pre-dispensed-batch and lifecycle-matrix tests. |
| Reporting | Visit-basis and payment-basis totals remain finite and reconcilable; transport posts once, on final settlement; corrections do not become orphan movements. | Frozen-rate, cross-period transport, reconciliation and lifecycle-matrix tests. |

## Accounting equations

- `invoice total = sum(active chargeable Sale lines)`; Wastage and Adjustment line amounts are excluded
- `payment received = payments - payment reversals`
- `payment received + invoice balance = invoice total`
- `net collections = payment receipts - payment reversals - credit notes`
- `stock sale quantity/value = active billed movements - compensating reversals`
- returned correction: `net sale = 0`, `net COGS = 0`, original batch quantity restored
- consumed correction: `net sale = 0`, `net COGS = 0`, wastage cost retained, stock not restored
- a visit's transport benefit appears once on payment basis, on the final-settlement date

## Local verification

Run from the repository root:

```sh
node --test server/tests/financialIntegrity.test.js
npm test --prefix server
npm test --prefix client -- --run
npm run build --prefix client
```

After these pass, run one Bugbot review against the complete uncommitted diff. Treat new P1/P2 billing-integrity findings as a failed release gate.
