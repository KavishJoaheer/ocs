# Financial and stock integrity

The SQLite production API now keeps archived patients in financial history and excludes voided bills and consultations from active revenue, unpaid balances and transport counts. Voided bills remain accessible through Billing's Voided filter and their details; payment and edit endpoints reject them. Voided invoice PDFs are labelled as historical records.

## Posted bills and history

Unpaid invoices can be edited without rededucting stock, provided their inventory-linked lines remain unchanged. Removing, replacing or repricing those lines is rejected on the server. A stock reversal or separate adjustment is required instead. Normal editors send a bill version to detect stale edits.

Paid bills are read-only for doctors and accountants. Administrators can correct them with a reason of at least eight characters. Payment retries with unchanged date and method return the existing bill; attempts to overwrite those details through the pay endpoint are rejected. Dates are validated on the server.

An append-only billing event table records previous/new bill details, actor identity, reason and time. Existing bills receive an opening snapshot; earlier changes cannot be reconstructed. Automatic inventory sales and consultation voids also leave financial events. This records application changes, not bank settlement or proof of a refund.

## Retry and offline behavior

Invoice creation uses a client operation ID retained in session storage until success. The server stores a receipt atomically with the bill and stock changes. Reusing the ID with different details is rejected. Distinct IDs permit legitimate separate invoices for one consultation. Older clients without IDs receive a 60-second identical-request deduplication window; persistent retry protection requires the updated client.

Doctor mobile deductions receive an operation ID before the first network attempt. Offline replay preserves that ID, preventing duplicate deductions after a lost response. Identified deductions can retry once against a refreshed stock version; the server still verifies ownership, stock and lot eligibility. Failed operations remain visible in the pending panel. Legacy queued entries without an operation ID are not blindly rebased because it is impossible to prove whether an earlier attempt committed. They remain available for reconciliation.

IndexedDB queue writes are acknowledged only after commit. Concurrent flush calls share the same flush, and queued records remain scoped to the signed-in user.

## Stock values and reporting

Movement cost and selling price are frozen when recorded; allocation costs take precedence over catalogue cost. Reversal valuations preserve the original snapshots. Existing records use stored allocation costs when present and otherwise freeze available catalogue values as labelled legacy estimates. Exact missing historical prices cannot be recovered automatically. Re-running the migration does not reprice existing snapshots.

Doctor Wasted and Expired stock-out reasons contribute to loss analytics and the wastage filter. Sale stock-outs contribute to sale analytics. Doctor deductions retain batch allocations. Stock history subscribes to doctor-bag, warehouse and supply changes and refreshes on focus/reconnection. Calendar filters use Mauritius days; displayed times use Indian/Mauritius and CSV timestamps are explicitly UTC.

Revenue-to-billing links preserve date basis and effective doctor scope. Unpaid records continue to use visit date in payment-date mode. Transport is Rs 300 per non-void saved consultation, including repeat visits to one patient, rather than per unique patient or bill. Day/week/month views aggregate the same visits. Commission remains 40% of full paid amounts. Existing transport timing and OCS funding treatment are unchanged.

## Validation and limits

Regression tests cover invoice retries and rollback, stock-linked edits, void/archive effects, payment date validation and correction history, historical price stability, wastage, offline retries and durable queue acknowledgement, date-basis drilldown, timezone boundaries and monthly transport additivity. All mutation tests use isolated databases. Desktop and phone-width checks use synthetic accounts.

This change does not delete existing duplicate bills or reconstruct past missing stock/payment records. Such historical discrepancies require explicit reconciliation. The optional legacy Vercel/Postgres app is outside this SQLite production-path change.
