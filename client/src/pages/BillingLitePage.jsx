import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
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
  Stethoscope,
} from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";

const NAV_ITEMS = [
  { id: "today", label: "Today", icon: Home },
  { id: "find", label: "Find visit", icon: Search },
  { id: "status", label: "Status", icon: ReceiptText },
];

const STATUS_META = {
  ready: { label: "Ready to bill", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  awaiting_operator: { label: "Awaiting operator", className: "bg-cyan-50 text-cyan-800 ring-cyan-200" },
  needs_doctor: { label: "Needs clarification", className: "bg-rose-50 text-rose-800 ring-rose-200" },
  ready_for_payment: { label: "Ready for payment", className: "bg-violet-50 text-violet-800 ring-violet-200" },
  completed: { label: "Completed", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
};

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

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.ready;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ring-1 ring-inset ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function VisitCard({ visit, onSelect }) {
  const canOpen = Boolean(visit.can_submit);
  return (
    <article className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-[0_16px_45px_rgba(23,77,80,0.08)]">
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => canOpen && onSelect(visit)}
        className="flex min-h-36 w-full items-stretch text-left disabled:cursor-default"
      >
        <span className="flex w-20 shrink-0 flex-col items-center justify-center bg-[#e8f8f6] text-[#15666a]">
          <span className="text-sm font-extrabold uppercase tracking-wide">{formatVisitDate(visit.visit_date).split(",")[0]}</span>
          <span className="mt-1 text-xl font-black tabular-nums">{formatVisitTime(visit.visit_time)}</span>
        </span>
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3 px-5 py-4">
          <span className="min-w-0">
            <span className="block text-lg font-black text-[#173f47]">{visit.patient_masked_name}</span>
            <span className="mt-1 block text-sm font-bold text-slate-500">
              {visit.patient_identifier} · {visit.visit_number}
            </span>
            <span className="mt-3 inline-flex"><StatusBadge status={visit.submission_status} /></span>
          </span>
          {canOpen ? (
            <ChevronRight className="size-7 shrink-0 text-[#248f91]" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-7 shrink-0 text-emerald-600" aria-hidden="true" />
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

function BillingLitePage({ onOpenHistory }) {
  const { user } = useAuth();
  const [view, setView] = useState("today");
  const [visits, setVisits] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [cart, setCart] = useState({});
  const [category, setCategory] = useState("Favourites");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [lookup, setLookup] = useState("");
  const [lookupResults, setLookupResults] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      const [visitPayload, submissionPayload] = await Promise.all([
        api.get("/billing/quick/visits"),
        api.get("/billing/quick/submissions"),
      ]);
      setVisits(Array.isArray(visitPayload?.visits) ? visitPayload.visits : []);
      setSubmissions(Array.isArray(submissionPayload?.submissions) ? submissionPayload.submissions : []);
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
    if (!user?.id) return;
    window.localStorage.setItem(
      `ocs-billing-lite-favourites:${user.id}`,
      JSON.stringify([...favorites]),
    );
  }, [favorites, user?.id]);

  const categories = useMemo(() => {
    const names = new Set(catalog.map((item) => item.subcategory || item.category).filter(Boolean));
    return ["Favourites", "All supplies", ...[...names].sort((a, b) => a.localeCompare(b))];
  }, [catalog]);

  const visibleCatalog = useMemo(() => {
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

  const selectedItems = useMemo(
    () =>
      catalog
        .filter((item) => Number(cart[item.id] || 0) > 0)
        .map((item) => ({ ...item, quantity: Number(cart[item.id]) })),
    [catalog, cart],
  );

  const supplyTotal = selectedItems.reduce(
    (sum, item) => sum + Number(item.selling_price || 0) * item.quantity,
    0,
  );
  const consultationTotal = Number(selectedVisit?.consultation_fee?.amount || 0);
  const grandTotal = consultationTotal + supplyTotal;
  const selectedUnitCount = selectedItems.reduce((sum, item) => sum + item.quantity, 0);

  async function chooseVisit(visit) {
    if (!visit?.can_submit) {
      toast.error("This visit no longer has an unpaid bill that can receive supplies.");
      return;
    }
    setSelectedVisit(visit);
    setCart({});
    setCatalog([]);
    setCatalogSearch("");
    setView("confirm");
  }

  async function openCatalog() {
    if (!selectedVisit) return;
    setIsCatalogLoading(true);
    try {
      const payload = await api.get(`/billing/quick/catalog/${selectedVisit.consultation_id}`);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setCatalog(items);
      setSelectedVisit(payload.visit || selectedVisit);
      const hasSavedFavourite = items.some((item) => favorites.has(item.id));
      setCategory(hasSavedFavourite ? "Favourites" : "All supplies");
      setView("catalog");
    } catch (error) {
      toast.error(error.message || "Supplies could not be loaded.");
    } finally {
      setIsCatalogLoading(false);
    }
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
      const payload = await api.get(`/billing/quick/lookup?reference=${encodeURIComponent(reference)}`);
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
    setIsSubmitting(true);
    try {
      const payload = await api.post(
        `/billing/quick/visits/${selectedVisit.consultation_id}/capture`,
        {
          operation_id: crypto.randomUUID(),
          items: selectedItems.map((item) => ({
            inventory_item_id: item.id,
            quantity: item.quantity,
          })),
        },
      );
      setSelectedVisit(payload.visit || selectedVisit);
      setView("success");
      await loadDashboard({ silent: true });
      toast.success(selectedItems.length ? "Billing sent to the operator." : "Consultation-only billing submitted.");
    } catch (error) {
      toast.error(error.message || "Billing could not be submitted.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetFlow(destination = "today") {
    setSelectedVisit(null);
    setCatalog([]);
    setCart({});
    setLookupResults([]);
    setCatalogSearch("");
    setView(destination);
  }

  const showBottomNav = ["today", "find", "status"].includes(view);

  return (
    <div className="relative min-h-[70svh] overflow-hidden rounded-[2rem] bg-[#eff8f7] text-[#173f47] shadow-[0_18px_60px_rgba(23,77,80,0.1)]">
      <div className="absolute inset-x-0 top-0 z-0 h-72 bg-[radial-gradient(circle_at_15%_15%,rgba(102,226,206,0.24),transparent_34%),linear-gradient(145deg,#123f46_0%,#17666a_52%,#2b8d8b_100%)]" />

      <main className={`relative z-10 mx-auto w-full max-w-5xl px-4 pt-5 ${showBottomNav ? "pb-8" : "pb-10"}`}>
        {isLoading ? (
          <div className="flex min-h-[55svh] items-center justify-center">
            <LoaderCircle className="size-10 animate-spin text-white" aria-label="Loading quick billing" />
          </div>
        ) : null}

        {!isLoading && showBottomNav ? (
          <nav className="mb-5 grid grid-cols-3 gap-2 rounded-[1.4rem] border border-white/15 bg-white/10 p-1.5 backdrop-blur-md" aria-label="Doctor billing sections">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl text-sm font-black transition active:scale-95 ${
                    active ? "bg-white text-[#17666a] shadow-sm" : "text-white/80"
                  }`}
                >
                  <Icon className="size-5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        ) : null}

        {!isLoading && view === "today" ? (
          <section>
            <div className="mb-6 flex items-end justify-between gap-4 text-white">
              <div>
                <p className="text-sm font-bold text-white/70">{dayjs().format("dddd, D MMMM")}</p>
                <h1 className="mt-1 text-3xl font-black tracking-tight">Today’s visits</h1>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenHistory}
                  className="min-h-12 rounded-2xl border border-white/15 bg-white/10 px-4 text-sm font-black transition active:scale-95"
                >
                  Full history
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

            <button
              type="button"
              onClick={() => setView("find")}
              className="mb-5 flex min-h-16 w-full items-center gap-3 rounded-2xl border border-white/70 bg-white px-5 text-left text-slate-500 shadow-[0_12px_35px_rgba(23,77,80,0.12)] transition active:scale-[0.99]"
            >
              <Search className="size-6 text-[#248f91]" aria-hidden="true" />
              <span className="text-base font-bold">Enter OCS or visit number</span>
            </button>

            {visits.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {visits.map((visit) => (
                  <VisitCard key={visit.consultation_id} visit={visit} onSelect={chooseVisit} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No completed visits today"
                description="A visit will appear here after its consultation has been recorded in OCS VP."
                action={
                  <button
                    type="button"
                    onClick={() => setView("find")}
                    className="rounded-2xl bg-[#17666a] px-6 py-3 text-base font-black text-white"
                  >
                    Find another visit
                  </button>
                }
              />
            )}
          </section>
        ) : null}

        {!isLoading && view === "find" ? (
          <section>
            <div className="mb-6 text-white">
              <p className="text-sm font-bold text-white/70">Your visits only</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight">Find a visit</h1>
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

        {!isLoading && view === "confirm" && selectedVisit ? (
          <section className="mx-auto max-w-2xl">
            <button
              type="button"
              onClick={() => resetFlow("today")}
              className="mb-5 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white/10 px-4 font-bold text-white transition active:scale-95"
            >
              <ArrowLeft className="size-5" /> Back
            </button>
            <div className="overflow-hidden rounded-[2.25rem] border border-white/70 bg-white shadow-[0_24px_65px_rgba(23,77,80,0.18)]">
              <div className="bg-[#dff5f1] px-6 py-7 text-center">
                <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-[#17666a] text-white shadow-lg">
                  <Stethoscope className="size-8" />
                </span>
                <p className="mt-5 text-sm font-black uppercase tracking-[0.16em] text-[#26787a]">Confirm visit</p>
                <h1 className="mt-2 text-3xl font-black text-[#173f47]">{selectedVisit.patient_identifier}</h1>
                <p className="mt-2 text-2xl font-black text-[#173f47]">{selectedVisit.patient_masked_name}</p>
              </div>
              <div className="space-y-4 px-6 py-7">
                <div className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-5 py-4">
                  <span className="flex items-center gap-3 font-bold text-slate-600"><Clock3 className="size-5 text-[#248f91]" /> Open visit</span>
                  <span className="text-right font-black">{formatVisitDate(selectedVisit.visit_date)}, {formatVisitTime(selectedVisit.visit_time)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-5 py-4">
                  <span className="font-bold text-slate-600">Visit number</span>
                  <span className="font-black">{selectedVisit.visit_number}</span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-2xl bg-[#fff8df] px-5 py-4">
                  <span>
                    <span className="block font-black text-[#173f47]">{selectedVisit.consultation_fee?.type || "Consultation fee"}</span>
                    <span className="block text-sm font-semibold text-slate-500">Locked from OCS VP</span>
                  </span>
                  <span className="text-xl font-black">{formatRupees(selectedVisit.consultation_fee?.amount)}</span>
                </div>
                <button
                  type="button"
                  onClick={openCatalog}
                  disabled={isCatalogLoading}
                  className="mt-2 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-[#f2b52b] px-6 text-lg font-black text-[#173f47] shadow-[0_14px_35px_rgba(242,181,43,0.3)] transition active:scale-[0.98] disabled:opacity-60"
                >
                  {isCatalogLoading ? <LoaderCircle className="size-6 animate-spin" /> : <ChevronRight className="size-6" />}
                  Continue to supplies
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {!isLoading && view === "catalog" && selectedVisit ? (
          <section>
            <div className="mb-5 flex items-center justify-between gap-3 text-white">
              <button
                type="button"
                onClick={() => setView("confirm")}
                className="flex size-12 items-center justify-center rounded-2xl bg-white/10 transition active:scale-95"
                aria-label="Back to visit confirmation"
              >
                <ArrowLeft className="size-6" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white/70">{selectedVisit.patient_identifier} · {selectedVisit.visit_number}</p>
                <h1 className="truncate text-2xl font-black">Select supplies</h1>
              </div>
              <button
                type="button"
                onClick={() => setView("review")}
                className="relative flex min-h-12 items-center gap-2 rounded-2xl bg-[#f2b52b] px-4 font-black text-[#173f47] transition active:scale-95"
              >
                <ShoppingBasket className="size-5" />
                Review
                {selectedUnitCount > 0 ? (
                  <span className="flex min-w-6 items-center justify-center rounded-full bg-[#173f47] px-1.5 py-0.5 text-sm text-white">{selectedUnitCount}</span>
                ) : null}
              </button>
            </div>

            <div className="sticky top-20 z-20 rounded-[1.75rem] border border-white/70 bg-white/95 p-4 shadow-[0_15px_45px_rgba(23,77,80,0.12)] backdrop-blur-xl">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
                <input
                  value={catalogSearch}
                  onChange={(event) => {
                    setCatalogSearch(event.target.value);
                    if (event.target.value) setCategory("All supplies");
                  }}
                  placeholder="Search medicines and supplies"
                  className="min-h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-12 pr-4 text-base font-bold outline-none transition focus:border-[#2aa7a0] focus:bg-white"
                />
              </div>
              <div className="ocs-h-scroll mt-3 pb-1">
                {categories.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setCategory(name)}
                    className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-black transition ${
                      category === name ? "bg-[#17666a] text-white" : "bg-[#edf6f5] text-[#315e64]"
                    }`}
                  >
                    {name === "Favourites" ? "★ Favourites" : name}
                  </button>
                ))}
              </div>
            </div>

            {visibleCatalog.length ? (
              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                {visibleCatalog.map((item) => {
                  const quantity = Number(cart[item.id] || 0);
                  const available = Number(item.available_to_use || 0);
                  const isUnavailable = available < 1;
                  const isFavorite = favorites.has(item.id);
                  return (
                    <article
                      key={item.id}
                      className={`relative flex min-h-52 flex-col overflow-hidden rounded-[1.6rem] border bg-white p-4 shadow-[0_12px_35px_rgba(23,77,80,0.08)] ${
                        quantity > 0 ? "border-[#2aa7a0] ring-2 ring-[#2aa7a0]/20" : "border-slate-200/80"
                      } ${isUnavailable ? "opacity-55" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleFavorite(item.id)}
                        className={`absolute right-3 top-3 flex size-10 items-center justify-center rounded-xl transition active:scale-90 ${
                          isFavorite ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-400"
                        }`}
                        aria-label={isFavorite ? `Remove ${item.item_name} from favourites` : `Add ${item.item_name} to favourites`}
                      >
                        <Star className={`size-5 ${isFavorite ? "fill-current" : ""}`} />
                      </button>
                      <div className="pr-10">
                        <p className="line-clamp-2 text-base font-black leading-6 text-[#173f47]">{item.item_name}</p>
                        <p className="mt-1 line-clamp-1 text-sm font-bold text-slate-400">{item.subcategory || item.category}</p>
                      </div>
                      <div className="mt-auto pt-4">
                        <p className="text-lg font-black text-[#17666a]">{formatRupees(item.selling_price)}</p>
                        <p className={`mt-1 text-sm font-bold ${isUnavailable ? "text-rose-600" : "text-slate-500"}`}>
                          {isUnavailable ? "Out of stock" : `${available} ${item.unit}${available === 1 ? "" : "s"} available`}
                        </p>
                        {quantity > 0 ? (
                          <div className="mt-3 flex items-center justify-between rounded-2xl bg-[#e6f7f4] p-1.5">
                            <button
                              type="button"
                              onClick={() => changeQuantity(item, -1)}
                              className="flex size-11 items-center justify-center rounded-xl bg-white text-[#17666a] shadow-sm active:scale-90"
                              aria-label={`Remove one ${item.item_name}`}
                            >
                              <Minus className="size-5" />
                            </button>
                            <span className="text-xl font-black tabular-nums">{quantity}</span>
                            <button
                              type="button"
                              onClick={() => changeQuantity(item, 1)}
                              className="flex size-11 items-center justify-center rounded-xl bg-[#17666a] text-white active:scale-90"
                              aria-label={`Add another ${item.item_name}`}
                            >
                              <Plus className="size-5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isUnavailable}
                            onClick={() => changeQuantity(item, 1)}
                            className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#17666a] font-black text-white transition active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            <Plus className="size-5" /> Add
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5">
                <EmptyState
                  icon={PackageOpen}
                  title={category === "Favourites" ? "No favourite supplies yet" : "No supplies found"}
                  description={
                    category === "Favourites"
                      ? "Open All supplies and tap the star on frequently used items."
                      : "Try another category or search term."
                  }
                  action={
                    category === "Favourites" ? (
                      <button type="button" onClick={() => setCategory("All supplies")} className="rounded-2xl bg-[#17666a] px-6 py-3 font-black text-white">
                        Browse all supplies
                      </button>
                    ) : null
                  }
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setView("review")}
              className="billing-integrated-review-bar fixed left-1/2 z-30 flex min-h-16 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center justify-between rounded-[1.4rem] bg-[#f2b52b] px-6 text-[#173f47] shadow-[0_20px_50px_rgba(23,63,71,0.3)] transition active:scale-[0.98]"
            >
              <span className="text-left">
                <span className="block text-sm font-bold">{selectedUnitCount ? `${selectedUnitCount} supply unit${selectedUnitCount === 1 ? "" : "s"}` : "No supplies selected"}</span>
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
              <ArrowLeft className="size-5" /> Edit supplies
            </button>
            <div className="overflow-hidden rounded-[2.25rem] border border-white/70 bg-white shadow-[0_24px_65px_rgba(23,77,80,0.18)]">
              <div className="bg-[#173f47] px-6 py-6 text-white">
                <p className="text-sm font-bold text-white/65">{selectedVisit.patient_identifier} · {selectedVisit.visit_number}</p>
                <h1 className="mt-1 text-3xl font-black">Review billing</h1>
              </div>
              <div className="p-6">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
                  <div>
                    <p className="text-lg font-black">{selectedVisit.consultation_fee?.type || "Consultation fee"}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">Set and locked in OCS VP</p>
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

                <div className="mt-2 flex items-center justify-between rounded-2xl bg-[#fff5cf] px-5 py-5">
                  <div>
                    <p className="text-sm font-bold text-slate-600">Provisional total</p>
                    <p className="text-sm font-semibold text-slate-500">Operator completes payment details</p>
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
                  {isSubmitting ? "Submitting…" : "Submit to operator"}
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
              <p className="mt-6 text-sm font-black uppercase tracking-[0.18em] text-emerald-700">Submission received</p>
              <h1 className="mt-2 text-3xl font-black text-[#173f47]">Sent to the operator</h1>
              <p className="mt-3 text-base font-semibold leading-7 text-slate-600">
                {selectedVisit.visit_number} · {selectedVisit.patient_identifier}<br />
                {selectedUnitCount ? `${selectedUnitCount} supply unit${selectedUnitCount === 1 ? "" : "s"} recorded` : "Consultation only"}
              </p>
              <div className="mt-7 rounded-2xl bg-[#edf8f6] px-5 py-4 text-left">
                <p className="text-sm font-bold text-slate-500">Current status</p>
                <div className="mt-2"><StatusBadge status="awaiting_operator" /></div>
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
            <div className="mb-6 flex items-end justify-between gap-4 text-white">
              <div>
                <p className="text-sm font-bold text-white/70">Your recent activity</p>
                <h1 className="mt-1 text-3xl font-black tracking-tight">Submission status</h1>
              </div>
              <button
                type="button"
                onClick={() => loadDashboard()}
                className="flex size-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 transition active:scale-95"
                aria-label="Refresh submission status"
              >
                <RefreshCw className="size-5" />
              </button>
            </div>
            {submissions.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {submissions.map((submission) => (
                  <article key={submission.id} className="rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(23,77,80,0.08)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-black">{submission.patient_masked_name}</p>
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
                    {submission.items.length ? (
                      <p className="mt-4 line-clamp-2 text-sm font-semibold leading-6 text-slate-600">
                        {submission.items.map((item) => `${item.description} ×${item.quantity}`).join(", ")}
                      </p>
                    ) : (
                      <p className="mt-4 text-sm font-semibold text-slate-600">Consultation only · no supplies submitted</p>
                    )}
                  </article>
                ))}
              </div>
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
    </div>
  );
}

export default BillingLitePage;
