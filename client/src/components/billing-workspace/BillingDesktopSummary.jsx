import { ChevronRight, ReceiptText } from "lucide-react";
import dayjs from "dayjs";
import { useIsMobile } from "../../hooks/useIsMobile.js";

function money(value) {
  return `Rs ${Number(value || 0).toLocaleString("en-MU", { maximumFractionDigits: 2 })}`;
}

export function BillingProgress({ step }) {
  return (
    <nav className="billing-progress" aria-label="Billing progress">
      {["Visit", "Charges", "Consumables", "Review"].map((label, index) => (
        <span key={label} className={`billing-step ${index === step ? "is-current" : index < step ? "is-complete" : ""}`} aria-current={index === step ? "step" : undefined}>
          <span>{index + 1}</span>{label}
        </span>
      ))}
    </nav>
  );
}

export function BillingVisitIdentity({ visit }) {
  return (
    <div className="billing-visit-identity">
      <strong>{visit.patient_name || visit.patient_masked_name}</strong>
      <span className="billing-care-pill">{visit.patient_identifier}</span>
      <span>{visit.doctor_name}</span>
      <span>{dayjs(visit.visit_date).isValid() ? dayjs(visit.visit_date).format("D MMM YYYY") : "Date unavailable"} · {visit.visit_number}</span>
    </div>
  );
}

export default function BillingDesktopSummary({
  visit, consultationType, consultationTotal, selectedItems, reviewedSupplyPrice,
  grandTotal, onAction, actionLabel, disabled = false, paymentNotice, finalReview = false,
}) {
  const isMobile = useIsMobile();
  const charges = selectedItems.filter((item) => !item.cost_only);
  const consumableUnits = selectedItems.filter((item) => item.cost_only).reduce((total, item) => total + item.quantity, 0);
  const pricesPending = charges.some((item) => reviewedSupplyPrice(item) <= 0);
  if (isMobile) return null;
  return (
    <aside className="billing-desktop-summary" aria-label="Invoice summary">
      <div className="billing-summary-title"><ReceiptText size={19} aria-hidden="true" /><h2>Invoice summary</h2></div>
      <p className="billing-summary-patient">{visit.patient_name || visit.patient_masked_name}</p>
      <p className="billing-summary-reference">{visit.patient_identifier} · {visit.visit_number}</p>
      <div className="billing-summary-total" aria-live="polite">
        <span>{pricesPending ? "Subtotal" : "Invoice total"}</span><strong>{money(grandTotal)}</strong>
      </div>
      {pricesPending ? <p className="billing-summary-notice">Set the remaining service prices at review to complete the total.</p> : null}
      {paymentNotice ? <p className="billing-summary-notice">{paymentNotice}</p> : null}
      <button type="button" onClick={onAction} disabled={disabled} className="billing-summary-action">
        {actionLabel}<ChevronRight size={18} aria-hidden="true" />
      </button>
      {!finalReview ? <p className="billing-summary-footnote">Confirm prices and payment at review.</p> : null}
      <div className="billing-summary-lines">
        <div><span>{consultationType}</span><strong>{money(consultationTotal)}</strong></div>
        {selectedItems.map((item) => (
          <div key={item.id}><span>{item.item_name} <small>×{item.quantity}</small></span><strong>{item.cost_only ? "Not charged" : reviewedSupplyPrice(item) > 0 ? money(reviewedSupplyPrice(item) * item.quantity) : "Set price"}</strong></div>
        ))}
      </div>
      {consumableUnits ? <p className="billing-summary-consumables">{consumableUnits} consumable unit{consumableUnits === 1 ? "" : "s"} · internal cost only</p> : null}
    </aside>
  );
}
