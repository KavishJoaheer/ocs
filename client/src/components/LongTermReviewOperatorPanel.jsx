import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Filter, RefreshCw, Search, X } from "lucide-react";
import LongTermReviewWorkspaceList from "./LongTermReviewWorkspaceList.jsx";
import AppUpdateBanner from "./AppUpdateBanner.jsx";
import PushNotificationBanner from "./PushNotificationBanner.jsx";
import Modal from "./Modal.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import { getReviewDueTiming } from "../lib/patientReview.js";
import { cx } from "../lib/utils.js";
import "./reviewWorkspace.css";

const INPUT_CLASS = "min-h-11 w-full min-w-0 rounded-full border border-[#d5e4e1] bg-white px-4 text-sm text-[#376168] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#137b80]";
const TIMING_FILTERS = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "due_7_days", label: "Next 7 days" },
  { id: "upcoming", label: "Later" },
  { id: "no_date", label: "No date" },
];

export default function LongTermReviewOperatorPanel({
  patients = [], scope = "all", onScopeChange, onPatientsChange,
  loading = false, refreshing = false, error = null, onRefresh,
}) {
  const { user } = useAuth();
  const compact = useIsMobile(1024);
  const isDoctor = user?.role === "doctor";
  const [month, setMonth] = useState("");
  const [search, setSearch] = useState("");
  const [timingFilter, setTimingFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [doctors, setDoctors] = useState([]);

  useEffect(() => {
    let ignore = false;
    api.get("/doctors").then(rows => {
      if (!ignore) setDoctors((Array.isArray(rows) ? rows : []).filter(doctor => doctor.is_active !== 0 && !doctor.deleted_at));
    }).catch(() => { if (!ignore) setDoctors([]); });
    return () => { ignore = true; };
  }, []);

  const months = useMemo(() => {
    const values = new Set(Array.from({ length: 12 }, (_, index) => dayjs().month(index).format("YYYY-MM")));
    for (const patient of patients) {
      if (patient.review_due_date && dayjs(patient.review_due_date).isValid()) values.add(dayjs(patient.review_due_date).format("YYYY-MM"));
    }
    if (month) values.add(month);
    return [...values].sort();
  }, [patients, month]);

  const baseRows = useMemo(() => {
    const needle = search.trim().toLowerCase().replace(/^#/, "");
    return patients.filter(patient => {
      if (month && (!patient.review_due_date || dayjs(patient.review_due_date).format("YYYY-MM") !== month)) return false;
      if (!needle) return true;
      return String(patient.full_name || "").toLowerCase().includes(needle)
        || String(patient.patient_identifier || "").toLowerCase().includes(needle)
        || String(patient.id) === needle;
    });
  }, [patients, month, search]);

  const timingCounts = useMemo(() => baseRows.reduce((counts, patient) => {
    const { status } = getReviewDueTiming(patient.review_due_date);
    counts[status] += 1;
    if (status === "today" || status === "due_7_days") counts.next7 += 1;
    return counts;
  }, { all: baseRows.length, overdue: 0, today: 0, due_7_days: 0, next7: 0, upcoming: 0, no_date: 0 }), [baseRows]);

  const visibleRows = useMemo(() => baseRows.filter(patient => {
    const { status } = getReviewDueTiming(patient.review_due_date);
    return timingFilter === "all" || (timingFilter === "due_7_days" ? status === "today" || status === "due_7_days" : status === timingFilter);
  }), [baseRows, timingFilter]);

  function handleScopeChange(event) {
    const value = event.target.value;
    onScopeChange?.(isDoctor && Number(value) === Number(user?.doctor_id) ? "mine" : value);
  }

  const extraFilterCount = Number(Boolean(month)) + Number(scope !== (isDoctor ? "mine" : "all"));
  const countsReady = !loading && !(error && !patients.length);
  const hasFilters = Boolean(search.trim() || month || timingFilter !== "all" || extraFilterCount);
  function clearFilters() {
    setSearch(""); setMonth(""); setTimingFilter("all");
    onScopeChange?.(isDoctor ? "mine" : "all");
  }

  const filters = <>
    <label className="min-w-0 space-y-1 text-xs font-semibold text-[#5b7379]">
      <span>Review doctor</span>
      <select aria-label="Review doctor" value={scope} onChange={handleScopeChange} className={INPUT_CLASS}>
        {isDoctor ? <option value="mine">My reviews</option> : null}
        <option value="all">All doctors</option>
        {doctors.map(doctor => <option key={doctor.id} value={String(doctor.id)}>{doctor.full_name}</option>)}
      </select>
    </label>
    <label className="min-w-0 space-y-1 text-xs font-semibold text-[#5b7379]">
      <span>Review month</span>
      <select aria-label="Review month" value={month} onChange={event => setMonth(event.target.value)} className={INPUT_CLASS}>
        <option value="">All months</option>
        {months.map(value => <option key={value} value={value}>{dayjs(`${value}-01`).format("MMMM YYYY")}</option>)}
      </select>
    </label>
  </>;

  return <section aria-label="Review appointment workspace" className="review-workspace w-full min-w-0 space-y-4">
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:justify-between sm:gap-3 rounded-[28px] bg-gradient-to-r from-[#e3f5f0] via-[#eef9f5] to-[#fff9ed] px-4 py-4 sm:px-6 sm:py-5">
      <div className="contents sm:block sm:min-w-0">
        <h1 className="col-span-2 text-xl font-bold tracking-tight text-[#173f4a] sm:text-3xl">Review appointments</h1>
        <p className="col-start-1 row-start-2 mt-1 text-xs text-[#376168] sm:text-sm">{loading ? "Loading reviews…" : !countsReady ? "Reviews unavailable" : `${visibleRows.length} ${visibleRows.length === 1 ? "review" : "reviews"}${visibleRows.length !== patients.length ? ` of ${patients.length}` : ""}`}{isDoctor && scope === "mine" ? " · Assigned to you" : ""}</p>
      </div>
      <div className="col-start-2 row-start-2 flex shrink-0 items-center gap-1">
        <PushNotificationBanner compact role={user?.role} /><AppUpdateBanner compact />
        <button type="button" aria-label="Refresh review appointments" onClick={onRefresh} disabled={refreshing || loading} className="inline-flex size-11 items-center justify-center rounded-full border border-[#d5e4e1] bg-white text-[#376168] disabled:opacity-50"><RefreshCw aria-hidden="true" className={cx("size-4", refreshing && "animate-spin")} /></button>
      </div>
    </header>

    <div className="flex items-end gap-2 lg:gap-3">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search review patients</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#657c82]" />
        <input aria-label="Search review patients" value={search} onChange={event => setSearch(event.target.value)} placeholder={compact ? "Name or ID" : "Find patient name or ID"} className={`${INPUT_CLASS} pl-10 ${search ? "pr-11" : ""}`} />
        {search ? <button type="button" aria-label="Clear review search" onClick={() => setSearch("")} className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-full text-[#376168]"><X aria-hidden="true" className="size-4" /></button> : null}
      </label>
      {compact ? <button type="button" onClick={() => setFiltersOpen(true)} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-[#d5e4e1] bg-white px-3 text-sm font-semibold text-[#376168]"><Filter aria-hidden="true" className="size-4" />Filters{extraFilterCount > 0 ? <span className="rounded-full bg-[#e3f5f0] px-1.5 text-xs">{extraFilterCount}</span> : null}</button> : <div className="grid w-[440px] shrink-0 grid-cols-2 gap-3">{filters}</div>}
    </div>

    <nav aria-label="Review due status" className="flex max-w-full gap-2 overflow-x-auto pb-1">
      {TIMING_FILTERS.map(filter => {
        const count = filter.id === "due_7_days" ? timingCounts.next7 : timingCounts[filter.id];
        return <button key={filter.id} type="button" aria-pressed={timingFilter === filter.id} onClick={() => setTimingFilter(filter.id)} title={filter.id === "due_7_days" ? "Today and the next 7 days" : undefined} className={cx("inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-sm font-semibold", timingFilter === filter.id ? "border-[#137b80] bg-[#137b80] text-white" : filter.id === "overdue" && count > 0 ? "border-rose-200 bg-rose-50 text-rose-800" : ["today", "due_7_days"].includes(filter.id) && count > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-[#d5e4e1] bg-white text-[#376168]")}>
          {filter.label}<span className={cx("rounded-full px-2 py-0.5 text-xs tabular-nums", timingFilter === filter.id ? "bg-white/20" : "bg-black/5")}>{countsReady ? count : "—"}</span>
        </button>;
      })}
    </nav>
    {hasFilters ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5b7379]"><p>{month ? dayjs(`${month}-01`).format("MMMM YYYY") : "All months"}{scope === "mine" ? " · My reviews" : scope === "all" ? " · All doctors" : ` · ${doctors.find(doctor => String(doctor.id) === scope)?.full_name || "Selected doctor"}`}</p><button type="button" onClick={clearFilters} className="min-h-11 rounded-full border border-[#d5e4e1] bg-white px-3 font-semibold text-[#376168]">Clear filters</button></div> : null}
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><p>{error}</p><button type="button" onClick={onRefresh} disabled={refreshing} className="min-h-11 rounded-full border border-rose-200 px-4 font-semibold disabled:opacity-50">Retry</button></div> : null}
    {loading ? <p role="status" className="rounded-[26px] border border-[#d5e4e1] bg-white px-5 py-8 text-sm text-[#5b7379]">Loading review appointments…</p> : !error || patients.length ? <LongTermReviewWorkspaceList patients={visibleRows} showMineBadge={isDoctor && scope !== "mine"} showReviewDoctor={!(isDoctor && scope === "mine")} emptyTitle={hasFilters ? "No matching reviews" : scope === "mine" ? "No review appointments assigned to you" : "No review appointments"} emptyDescription={hasFilters ? "Try another patient name, doctor, month or due status." : "Patients flagged for a review appointment will appear here."} onPatientsChange={onPatientsChange} /> : null}

    <Modal open={compact && filtersOpen} onClose={() => setFiltersOpen(false)} title="Review filters" size="sm">
      <div className="space-y-4"><div className="grid gap-4">{filters}</div><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={clearFilters} className="min-h-11 rounded-full border border-[#d5e4e1] px-4 text-sm font-semibold text-[#376168]">Reset filters</button><button type="button" onClick={() => setFiltersOpen(false)} className="min-h-11 rounded-full bg-[#137b80] px-4 text-sm font-semibold text-white">Show reviews</button></div></div>
    </Modal>
  </section>;
}
