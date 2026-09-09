# Financial and stock integrity

The SQLite production API now keeps archived patients in financial history and excludes voided bills and consultations from active revenue, unpaid balances and transport counts. Voided bills remain accessible through Billing's Voided filter and their details; payment and edit endpoints reject them. Voided invoice PDFs are labelled as historical records.

## Posted bills and history

Unpaid invoices can be edited without rededucting stock, provided their inventory-linked lines remain unchanged. Removing, replacing or repricing those lines is rejected on the server. A stock reversal or separate adjustment is required instead. Normal editors send a bill version to detect stale edits.

Paid bills are read-only for doctors and accountants. Administrators can correct them with a reason of at least eight characters. Payment retries with unchanged date and method return the existing bill; attempts to overwrite those details through the pay endpoint are rejected. Dates are validated on the server.

An append-only billing event table records previous/new bill details, actor identity, reason and time. Existing bills receive an opening snapshot; earlier changes cannot be reconstructed. Automatic inventory sales and consultation voids also leave financial events. This records application changes, not bank settlement or proof of a refund.

## Retry and offline behavior

Invoice creation uses a client operation ID retained in session storage until success. The server stores a receipt atomically with the bill and stock changes. Reusing the ID with different details is rejected. Distinct IDs permit separate additional-item invoices for one consultation, but a transaction guard permits only one consultation fee across its active bills. Older clients without IDs receive a 60-second identical-request deduplication window; persistent retry protection requires the updated client.

Doctor mobile deductions receive an operation ID before the first network attempt. Offline replay preserves that ID, preventing duplicate deductions after a lost response. Identified deductions can retry once against a refreshed stock version; the server still verifies ownership, stock and lot eligibility. Failed operations remain visible in the pending panel. Legacy queued entries without an operation ID are not blindly rebased because it is impossible to prove whether an earlier attempt committed. They remain available for reconciliation.

IndexedDB queue writes are acknowledged only after commit. Concurrent flush calls share the same flush, and queued records remain scoped to the signed-in user.

## Stock values and reporting

Movement cost and selling price are frozen when recorded; allocation costs take precedence over catalogue cost. Reversal valuations preserve the original snapshots. Existing records use stored allocation costs when present and otherwise freeze available catalogue values as labelled legacy estimates. Exact missing historical prices cannot be recovered automatically. Re-running the migration does not reprice existing snapshots.

Doctor Wasted and Expired stock-out reasons contribute to loss analytics and the wastage filter. Sale stock-outs contribute to sale analytics. Doctor deductions retain batch allocations. Stock history subscribes to doctor-bag, warehouse and supply changes and refreshes on focus/reconnection. Calendar filters use Mauritius days; displayed times use Indian/Mauritius and CSV timestamps are explicitly UTC.

Revenue-to-billing links preserve date basis and effective doctor scope. Unpaid records continue to use visit date in payment-date mode. Transport is Rs 300 per non-void saved consultation, including repeat visits to one patient, rather than per unique patient or bill. Day/week/month views aggregate the same visits. Commission remains 40% of full paid amounts. Existing transport timing and OCS funding treatment are unchanged.

## Validation and limits

Regression tests cover invoice retries and rollback, stock-linked edits, void/archive effects, payment date validation and correction history, historical price stability, wastage, offline retries and durable queue acknowledgement, date-basis drilldown, timezone boundaries and monthly transport additivity. All mutation tests use isolated databases. Desktop and phone-width checks use synthetic accounts.

This change does not delete existing duplicate bills or reconstruct past missing stock/payment records. Such historical discrepancies require explicit reconciliation. The optional legacy Vercel/Postgres app is outside this SQLite production-path change.

## Consultation fees and dispensing reconciliation

Current tariff defaults are Day Rs 2,000, Night Rs 3,000 and Review Rs 2,000. A one-time migration updates the tariff settings without changing existing invoices or overwriting later administrator tariff changes. An automatic invoice created without an explicit consultation type remains marked for fee review and cannot be paid until its type and fee are confirmed. No night-time cutoff is assumed.

The bill creator loads the selected visit's existing invoices. If its consultation fee already exists, additional invoices contain only additional items. The server enforces the same rule for creation and edits inside a write transaction. Automatic fees record the initiating actor. Administrators can void an unpaid service-only duplicate invoice with a reason and current version, retaining the visit. Paid and stock-linked discrepancies require a separate reviewed correction.

Pending dispensing matches permanent visit or movement identities rather than a seven-day window. Without a visit identifier, automatic linking requires a single matching consultation for that patient, doctor and Mauritius dispensing day. Ambiguous cases require explicit selection; partial movement matching is rejected. Bills retain the dispensing's original selling price and movement references even after catalogue prices change. Voiding a clinical visit does not pretend that medicine already handed to a patient was physically returned: that field dispensing becomes pending reconciliation. Invoice-created dispensing follows its existing compensating stock reversal path.

## Net stock values and review queue

Stock sale, consumption and wastage summaries use movement snapshots and signed compensating reversals. Restocks and transfers do not count as consumption. Stock sales include billed and pending dispensing by movement date; they are not collected cash. History and CSV exports show the current invoice connection while retaining original activity metadata.

Billing and Revenue Report expose an all-date financial review queue for duplicate visit fees, unconfirmed automatic fees, pending dispensing and voided paid bills requiring cash/refund review. Legacy estimated valuations are explicitly identified. An empty queue means these checks found no exceptions; it is not certification of bank reconciliation, refunds, all operating expenses or physical stock counts. OCS retained revenue is after doctor commission and transport, not net operating profit.

Reconnecting the event stream refreshes financial, patient, stock and supply caches, including accountant inventory updates. Supply catalogue and doctor-bag availability also refresh on relevant events, focus and reopening the request form without discarding the request draft.
