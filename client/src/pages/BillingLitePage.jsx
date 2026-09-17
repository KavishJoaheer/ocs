import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  CreditCard,
  ChevronDown,
  ChevronRight,
  Home,
  LoaderCircle,
  Minus,
  PackageOpen,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShoppingBasket,
  Star,
  UserRound,
} from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import Modal from "../components/Modal.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { listOfflineMutations, removeOfflineMutation } from "../lib/offlineQueue.js";
import { isBrowserOffline, isNetworkFailure } from "../lib/networkErrors.js";
import {
  flushOfflineQueue,
  OFFLINE_QUEUE_CHANGED,
  OFFLINE_QUEUE_ITEM_SYNCED,
  OFFLINE_SAVED_TOAST,
  queueQuickBillingMutation,
} from "../lib/inventoryOfflineSync.js";

const STATUS_META = {
  ready: { label: "Ready to bill", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  awaiting_operator: { label: "Awaiting operator", className: "bg-cyan-50 text-cyan-800 ring-cyan-200" },
  needs_doctor: { label: "Needs clarification", className: "bg-rose-50 text-rose-800 ring-rose-200" },
  ready_for_payment: { label: "Ready for payment", className: "bg-violet-50 text-violet-800 ring-violet-200" },
  partial: { label: "Part paid", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  queued_offline: { label: "Saved offline", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  needs_attention: { label: "Sync needs attention", className: "bg-rose-50 text-rose-800 ring-rose-200" },
  reversed: { label: "Reversed", className: "bg-slate-100 text-slate-700 ring-slate-300" },
  superseded: { label: "Corrected", className: "bg-slate-100 text-slate-700 ring-slate-300" },
  corrected: { label: "Paid correction", className: "bg-slate-100 text-slate-700 ring-slate-300" },
  completed: { label: "Completed", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
};

const MAX_CONSULTATION_FEE = 4500;
const SUBMISSION_PAGE_SIZE = 20;

function formatRupees(value) {
  return `Rs ${Number(value || 0).toLocaleString("en-MU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatVisitDate(date) {
  if (!date) return "Date unavailable";
  const parsed = dayjs(date);
  return parsed.isValid() ? parsed.format("ddd, D MMM") : date;
}

function formatVisitTime(time) {
  if (!time) return "Time unavailable";
  const parsed = dayjs(`2000-01-01T${time}`);
  return parsed.isValid() ? parsed.format("HH:mm") : time;
}

function formatSubmittedAt(value) {
  if (!value) return "";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("D MMM, HH:mm") : value;
}

function StatusBadge({ status, compact = false }) {
  const meta = STATUS_META[status] || STATUS_META.ready;
  return (
    <span className={`inline-flex items-center rounded-full font-bold ring-1 ring-inset ${compact ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"} ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function VisitCard({ visit, onSelect }) {
  const canOpen = Boolean(visit.can_submit);
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_28px_rgba(23,77,80,0.07)]">
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => canOpen && onSelect(visit)}
        className="flex min-h-24 w-full items-stretch text-left disabled:cursor-default"
      >
        <span className="flex w-16 shrink-0 flex-col items-center justify-center bg-[#e8f8f6] text-[#15666a]">
          <span className="text-xs font-extrabold uppercase tracking-wide">{formatVisitDate(visit.visit_date).split(",")[0]}</span>
          <span className="mt-0.5 text-lg font-black tabular-nums">{formatVisitTime(visit.visit_time)}</span>
        </span>
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0">
            <span className="block truncate text-base font-black text-[#173f47]">{visit.patient_name || visit.patient_masked_name}</span>
            <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">
              {visit.patient_identifier} · {visit.visit_number}
            </span>
            <span className="mt-2 inline-flex"><StatusBadge status={visit.submission_status} compact /></span>
          </span>
          {canOpen ? (
            <ChevronRight className="size-5 shrink-0 text-[#248f91]" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />
          )}
        </span>
      </button>
    </article>
  );
}

function EmptyState({ icon: Icon = CalendarDays, title, description, action }) {
  return (
    <div className="rounded-[2rem] border border-dashed border-[#9ccfcb] bg-white/75 px-6 py-12 text-center">
      <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-[#e7f8f5] text-[#217a7d]">
        <Icon className="size-8" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-xl font-black text-[#173f47]">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-base leading-7 text-slate-600">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

function OperatorPaymentModal({ bill, busy, onClose, onConfirm, onReverse }) {
  const balance = Math.max(0, Number(bill?.payment_balance_amount ?? bill?.total_amount ?? 0));
  const [amount, setAmount] = useState(balance ? balance.toFixed(2) : "");
  const [method, setMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const [reversalPayment, setReversalPayment] = useState(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversalDate, setReversalDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [reversalReference, setReversalReference] = useState("");
  const reversedPaymentIds = new Set((bill.payments || []).filter((entry) => entry.entry_type === "reversal").map((entry) => Number(entry.payment_transaction_id)));
  const amountNumber = Number(amount || 0);
  const valid = amountNumber > 0 && amountNumber <= balance && method && paymentDate &&
    (method === "cash" || reference.trim().length >= 3) && confirmed;
  return (
    <Modal open onClose={onClose} title={`Record payment · ${bill.invoice_number || `Bill #${bill.id}`}`} size="md">
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (!busy && valid) onConfirm({
          amount: amountNumber, payment_method: method, payment_date: paymentDate,
          external_reference: reference.trim() || null, operation_id: operationId,
          expected_version: bill.row_version,
        });
      }}>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="font-black text-slate-950">{bill.patient_name}</p>
          <p className="mt-1 text-sm font-semibold text-slate-500">{bill.doctor_name} · {formatVisitDate(bill.consultation_date)}</p>
          <p className="mt-3 text-xs font-black uppercase tracking-wide text-slate-500">Outstanding</p>
          <p className="mt-1 text-2xl font-black">{formatRupees(balance)}</p>
        </div>
        {(bill.payments || []).some((payment) => payment.entry_type === "payment" && !reversedPaymentIds.has(Number(payment.payment_transaction_id))) ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-black text-amber-950">Recorded receipts</p>
            <p className="mt-1 text-xs font-semibold text-amber-800">Reverse an incorrect receipt before correcting supplies on a partially paid invoice.</p>
            <div className="mt-3 space-y-2">
              {(bill.payments || []).filter((payment) => payment.entry_type === "payment" && !reversedPaymentIds.has(Number(payment.payment_transaction_id))).map((payment) => (
                <button key={payment.id} type="button" onClick={() => { setReversalPayment(payment); setReversalReason(""); setReversalReference(""); }} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-amber-200 bg-white px-3 text-left text-sm font-bold text-amber-950">
                  <span>{formatVisitDate(payment.payment_date)} · {payment.payment_method}</span><span>{formatRupees(payment.amount)} · Reverse</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {reversalPayment ? (
          <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="font-black text-rose-950">Reverse {formatRupees(reversalPayment.amount)} receipt</p>
            <label className="block text-sm font-bold">Reason
              <textarea minLength={8} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} className="mt-2 min-h-20 w-full rounded-xl border border-rose-200 bg-white p-3" />
            </label>
            <label className="block text-sm font-bold">Reversal date
              <input type="date" max={dayjs().format("YYYY-MM-DD")} value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-rose-200 bg-white px-3" />
            </label>
            {reversalPayment.payment_method !== "cash" ? <label className="block text-sm font-bold">Provider reversal reference
              <input minLength={3} value={reversalReference} onChange={(event) => setReversalReference(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-rose-200 bg-white px-3" />
            </label> : null}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setReversalPayment(null)} className="min-h-10 rounded-xl border border-rose-200 bg-white px-3 font-bold">Cancel</button><button type="button" disabled={busy || reversalReason.trim().length < 8 || (reversalPayment.payment_method !== "cash" && reversalReference.trim().length < 3)} onClick={() => onReverse(reversalPayment, { reversal_date: reversalDate, reason: reversalReason.trim(), external_reference: reversalReference.trim() || null, operation_id: crypto.randomUUID() })} className="min-h-10 rounded-xl bg-rose-700 px-3 font-black text-white disabled:opacity-50">Confirm reversal</button></div>
          </div>
        ) : null}
        <label className="block text-sm font-bold">Amount received
          <input required type="number" min="0.01" max={balance} step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4" />
        </label>
        <label className="block text-sm font-bold">Payment method
          <select required value={method} onChange={(event) => { setMethod(event.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4">
            <option value="">Select method</option><option value="cash">Cash</option><option value="juice">Juice</option><option value="card">Card</option><option value="ib">IB / bank</option>
          </select>
        </label>
        <label className="block text-sm font-bold">Payment date
          <input required type="date" max={dayjs().format("YYYY-MM-DD")} value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4" />
        </label>
        <label className="block text-sm font-bold">Provider reference {method === "cash" ? <span className="font-normal text-slate-500">(optional)</span> : <span className="text-rose-600">*</span>}
          <input required={method !== "cash"} minLength={method === "cash" ? undefined : 3} value={reference} onChange={(event) => { setReference(event.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4" />
        </label>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm this payment was received and should be added to the immutable ledger.</span></label>
        <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border px-4 font-bold">Cancel</button><button disabled={busy || !valid} className="min-h-11 rounded-xl bg-[#17666a] px-4 font-black text-white disabled:opacity-50">{busy ? "Recording…" : "Record payment"}</button></div>
      </form>
    </Modal>
  );
}

function BillingLitePage() {
  const { user } = useAuth();
  const operatorIssueOnly = user?.role === "operator";
  const [view, setView] = useState("today");
  const [submissions, setSubmissions] = useState([]);
  const [submissionTotal, setSubmissionTotal] = useState(0);
  const [submissionSearch, setSubmissionSearch] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState("");
  const [submissionPage, setSubmissionPage] = useState(0);
  const [submissionRefreshToken, setSubmissionRefreshToken] = useState(0);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [cart, setCart] = useState({});
  const [category, setCategory] = useState("All supplies");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [lookup, setLookup] = useState("");
  const [lookupResults, setLookupResults] = useState([]);
  const [patientOptions, setPatientOptions] = useState([]);
  const [doctorOptions, setDoctorOptions] = useState([]);
  const [billingDoctorId, setBillingDoctorId] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const patientPickerRef = useRef(null);
  const [visitSearch, setVisitSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedPickerVisitId, setSelectedPickerVisitId] = useState("");
  const [consultationFees, setConsultationFees] = useState({});
  const [consultationType, setConsultationType] = useState("Day Consultation");
  const [consultationPrice, setConsultationPrice] = useState("2000");
  const [consultationAdjustmentReason, setConsultationAdjustmentReason] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [offlineSubmissions, setOfflineSubmissions] = useState([]);
  const [editingOfflineEntry, setEditingOfflineEntry] = useState(null);
  const [lastSubmissionOffline, setLastSubmissionOffline] = useState(false);
  const [reversingSubmissionId, setReversingSubmissionId] = useState(null);
  const [operatorPayments, setOperatorPayments] = useState([]);
  const [operatorQueueSearch, setOperatorQueueSearch] = useState("");
  const [paymentBill, setPaymentBill] = useState(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    return new Set();
  });

  useEffect(() => {
    document.title = "Billing · OCS Médecins";
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = window.localStorage.getItem(`ocs-billing-lite-favourites:${user.id}`);
      setFavorites(new Set(saved ? JSON.parse(saved) : []));
    } catch {
      setFavorites(new Set());
    }
  }, [user?.id]);

  async function loadDashboard({ silent = false } = {}) {
    if (!silent) setIsLoading(true);
    try {
      const pickerQuery = operatorIssueOnly && billingDoctorId
        ? `?doctorId=${encodeURIComponent(billingDoctorId)}`
        : "";
      const [submissionPayload, pickerPayload, feePayload, operatorPayload] = await Promise.all([
        api.get(`/billing/quick/submissions?limit=${SUBMISSION_PAGE_SIZE}&offset=0`),
        api.get(`/billing/quick/picker-options${pickerQuery}`),
        api.get("/billing/consultation-fees"),
        operatorIssueOnly ? api.get("/dashboard/operator-workspace") : Promise.resolve(null),
      ]);
      setSubmissions(Array.isArray(submissionPayload?.submissions) ? submissionPayload.submissions : []);
      setSubmissionTotal(Number(submissionPayload?.total || 0));
      setSubmissionPage(0);
      setPatientOptions(Array.isArray(pickerPayload?.patients) ? pickerPayload.patients : []);
      setDoctorOptions(Array.isArray(pickerPayload?.doctors) ? pickerPayload.doctors : []);
      setConsultationFees(feePayload || {});
      setOperatorPayments(Array.isArray(operatorPayload?.pendingPayments) ? operatorPayload.pendingPayments : []);
    } catch (error) {
      toast.error(error.message || "Quick billing could not be loaded.");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (view !== "status") return undefined;
    const timeout = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({
          limit: String(SUBMISSION_PAGE_SIZE),
          offset: String(submissionPage * SUBMISSION_PAGE_SIZE),
        });
        if (submissionSearch.trim()) query.set("search", submissionSearch.trim());
        if (submissionStatus) query.set("status", submissionStatus);
        const payload = await api.get(`/billing/quick/submissions?${query.toString()}`);
        setSubmissions(Array.isArray(payload?.submissions) ? payload.submissions : []);
        setSubmissionTotal(Number(payload?.total || 0));
      } catch (error) {
        toast.error(error.message || "Billing updates could not be loaded.");
      }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [submissionPage, submissionRefreshToken, submissionSearch, submissionStatus, view]);

  async function selectBillingDoctor(doctorId) {
    setBillingDoctorId(doctorId);
    setPatientOptions([]);
    setSelectedPatientId("");
    setSelectedPickerVisitId("");
    setSelectedVisit(null);
    setSourceReference("");
    if (!doctorId) return;
    setIsCatalogLoading(true);
    try {
      const payload = await api.get(`/billing/quick/picker-options?doctorId=${encodeURIComponent(doctorId)}`);
      setPatientOptions(Array.isArray(payload?.patients) ? payload.patients : []);
      if (Array.isArray(payload?.doctors)) setDoctorOptions(payload.doctors);
    } catch (error) {
      toast.error(error.message || "This doctor’s billable visits could not be loaded.");
    } finally {
      setIsCatalogLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.id) return undefined;
    let ignore = false;
    const refresh = async () => {
      const entries = await listOfflineMutations({ userId: user.id });
      if (!ignore) setOfflineSubmissions(entries.filter((entry) => entry.kind === "billing_quick_capture"));
    };
    const handleSynced = (event) => {
      void refresh();
      if (event.detail?.entry?.kind === "billing_quick_capture") void loadDashboard({ silent: true });
    };
    void refresh();
    window.addEventListener(OFFLINE_QUEUE_CHANGED, refresh);
    window.addEventListener(OFFLINE_QUEUE_ITEM_SYNCED, handleSynced);
    return () => {
      ignore = true;
      window.removeEventListener(OFFLINE_QUEUE_CHANGED, refresh);
      window.removeEventListener(OFFLINE_QUEUE_ITEM_SYNCED, handleSynced);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    window.localStorage.setItem(
      `ocs-billing-lite-favourites:${user.id}`,
      JSON.stringify([...favorites]),
    );
  }, [favorites, user?.id]);

  useEffect(() => {
    if (!patientPickerOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      patientPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [patientPickerOpen]);

  const categories = useMemo(() => {
    const names = new Set(catalog.map((item) => item.subcategory || item.category).filter(Boolean));
    return ["Favourites", "All supplies", ...[...names].sort((a, b) => a.localeCompare(b))];
  }, [catalog]);

  const matchingCatalog = useMemo(() => {
    const needle = catalogSearch.trim().toLowerCase();
    return catalog.filter((item) => {
      const inCategory =
        category === "All supplies" ||
        (category === "Favourites" && favorites.has(item.id)) ||
        item.subcategory === category ||
        item.category === category;
      const matchesSearch =
        !needle ||
        item.item_name.toLowerCase().includes(needle) ||
        item.category.toLowerCase().includes(needle) ||
        item.subcategory.toLowerCase().includes(needle) ||
        item.unit.toLowerCase().includes(needle);
      return inCategory && matchesSearch;
    });
  }, [catalog, catalogSearch, category, favorites]);

  const visibleCatalog = useMemo(() => {
    return matchingCatalog
      .filter((item) => showUnavailable || (Number(item.available_to_use || 0) > 0 && item.cost_price_ready && Number(item.selling_price || 0) > 0))
      .sort((a, b) => {
        const availabilityDifference = Number(Number(b.available_to_use || 0) > 0 && b.cost_price_ready && Number(b.selling_price || 0) > 0) - Number(Number(a.available_to_use || 0) > 0 && a.cost_price_ready && Number(a.selling_price || 0) > 0);
        return availabilityDifference || a.item_name.localeCompare(b.item_name);
      });
  }, [matchingCatalog, showUnavailable]);

  const unavailableCount = useMemo(
    () => matchingCatalog.filter((item) => Number(item.available_to_use || 0) < 1 || !item.cost_price_ready || Number(item.selling_price || 0) <= 0).length,
    [matchingCatalog],
  );

  const selectedItems = useMemo(
    () =>
      catalog
        .filter((item) => Number(cart[item.id] || 0) > 0)
        .map((item) => ({ ...item, quantity: Number(cart[item.id]) })),
    [catalog, cart],
  );

  const selectedPatient = useMemo(
    () => patientOptions.find((patient) => String(patient.patient_id) === String(selectedPatientId)) || null,
    [patientOptions, selectedPatientId],
  );

  const filteredPatientOptions = useMemo(() => {
    const needle = patientSearch.trim().toLowerCase();
    if (!needle) return patientOptions;
    return patientOptions.filter((patient) =>
      String(patient.patient_name || "").toLowerCase().includes(needle) ||
      String(patient.patient_identifier || "").toLowerCase().includes(needle),
    );
  }, [patientOptions, patientSearch]);

  const selectedPickerVisit = useMemo(
    () => selectedPatient?.visits?.find(
      (visit) => String(visit.consultation_id) === String(selectedPickerVisitId),
    ) || null,
    [selectedPatient, selectedPickerVisitId],
  );

  const filteredPickerVisits = useMemo(() => {
    const needle = visitSearch.trim().toLowerCase();
    const visits = selectedPatient?.visits || [];
    if (!needle) return visits;
    return visits.filter((visit) =>
      [
        visit.visit_number,
        formatVisitDate(visit.visit_date),
        formatVisitTime(visit.visit_time),
        visit.doctor_name,
      ].some((value) => String(value || "").toLowerCase().includes(needle)),
    );
  }, [selectedPatient, visitSearch]);

  const priorityVisits = useMemo(() => {
    const today = dayjs().startOf("day");
    return patientOptions
      .flatMap((patient) => (patient.visits || []).map((visit) => ({
        ...visit,
        patient_name: visit.patient_name || patient.patient_name,
        patient_identifier: visit.patient_identifier || patient.patient_identifier,
      })))
      .filter((visit) =>
        visit.can_submit &&
        ["ready", "needs_doctor"].includes(visit.submission_status) &&
        dayjs(visit.visit_date).isValid() &&
        !dayjs(visit.visit_date).startOf("day").isAfter(today),
      )
      .sort((a, b) => {
        const aToday = dayjs(a.visit_date).isSame(today, "day");
        const bToday = dayjs(b.visit_date).isSame(today, "day");
        if (aToday !== bToday) return aToday ? -1 : 1;
        return dayjs(a.visit_date).valueOf() - dayjs(b.visit_date).valueOf();
      });
  }, [patientOptions]);

  const todayPriorityCount = priorityVisits.filter((visit) => dayjs(visit.visit_date).isSame(dayjs(), "day")).length;
  const overduePriorityCount = priorityVisits.length - todayPriorityCount;

  const supplyTotal = selectedItems.reduce(
    (sum, item) => sum + Number(item.selling_price || 0) * item.quantity,
    0,
  );
  const consultationTotal = Number(consultationPrice || 0);
  const grandTotal = consultationTotal + supplyTotal;
  const selectedUnitCount = selectedItems.reduce((sum, item) => sum + item.quantity, 0);

  async function chooseVisit(visit) {
    if (!visit?.can_submit) {
      toast.error("This visit no longer has an unpaid bill that can receive supplies.");
      return;
    }
    setSelectedVisit(visit);
    const nextType = visit.consultation_fee?.type || "Day Consultation";
    const nextAmount = Number(visit.consultation_fee?.amount ?? consultationFees[nextType] ?? 0);
    setConsultationType(nextType);
    setConsultationPrice(String(nextAmount));
    setConsultationAdjustmentReason("");
    setCart({});
    setCatalog([]);
    setCatalogSearch("");
    setShowUnavailable(false);
    await openCatalog(visit);
  }

  function choosePatient(patient) {
    setSelectedPatientId(String(patient.patient_id));
    setSelectedPickerVisitId(patient.visits?.length === 1 ? String(patient.visits[0].consultation_id) : "");
    setVisitSearch("");
    setPatientPickerOpen(false);
    setPatientSearch("");
  }

  async function openCatalog(visit = selectedVisit) {
    if (!visit) return;
    setIsCatalogLoading(true);
    try {
      const doctorQuery = operatorIssueOnly
        ? `?doctorId=${encodeURIComponent(billingDoctorId)}`
        : "";
      const payload = await api.get(`/billing/quick/catalog/${visit.consultation_id}${doctorQuery}`);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const resolvedVisit = payload.visit || visit;
      const clarificationCart = {};
      if (resolvedVisit.submission_status === "needs_doctor") {
        for (const previousItem of resolvedVisit.clarification_items || []) {
          if (items.some((item) => Number(item.id) === Number(previousItem.inventory_item_id))) {
            clarificationCart[Number(previousItem.inventory_item_id)] = Number(previousItem.quantity || 0);
          }
        }
      }
      setCatalog(items);
      setCart(clarificationCart);
      setSelectedVisit(resolvedVisit);
      const hasSavedFavourite = items.some((item) => favorites.has(item.id));
      setCategory(hasSavedFavourite ? "Favourites" : "All supplies");
      setView("catalog");
    } catch (error) {
      toast.error(error.message || "Supplies could not be loaded.");
    } finally {
      setIsCatalogLoading(false);
    }
  }

  function reviewBilling() {
    const amount = Number(consultationPrice);
    if (!Object.hasOwn(consultationFees, consultationType)) {
      toast.error("Select a valid consultation type.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_CONSULTATION_FEE) {
      toast.error(`Enter a consultation price above Rs 0 and no more than Rs ${MAX_CONSULTATION_FEE.toLocaleString("en-MU")}.`);
      return;
    }
    const configuredAmount = Number(consultationFees[consultationType] || 0);
    if (Math.abs(amount - configuredAmount) >= 0.005 && consultationAdjustmentReason.trim().length < 8) {
      toast.error("Explain the consultation price adjustment in at least 8 characters.");
      return;
    }
    if (operatorIssueOnly && !billingDoctorId) {
      toast.error("Select the consultation doctor first.");
      return;
    }
    setView("review");
  }

  function changeQuantity(item, delta) {
    const available = Number(item.available_to_use || 0);
    setCart((current) => {
      const next = Math.max(0, Math.min(available, Number(current[item.id] || 0) + delta));
      if (next === Number(current[item.id] || 0) && delta > 0) {
        toast.error(`Only ${available} ${item.unit}${available === 1 ? "" : "s"} available.`);
      }
      return { ...current, [item.id]: next };
    });
  }

  function toggleFavorite(itemId) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function runLookup(event) {
    event?.preventDefault();
    const reference = lookup.trim();
    if (!reference) {
      toast.error("Enter an OCS care number or visit number.");
      return;
    }
    setIsLookingUp(true);
    setLookupResults([]);
    try {
      if (operatorIssueOnly && !billingDoctorId) {
        toast.error("Select the consultation doctor before searching.");
        return;
      }
      const doctorQuery = operatorIssueOnly ? `&doctorId=${encodeURIComponent(billingDoctorId)}` : "";
      const payload = await api.get(`/billing/quick/lookup?reference=${encodeURIComponent(reference)}${doctorQuery}`);
      const matches = Array.isArray(payload?.visits) ? payload.visits : [];
      setLookupResults(matches);
      if (matches.length === 1) await chooseVisit(matches[0]);
    } catch (error) {
      toast.error(error.message || "No matching visit was found.");
    } finally {
      setIsLookingUp(false);
    }
  }

  async function submitBilling() {
    if (!selectedVisit || isSubmitting) return;
    if (operatorIssueOnly && sourceReference.trim().length < 3) {
      toast.error("Enter the paper invoice number or photo reference.");
      return;
    }
    setIsSubmitting(true);
    const endpoint = `/billing/quick/visits/${selectedVisit.consultation_id}/capture`;
    const submissionPayload = {
      operation_id: editingOfflineEntry?.payload?.operation_id || crypto.randomUUID(),
      doctor_id: operatorIssueOnly ? Number(billingDoctorId) : undefined,
      source_reference: operatorIssueOnly ? sourceReference.trim() : undefined,
      consultation_fee: {
        type: consultationType,
        amount: Number(consultationPrice),
        adjustment_reason: consultationAdjustmentReason.trim() || undefined,
      },
      items: selectedItems.map((item) => ({
        inventory_item_id: item.id,
        quantity: item.quantity,
        unit_price: Number(item.selling_price || 0),
      })),
    };
    try {
      const payload = await api.post(endpoint, submissionPayload);
      if (editingOfflineEntry?.id) {
        await removeOfflineMutation(editingOfflineEntry.id);
        setOfflineSubmissions((current) => current.filter((entry) => entry.id !== editingOfflineEntry.id));
        setEditingOfflineEntry(null);
      }
      setLastSubmissionOffline(false);
      setSelectedVisit(payload.visit || selectedVisit);
      setView("success");
      await loadDashboard({ silent: true });
      toast.success(operatorIssueOnly
        ? "Invoice issued and ready for payment."
        : selectedItems.length ? "Billing sent to the operator." : "Consultation-only billing submitted.");
    } catch (error) {
      if (isBrowserOffline() || isNetworkFailure(error)) {
        try {
          await queueQuickBillingMutation({
            id: editingOfflineEntry?.id,
            endpoint,
            payload: submissionPayload,
            userId: user.id,
            meta: {
              label: `Billing ${selectedVisit.visit_number}`,
              consultationId: selectedVisit.consultation_id,
              visitNumber: selectedVisit.visit_number,
              patientName: selectedVisit.patient_name || selectedVisit.patient_masked_name,
              itemCount: selectedUnitCount,
            },
          });
          setLastSubmissionOffline(true);
          setEditingOfflineEntry(null);
          setView("success");
          toast.success(OFFLINE_SAVED_TOAST, { duration: 6500 });
        } catch (queueError) {
          toast.error(queueError.message || "Billing could not be saved on this device.");
        }
      } else {
        toast.error(error.message || "Billing could not be submitted.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function reverseSubmission(submission) {
    const response = window.prompt("Why are these submitted supplies being reversed?");
    if (response === null) return;
    const reason = response.trim();
    if (reason.length < 5) {
      toast.error("Enter a clear reason for the reversal.");
      return;
    }
    setReversingSubmissionId(submission.id);
    try {
      await api.post(`/billing/quick/submissions/${submission.id}/reverse`, {
        operation_id: crypto.randomUUID(),
        reason,
      });
      await loadDashboard({ silent: true });
      toast.success("Supplies reversed. The stock and bill audit trails were updated.");
    } catch (error) {
      toast.error(error.message || "The submitted supplies could not be reversed.");
    } finally {
      setReversingSubmissionId(null);
    }
  }

  async function updateOperatorWorkflow(submission, status) {
    let note = "";
    if (status === "needs_doctor") {
      const response = window.prompt("What should the doctor clarify?");
      if (response === null) return;
      note = response.trim();
      if (note.length < 3) return toast.error("Add a short clarification note for the doctor.");
    }
    try {
      await api.patch(`/billing/quick/operator-queue/${submission.consultation_id}/status`, { status, note });
      await loadDashboard({ silent: true });
      toast.success(status === "needs_doctor" ? "Clarification sent to the doctor." : "Bill is ready for payment.");
    } catch (error) {
      toast.error(error.message || "The billing workflow could not be updated.");
    }
  }

  async function recordOperatorPayment(payload) {
    if (!paymentBill || paymentBusy) return;
    setPaymentBusy(true);
    try {
      await api.patch(`/billing/${paymentBill.id}/pay`, payload);
      setPaymentBill(null);
      await loadDashboard({ silent: true });
      toast.success("Payment recorded in the transaction ledger.");
    } catch (error) {
      toast.error(error.message || "Payment could not be recorded.");
    } finally {
      setPaymentBusy(false);
    }
  }

  async function openOperatorPaymentBill(bill) {
    setPaymentBusy(true);
    try {
      const detail = await api.get(`/billing/${bill.id}`);
      setPaymentBill(detail);
    } catch (error) {
      toast.error(error.message || "The invoice ledger could not be opened.");
    } finally {
      setPaymentBusy(false);
    }
  }

  async function reverseOperatorPayment(payment, payload) {
    if (!paymentBill || paymentBusy) return;
    setPaymentBusy(true);
    try {
      const result = await api.post(`/billing/${paymentBill.id}/payments/${payment.payment_transaction_id}/reverse`, payload);
      setPaymentBill(result.bill);
      await loadDashboard({ silent: true });
      toast.success("Receipt reversed. Correct the supplies, then re-record the correct payment.");
    } catch (error) {
      toast.error(error.message || "The receipt could not be reversed.");
    } finally {
      setPaymentBusy(false);
    }
  }

  async function editOfflineSubmission(queueEntry) {
    const consultationId = Number(queueEntry.payload?.consultation_id || queueEntry.meta?.consultationId || 0);
    const visit = patientOptions
      .flatMap((patient) => patient.visits || [])
      .find((row) => Number(row.consultation_id) === consultationId);
    if (!visit) {
      toast.error("This visit is no longer billable. Discard the saved submission after confirming no further bill is needed.");
      return;
    }

    const fee = queueEntry.payload?.consultation_fee || {};
    setSelectedVisit(visit);
    setConsultationType(fee.type || visit.consultation_fee?.type || "Day Consultation");
    setConsultationPrice(String(fee.amount ?? visit.consultation_fee?.amount ?? 0));
    setConsultationAdjustmentReason(String(fee.adjustment_reason || ""));
    setIsCatalogLoading(true);
    try {
      const doctorQuery = operatorIssueOnly
        ? `?doctorId=${encodeURIComponent(billingDoctorId || visit.doctor_id || "")}`
        : "";
      const payload = await api.get(`/billing/quick/catalog/${consultationId}${doctorQuery}`);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const nextCart = {};
      for (const savedItem of queueEntry.payload?.items || []) {
        if (items.some((item) => Number(item.id) === Number(savedItem.inventory_item_id))) {
          nextCart[Number(savedItem.inventory_item_id)] = Number(savedItem.quantity || 0);
        }
      }
      setCatalog(items);
      setCart(nextCart);
      setSelectedVisit(payload.visit || visit);
      setEditingOfflineEntry(queueEntry);
      setView("catalog");
      toast.success("Saved submission opened for correction. Review it before submitting again.");
    } catch (error) {
      toast.error(error.message || "This saved submission could not be opened for editing.");
    } finally {
      setIsCatalogLoading(false);
    }
  }

  async function discardOfflineSubmission(queueEntry) {
    if (!window.confirm("Discard this saved offline billing submission? This does not change any server bill or stock.")) return;
    await removeOfflineMutation(queueEntry.id);
    setOfflineSubmissions((current) => current.filter((entry) => entry.id !== queueEntry.id));
    toast.success("Saved offline submission discarded.");
  }

  function resetFlow(destination = "today") {
    setSelectedVisit(null);
    setCatalog([]);
    setCart({});
    setLookupResults([]);
    setCatalogSearch("");
    setLastSubmissionOffline(false);
    setEditingOfflineEntry(null);
    setSourceReference("");
    setConsultationAdjustmentReason("");
    setView(destination);
  }

  const showOfflineSubmissions = submissionPage === 0 && !submissionSearch.trim() && !submissionStatus;
  const displayedSubmissions = [
    ...(showOfflineSubmissions ? offlineSubmissions : []).map((entry) => ({
      id: `offline-${entry.id}`,
      patient_name: entry.meta?.patientName || "Saved securely on this device",
      patient_identifier: entry.meta?.visitNumber || "Pending visit",
      visit_number: entry.meta?.visitNumber || "Pending sync",
      submitted_at: entry.timestamp,
      item_count: Number(entry.meta?.itemCount || 0),
      items: [],
      status: entry.sync_status === "needs_attention" ? "needs_attention" : "queued_offline",
      sync_error: entry.sync_error || "",
      offline: true,
      queue_entry: entry,
    })),
    ...submissions,
  ];

  const attentionCount = displayedSubmissions.filter((submission) =>
    ["needs_doctor", "needs_attention", "queued_offline"].includes(submission.status),
  ).length;

  const operatorActionSubmissions = operatorIssueOnly
    ? submissions.filter((submission) => ["awaiting_operator", "needs_doctor"].includes(submission.status))
    : [];
  const operatorQueueNeedle = operatorQueueSearch.trim().toLowerCase();
  const matchesOperatorQueue = (entry) => !operatorQueueNeedle || [
    entry.patient_name, entry.patient_identifier, entry.visit_number,
    entry.invoice_number, entry.doctor_name,
  ].some((value) => String(value || "").toLowerCase().includes(operatorQueueNeedle));
  const visibleOperatorSubmissions = operatorActionSubmissions.filter(matchesOperatorQueue);
  const actionBillIds = new Set(operatorActionSubmissions.map((submission) => Number(submission.bill_id || 0)).filter(Boolean));
  const visibleOperatorPayments = operatorPayments
    .filter((bill) => !actionBillIds.has(Number(bill.id || 0)))
    .filter(matchesOperatorQueue);

  return (
    <div className="relative min-h-[70svh] rounded-[2rem] bg-[#eff8f7] text-[#173f47] shadow-[0_18px_60px_rgba(23,77,80,0.1)]">
      <div className="absolute inset-x-0 top-0 z-0 h-72 rounded-t-[2rem] bg-[radial-gradient(circle_at_15%_15%,rgba(102,226,206,0.24),transparent_34%),linear-gradient(145deg,#123f46_0%,#17666a_52%,#2b8d8b_100%)]" />

      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-10 pt-5">
        {isLoading ? (
          <div className="flex min-h-[55svh] items-center justify-center">
            <LoaderCircle className="size-10 animate-spin text-white" aria-label="Loading quick billing" />
          </div>
        ) : null}

        {!isLoading && view === "today" ? (
          <section>
            <div className="mb-6 flex items-end justify-between gap-4 text-white">
              <div>
                <p className="text-sm font-bold text-white/70">{dayjs().format("dddd, D MMMM")}</p>
                <h1 className="mt-1 text-3xl font-black tracking-tight">Billing</h1>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setView("status")}
                  className="relative min-h-12 rounded-2xl border border-white/15 bg-white/10 px-4 text-sm font-black transition active:scale-95"
                >
                  Updates
                  {attentionCount ? (
                    <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-[#f2b52b] px-1.5 py-0.5 text-xs text-[#173f47]">
                      {attentionCount}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => loadDashboard()}
                  className="flex size-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 transition active:scale-95"
                  aria-label="Refresh visits"
                >
                  <RefreshCw className="size-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {isCatalogLoading ? (
              <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl bg-white/95 px-4 py-3 font-black text-[#17666a] shadow-sm">
                <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                Opening charges…
              </div>
            ) : null}

            {operatorIssueOnly ? (
              <div className="relative z-20 mb-4 rounded-[1.5rem] border border-white/70 bg-white p-4 shadow-[0_12px_35px_rgba(23,77,80,0.11)]">
                <label className="block">
                  <span className="text-sm font-black text-slate-700">Consultation doctor</span>
                  <select
                    value={billingDoctorId}
                    onChange={(event) => void selectBillingDoctor(event.target.value)}
                    className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-base font-bold text-[#173f47] outline-none transition focus:border-[#2aa7a0] focus:bg-white"
                  >
                    <option value="">Select doctor first</option>
                    {doctorOptions.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>
                    ))}
                  </select>
                  <span className="mt-2 block text-xs font-semibold text-slate-500">
                    The invoice and supply deduction will be recorded against this doctor’s consultation.
                  </span>
                </label>
              </div>
            ) : null}

            {operatorIssueOnly ? (
              <div className="relative z-10 mb-4 rounded-[1.5rem] border border-white/70 bg-white p-4 shadow-[0_12px_35px_rgba(23,77,80,0.11)]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-black text-[#173f47]">Operator action queue</h2>
                    <p className="text-xs font-semibold text-slate-500">Clarifications and collections in one place.</p>
                  </div>
                  <div className="relative sm:w-72">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input value={operatorQueueSearch} onChange={(event) => setOperatorQueueSearch(event.target.value)} placeholder="Patient, OCS, visit or invoice" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold outline-none focus:border-[#2aa7a0]" />
                  </div>
                </div>
                {visibleOperatorSubmissions.length || visibleOperatorPayments.length ? (
                  <div className="mt-3 grid gap-2.5 md:grid-cols-2">
                    {visibleOperatorSubmissions.map((submission) => (
                      <article key={`review-${submission.id}`} className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4">
                        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-black">{submission.patient_name}</p><p className="mt-1 text-xs font-bold text-slate-500">{submission.patient_identifier} · {submission.visit_number}</p></div><StatusBadge status={submission.status} compact /></div>
                        {submission.workflow_note ? <p className="mt-3 text-sm font-semibold text-rose-800">{submission.workflow_note}</p> : null}
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => updateOperatorWorkflow(submission, "needs_doctor")} className="min-h-11 rounded-xl border border-rose-200 bg-white px-3 text-sm font-black text-rose-800">Ask doctor</button>
                          <button type="button" onClick={() => updateOperatorWorkflow(submission, "ready_for_payment")} className="min-h-11 rounded-xl bg-violet-600 px-3 text-sm font-black text-white">Ready for payment</button>
                        </div>
                      </article>
                    ))}
                    {visibleOperatorPayments.map((bill) => (
                      <article key={`payment-${bill.id}`} className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
                        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-black">{bill.patient_name}</p><p className="mt-1 text-xs font-bold text-slate-500">{bill.patient_identifier} · {bill.invoice_number}</p><p className="mt-1 text-xs font-semibold text-slate-500">{bill.doctor_name}</p></div><StatusBadge status={Number(bill.payment_received_amount || 0) > 0 ? "partial" : "ready_for_payment"} compact /></div>
                        <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2"><span className="text-xs font-bold text-slate-500">Outstanding</span><span className="font-black">{formatRupees(bill.payment_balance_amount)}</span></div>
                        <button type="button" onClick={() => void openOperatorPaymentBill(bill)} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#17666a] px-3 text-sm font-black text-white"><CreditCard className="size-4" />{Number(bill.payment_received_amount || 0) > 0 ? "Open payment ledger" : "Record payment"}</button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-2xl bg-[#eff8f7] px-4 py-4 text-center text-sm font-bold text-[#17666a]">No matching operator actions.</p>
                )}
              </div>
            ) : null}

            <div className="relative z-10 mb-4 rounded-[1.5rem] border border-white/70 bg-white/95 p-4 shadow-[0_12px_35px_rgba(23,77,80,0.11)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-[#173f47]">Visits needing billing</h2>
                  <p className="text-xs font-semibold text-slate-500">Today first, then overdue.</p>
                </div>
                <div className="flex gap-2 text-xs font-black">
                  <span className="rounded-full bg-[#e7f8f5] px-3 py-1.5 text-[#17666a]">Today {todayPriorityCount}</span>
                  {overduePriorityCount ? (
                    <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-800">Overdue {overduePriorityCount}</span>
                  ) : null}
                </div>
              </div>
              {operatorIssueOnly && !billingDoctorId ? (
                <div className="mt-3 rounded-2xl bg-[#eff8f7] px-4 py-4 text-center text-sm font-bold text-[#17666a]">
                  Select the consultation doctor to see visits needing billing.
                </div>
              ) : priorityVisits.length ? (
                <div className="mt-3 grid gap-2.5 md:grid-cols-2">
                  {priorityVisits.slice(0, 4).map((visit) => (
                    <VisitCard key={visit.consultation_id} visit={visit} onSelect={chooseVisit} />
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-2xl bg-[#eff8f7] px-4 py-4 text-center text-sm font-bold text-[#17666a]">
                  No completed visits are waiting for billing.
                </div>
              )}
              {priorityVisits.length > 4 ? (
                <p className="mt-2.5 text-center text-xs font-bold text-slate-500">
                  {priorityVisits.length - 4} more in the patient and consultation picker below.
                </p>
              ) : null}
            </div>

            <div className="relative z-20 mb-6 rounded-[2rem] border border-white/70 bg-white p-5 shadow-[0_16px_45px_rgba(23,77,80,0.15)] md:p-6">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-[#173f47]">Select patient and consultation</h2>
                </div>
                <button
                  type="button"
                  disabled={operatorIssueOnly && !billingDoctorId}
                  onClick={() => setView("find")}
                  className="mt-2 inline-flex min-h-11 items-center gap-2 self-start rounded-xl px-2 text-sm font-bold text-[#17666a] disabled:cursor-not-allowed disabled:opacity-50 sm:mt-0"
                >
                  <Search className="size-4" aria-hidden="true" />
                  Search by number
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <div ref={patientPickerRef} className="relative z-50 scroll-mt-4">
                  <label className="text-sm font-black text-slate-700">1. Patient</label>
                  <button
                    type="button"
                    disabled={operatorIssueOnly && !billingDoctorId}
                    onClick={() => setPatientPickerOpen((open) => !open)}
                    className="mt-2 flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 text-left outline-none transition focus:border-[#2aa7a0] disabled:cursor-not-allowed disabled:opacity-60"
                    aria-haspopup="listbox"
                    aria-expanded={patientPickerOpen}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <UserRound className="size-6 shrink-0 text-[#248f91]" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className={`block truncate font-black ${selectedPatient ? "text-[#173f47]" : "text-slate-500"}`}>
                          {selectedPatient?.patient_name || (operatorIssueOnly && !billingDoctorId ? "Select doctor first" : "Select patient")}
                        </span>
                        <span className="block truncate text-sm font-semibold text-slate-500">
                          {selectedPatient?.patient_identifier || (operatorIssueOnly && !billingDoctorId ? "Doctor selection is required" : "Search by name or OCS number")}
                        </span>
                      </span>
                    </span>
                    <ChevronDown className={`size-5 shrink-0 text-slate-400 transition ${patientPickerOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>

                  {patientPickerOpen ? (
                    <div className="absolute inset-x-0 top-full z-[70] mt-2 flex max-h-[min(24rem,calc(100svh-6rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_55px_rgba(15,50,55,0.2)]">
                      <div className="shrink-0 border-b border-slate-100 p-3">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                          <input
                            autoFocus
                            value={patientSearch}
                            onChange={(event) => setPatientSearch(event.target.value)}
                            placeholder="Type patient name or OCS number"
                            className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 font-semibold text-[#173f47] outline-none focus:border-[#2aa7a0] focus:bg-white"
                          />
                        </div>
                        <p className="mt-2 px-1 text-xs font-bold text-slate-500">
                          {filteredPatientOptions.length} {filteredPatientOptions.length === 1 ? "patient" : "patients"} from your billable visits
                        </p>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="listbox" aria-label="Patients with consultations ready to bill">
                        {filteredPatientOptions.length ? filteredPatientOptions.map((patient) => (
                          <button
                            key={patient.patient_id}
                            type="button"
                            role="option"
                            aria-selected={String(patient.patient_id) === String(selectedPatientId)}
                            onClick={() => choosePatient(patient)}
                            className="flex min-h-16 w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-[#eff8f7] active:bg-[#dff5f1]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-black text-[#173f47]">{patient.patient_name}</span>
                              <span className="block text-sm font-semibold text-slate-500">{patient.patient_identifier}</span>
                            </span>
                            <span className="shrink-0 rounded-full bg-[#e7f8f5] px-2.5 py-1 text-xs font-black text-[#17666a]">
                              {patient.visits.length} {patient.visits.length === 1 ? "visit" : "visits"}
                            </span>
                          </button>
                        )) : (
                          <p className="px-4 py-8 text-center text-sm font-semibold text-slate-500">No matching patient.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <label className="block">
                  <span className="text-sm font-black text-slate-700">2. Consultation</span>
                  {selectedPatient?.visits?.length > 4 ? (
                    <div className="relative mt-2">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      <input
                        value={visitSearch}
                        onChange={(event) => {
                          setVisitSearch(event.target.value);
                          setSelectedPickerVisitId("");
                        }}
                        placeholder="Search visit number or date"
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-[#173f47] outline-none focus:border-[#2aa7a0]"
                      />
                    </div>
                  ) : null}
                  <select
                    value={selectedPickerVisitId}
                    onChange={(event) => setSelectedPickerVisitId(event.target.value)}
                    disabled={!selectedPatient}
                    className="mt-2 min-h-16 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 font-black text-[#173f47] outline-none transition focus:border-[#2aa7a0] disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    <option value="">{selectedPatient ? "Select consultation" : "Select patient first"}</option>
                    {filteredPickerVisits.map((visit) => (
                      <option key={visit.consultation_id} value={visit.consultation_id}>
                        {formatVisitDate(visit.visit_date)} · {formatVisitTime(visit.visit_time)} · {visit.visit_number}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  disabled={!selectedPickerVisit}
                  onClick={() => selectedPickerVisit && chooseVisit(selectedPickerVisit)}
                  className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-[#f2b52b] px-6 font-black text-[#173f47] shadow-[0_12px_30px_rgba(242,181,43,0.25)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 md:min-w-36"
                >
                  Continue
                  <ChevronRight className="size-5" aria-hidden="true" />
                </button>
              </div>
            </div>

          </section>
        ) : null}

        {!isLoading && view === "find" ? (
          <section>
            <button
              type="button"
              onClick={() => resetFlow("today")}
              className="mb-5 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white/10 px-4 font-bold text-white transition active:scale-95"
            >
              <ArrowLeft className="size-5" /> Back to billing
            </button>
            <div className="mb-6 text-white">
              <h1 className="text-3xl font-black tracking-tight">Search by number</h1>
            </div>
            <form onSubmit={runLookup} className="rounded-[2rem] border border-white/70 bg-white p-5 shadow-[0_18px_50px_rgba(23,77,80,0.14)] md:p-7">
              <label htmlFor="billing-lite-lookup" className="text-base font-black text-[#173f47]">
                OCS care number or visit number
              </label>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    id="billing-lite-lookup"
                    autoCapitalize="characters"
                    autoComplete="off"
                    value={lookup}
                    onChange={(event) => setLookup(event.target.value.toUpperCase())}
                    placeholder="OCS-212 or V-000184"
                    className="min-h-16 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 pl-13 pr-4 text-xl font-black uppercase tracking-wide text-[#173f47] outline-none transition focus:border-[#2aa7a0] focus:bg-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLookingUp}
                  className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-[#f2b52b] px-8 text-base font-black text-[#173f47] shadow-[0_12px_30px_rgba(242,181,43,0.28)] transition active:scale-[0.98] disabled:opacity-60"
                >
                  {isLookingUp ? <LoaderCircle className="size-5 animate-spin" /> : <Search className="size-5" />}
                  Find visit
                </button>
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-500">Only visits completed by your doctor account can be opened.</p>
            </form>

            {lookupResults.length > 1 ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {lookupResults.map((visit) => (
                  <VisitCard key={visit.consultation_id} visit={visit} onSelect={chooseVisit} />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {!isLoading && view === "catalog" && selectedVisit ? (
          <section>
            <div className="mb-5 flex items-center justify-between gap-3 text-white">
              <button
                type="button"
                onClick={() => resetFlow("today")}
                className="flex size-12 items-center justify-center rounded-2xl bg-white/10 transition active:scale-95"
                aria-label="Back to visits"
              >
                <ArrowLeft className="size-6" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white/70">{selectedVisit.patient_identifier} · {selectedVisit.visit_number}</p>
                <h1 className="truncate text-2xl font-black">Charges</h1>
              </div>
              <button
                type="button"
                onClick={reviewBilling}
                className="relative hidden min-h-12 items-center gap-2 rounded-2xl bg-[#f2b52b] px-4 font-black text-[#173f47] transition active:scale-95 md:flex"
              >
                <ShoppingBasket className="size-5" />
                Review
                {selectedUnitCount > 0 ? (
                  <span className="flex min-w-6 items-center justify-center rounded-full bg-[#173f47] px-1.5 py-0.5 text-sm text-white">{selectedUnitCount}</span>
                ) : null}
              </button>
            </div>

            {selectedVisit.submission_status === "needs_doctor" ? (
              <div className="mb-4 rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <p className="font-black">Replace the earlier submission</p>
                <p className="mt-1 text-sm font-semibold">{selectedVisit.workflow_note || "Review the previously submitted supplies and send the complete corrected list."}</p>
                <p className="mt-2 text-xs font-bold text-amber-800">The previous quantities are preloaded. On submission, the earlier stock movements and charge lines are reversed before this corrected list is applied.</p>
              </div>
            ) : null}

            <div className="mb-4 rounded-[1.5rem] border border-white/70 bg-white p-4 shadow-[0_12px_35px_rgba(23,77,80,0.12)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1">
                  <span className="text-sm font-black text-slate-700">Consultation</span>
                  <select
                    value={consultationType}
                    onChange={(event) => {
                      const nextType = event.target.value;
                      setConsultationType(nextType);
                      setConsultationPrice(String(consultationFees[nextType] ?? 0));
                      setConsultationAdjustmentReason("");
                    }}
                    className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-black text-[#173f47] outline-none focus:border-[#2aa7a0]"
                  >
                    {Object.keys(consultationFees).map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label className="sm:w-44">
                  <span className="text-sm font-black text-slate-700">Price</span>
                  <span className="relative mt-2 block">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-500">Rs</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      max={MAX_CONSULTATION_FEE}
                      step="0.01"
                      value={consultationPrice}
                      onChange={(event) => setConsultationPrice(event.target.value)}
                      className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-base font-black text-[#173f47] outline-none focus:border-[#2aa7a0]"
                    />
                  </span>
                </label>
              </div>
              {Math.abs(Number(consultationPrice || 0) - Number(consultationFees[consultationType] || 0)) >= 0.005 ? (
                <label className="mt-3 block">
                  <span className="text-sm font-black text-amber-900">Reason for price adjustment</span>
                  <textarea
                    required
                    minLength={8}
                    rows={2}
                    value={consultationAdjustmentReason}
                    onChange={(event) => setConsultationAdjustmentReason(event.target.value)}
                    placeholder="Explain why the standard consultation price was changed."
                    className="mt-2 w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold outline-none focus:border-amber-500"
                  />
                </label>
              ) : null}
              <p className="mt-2 text-xs font-semibold text-slate-500">Maximum Rs 4,500. Adjustments require a reason and are retained in the audit history.</p>
            </div>

            <div className="sticky top-20 z-20 rounded-[1.5rem] border border-white/70 bg-white/95 p-3 shadow-[0_12px_35px_rgba(23,77,80,0.12)] backdrop-blur-xl md:p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={catalogSearch}
                    onChange={(event) => {
                      setCatalogSearch(event.target.value);
                      if (event.target.value) setCategory("All supplies");
                    }}
                    placeholder="Search supplies"
                    className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-12 pr-4 text-base font-bold outline-none transition focus:border-[#2aa7a0] focus:bg-white"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 lg:shrink-0">
                  <span className="text-sm font-bold text-slate-500">{visibleCatalog.length} shown</span>
                  {unavailableCount ? (
                    <button
                      type="button"
                      aria-pressed={showUnavailable}
                      onClick={() => setShowUnavailable((current) => !current)}
                      className={`min-h-11 rounded-xl px-4 text-sm font-black transition ${
                        showUnavailable ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {showUnavailable ? "Hide out of stock" : `Show out of stock (${unavailableCount})`}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="ocs-h-scroll mt-3 border-t border-slate-100 pt-3">
                {categories.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setCategory(name)}
                    className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-black transition ${
                      category === name ? "bg-[#17666a] text-white shadow-sm" : "bg-[#edf6f5] text-[#315e64]"
                    }`}
                  >
                    {name === "Favourites" ? "★ Favourites" : name}
                  </button>
                ))}
              </div>
            </div>

            {visibleCatalog.length ? (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visibleCatalog.map((item) => {
                  const quantity = Number(cart[item.id] || 0);
                  const available = Number(item.available_to_use || 0);
                  const priceMissing = !item.cost_price_ready || Number(item.selling_price || 0) <= 0;
                  const isUnavailable = available < 1 || priceMissing;
                  const isFavorite = favorites.has(item.id);
                  return (
                    <article
                      key={item.id}
                      className={`relative flex min-h-44 flex-col rounded-2xl border p-4 transition ${
                        quantity > 0 ? "border-[#2aa7a0] ring-2 ring-[#2aa7a0]/20" : "border-slate-200/80"
                      } ${isUnavailable ? "bg-slate-50" : "bg-white shadow-[0_8px_24px_rgba(23,77,80,0.07)]"}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleFavorite(item.id)}
                        className={`absolute right-3 top-3 flex size-9 items-center justify-center rounded-xl transition active:scale-90 ${
                          isFavorite ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-400"
                        }`}
                        aria-label={isFavorite ? `Remove ${item.item_name} from favourites` : `Add ${item.item_name} to favourites`}
                      >
                        <Star className={`size-5 ${isFavorite ? "fill-current" : ""}`} />
                      </button>
                      <div className="pr-10">
                        <p className="line-clamp-2 text-base font-black leading-6 text-[#173f47]">{item.item_name}</p>
                        <p className="mt-1 line-clamp-1 text-sm font-semibold text-slate-400">{item.subcategory || item.category}</p>
                      </div>
                      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
                        <div className="min-w-0">
                          <p className={`text-lg font-black ${isUnavailable ? "text-slate-400" : "text-[#17666a]"}`}>{formatRupees(item.selling_price)}</p>
                          <p className={`mt-1 text-sm font-bold ${isUnavailable ? "text-rose-600" : "text-slate-500"}`}>
                            {priceMissing ? "Pricing required" : isUnavailable ? "Out of stock" : `${available} ${item.unit}${available === 1 ? "" : "s"}`}
                          </p>
                        </div>
                        {quantity > 0 ? (
                          <div className="flex shrink-0 items-center rounded-xl bg-[#e6f7f4] p-1">
                            <button
                              type="button"
                              onClick={() => changeQuantity(item, -1)}
                              className="flex size-10 items-center justify-center rounded-lg bg-white text-[#17666a] shadow-sm active:scale-90"
                              aria-label={`Remove one ${item.item_name}`}
                            >
                              <Minus className="size-5" />
                            </button>
                            <span className="min-w-9 text-center text-lg font-black tabular-nums">{quantity}</span>
                            <button
                              type="button"
                              onClick={() => changeQuantity(item, 1)}
                              className="flex size-10 items-center justify-center rounded-lg bg-[#17666a] text-white active:scale-90"
                              aria-label={`Add another ${item.item_name}`}
                            >
                              <Plus className="size-5" />
                            </button>
                          </div>
                        ) : !isUnavailable ? (
                          <button
                            type="button"
                            onClick={() => changeQuantity(item, 1)}
                            className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#17666a] px-4 font-black text-white transition active:scale-95"
                          >
                            <Plus className="size-5" /> Add
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5">
                <EmptyState
                  icon={PackageOpen}
                  title={category === "Favourites" ? "No favourite supplies yet" : showUnavailable ? "No supplies found" : "No available supplies found"}
                  description={
                    category === "Favourites"
                      ? "Open All supplies and tap the star on frequently used items."
                      : showUnavailable
                        ? "Try another category or search term."
                        : "Try another category, change your search, or show out-of-stock supplies."
                  }
                  action={
                    category === "Favourites" ? (
                      <button type="button" onClick={() => setCategory("All supplies")} className="rounded-2xl bg-[#17666a] px-6 py-3 font-black text-white">
                        Browse all supplies
                      </button>
                    ) : !showUnavailable && unavailableCount ? (
                      <button type="button" onClick={() => setShowUnavailable(true)} className="rounded-2xl bg-[#17666a] px-6 py-3 font-black text-white">
                        Show out-of-stock supplies
                      </button>
                    ) : null
                  }
                />
              </div>
            )}

            <button
              type="button"
              onClick={reviewBilling}
              className="billing-integrated-review-bar fixed left-1/2 z-30 flex min-h-16 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center justify-between rounded-[1.4rem] bg-[#f2b52b] px-6 text-[#173f47] shadow-[0_20px_50px_rgba(23,63,71,0.3)] transition active:scale-[0.98] md:hidden"
            >
              <span className="text-left">
                <span className="block text-sm font-bold">{selectedUnitCount ? `${selectedUnitCount} supply unit${selectedUnitCount === 1 ? "" : "s"}` : "Consultation only"}</span>
                <span className="block text-lg font-black">{formatRupees(grandTotal)}</span>
              </span>
              <span className="flex items-center gap-2 text-base font-black">Review <ChevronRight className="size-5" /></span>
            </button>
          </section>
        ) : null}

        {!isLoading && view === "review" && selectedVisit ? (
          <section className="mx-auto max-w-2xl">
            <button
              type="button"
              onClick={() => setView("catalog")}
              className="mb-5 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white/10 px-4 font-bold text-white transition active:scale-95"
            >
              <ArrowLeft className="size-5" /> Edit charges
            </button>
            <div className="overflow-hidden rounded-[2.25rem] border border-white/70 bg-white shadow-[0_24px_65px_rgba(23,77,80,0.18)]">
              <div className="bg-[#173f47] px-6 py-6 text-white">
                <p className="text-sm font-bold text-white/65">{selectedVisit.patient_identifier} · {selectedVisit.visit_number}</p>
                <h1 className="mt-1 text-3xl font-black">Review billing</h1>
              </div>
              <div className="p-6">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
                  <div>
                    <p className="text-lg font-black">{consultationType}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">Confirmed for this bill</p>
                  </div>
                  <p className="text-lg font-black">{formatRupees(consultationTotal)}</p>
                </div>

                {selectedItems.length ? (
                  <div className="divide-y divide-slate-100">
                    {selectedItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-4 py-5">
                        <div className="min-w-0">
                          <p className="font-black text-[#173f47]">{item.item_name}</p>
                          <p className="mt-1 text-sm font-semibold text-slate-500">{item.quantity} × {formatRupees(item.selling_price)}</p>
                        </div>
                        <p className="shrink-0 font-black">{formatRupees(item.selling_price * item.quantity)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="my-5 rounded-2xl bg-[#edf8f6] px-5 py-4">
                    <p className="font-black text-[#17666a]">Consultation only</p>
                    <p className="mt-1 text-sm font-semibold text-slate-600">No supplies will be deducted from your bag.</p>
                  </div>
                )}

                {operatorIssueOnly ? (
                  <label className="mt-5 block rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <span className="text-sm font-black text-slate-700">Paper invoice or photo reference</span>
                    <input
                      value={sourceReference}
                      onChange={(event) => setSourceReference(event.target.value)}
                      placeholder="Example: PAPER-1042"
                      className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-bold text-[#173f47] outline-none focus:border-[#2aa7a0]"
                    />
                    <span className="mt-2 block text-xs font-semibold text-slate-500">
                      Required for audit and duplicate protection.
                    </span>
                  </label>
                ) : null}

                <div className="mt-2 flex items-center justify-between rounded-2xl bg-[#fff5cf] px-5 py-5">
                  <div>
                    <p className="text-sm font-bold text-slate-600">{operatorIssueOnly ? "Invoice total" : "Provisional total"}</p>
                    <p className="text-sm font-semibold text-slate-500">
                      {operatorIssueOnly ? "Issued unpaid and ready for payment recording" : "Operator completes payment details"}
                    </p>
                  </div>
                  <p className="text-2xl font-black text-[#173f47]">{formatRupees(grandTotal)}</p>
                </div>

                <button
                  type="button"
                  onClick={submitBilling}
                  disabled={isSubmitting}
                  className="mt-6 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-[#17666a] px-6 text-lg font-black text-white shadow-[0_15px_35px_rgba(23,102,106,0.25)] transition active:scale-[0.98] disabled:opacity-60"
                >
                  {isSubmitting ? <LoaderCircle className="size-6 animate-spin" /> : <Send className="size-6" />}
                  {isSubmitting ? "Submitting…" : operatorIssueOnly ? "Issue invoice" : "Submit to operator"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {!isLoading && view === "success" && selectedVisit ? (
          <section className="mx-auto flex min-h-[65svh] max-w-xl items-center">
            <div className="w-full rounded-[2.5rem] border border-white/70 bg-white px-6 py-10 text-center shadow-[0_26px_75px_rgba(23,77,80,0.2)]">
              <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="size-10 stroke-[3]" />
              </span>
              <p className="mt-6 text-sm font-black uppercase tracking-[0.18em] text-emerald-700">
                {lastSubmissionOffline ? "Saved on this device" : "Submission received"}
              </p>
              <h1 className="mt-2 text-3xl font-black text-[#173f47]">
                {lastSubmissionOffline
                  ? "Will send when online"
                  : operatorIssueOnly ? "Invoice issued" : "Sent to the operator"}
              </h1>
              <p className="mt-3 text-base font-semibold leading-7 text-slate-600">
                {selectedVisit.visit_number} · {selectedVisit.patient_identifier}<br />
                {selectedUnitCount ? `${selectedUnitCount} supply unit${selectedUnitCount === 1 ? "" : "s"} recorded` : "Consultation only"}
              </p>
              <div className="mt-7 rounded-2xl bg-[#edf8f6] px-5 py-4 text-left">
                <p className="text-sm font-bold text-slate-500">Current status</p>
                <div className="mt-2"><StatusBadge status={lastSubmissionOffline ? "queued_offline" : operatorIssueOnly ? "ready_for_payment" : "awaiting_operator"} /></div>
              </div>
              <button
                type="button"
                onClick={() => resetFlow("today")}
                className="mt-6 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-[#f2b52b] text-lg font-black text-[#173f47] transition active:scale-[0.98]"
              >
                <Home className="size-5" /> Back to today’s visits
              </button>
            </div>
          </section>
        ) : null}

        {!isLoading && view === "status" ? (
          <section>
            <button
              type="button"
              onClick={() => resetFlow("today")}
              className="mb-5 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white/10 px-4 font-bold text-white transition active:scale-95"
            >
              <ArrowLeft className="size-5" /> Back to billing
            </button>
            <div className="mb-6 flex items-end justify-between gap-4 text-white">
              <div>
                <h1 className="text-3xl font-black tracking-tight">Billing updates</h1>
              </div>
              <button
                type="button"
                onClick={() => setSubmissionRefreshToken((current) => current + 1)}
                className="flex size-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 transition active:scale-95"
                aria-label="Refresh submission status"
              >
                <RefreshCw className="size-5" />
              </button>
            </div>
            <div className="mb-5 grid gap-3 rounded-2xl border border-white/70 bg-white p-4 shadow-[0_12px_35px_rgba(23,77,80,0.12)] sm:grid-cols-[1fr_14rem]">
              <label>
                <span className="sr-only">Search billing updates</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={submissionSearch}
                    onChange={(event) => { setSubmissionSearch(event.target.value); setSubmissionPage(0); }}
                    placeholder="Search patient, OCS or visit number"
                    className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-12 pr-4 font-semibold outline-none focus:border-[#2aa7a0]"
                  />
                </span>
              </label>
              <label>
                <span className="sr-only">Filter billing updates by status</span>
                <select
                  value={submissionStatus}
                  onChange={(event) => { setSubmissionStatus(event.target.value); setSubmissionPage(0); }}
                  className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 font-semibold outline-none focus:border-[#2aa7a0]"
                >
                  <option value="">All statuses</option>
                  <option value="awaiting_operator">Awaiting operator</option>
                  <option value="needs_doctor">Needs clarification</option>
                  <option value="ready_for_payment">Ready for payment</option>
                  <option value="completed">Completed</option>
                  <option value="reversed">Reversed</option>
                </select>
              </label>
            </div>
            {offlineSubmissions.length ? (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <div>
                  <p className="font-black">{offlineSubmissions.length} billing submission{offlineSubmissions.length === 1 ? "" : "s"} waiting to sync</p>
                  <p className="mt-1 text-sm font-semibold">Saved on this device and protected against duplicate submission.</p>
                </div>
                <button
                  type="button"
                  disabled={isSyncingOffline}
                  onClick={async () => {
                    setIsSyncingOffline(true);
                    try { await flushOfflineQueue(); } finally { setIsSyncingOffline(false); }
                  }}
                  className="min-h-11 rounded-xl border border-amber-300 bg-white px-4 text-sm font-black disabled:opacity-50"
                >
                  {isSyncingOffline ? "Syncing…" : "Retry now"}
                </button>
              </div>
            ) : null}
            {displayedSubmissions.length ? (
              <>
              <div className="grid gap-4 md:grid-cols-2">
                {displayedSubmissions.map((submission) => (
                  <article key={submission.id} className="rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(23,77,80,0.08)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-black">{submission.patient_name || submission.patient_masked_name}</p>
                        <p className="mt-1 text-sm font-bold text-slate-500">{submission.patient_identifier} · {submission.visit_number}</p>
                      </div>
                      <StatusBadge status={submission.status} />
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4">
                      <div>
                        <p className="text-sm font-bold text-slate-400">Submitted</p>
                        <p className="mt-1 font-black">{formatSubmittedAt(submission.submitted_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-400">Supplies added</p>
                        <p className="mt-1 font-black">{submission.item_count || "None"}</p>
                      </div>
                    </div>
                    {submission.workflow_note ? (
                      <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-800">
                        Operator note: {submission.workflow_note}
                      </p>
                    ) : null}
                    {submission.sync_error ? (
                      <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-800">
                        {submission.sync_error}
                      </p>
                    ) : null}
                    {submission.offline && submission.status === "needs_attention" ? (
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => editOfflineSubmission(submission.queue_entry)}
                          className="min-h-11 rounded-2xl bg-[#17666a] px-4 text-sm font-black text-white"
                        >
                          Edit submission
                        </button>
                        <button
                          type="button"
                          onClick={() => discardOfflineSubmission(submission.queue_entry)}
                          className="min-h-11 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-black text-rose-800"
                        >
                          Discard
                        </button>
                      </div>
                    ) : null}
                    {submission.items.length ? (
                      <p className="mt-4 line-clamp-2 text-sm font-semibold leading-6 text-slate-600">
                        {submission.items.map((item) => `${item.description} ×${item.quantity}`).join(", ")}
                      </p>
                    ) : !submission.offline ? (
                      <p className="mt-4 text-sm font-semibold text-slate-600">Consultation only · no supplies submitted</p>
                    ) : null}
                    {!submission.offline && submission.item_count > 0 && !["completed", "reversed"].includes(submission.status) ? (
                      <button
                        type="button"
                        disabled={reversingSubmissionId === submission.id}
                        onClick={() => reverseSubmission(submission)}
                        className="mt-4 min-h-11 w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-black text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
                      >
                        {reversingSubmissionId === submission.id ? "Reversing…" : "Reverse incorrect supplies"}
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/90 px-4 py-3 text-sm font-bold text-slate-600">
                <span>{submissionTotal} server submission{submissionTotal === 1 ? "" : "s"}</span>
                <div className="flex gap-2">
                  <button type="button" disabled={submissionPage === 0} onClick={() => setSubmissionPage((current) => Math.max(0, current - 1))} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 disabled:opacity-40">Previous</button>
                  <button type="button" disabled={(submissionPage + 1) * SUBMISSION_PAGE_SIZE >= submissionTotal} onClick={() => setSubmissionPage((current) => current + 1)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 disabled:opacity-40">Next</button>
                </div>
              </div>
              </>
            ) : (
              <EmptyState
                icon={ReceiptText}
                title="No billing submissions yet"
                description="Bills submitted from the quick workflow will appear here with their operator status."
              />
            )}
          </section>
        ) : null}
      </main>
      {paymentBill ? (
        <OperatorPaymentModal bill={paymentBill} busy={paymentBusy} onClose={() => !paymentBusy && setPaymentBill(null)} onConfirm={recordOperatorPayment} onReverse={reverseOperatorPayment} />
      ) : null}
    </div>
  );
}

export default BillingLitePage;
