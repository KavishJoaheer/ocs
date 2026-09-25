import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
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
  X,
} from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import Modal from "../components/Modal.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useKeyboardOffset } from "../hooks/useKeyboardOffset.js";
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
const PATIENT_PICKER_PAGE_SIZE = 60;

function mergePatientOptions(current, incoming) {
  const patients = new Map((current || []).map((patient) => [String(patient.patient_id), {
    ...patient,
    visits: [...(patient.visits || [])],
  }]));
  for (const patient of incoming || []) {
    const key = String(patient.patient_id);
    const existing = patients.get(key);
    if (!existing) {
      patients.set(key, { ...patient, visits: [...(patient.visits || [])] });
      continue;
    }
    const visits = new Map((existing.visits || []).map((visit) => [String(visit.consultation_id), visit]));
    for (const visit of patient.visits || []) visits.set(String(visit.consultation_id), visit);
    patients.set(key, { ...existing, ...patient, visits: [...visits.values()] });
  }
  return [...patients.values()].sort((a, b) => String(a.patient_name || "").localeCompare(String(b.patient_name || ""), undefined, { sensitivity: "base" }));
}

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
  const [maskSizeByItem, setMaskSizeByItem] = useState({});
  const [category, setCategory] = useState("All supplies");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [lookup, setLookup] = useState("");
  const [lookupResults, setLookupResults] = useState([]);
  const [patientOptions, setPatientOptions] = useState([]);
  const [doctorOptions, setDoctorOptions] = useState([]);
  const [billingDoctorId, setBillingDoctorId] = useState("");
  const billingDoctorIdRef = useRef("");
  const [sourceReference, setSourceReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [operatorDoctorConfirmation, setOperatorDoctorConfirmation] = useState(false);
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [visitPickerExpanded, setVisitPickerExpanded] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientSearchResults, setPatientSearchResults] = useState(null);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [patientOptionsHasMore, setPatientOptionsHasMore] = useState(false);
  const [patientSearchHasMore, setPatientSearchHasMore] = useState(false);
  const [patientOptionsOffset, setPatientOptionsOffset] = useState(0);
  const [patientSearchOffset, setPatientSearchOffset] = useState(0);
  const [patientPageLoading, setPatientPageLoading] = useState(false);
  const patientPickerRef = useRef(null);
  const patientSearchInputRef = useRef(null);
  const [visitSearch, setVisitSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedPickerVisitId, setSelectedPickerVisitId] = useState("");
  const [consultationFees, setConsultationFees] = useState({});
  const [billingCutover, setBillingCutover] = useState({ date: null, active: true });
  const [consultationType, setConsultationType] = useState("Day Consultation");
  const [consultationPrice, setConsultationPrice] = useState("2000");
  const [consultationAdjustmentReason, setConsultationAdjustmentReason] = useState("");
  const [supplyPriceEdits, setSupplyPriceEdits] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [offlineSubmissions, setOfflineSubmissions] = useState([]);
  const [editingOfflineEntry, setEditingOfflineEntry] = useState(null);
  const [lastSubmissionOffline, setLastSubmissionOffline] = useState(false);
  const [reversingSubmissionId, setReversingSubmissionId] = useState(null);
  const [workflowDialog, setWorkflowDialog] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    return new Set();
  });
  const keyboardOffset = useKeyboardOffset(patientPickerOpen);

  useEffect(() => {
    document.title = "Billing · OCS Médecins";
  }, []);

  useEffect(() => {
    billingDoctorIdRef.current = billingDoctorId;
  }, [billingDoctorId]);

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
      const pickerQuery = new URLSearchParams({ limit: String(PATIENT_PICKER_PAGE_SIZE), offset: "0" });
      const activeBillingDoctorId = billingDoctorIdRef.current;
      if (operatorIssueOnly && activeBillingDoctorId) pickerQuery.set("doctorId", activeBillingDoctorId);
      const [submissionPayload, pickerPayload, feePayload] = await Promise.all([
        api.get(`/billing/quick/submissions?limit=${SUBMISSION_PAGE_SIZE}&offset=0`),
        api.get(`/billing/quick/picker-options?${pickerQuery.toString()}`),
        api.get("/billing/consultation-fees"),
      ]);
      setSubmissions(Array.isArray(submissionPayload?.submissions) ? submissionPayload.submissions : []);
      setSubmissionTotal(Number(submissionPayload?.total || 0));
      setSubmissionPage(0);
      setPatientOptions(Array.isArray(pickerPayload?.patients) ? pickerPayload.patients : []);
      setPatientOptionsHasMore(Boolean(pickerPayload?.has_more));
      setPatientOptionsOffset(Number(pickerPayload?.next_offset || 0));
      setDoctorOptions(Array.isArray(pickerPayload?.doctors) ? pickerPayload.doctors : []);
      setBillingCutover({
        date: pickerPayload?.cutover_date || null,
        active: pickerPayload?.billing_active !== false,
      });
      setConsultationFees(feePayload || {});
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
    setPatientOptionsHasMore(false);
    setPatientOptionsOffset(0);
    setPatientSearchResults(null);
    setPatientSearchHasMore(false);
    setPatientSearchOffset(0);
    setSelectedPatientId("");
    setSelectedPickerVisitId("");
    setSelectedVisit(null);
    setSourceReference("");
    setPaymentMethod("");
    setPaymentReference("");
    setPaymentDate(dayjs().format("YYYY-MM-DD"));
    setOperatorDoctorConfirmation(false);
    if (!doctorId) return;
    setIsCatalogLoading(true);
    try {
      const query = new URLSearchParams({ doctorId, limit: String(PATIENT_PICKER_PAGE_SIZE), offset: "0" });
      const payload = await api.get(`/billing/quick/picker-options?${query.toString()}`);
      setPatientOptions(Array.isArray(payload?.patients) ? payload.patients : []);
      setPatientOptionsHasMore(Boolean(payload?.has_more));
      setPatientOptionsOffset(Number(payload?.next_offset || 0));
      if (Array.isArray(payload?.doctors)) setDoctorOptions(payload.doctors);
      setBillingCutover({
        date: payload?.cutover_date || null,
        active: payload?.billing_active !== false,
      });
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
      patientSearchInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [patientPickerOpen]);

  useEffect(() => {
    if (!patientPickerOpen) return undefined;
    function closePicker(event) {
      if (event.key === "Escape") setPatientPickerOpen(false);
    }
    window.addEventListener("keydown", closePicker);
    return () => window.removeEventListener("keydown", closePicker);
  }, [patientPickerOpen]);

  useEffect(() => {
    if (!patientPickerOpen || !window.matchMedia("(max-width: 767px)").matches) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [patientPickerOpen]);

  useEffect(() => {
    const needle = patientSearch.trim();
    if (!patientPickerOpen || needle.length < 2 || (operatorIssueOnly && !billingDoctorId)) {
      setPatientSearchResults(null);
      setPatientSearchHasMore(false);
      setPatientSearchOffset(0);
      setPatientSearchLoading(false);
      return undefined;
    }
    let ignore = false;
    setPatientSearchLoading(true);
    setPatientSearchResults([]);
    const timeout = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ search: needle, limit: String(PATIENT_PICKER_PAGE_SIZE), offset: "0" });
        if (operatorIssueOnly) query.set("doctorId", billingDoctorId);
        const payload = await api.get(`/billing/quick/picker-options?${query.toString()}`);
        if (!ignore) {
          setPatientSearchResults(Array.isArray(payload?.patients) ? payload.patients : []);
          setPatientSearchHasMore(Boolean(payload?.has_more));
          setPatientSearchOffset(Number(payload?.next_offset || 0));
        }
      } catch (error) {
        if (!ignore) toast.error(error.message || "Patient search could not be completed.");
      } finally {
        if (!ignore) setPatientSearchLoading(false);
      }
    }, 250);
    return () => {
      ignore = true;
      window.clearTimeout(timeout);
    };
  }, [billingDoctorId, operatorIssueOnly, patientPickerOpen, patientSearch]);

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
      .filter((item) => showUnavailable || (
        item.is_service_charge
          ? true
          : Number(item.available_to_use || 0) > 0 && item.cost_price_ready && Number(item.selling_price || 0) > 0
      ))
      .sort((a, b) => {
        const bAvailable = b.is_service_charge
          ? true
          : Number(b.available_to_use || 0) > 0 && b.cost_price_ready && Number(b.selling_price || 0) > 0;
        const aAvailable = a.is_service_charge
          ? true
          : Number(a.available_to_use || 0) > 0 && a.cost_price_ready && Number(a.selling_price || 0) > 0;
        const availabilityDifference = Number(bAvailable) - Number(aAvailable);
        return availabilityDifference || a.item_name.localeCompare(b.item_name);
      });
  }, [matchingCatalog, showUnavailable]);

  const unavailableCount = useMemo(
    () => matchingCatalog.filter((item) => item.is_service_charge
      ? false
      : Number(item.available_to_use || 0) < 1 || !item.cost_price_ready || Number(item.selling_price || 0) <= 0).length,
    [matchingCatalog],
  );

  const selectedItems = useMemo(
    () =>
      catalog
        .filter((item) => Number(cart[item.id] || 0) > 0)
        .map((item) => ({ ...item, quantity: Number(cart[item.id]) })),
    [catalog, cart],
  );

  function reviewedSupplyPrice(item) {
    const edited = supplyPriceEdits[item.id]?.price;
    return Number(edited === undefined ? item.selling_price || 0 : edited);
  }

  function supplyPriceWasAdjusted(item) {
    return Math.abs(reviewedSupplyPrice(item) - Number(item.selling_price || 0)) >= 0.005;
  }

  function validatePriceAdjustments() {
    const consultationAmount = Number(consultationPrice);
    if (!Number.isFinite(consultationAmount) || consultationAmount <= 0 || consultationAmount > MAX_CONSULTATION_FEE) {
      return `Enter a consultation price above Rs 0 and no more than Rs ${MAX_CONSULTATION_FEE.toLocaleString("en-MU")}.`;
    }
    const configuredAmount = Number(consultationFees[consultationType] || 0);
    if (Math.abs(consultationAmount - configuredAmount) >= 0.005 && consultationAdjustmentReason.trim().length < 8) {
      return "Explain the consultation price adjustment in at least 8 characters.";
    }
    for (const item of selectedItems) {
      const price = reviewedSupplyPrice(item);
      if (!Number.isFinite(price) || price <= 0) {
        return `Enter a valid positive price for ${item.item_name}.`;
      }
      if (supplyPriceWasAdjusted(item) && String(supplyPriceEdits[item.id]?.reason || "").trim().length < 8) {
        return `Explain the price adjustment for ${item.item_name} in at least 8 characters.`;
      }
      if (item.requires_mask && !["adult", "paediatric"].includes(maskSizeByItem[item.id])) {
        return `Choose Adult or Paediatric face mask for ${item.item_name}.`;
      }
    }
    return "";
  }

  const selectedPatient = useMemo(
    () => patientOptions.find((patient) => String(patient.patient_id) === String(selectedPatientId)) || null,
    [patientOptions, selectedPatientId],
  );

  const filteredPatientOptions = useMemo(() => {
    if (patientSearchResults) return patientSearchResults;
    const needle = patientSearch.trim().toLowerCase();
    if (!needle) return patientOptions;
    return patientOptions.filter((patient) =>
      String(patient.patient_name || "").toLowerCase().includes(needle) ||
      String(patient.patient_identifier || "").toLowerCase().includes(needle),
    );
  }, [patientOptions, patientSearch, patientSearchResults]);

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
    (sum, item) => sum + reviewedSupplyPrice(item) * item.quantity,
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
    setSupplyPriceEdits({});
    setSourceReference("");
    setPaymentMethod("");
    setPaymentReference("");
    setPaymentDate(dayjs().format("YYYY-MM-DD"));
    setOperatorDoctorConfirmation(false);
    setCart({});
    setCatalog([]);
    setCatalogSearch("");
    setShowUnavailable(false);
    await openCatalog(visit);
  }

  function choosePatient(patient) {
    setPatientOptions((current) => mergePatientOptions(current, [patient]));
    setSelectedPatientId(String(patient.patient_id));
    setSelectedPickerVisitId(patient.visits?.length === 1 ? String(patient.visits[0].consultation_id) : "");
    setVisitSearch("");
    setPatientPickerOpen(false);
    setPatientSearch("");
    setPatientSearchResults(null);
  }

  async function loadMorePatients() {
    if (patientPageLoading || (operatorIssueOnly && !billingDoctorId)) return;
    const search = patientSearch.trim();
    const searching = search.length >= 2 && patientSearchResults !== null;
    setPatientPageLoading(true);
    try {
      const query = new URLSearchParams({
        limit: String(PATIENT_PICKER_PAGE_SIZE),
        offset: String(searching ? patientSearchOffset : patientOptionsOffset),
      });
      if (searching) query.set("search", search);
      if (operatorIssueOnly) query.set("doctorId", billingDoctorId);
      const payload = await api.get(`/billing/quick/picker-options?${query.toString()}`);
      const incoming = Array.isArray(payload?.patients) ? payload.patients : [];
      if (searching) {
        setPatientSearchResults((existing) => mergePatientOptions(existing || [], incoming));
        setPatientSearchHasMore(Boolean(payload?.has_more));
        setPatientSearchOffset(Number(payload?.next_offset || patientSearchOffset));
      } else {
        setPatientOptions((existing) => mergePatientOptions(existing, incoming));
        setPatientOptionsHasMore(Boolean(payload?.has_more));
        setPatientOptionsOffset(Number(payload?.next_offset || patientOptionsOffset));
      }
    } catch (error) {
      toast.error(error.message || "More billable visits could not be loaded.");
    } finally {
      setPatientPageLoading(false);
    }
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
    const priceError = validatePriceAdjustments();
    if (priceError) {
      toast.error(priceError);
      return;
    }
    setView("review");
  }

  function changeQuantity(item, delta) {
    if (item.is_service_charge) {
      setCart((current) => ({
        ...current,
        [item.id]: Math.max(0, Number(current[item.id] || 0) + delta),
      }));
      return;
    }
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
    const priceError = validatePriceAdjustments();
    if (priceError) {
      toast.error(priceError);
      return;
    }
    if (sourceReference.trim().length < 3) {
      toast.error("Enter the manual invoice receipt reference.");
      return;
    }
    if (!["cash", "juice", "card", "ib"].includes(paymentMethod)) {
      toast.error("Select the payment method.");
      return;
    }
    if (!paymentDate || dayjs(paymentDate).isAfter(dayjs(), "day")) {
      toast.error("Select a valid payment date that is not in the future.");
      return;
    }
    if (paymentMethod !== "cash" && paymentReference.trim().length < 3) {
      toast.error("Enter the Juice, card, or IB transaction reference.");
      return;
    }
    if (operatorIssueOnly && !operatorDoctorConfirmation) {
      toast.error('Select "Raise invoice by Doctor" before issuing.');
      return;
    }
    setIsSubmitting(true);
    const endpoint = `/billing/quick/visits/${selectedVisit.consultation_id}/capture`;
    const submissionPayload = {
      operation_id: editingOfflineEntry?.payload?.operation_id || crypto.randomUUID(),
      doctor_id: operatorIssueOnly ? Number(billingDoctorId) : undefined,
      source_reference: sourceReference.trim(),
      payment_method: paymentMethod,
      payment_date: paymentDate,
      payment_reference: paymentReference.trim() || undefined,
      raised_by_doctor: operatorIssueOnly ? operatorDoctorConfirmation : undefined,
      consultation_fee: {
        type: consultationType,
        amount: Number(consultationPrice),
        adjustment_reason: consultationAdjustmentReason.trim() || undefined,
      },
      items: selectedItems.map((item) => ({
        inventory_item_id: item.id,
        quantity: item.quantity,
        unit_price: reviewedSupplyPrice(item),
        price_adjustment_reason: supplyPriceWasAdjusted(item)
          ? String(supplyPriceEdits[item.id]?.reason || "").trim()
          : undefined,
        mask_size: item.requires_mask ? maskSizeByItem[item.id] : undefined,
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
      toast.success("Invoice issued and payment recorded.");
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
              doctorId: Number(selectedVisit.doctor_id || billingDoctorId || 0) || null,
              visitNumber: selectedVisit.visit_number,
              patientName: selectedVisit.patient_name || selectedVisit.patient_masked_name,
              patientIdentifier: selectedVisit.patient_identifier || "",
              sourceReference: sourceReference.trim() || "",
              paymentMethod,
              paymentDate,
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

  async function reverseSubmission(submission, reasonInput) {
    const reason = String(reasonInput || "").trim();
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
      setWorkflowDialog(null);
      await loadDashboard({ silent: true });
      toast.success("Supplies reversed. The stock and bill audit trails were updated.");
    } catch (error) {
      toast.error(error.message || "The submitted supplies could not be reversed.");
    } finally {
      setReversingSubmissionId(null);
    }
  }

  async function editOfflineSubmission(queueEntry) {
    const consultationId = Number(queueEntry.payload?.consultation_id || queueEntry.meta?.consultationId || 0);
    const queuedDoctorId = Number(queueEntry.payload?.doctor_id || queueEntry.meta?.doctorId || 0);
    if (!Number.isInteger(consultationId) || consultationId <= 0) {
      toast.error("This saved submission is missing its consultation reference and cannot be edited safely.");
      return;
    }
    setIsCatalogLoading(true);
    try {
      const doctorQuery = operatorIssueOnly
        ? `?doctorId=${encodeURIComponent(queuedDoctorId || billingDoctorId || "")}`
        : "";
      const payload = await api.get(`/billing/quick/catalog/${consultationId}${doctorQuery}`);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const visit = payload?.visit;
      if (!visit) throw new Error("The saved consultation could not be loaded.");
      const fee = queueEntry.payload?.consultation_fee || {};
      const nextCart = {};
      const nextSupplyPriceEdits = {};
      for (const savedItem of queueEntry.payload?.items || []) {
        const catalogItem = items.find((item) => Number(item.id) === Number(savedItem.inventory_item_id));
        if (catalogItem) {
          nextCart[Number(savedItem.inventory_item_id)] = Number(savedItem.quantity || 0);
          const savedPrice = Number(savedItem.unit_price);
          if (Number.isFinite(savedPrice) && Math.abs(savedPrice - Number(catalogItem.selling_price || 0)) >= 0.005) {
            nextSupplyPriceEdits[Number(savedItem.inventory_item_id)] = {
              price: String(savedPrice),
              reason: String(savedItem.price_adjustment_reason || ""),
            };
          }
        }
      }
      setCatalog(items);
      setCart(nextCart);
      setSupplyPriceEdits(nextSupplyPriceEdits);
      setSelectedVisit(visit);
      setConsultationType(fee.type || visit.consultation_fee?.type || "Day Consultation");
      setConsultationPrice(String(fee.amount ?? visit.consultation_fee?.amount ?? 0));
      setConsultationAdjustmentReason(String(fee.adjustment_reason || ""));
      if (operatorIssueOnly) {
        setBillingDoctorId(String(queuedDoctorId || visit.doctor_id || ""));
      }
      setSourceReference(String(queueEntry.payload?.source_reference || queueEntry.meta?.sourceReference || ""));
      setPaymentMethod(String(queueEntry.payload?.payment_method || queueEntry.meta?.paymentMethod || ""));
      setPaymentReference(String(queueEntry.payload?.payment_reference || ""));
      setPaymentDate(String(queueEntry.payload?.payment_date || queueEntry.meta?.paymentDate || dayjs().format("YYYY-MM-DD")));
      setOperatorDoctorConfirmation(Boolean(queueEntry.payload?.raised_by_doctor));
      setEditingOfflineEntry(queueEntry);
      setView("catalog");
      toast.success("Saved submission opened for correction. Review it before submitting again.");
    } catch (error) {
      toast.error(error.message || "This saved submission could not be opened. Retry after checking the consultation or discard it if no bill is required.");
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
    setSupplyPriceEdits({});
    setLookupResults([]);
    setCatalogSearch("");
    setLastSubmissionOffline(false);
    setEditingOfflineEntry(null);
    setSourceReference("");
    setPaymentMethod("");
    setPaymentReference("");
    setPaymentDate(dayjs().format("YYYY-MM-DD"));
    setOperatorDoctorConfirmation(false);
    setConsultationAdjustmentReason("");
    setPatientPickerOpen(false);
    setVisitPickerExpanded(false);
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

            {!billingCutover.active && billingCutover.date ? (
              <div className="relative z-20 mb-4 rounded-[1.5rem] border border-amber-300 bg-amber-50 px-5 py-4 text-amber-950 shadow-sm" role="status">
                <p className="font-black">Live billing begins {dayjs(billingCutover.date).format("D MMMM YYYY")}</p>
                <p className="mt-1 text-sm font-semibold">
                  Visits before the cutover remain closed so trial activity cannot enter the live financial ledger.
                </p>
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
                  {priorityVisits.length - 4} more billable {priorityVisits.length - 4 === 1 ? "visit" : "visits"} available.
                </p>
              ) : null}
              {priorityVisits.length ? (
                <button
                  type="button"
                  onClick={() => setVisitPickerExpanded((expanded) => !expanded)}
                  className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#b9e3df] bg-white font-black text-[#17666a] transition active:scale-[0.98] md:hidden"
                  aria-expanded={visitPickerExpanded}
                  aria-controls="billing-visit-picker"
                >
                  <Search className="size-4" aria-hidden="true" />
                  {visitPickerExpanded ? "Hide patient search" : "Find another visit"}
                  <ChevronDown className={`size-4 transition ${visitPickerExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div
              id="billing-visit-picker"
              className={`relative z-20 mb-6 rounded-[2rem] border border-white/70 bg-white p-5 shadow-[0_16px_45px_rgba(23,77,80,0.15)] md:block md:p-6 ${priorityVisits.length && !visitPickerExpanded ? "hidden" : "block"}`}
            >
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
                    <>
                      <button
                        type="button"
                        onClick={() => setPatientPickerOpen(false)}
                        className="billing-patient-picker-backdrop fixed inset-0 z-[60] bg-slate-950/20 md:hidden"
                        aria-label="Close patient search"
                      />
                      <div
                        className="billing-patient-picker-panel z-[70] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_55px_rgba(15,50,55,0.2)]"
                        style={{
                          "--billing-picker-bottom-clearance": keyboardOffset.bottom > 0
                            ? `${keyboardOffset.bottom + 8}px`
                            : "calc(var(--ocs-mobile-nav-clearance, 5.5rem) + 0.5rem)",
                          "--billing-viewport-top": `${keyboardOffset.top}px`,
                        }}
                      >
                        <div className="shrink-0 border-b border-slate-100 p-3">
                          <div className="mb-2 flex items-center justify-between gap-3 md:hidden">
                            <p className="font-black text-[#173f47]">Find a patient</p>
                            <button
                              type="button"
                              onClick={() => setPatientPickerOpen(false)}
                              className="flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600"
                              aria-label="Close patient search"
                            >
                              <X className="size-5" aria-hidden="true" />
                            </button>
                          </div>
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                            <input
                              ref={patientSearchInputRef}
                              value={patientSearch}
                              onChange={(event) => setPatientSearch(event.target.value)}
                              placeholder="Type patient name or OCS number"
                              enterKeyHint="search"
                              autoComplete="off"
                              className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 font-semibold text-[#173f47] outline-none focus:border-[#2aa7a0] focus:bg-white"
                            />
                          </div>
                          <p className="mt-2 px-1 text-xs font-bold text-slate-500">
                            {patientSearchLoading
                              ? "Searching all billable visits…"
                              : `${filteredPatientOptions.length} ${filteredPatientOptions.length === 1 ? "patient" : "patients"} from your billable visits`}
                          </p>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="listbox" aria-label="Patients with consultations ready to bill">
                          {patientSearchLoading ? (
                            <p className="px-4 py-8 text-center text-sm font-semibold text-slate-500">Searching patients…</p>
                          ) : filteredPatientOptions.length ? filteredPatientOptions.map((patient) => (
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
                            <p className="px-4 py-8 text-center text-sm font-semibold text-slate-500">
                              No matching patient with a completed billable consultation.
                            </p>
                          )}
                          {(patientSearch.trim().length >= 2 && patientSearchResults !== null ? patientSearchHasMore : patientOptionsHasMore) ? (
                            <div className="sticky bottom-0 border-t border-slate-100 bg-white/95 p-3 backdrop-blur">
                              <button
                                type="button"
                                disabled={patientPageLoading}
                                onClick={() => void loadMorePatients()}
                                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#eff8f7] px-4 text-sm font-black text-[#17666a] disabled:opacity-50"
                              >
                                {patientPageLoading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
                                {patientPageLoading ? "Loading…" : "Load more billable visits"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
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
          <section className="billing-mobile-action-space">
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
                <div className="rounded-xl bg-[#edf8f6] px-4 py-3 sm:min-w-40 sm:text-right">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Standard price</p>
                  <p className="mt-0.5 text-lg font-black text-[#17666a]">{formatRupees(consultationFees[consultationType] || 0)}</p>
                </div>
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-500">Confirm or adjust prices once on the final review screen. Maximum consultation price: Rs 4,500.</p>
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
                  const isUnavailable = item.is_service_charge ? false : available < 1 || priceMissing;
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
                          <p className={`text-lg font-black ${isUnavailable ? "text-slate-400" : "text-[#17666a]"}`}>{item.is_service_charge && Number(item.selling_price || 0) <= 0 ? "Set at review" : formatRupees(item.selling_price)}</p>
                          <p className={`mt-1 text-sm font-bold ${isUnavailable ? "text-rose-600" : "text-slate-500"}`}>
                            {item.included_label
                              ? `From the bag: ${item.included_label}`
                              : item.is_service_charge && Number(item.selling_price || 0) <= 0
                                ? "Price and reason required"
                                : priceMissing
                                  ? "Pricing required"
                                  : item.is_service_charge
                                    ? "Non-stock service"
                                    : isUnavailable
                                      ? "Out of stock"
                                      : `${available} ${item.unit}${available === 1 ? "" : "s"}`}
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
          <section className="billing-mobile-action-space mx-auto max-w-2xl">
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
                <div className="grid gap-4 border-b border-slate-200 pb-5 sm:grid-cols-[1fr_11rem]">
                  <div className="min-w-0">
                    <p className="text-lg font-black">{consultationType}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      Standard tariff: {formatRupees(consultationFees[consultationType] || 0)}
                    </p>
                  </div>
                  <label>
                    <span className="text-xs font-black uppercase tracking-wide text-slate-500">Consultation price</span>
                    <span className="relative mt-1 block">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-500">Rs</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max={MAX_CONSULTATION_FEE}
                        step="0.01"
                        value={consultationPrice}
                        onChange={(event) => setConsultationPrice(event.target.value)}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-right font-black text-[#173f47] outline-none focus:border-[#2aa7a0]"
                      />
                    </span>
                  </label>
                  {Math.abs(Number(consultationPrice || 0) - Number(consultationFees[consultationType] || 0)) >= 0.005 ? (
                    <label className="sm:col-span-2">
                      <span className="text-sm font-black text-amber-900">Reason for consultation price adjustment <span aria-hidden="true">*</span></span>
                      <textarea
                        required
                        minLength={8}
                        rows={2}
                        value={consultationAdjustmentReason}
                        onChange={(event) => setConsultationAdjustmentReason(event.target.value)}
                        placeholder="Explain why the standard consultation price was changed."
                        className="mt-2 w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold outline-none focus:border-amber-500"
                      />
                      <span className="mt-1 block text-xs font-semibold text-amber-800">Required · minimum 8 characters · saved in the audit history</span>
                    </label>
                  ) : null}
                </div>

                {selectedItems.length ? (
                  <div className="divide-y divide-slate-100">
                    {selectedItems.map((item) => (
                      <div key={item.id} className="grid gap-3 py-5 sm:grid-cols-[1fr_11rem] sm:items-start">
                        <div className="min-w-0">
                          <p className="font-black text-[#173f47]">{item.item_name}</p>
                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            Quantity {item.quantity} · Standard price {formatRupees(item.selling_price)}
                          </p>
                          {item.included_label ? (
                            <p className="mt-1 text-sm font-semibold text-[#17666a]">From the bag: {item.quantity} × {item.included_label}</p>
                          ) : null}
                          {item.requires_mask ? (
                            <label className="mt-3 block">
                              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Face mask</span>
                              <select
                                value={maskSizeByItem[item.id] || ""}
                                onChange={(event) => setMaskSizeByItem((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))}
                                className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-[#173f47] outline-none focus:border-[#2aa7a0]"
                              >
                                <option value="">Choose face mask</option>
                                <option value="adult">Adult face mask</option>
                                <option value="paediatric">Paediatric face mask</option>
                              </select>
                            </label>
                          ) : null}
                        </div>
                        <label>
                          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Unit price</span>
                          <span className="relative mt-1 block">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-500">Rs</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0.01"
                              step="0.01"
                              value={supplyPriceEdits[item.id]?.price ?? String(item.selling_price || 0)}
                              onChange={(event) => setSupplyPriceEdits((current) => ({
                                ...current,
                                [item.id]: {
                                  price: event.target.value,
                                  reason: current[item.id]?.reason || "",
                                },
                              }))}
                              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-right font-black text-[#173f47] outline-none focus:border-[#2aa7a0]"
                            />
                          </span>
                          <span className="mt-1 block text-right text-xs font-bold text-slate-500">
                            Line total {formatRupees(reviewedSupplyPrice(item) * item.quantity)}
                          </span>
                        </label>
                        {supplyPriceWasAdjusted(item) ? (
                          <label className="sm:col-span-2">
                            <span className="text-sm font-black text-amber-900">Reason for {item.item_name} price adjustment <span aria-hidden="true">*</span></span>
                            <textarea
                              required
                              minLength={8}
                              rows={2}
                              value={supplyPriceEdits[item.id]?.reason || ""}
                              onChange={(event) => setSupplyPriceEdits((current) => ({
                                ...current,
                                [item.id]: {
                                  price: current[item.id]?.price ?? String(item.selling_price || 0),
                                  reason: event.target.value,
                                },
                              }))}
                              placeholder="Explain why the standard supply price was changed."
                              className="mt-2 w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold outline-none focus:border-amber-500"
                            />
                            <span className="mt-1 block text-xs font-semibold text-amber-800">Required · minimum 8 characters · saved with this invoice</span>
                          </label>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="my-5 rounded-2xl bg-[#edf8f6] px-5 py-4">
                    <p className="font-black text-[#17666a]">Consultation only</p>
                    <p className="mt-1 text-sm font-semibold text-slate-600">No treatment supplies will be taken from the bag.</p>
                  </div>
                )}

                <div className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block">
                    <span className="text-sm font-black text-slate-700">Manual invoice receipt reference</span>
                    <input
                      value={sourceReference}
                      onChange={(event) => setSourceReference(event.target.value)}
                      placeholder="Example: RECEIPT-1042"
                      className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-bold text-[#173f47] outline-none focus:border-[#2aa7a0]"
                    />
                    <span className="mt-2 block text-xs font-semibold text-slate-500">
                      Required for audit and duplicate-invoice protection.
                    </span>
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-black text-slate-700">Payment method</span>
                      <select
                        value={paymentMethod}
                        onChange={(event) => {
                          setPaymentMethod(event.target.value);
                          if (event.target.value === "cash") setPaymentReference("");
                        }}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-bold text-[#173f47] outline-none focus:border-[#2aa7a0]"
                      >
                        <option value="">Select method</option>
                        <option value="cash">Cash</option>
                        <option value="juice">Juice</option>
                        <option value="card">Card</option>
                        <option value="ib">Internet Banking</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-black text-slate-700">Payment date</span>
                      <input
                        type="date"
                        max={dayjs().format("YYYY-MM-DD")}
                        value={paymentDate}
                        onChange={(event) => setPaymentDate(event.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-bold text-[#173f47] outline-none focus:border-[#2aa7a0]"
                      />
                    </label>
                  </div>

                  {paymentMethod && paymentMethod !== "cash" ? (
                    <label className="block">
                      <span className="text-sm font-black text-slate-700">Payment transaction reference</span>
                      <input
                        value={paymentReference}
                        onChange={(event) => setPaymentReference(event.target.value)}
                        placeholder={paymentMethod === "juice" ? "Juice transaction reference" : paymentMethod === "card" ? "Card transaction reference" : "Bank transfer reference"}
                        className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-bold text-[#173f47] outline-none focus:border-[#2aa7a0]"
                      />
                    </label>
                  ) : null}

                  {operatorIssueOnly ? (
                    <label className="flex items-start gap-3 rounded-xl border border-[#b9e3df] bg-[#edf8f6] px-4 py-3 text-sm font-bold text-[#173f47]">
                      <input
                        type="checkbox"
                        checked={operatorDoctorConfirmation}
                        onChange={(event) => setOperatorDoctorConfirmation(event.target.checked)}
                        className="mt-1 size-4"
                      />
                      <span>
                        Raise invoice by Doctor
                        <span className="mt-1 block text-xs font-semibold text-slate-600">
                          I confirm this invoice is being raised on behalf of {selectedVisit.doctor_name || "the selected consultation doctor"}.
                        </span>
                      </span>
                    </label>
                  ) : null}
                </div>

                <div className="mt-2 flex items-center justify-between rounded-2xl bg-[#fff5cf] px-5 py-5">
                  <div>
                    <p className="text-sm font-bold text-slate-600">Invoice total</p>
                    <p className="text-sm font-semibold text-slate-500">
                      Payment is recorded when the invoice is issued
                    </p>
                  </div>
                  <p className="text-2xl font-black text-[#173f47]">{formatRupees(grandTotal)}</p>
                </div>

                <button
                  type="button"
                  onClick={submitBilling}
                  disabled={isSubmitting}
                  className="mt-6 hidden min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-[#17666a] px-6 text-lg font-black text-white shadow-[0_15px_35px_rgba(23,102,106,0.25)] transition active:scale-[0.98] disabled:opacity-60 md:flex"
                >
                  {isSubmitting ? <LoaderCircle className="size-6 animate-spin" /> : <Send className="size-6" />}
                  {isSubmitting ? "Issuing…" : "Issue invoice"}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={submitBilling}
              disabled={isSubmitting}
              className="billing-integrated-review-bar fixed left-1/2 z-30 flex min-h-16 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center justify-between rounded-[1.4rem] bg-[#17666a] px-5 text-white shadow-[0_20px_50px_rgba(23,63,71,0.3)] transition active:scale-[0.98] disabled:opacity-60 md:hidden"
              aria-label={`Issue invoice for ${formatRupees(grandTotal)}`}
            >
              <span className="text-left">
                <span className="block text-xs font-bold text-white/70">Invoice total</span>
                <span className="block text-lg font-black">{formatRupees(grandTotal)}</span>
              </span>
              <span className="flex items-center gap-2 text-base font-black">
                {isSubmitting ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Send className="size-5" aria-hidden="true" />}
                {isSubmitting ? "Issuing…" : "Issue invoice"}
              </span>
            </button>
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
                  : "Invoice issued"}
              </h1>
              <p className="mt-3 text-base font-semibold leading-7 text-slate-600">
                {selectedVisit.visit_number} · {selectedVisit.patient_identifier}<br />
                {selectedUnitCount ? `${selectedUnitCount} supply unit${selectedUnitCount === 1 ? "" : "s"} recorded` : "Consultation only"}
              </p>
              <div className="mt-7 rounded-2xl bg-[#edf8f6] px-5 py-4 text-left">
                <p className="text-sm font-bold text-slate-500">Current status</p>
                <div className="mt-2"><StatusBadge status={lastSubmissionOffline ? "queued_offline" : "completed"} /></div>
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
                        onClick={() => setWorkflowDialog({ kind: "reversal", submission, reason: "" })}
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
      {workflowDialog ? (
        <Modal
          open
          onClose={() => !reversingSubmissionId && setWorkflowDialog(null)}
          title="Reverse incorrect supplies"
          size="md"
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void reverseSubmission(workflowDialog.submission, workflowDialog.reason);
            }}
          >
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="font-black text-slate-950">{workflowDialog.submission.patient_name}</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {workflowDialog.submission.patient_identifier} · {workflowDialog.submission.visit_number}
              </p>
              <p className="mt-3 text-sm font-bold text-slate-700">
                {workflowDialog.submission.item_count || 0} supplied item{Number(workflowDialog.submission.item_count || 0) === 1 ? "" : "s"} · {formatRupees(workflowDialog.submission.amount_added)}
              </p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold leading-6 text-rose-900">
              This restores eligible stock, removes the supply charges, and records an immutable reversal event. It does not erase the original submission.
            </div>
            <label className="block text-sm font-black text-slate-800">
              Reason for reversal
              <textarea
                autoFocus
                required
                minLength={5}
                rows={3}
                value={workflowDialog.reason}
                onChange={(event) => setWorkflowDialog((current) => ({ ...current, reason: event.target.value }))}
                placeholder="Describe the incorrect supply entry."
                className="mt-2 w-full rounded-xl border border-slate-200 p-3 font-semibold outline-none focus:border-[#2aa7a0]"
              />
            </label>
            <div className="flex justify-end gap-3">
              <button type="button" disabled={Boolean(reversingSubmissionId)} onClick={() => setWorkflowDialog(null)} className="min-h-11 rounded-xl border border-slate-200 px-4 font-bold">Cancel</button>
              <button
                type="submit"
                disabled={Boolean(reversingSubmissionId) || workflowDialog.reason.trim().length < 5}
                className="min-h-11 rounded-xl bg-rose-700 px-4 font-black text-white disabled:opacity-50"
              >
                {reversingSubmissionId ? "Reversing…" : "Confirm reversal"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

export default BillingLitePage;
