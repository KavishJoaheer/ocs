import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  CreditCard,
  Globe,
  MapPin,
  MoreVertical,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import { canLogLongTermReviewUpdate } from "../lib/longTermReviewAccess.js";
import { useLongTermReviewLogUpdate } from "../hooks/useLongTermReviewLogUpdate.jsx";
import PatientWorkspaceHeader from "../components/patient-workspace/PatientWorkspaceHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import { isBrowserOffline, isNetworkFailure } from "../lib/networkErrors.js";
import {
  buildOfflinePatientsPage,
  filterOfflineDirectoryItems,
  prefetchPatientOfflineDirectory,
  getCachedPatientDirectory,
} from "../lib/patientOfflineSync.js";
import {
  formatAgeFromDateOfBirth,
  formatDate,
} from "../lib/format.js";
import { canBillPatientForUser } from "../lib/access.js";
import {
  formatReviewDueShort,
  formatReviewTimelineDate,
  isPatientUnderReview,
} from "../lib/patientReview.js";
import { cx, pageContainerClass } from "../lib/utils.js";

import { PatientFormModal } from "../components/PatientIntakeForm.jsx";

function displayText(value, fallback = "Not recorded") {
  return value ? value : fallback;
}

function PatientCareNumber({ patient, className }) {
  const identifier = displayText(patient.patient_identifier);
  return <span className={className}>{identifier}</span>;
}

function PortalAccountBadge({ patient, onDark = false, desktop = false, mobile = false }) {
  if (!patient.has_portal_account) return null;

  const isPending =
    patient.link_status === "pending_review" ||
    patient.link_status === "self_registered";

  if (isPending) {
    return (
      <span
        className={cx(
          "ml-2 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold",
          onDark
            ? "border border-amber-400/20 bg-amber-400/15 text-amber-200"
            : "border border-amber-300/40 bg-amber-50 text-amber-700",
        )}
        title="Portal account pending approval"
      >
        <ShieldAlert className="size-3" />
        Pending
      </span>
    );
  }

  const PortalIcon = desktop || mobile ? Sparkles : Globe;

  return (
    <span
      className={cx(
        "ml-2 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold",
        onDark
          ? "border border-white/10 bg-white/15 text-[#e6f0f0]"
          : "border border-teal-200/60 bg-teal-50 text-teal-700",
      )}
      title="Has portal account"
    >
      <PortalIcon className="size-3" />
      Portal
    </span>
  );
}

function formatMobilePatientGender(gender) {
  if (gender === "M") return "Male";
  if (gender === "F") return "Female";
  const normalized = String(gender || "").trim();
  return normalized || null;
}

function formatMobilePatientAgeYears(dateOfBirth, manualAge = null) {
  const formatted = formatAgeFromDateOfBirth(dateOfBirth, manualAge);
  const match = /^(\d+)\s+years old$/.exec(formatted);
  return match ? `${match[1]} yrs` : null;
}

function formatMobilePatientMetaLine(patient) {
  const parts = [];

  if (patient.patient_identifier) {
    parts.push(patient.patient_identifier);
  }

  const ageLabel = (patient.date_of_birth || patient.manual_age != null) ? formatMobilePatientAgeYears(patient.date_of_birth, patient.manual_age) : null;
  if (ageLabel) {
    parts.push(ageLabel);
  }

  const genderLabel = formatMobilePatientGender(patient.gender);
  if (genderLabel) {
    parts.push(genderLabel);
  }

  return parts.length ? parts.join(" • ") : "Patient details unavailable";
}

function formatUnderReviewAgeLocationLine(patient) {
  const parts = [];

  if (patient.date_of_birth || patient.manual_age != null) {
    const ageLabel = formatMobilePatientAgeYears(patient.date_of_birth, patient.manual_age);
    if (ageLabel) {
      parts.push(ageLabel);
    }
  }

  if (patient.gender === "M" || patient.gender === "F") {
    parts.push(patient.gender);
  } else if (patient.gender) {
    parts.push(String(patient.gender).trim());
  }

  const location = String(patient.location || "").trim();
  if (location) {
    parts.push(location);
  }

  return parts.length ? parts.join(" • ") : "Details unavailable";
}

function formatAssignedClinicianLine(patient) {
  if (!patient.assigned_doctor_name) {
    return "Not assigned";
  }

  if (patient.assigned_doctor_specialization) {
    return `${patient.assigned_doctor_name} (${patient.assigned_doctor_specialization})`;
  }

  return patient.assigned_doctor_name;
}

function formatDoctorFilterShortName(fullName) {
  const normalized = String(fullName || "").trim();
  if (!normalized) {
    return "All";
  }

  const withoutTitle = normalized.replace(/^(dr|doctor)\.?\s+/i, "");
  return withoutTitle.split(/\s+/)[0] || normalized;
}

function MobileDoctorFilter({ doctors, value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = doctors.find((doctor) => String(doctor.id) === String(value));
  const shortLabel = selected ? formatDoctorFilterShortName(selected.full_name) : "All";
  const options = [{ id: "", full_name: "All doctors" }, ...doctors];

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKey(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="overflow-hidden rounded-[24px] border border-[#d5e4e1] bg-white"
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="text-[11px] font-semibold text-[#376168]">Doctor</span>
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ocs-slate">{shortLabel}</span>
          <ChevronDown
            className={cx("size-4 text-[#376168] transition", open && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>
      {open ? (
        <div className="border-t border-[#d5e4e1]" role="listbox">
          {options.map((doctor, index) => {
            const optionValue = doctor.id === "" ? "" : String(doctor.id);
            const active = String(value || "") === optionValue;

            return (
              <button
                key={doctor.id || "all"}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(optionValue);
                  setOpen(false);
                }}
                className={cx(
                  "flex w-full px-3.5 py-2.5 text-left text-sm",
                  index > 0 && "border-t border-ocs-yellow/20",
                  active
                    ? "bg-[#eaf5f1] font-semibold text-[#137b80]"
                    : "font-medium text-slate-600",
                )}
              >
                {doctor.full_name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PatientsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const directoryContext = location.state?.directoryContext;
  const restoredScroll = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const myAssignedFilterActive = searchParams.get("filter") === "my_assigned";
  const scopeRestored = useRef(false);
  const scopeRestoring = useRef(false);
  useEffect(() => {
    if (user.role !== "doctor") return;
    const key = `ocs_patient_scope_${user.id}`;
    if (!scopeRestored.current) {
      scopeRestored.current = true;
      if (!searchParams.size && window.sessionStorage.getItem(key) === "my_assigned") {
        scopeRestoring.current = true;
        setSearchParams({ filter: "my_assigned" }, { replace: true });
        return;
      }
    }
    if (scopeRestoring.current && !myAssignedFilterActive) return;
    scopeRestoring.current = false;
    window.sessionStorage.setItem(key, myAssignedFilterActive ? "my_assigned" : "all");
  }, [user.role, user.id, searchParams, setSearchParams, myAssignedFilterActive]);
  const isMobile = useIsMobile();
  const canCreatePatients = ["admin", "doctor", "operator"].includes(user.role);
  const canDeletePatients = ["admin", "operator"].includes(user.role);
  const canManageDeletedPatients = ["admin", "operator"].includes(user.role);
  // Purging a soft-deleted record is irreversible, so it stays admin-only.
  const canPurgePatients = user.role === "admin";
  const canEditPatientIdentifier = user.role === "admin";
  const canOpenBilling =
    user.role === "admin" || user.role === "doctor" || user.role === "operator" || user.role === "accountant";
  const [search, setSearch] = useState(() => searchParams.get("search") || directoryContext?.search || "");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState(() =>
    searchParams.get("tab") === "under_review" || searchParams.get("filter") === "under_review"
      ? "under_review"
      : directoryContext?.statusFilter || (myAssignedFilterActive ? "active" : "all"),
  );
  const isUnderReviewView =
    statusFilter === "under_review" ||
    searchParams.get("tab") === "under_review" ||
    searchParams.get("filter") === "under_review";
  const isRecentlyDeletedView =
    !isMobile && canManageDeletedPatients && statusFilter === "recently_deleted";
  const [doctorIdFilter, setDoctorIdFilter] = useState(() => myAssignedFilterActive ? String(user.doctor_id || "") : directoryContext?.doctorIdFilter || "");
  const [page, setPage] = useState(() => directoryContext?.page || 1);
  const [patientsData, setPatientsData] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState(null);
  const [patientToRestore, setPatientToRestore] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [restoreReason, setRestoreReason] = useState("");
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [patientToPurge, setPatientToPurge] = useState(null);
  const [patientCardMenu, setPatientCardMenu] = useState(null);
  const [desktopTableMenu, setDesktopTableMenu] = useState(null);
  const [offlineDirectoryActive, setOfflineDirectoryActive] = useState(false);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const isDoctorMobile = user.role === "doctor" && isMobile;
  const canLogLongTermReview = canLogLongTermReviewUpdate(user.role);
  const loadPatientsRef = useRef(null);
  const directoryRequestId = useRef(0);
  useEffect(() => () => { directoryRequestId.current += 1; }, []);
  const { openLogUpdate, dialogs: longTermReviewLogDialogs } = useLongTermReviewLogUpdate({
    onUpdated: async () => {
      await loadPatientsRef.current?.();
    },
  });

  function shouldShowReviewLogUpdate(patient) {
    return canLogLongTermReview && isPatientUnderReview(patient);
  }

  useEffect(() => {
    if (!desktopTableMenu) return undefined;

    function handleKey(event) {
      if (event.key === "Escape") {
        setDesktopTableMenu(null);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [desktopTableMenu]);

  function canEditPatient() {
    return ["admin", "doctor", "operator"].includes(user.role);
  }

  async function loadDoctors() {
    try {
      const data = await api.get("/doctors");
      setDoctors(data);
    } catch (error) {
      console.error("Failed to load doctors", error);
    }
  }

  async function loadOfflinePatientDirectory(requestId = ++directoryRequestId.current) {
    const target = patientsData ? setRefreshing : setLoading;
    target(true);

    try {
      const cached = await getCachedPatientDirectory(user.id);
      if (requestId !== directoryRequestId.current) return;
      const filtered = filterOfflineDirectoryItems(cached?.items || [], {
        search: deferredSearch,
        statusFilter,
      });
      const pagePayload = buildOfflinePatientsPage(filtered, page, 15);
      setPatientsData(pagePayload);
      setOfflineDirectoryActive(true);
    } catch (error) {
      if (requestId !== directoryRequestId.current) return;
      toast.error(error.message || "Unable to load cached patient directory.");
      setPatientsData({
        items: [],
        pagination: { page: 1, limit: 15, total: 0, totalPages: 1 },
      });
      setOfflineDirectoryActive(true);
    } finally {
      if (requestId === directoryRequestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  async function loadPendingApprovalCount() {
    if (isMobile) {
      return;
    }

    try {
      const data = await api.get("/patients?pendingApproval=1&page=1&limit=1");
      setPendingApprovalCount(data.pagination?.total ?? 0);
    } catch (error) {
      console.error("Failed to load pending approval count", error);
      setPendingApprovalCount(0);
    }
  }

  async function loadPatients() {
    const requestId = ++directoryRequestId.current;
    if (isDoctorMobile && isBrowserOffline()) {
      await loadOfflinePatientDirectory(requestId);
      return;
    }

    const target = patientsData ? setRefreshing : setLoading;
    target(true);

    try {
      if (!isMobile && canManageDeletedPatients && statusFilter === "recently_deleted") {
        const deleted = await api.get("/patients/deleted/recent");
        if (requestId !== directoryRequestId.current) return;
        const query = deferredSearch.trim().toLowerCase();
        const items = query
          ? deleted.filter((patient) => {
              const haystack = [
                patient.full_name,
                patient.patient_identifier,
                patient.patient_id_number,
                patient.patient_contact_number,
                patient.assigned_doctor_name,
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              return haystack.includes(query);
            })
          : deleted;

        setPatientsData({
          items,
          pagination: {
            page: 1,
            limit: Math.max(items.length, 1),
            total: items.length,
            totalPages: 1,
          },
        });
        setOfflineDirectoryActive(false);
        void loadPendingApprovalCount();
        return;
      }

      let url = `/patients?search=${encodeURIComponent(deferredSearch)}&page=${page}&limit=15`;

      if (statusFilter === "under_review") {
        url += "&underReview=1";
      } else if (statusFilter === "pending_approval") {
        url += "&pendingApproval=1";
      } else if (statusFilter !== "all") {
        url += `&status=${statusFilter}`;
      }

      if (doctorIdFilter) {
        url += `&doctorId=${doctorIdFilter}`;
      }

      if (myAssignedFilterActive && user.role === "doctor" && user.doctor_id) {
        url += "&filter=my_assigned";
        url += `&doctorId=${user.doctor_id}`;
        if (statusFilter === "all") {
          url += "&status=active";
        }
      }

      const data = await api.get(url);
      if (requestId !== directoryRequestId.current) return;
      setPatientsData(data);
      setOfflineDirectoryActive(false);

      if (!isMobile) {
        void loadPendingApprovalCount();
      }

      if (isDoctorMobile) {
        void prefetchPatientOfflineDirectory(user.id);
      }
    } catch (error) {
      if (requestId !== directoryRequestId.current) return;
      if (isDoctorMobile && isNetworkFailure(error)) {
        console.warn("Online fetch failed, falling back to local storage cache.");
        await loadOfflinePatientDirectory(requestId);
        return;
      }
      toast.error(error.message);
    } finally {
      if (requestId === directoryRequestId.current) setLoading(false);
      if (requestId === directoryRequestId.current) setRefreshing(false);
    }
  }

  loadPatientsRef.current = loadPatients;

  async function handleMobileDirectoryRefresh() {
    if (isDoctorMobile && isBrowserOffline()) {
      await loadOfflinePatientDirectory();
      return;
    }

    await loadPatients();
    if (isDoctorMobile) {
      await prefetchPatientOfflineDirectory(user.id, { force: true });
    }
  }

  useEffect(() => {
    const tab = searchParams.get("tab");
    const filter = searchParams.get("filter");
    if (tab === "under_review" || filter === "under_review") {
      if (user.role === "doctor") {
        navigate("/doctor/long-term-review", { replace: true });
        return;
      }
      if (user.role === "admin") {
        navigate("/admin/long-term-review", { replace: true });
        return;
      }
      if (user.role === "operator") {
        navigate("/operator/long-term-review", { replace: true });
        return;
      }
    }

    const next = searchParams.get("search") || directoryContext?.search || "";
    setSearch((prev) => (prev === next ? prev : next));

    if (tab === "under_review" || filter === "under_review") {
      setStatusFilter("under_review");
    }

    if (searchParams.get("filter") === "my_assigned" && user.role === "doctor" && user.doctor_id) {
      setDoctorIdFilter(String(user.doctor_id));
      setStatusFilter("active");
    }

    setPage(directoryContext?.page || 1);
  }, [navigate, searchParams, user.doctor_id, user.role, directoryContext]);

  useEffect(() => {
    if (loading || !patientsData || restoredScroll.current) return;
    if (location.state?.patientsScrollY == null) {
      restoredScroll.current = true;
      return;
    }
    let cancelled = false;
    let frame;
    Promise.resolve(document.fonts?.ready).then(() => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(() => {
        restoredScroll.current = true;
        window.scrollTo({ top: location.state?.patientsScrollY || 0, behavior: "instant" });
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [loading, patientsData, location.state]);

  // Save the directory entry as well as the profile entry so browser Back restores the same context.
  function openPatientProfile(patientId) {
    const state = { patientsReturnTo: location.pathname + location.search, patientsScrollY: window.scrollY, directoryContext: { search, statusFilter, doctorIdFilter, page } };
    navigate(location.pathname + location.search, { replace: true, state: { directoryContext: state.directoryContext, patientsScrollY: state.patientsScrollY } });
    navigate(`/patients/${patientId}`, { state });
  }

  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    loadDoctors();
    void loadPendingApprovalCount();
  }, []);

  useEffect(() => {
    void loadPendingApprovalCount();
  }, [isMobile, refreshKey]);

  useEffect(() => {
    loadPatients();
  }, [
    deferredSearch,
    page,
    statusFilter,
    doctorIdFilter,
    myAssignedFilterActive,
    user.doctor_id,
    user.role,
    user.id,
    isMobile,
    isDoctorMobile,
    refreshKey,
  ]);

  useEffect(() => {
    if (!isDoctorMobile) {
      return undefined;
    }

    function handleConnectivityChange() {
      void loadPatients();
    }

    window.addEventListener("online", handleConnectivityChange);
    window.addEventListener("offline", handleConnectivityChange);

    return () => {
      window.removeEventListener("online", handleConnectivityChange);
      window.removeEventListener("offline", handleConnectivityChange);
    };
  }, [isDoctorMobile]);

  const patients = useMemo(() => {
    const items = patientsData?.items || [];

    if (!myAssignedFilterActive || user.role !== "doctor" || !user.doctor_id) {
      return items;
    }

    return items.filter(
      (patient) =>
        Number(patient.assigned_doctor_id) === Number(user.doctor_id) &&
        patient.status === "active",
    );
  }, [patientsData?.items, myAssignedFilterActive, user.doctor_id, user.role]);
  const pagination = patientsData?.pagination;

  const headerActions = useMemo(() => {
    if (!canCreatePatients) {
      return null;
    }

    return (
      <Link
        to="/patients/add"
        className="patient-control patient-control-primary"
      >
        <Plus className="size-4" />
        Add patient
      </Link>
    );
  }, [canCreatePatients]);

  async function handleSave(payload) {
    setIsSaving(true);

    try {
      if (editor?.mode === "edit") {
        await api.put(`/patients/${editor.patient.id}`, payload);
        toast.success("Patient record updated.");
        setEditor(null);
        await loadPatients();
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!patientToDelete) return;

    setLifecycleBusy(true);
    try {
      await api.delete(`/patients/${patientToDelete.id}`, {
        body: { reason: deleteReason.trim() },
      });
      toast.success("Patient removed from the directory.");
      setPatientToDelete(null);
      setDeleteReason("");
      await loadPatients();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function handleRestore() {
    if (!patientToRestore) return;

    setLifecycleBusy(true);
    try {
      await api.post(`/patients/${patientToRestore.id}/restore`, {
        reason: restoreReason.trim(),
      });
      toast.success(`${patientToRestore.full_name} restored to the patient directory.`);
      setPatientToRestore(null);
      setRestoreReason("");
      await loadPatients();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function handlePermanentDelete() {
    if (!patientToPurge) return;

    try {
      await api.delete(`/patients/${patientToPurge.id}/permanent`);
      toast.success(`${patientToPurge.full_name} permanently deleted.`);
      setPatientToPurge(null);
      await loadPatients();
    } catch (error) {
      toast.error(error.message);
    }
  }

  function clearMyAssignedFilter() {
    window.sessionStorage.setItem(`ocs_patient_scope_${user.id}`, "all");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("filter");
    setSearchParams(nextParams, { replace: true, state: { directoryContext: { search, statusFilter: "all", doctorIdFilter: "", page: 1 } } });
    setDoctorIdFilter("");
    setStatusFilter("all");
    setPage(1);
  }

  const searchField = (
    <label className={cx("relative block w-full", !isMobile && "max-w-xl")}>
      <Search
        className={cx(
          "pointer-events-none absolute left-4 -translate-y-1/2 text-slate-400",
          isMobile ? "top-1/2 size-5" : "top-1/2 size-4",
        )}
      />
      <input
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
        aria-label="Search patients"
        placeholder={isMobile ? "Name or care number" : "Name, care number or contact"}
        className={cx(
          "w-full rounded-full border bg-white pl-11 pr-4 text-sm outline-none transition focus:bg-white",
          isMobile ? "h-12 border-slate-100 focus:border-ocs-teal" : "border-slate-200 py-3 focus:border-sky-400",
        )}
      />
    </label>
  );

  const myAssignedFilterBadge = myAssignedFilterActive ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700">
      <span>Filter Active: My Patients</span>
      <button
        type="button"
        onClick={clearMyAssignedFilter}
        className="inline-flex size-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
        aria-label="Clear my patients filter"
      >
        <X className="size-3.5" />
      </button>
    </span>
  ) : null;

  const patientStatusTabs = useMemo(() => {
    const baseTabs = [
      { id: "all", label: "All" },
      { id: "active", label: "Active" },
      { id: "discharged", label: "Discharged" },
      { id: "under_review", label: "Reviews" },
    ];

    if (isMobile) {
      return baseTabs;
    }

    const desktopTabs = [...baseTabs, { id: "pending_approval", label: "Pending Approval" }];

    if (canManageDeletedPatients) {
      desktopTabs.push({ id: "recently_deleted", label: "Recently deleted" });
    }

    return desktopTabs;
  }, [canManageDeletedPatients, isMobile]);

  useEffect(() => {
    if (isMobile && statusFilter === "recently_deleted") {
      setStatusFilter("all");
    }
  }, [isMobile, statusFilter]);

  const statusTabBar = !myAssignedFilterActive ? (
    <div
      className={cx(
        "flex max-w-full items-center gap-2 overflow-x-auto pb-1",
        isMobile && "w-full",
      )}
    >
      {patientStatusTabs.map((status) => (
        <button
          key={status.id}
          type="button"
          onClick={() => {
            if (status.id === "under_review" && ["doctor", "operator", "admin"].includes(user.role)) {
              navigate(`/${user.role}/long-term-review`);
              return;
            }
            setStatusFilter(status.id);
            setPage(1);
          }}
          aria-pressed={statusFilter === status.id}
          className={cx("patient-control shrink-0 whitespace-nowrap", statusFilter === status.id && "patient-control-primary")}
        >
          <span className="flex items-center justify-center gap-2">
            {status.label}
            {!isMobile && status.id === "pending_approval" && pendingApprovalCount > 0 ? (
              <span
                className={cx(
                  "flex min-w-[20px] items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-bold",
                  statusFilter === status.id
                    ? "bg-white text-red-600"
                    : "bg-red-500 text-white",
                )}
              >
                {pendingApprovalCount}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  ) : (
    <span className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">
      Active assigned cases only
    </span>
  );

  const statusFilters = (
    <div className="flex flex-wrap items-center gap-2">
      {statusTabBar}

      {!isMobile && !myAssignedFilterActive && !isRecentlyDeletedView ? (
        <select
        value={doctorIdFilter}
        onChange={(event) => {
          setDoctorIdFilter(event.target.value);
          setPage(1);
        }}
        aria-label="Assigned doctor filter"
        className="patient-control max-w-full"
      >
        <option value="">All assigned doctors</option>
        {doctors.map((doctor) => (
          <option key={doctor.id} value={doctor.id}>
            {doctor.full_name}
          </option>
        ))}
      </select>
      ) : null}
    </div>
  );

  if (loading) {
    return <LoadingState label="Loading patients" />;
  }

  return (
    <div
      className={cx(
        pageContainerClass,
        "patient-workspace patient-directory",
        isMobile
          ? "mx-auto flex min-h-[calc(100dvh-3.25rem)] w-full max-w-md flex-col space-y-3"
          : "space-y-4",
      )}
    >
      <PatientWorkspaceHeader title="Patients" subtitle={`${pagination?.total || 0} ${isRecentlyDeletedView ? "recently deleted records" : "patient records"}`} role={user.role} onRefresh={() => void handleMobileDirectoryRefresh()} refreshing={refreshing} actions={headerActions}>
        {user.role === "doctor" ? <Link className={cx("patient-control", myAssignedFilterActive && "patient-control-primary")} to="/patients?filter=my_assigned" onClick={() => window.sessionStorage.setItem(`ocs_patient_scope_${user.id}`, "my_assigned")}>My patients</Link> : null}
      </PatientWorkspaceHeader>
      {isMobile ? searchField : null}
      {offlineDirectoryActive && isDoctorMobile ? <p className="rounded-full bg-amber-50 px-4 py-2 text-sm text-amber-800">Offline — showing cached directory</p> : null}

      <SectionCard
        className="patient-directory-list"
        actions={
          !isMobile && refreshing ? (
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
              Refreshing...
            </span>
          ) : null
        }
      >
        <>
            {!isMobile ? (
              <div className="mb-4 flex flex-col gap-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  {searchField}
                  {statusFilters}
                </div>
                {myAssignedFilterBadge}

                {isRecentlyDeletedView ? (
                  <div className="rounded-[24px] border border-rose-100 bg-rose-50/80 px-4 py-3 text-sm text-rose-950">
                    Soft-deleted patients from the last 30 days. Restore returns them to the directory.
                    Permanent delete removes the patient and linked clinical records.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mb-3 space-y-3">
                {statusTabBar}
                {!myAssignedFilterActive ? (
                  <MobileDoctorFilter
                    doctors={doctors}
                    value={doctorIdFilter}
                    onChange={(nextDoctorId) => {
                      setDoctorIdFilter(nextDoctorId);
                      setPage(1);
                    }}
                  />
                ) : null}
                {myAssignedFilterBadge}
              </div>
            )}

            {patients.length ? (
              <>
                {isMobile ? (
                  /* ── Mobile: card list ── */
                  <div className="flex flex-col pb-8">
                    {patients.map((patient) => {
                      const dueLabel = isPatientUnderReview(patient)
                        ? formatReviewDueShort(patient.review_due_date)
                        : "";
                      const isDischarged =
                        String(patient.status || "").toLowerCase() === "discharged";
                      const showAssignedDoctor = !doctorIdFilter && !myAssignedFilterActive;

                      return (
                      <div
                        key={patient.id}
                        className="mb-3 flex min-w-0 max-w-full overflow-hidden rounded-[26px] border border-[#d5e4e1] bg-white p-4 transition-all active:scale-[0.99]"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-2">
                          <Link to={`/patients/${patient.id}`} onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openPatientProfile(patient.id); } }} className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 flex flex-wrap items-center gap-y-1 break-words">
                                <span className="text-base font-bold text-slate-700">
                                  {patient.full_name}
                                </span>
                                <PortalAccountBadge patient={patient} mobile />
                              </p>
                              {dueLabel ? (
                                <span className="shrink-0 rounded-full bg-ocs-slate/10 px-2 py-0.5 text-xs font-bold text-ocs-slate">
                                  Due {dueLabel}
                                </span>
                              ) : isDischarged ? (
                                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                                  Out
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 break-words text-xs font-medium text-ocs-grey">
                              {formatMobilePatientMetaLine(patient)}
                            </p>
                            <p
                              className={`mt-1 flex items-start gap-1 text-xs font-semibold ${
                                patient.location?.trim() ? "text-slate-500" : "text-rose-700"
                              }`}
                            >
                              <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />
                              {patient.location?.trim() || "Location required · not dispatch ready"}
                            </p>
                            {showAssignedDoctor ? (
                              <p className="mt-1 text-xs font-medium text-ocs-grey">
                                {displayText(patient.assigned_doctor_name, "Not assigned")}
                              </p>
                            ) : null}

                            {offlineDirectoryActive && patient.offline_directory ? (
                              <div className="mt-3 space-y-1.5 rounded-xl border border-slate-100 bg-white p-2.5 text-[11px] leading-relaxed text-slate-700">
                                <p>
                                  <span className="font-bold text-gray-800">Location:</span>{" "}
                                  {patient.offline_directory.address_location}
                                </p>
                                <p>
                                  <span className="font-bold text-gray-800">Emergency:</span>{" "}
                                  {patient.offline_directory.emergency_contact}
                                </p>
                                <p>
                                  <span className="font-bold text-gray-800">Alerts:</span>{" "}
                                  {patient.offline_directory.medical_alerts}
                                </p>
                                <p>
                                  <span className="font-bold text-gray-800">Last visit:</span>{" "}
                                  {patient.offline_directory.last_consultation_summary}
                                </p>
                              </div>
                            ) : null}

                          </Link>

                          <button
                            type="button"
                            aria-label="Patient actions"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setPatientCardMenu(patient);
                            }}
                            className="grid size-10 shrink-0 place-items-center rounded-xl text-gray-500 transition hover:bg-[#557373]/10 hover:text-gray-800 active:scale-95"
                          >
                            <MoreVertical className="size-5" strokeWidth={2.25} />
                          </button>
                        </div>
                      </div>
                      );
                    })}

                    {pagination ? (
                      <div className="mt-5 flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-slate-500">
                          Page {pagination.page} of {pagination.totalPages}
                        </p>
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            disabled={pagination.page <= 1}
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            disabled={pagination.page >= pagination.totalPages}
                            onClick={() =>
                              setPage((current) => Math.min(pagination.totalPages, current + 1))
                            }
                            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : isRecentlyDeletedView ? (
                  <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
                    <div className="overflow-x-auto">
                      <table className="min-w-full table-fixed bg-white text-left">
                        <thead className="bg-gradient-to-r from-ocs-slate to-[#2f4749] text-xs font-semibold uppercase tracking-[0.22em] text-white">
                          <tr>
                            <th className="w-[24%] px-4 py-2.5">Patient</th>
                            <th className="w-[18%] px-4 py-2.5">Contact</th>
                            <th className="w-[18%] px-4 py-2.5">Assigned clinician</th>
                            <th className="w-[14%] px-4 py-2.5">Deleted</th>
                            <th className="w-[12%] px-4 py-2.5">Records</th>
                            <th className="w-[14%] px-4 py-2.5 text-right">Restore</th>
                          </tr>
                        </thead>
                        <tbody>
                          {patients.map((patient) => (
                            <tr
                              key={patient.id}
                              className="border-t border-slate-200/70 text-slate-700 transition hover:bg-slate-50"
                            >
                              <td className="max-w-0 px-4 py-3 align-top">
                                <div className="min-w-0 space-y-0.5">
                                  <p className="truncate font-semibold leading-tight text-slate-950">
                                    {patient.full_name}
                                  </p>
                                  <p className="truncate text-xs text-slate-500">
                                    <PatientCareNumber patient={patient} className="truncate" />
                                  </p>
                                  <p className="truncate text-xs text-slate-500">
                                    ID: {displayText(patient.patient_id_number)}
                                  </p>
                                </div>
                              </td>
                              <td className="max-w-0 px-4 py-3 align-top">
                                <p className="truncate text-sm font-medium text-slate-800">
                                  {displayText(patient.patient_contact_number)}
                                </p>
                                <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                                  {displayText(patient.location, "Location not selected")}
                                </p>
                              </td>
                              <td className="max-w-0 px-4 py-3 align-top">
                                <p className="line-clamp-2 text-sm font-semibold text-slate-800">
                                  {formatAssignedClinicianLine(patient)}
                                </p>
                              </td>
                              <td className="px-4 py-3 align-top text-sm text-slate-600">
                                {formatDate(patient.deleted_at)}
                                {patient.deleted_reason ? (
                                  <p className="mt-1 text-xs leading-snug text-slate-500">
                                    Reason: {patient.deleted_reason}
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-4 py-3 align-top text-xs leading-snug text-slate-500">
                                <p>{Number(patient.appointment_count || 0)} appointments</p>
                                <p>{Number(patient.consultation_count || 0)} consultations</p>
                                <p>{Number(patient.bill_count || 0)} bills</p>
                              </td>
                              <td className="px-4 py-3 align-top">
                                <div className="flex flex-col items-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setPatientToRestore(patient)}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-ocs-teal px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-ocs-teal/90"
                                  >
                                    <RotateCcw className="size-3.5" aria-hidden />
                                    Restore
                                  </button>
                                  {canPurgePatients ? (
                                    <button
                                      type="button"
                                      onClick={() => setPatientToPurge(patient)}
                                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                                    >
                                      <Trash2 className="size-3.5" aria-hidden />
                                      Delete forever
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  /* ── Desktop: original table ── */
                  <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
                    <div className="overflow-x-auto">
                      <table className="min-w-full table-fixed bg-white text-left">
                        <thead className="bg-gradient-to-r from-ocs-slate to-[#2f4749] text-xs font-semibold uppercase tracking-[0.22em] text-white">
                          {isUnderReviewView ? (
                            <tr>
                              <th className="w-[20%] px-4 py-2.5">Patient</th>
                              <th className="w-[18%] px-4 py-2.5">Age / location</th>
                              <th className="w-[18%] px-4 py-2.5">Assigned clinician</th>
                              <th className="w-[16%] px-4 py-2.5">Review timeline</th>
                              <th className="w-[22%] px-4 py-2.5">Review notes</th>
                              <th className="sticky right-0 z-10 w-12 bg-[#2f4749] px-2 py-2.5 text-right text-white shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.18)]">
                                <span className="sr-only">Row actions</span>
                              </th>
                            </tr>
                          ) : (
                            <tr>
                              <th className="w-[44%] px-4 py-2.5">Patient</th>
                              <th className="w-[28%] px-4 py-2.5">Contact</th>
                              <th className="w-[20%] px-4 py-2.5">Doctor</th>
                              <th className="sticky right-0 z-10 w-12 bg-[#2f4749] px-2 py-2.5 text-right text-white shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.18)]">
                                <span className="sr-only">Row actions</span>
                              </th>
                            </tr>
                          )}
                        </thead>
                        <tbody>
                          {patients.map((patient) => {
                            const reviewNote = String(patient.review_reason_note || "").trim();
                            const dueLabel = formatReviewTimelineDate(patient.review_due_date);
                            const dueShort = isPatientUnderReview(patient)
                              ? formatReviewDueShort(patient.review_due_date)
                              : "";
                            const status = String(patient.status || "").toLowerCase();

                            return (
                            <tr
                              key={patient.id}
                              onClick={() => openPatientProfile(patient.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openPatientProfile(patient.id);
                                }
                              }}
                              tabIndex={0}
                              role="link"
                              aria-label={`Open patient profile for ${patient.full_name}`}
                              className="cursor-pointer border-t border-slate-200/70 text-slate-700 outline-none transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-400/40"
                            >
                              {isUnderReviewView ? (
                                <>
                                  <td className="max-w-0 px-4 py-2 align-top">
                                    <div className="min-w-0 space-y-0.5">
                                      <p className="flex flex-wrap items-center gap-y-1">
                                        <span className="truncate font-semibold leading-tight text-slate-950">
                                          {patient.full_name}
                                        </span>
                                        <PortalAccountBadge patient={patient} desktop />
                                      </p>
                                      <p className="truncate text-xs text-slate-500">
                                        <PatientCareNumber patient={patient} className="truncate" />
                                      </p>
                                    </div>
                                  </td>

                                  <td className="max-w-0 px-4 py-2 align-top">
                                    <p className="truncate text-sm font-medium leading-snug text-slate-700">
                                      {formatUnderReviewAgeLocationLine(patient)}
                                    </p>
                                  </td>

                                  <td className="max-w-0 px-4 py-2 align-top">
                                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800">
                                      {formatAssignedClinicianLine(patient)}
                                    </p>
                                  </td>

                                  <td className="px-4 py-2 align-top">
                                    {dueLabel ? (
                                      <p className="text-sm font-bold text-amber-700">⏱ Due: {dueLabel}</p>
                                    ) : (
                                      <p className="text-sm font-bold text-slate-500">⏱ Due date not set</p>
                                    )}
                                  </td>

                                  <td className="max-w-0 px-4 py-2 align-top">
                                    <div
                                      className="max-w-xs truncate text-xs font-medium text-gray-600 cursor-help"
                                      title={reviewNote || undefined}
                                    >
                                      {reviewNote || "No review note recorded"}
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                              <td className="max-w-0 px-4 py-2.5 align-top">
                                <div className="min-w-0 space-y-0.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="min-w-0 flex flex-wrap items-center gap-y-1">
                                      <span className="font-semibold leading-snug text-slate-950">
                                        {patient.full_name}
                                      </span>
                                      <PortalAccountBadge patient={patient} desktop />
                                    </p>
                                    {dueShort ? (
                                      <span className="shrink-0 rounded-full bg-ocs-slate/10 px-2 py-0.5 text-xs font-bold text-ocs-slate">
                                        Due {dueShort}
                                      </span>
                                    ) : status === "discharged" ? (
                                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                                        Out
                                      </span>
                                    ) : status === "pending_approval" ? (
                                      <StatusBadge value={patient.status} />
                                    ) : null}
                                  </div>
                                  <p className="text-xs leading-snug text-slate-500">
                                    {formatMobilePatientMetaLine(patient)}
                                  </p>
                                </div>
                              </td>

                              <td className="max-w-0 px-4 py-2.5 align-top">
                                <p className="truncate text-sm font-medium leading-tight text-slate-800">
                                  {displayText(patient.patient_contact_number)}
                                </p>
                                <p className="mt-0.5 truncate text-xs leading-snug text-slate-500">
                                  {displayText(patient.location, "Location not selected")}
                                </p>
                              </td>

                              <td className="max-w-0 px-4 py-2.5 align-top">
                                <p className="truncate text-sm font-medium leading-snug text-ocs-grey">
                                  {displayText(patient.assigned_doctor_name, "Not assigned")}
                                </p>
                              </td>
                                </>
                              )}

                              <td className="sticky right-0 z-10 bg-white px-2 py-2 align-top shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.12)]">
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    aria-label={`More actions for ${patient.full_name}`}
                                    aria-expanded={
                                      desktopTableMenu?.patient.id === patient.id
                                    }
                                    aria-haspopup="menu"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (desktopTableMenu?.patient.id === patient.id) {
                                        setDesktopTableMenu(null);
                                        return;
                                      }
                                      const rect = event.currentTarget.getBoundingClientRect();
                                      const menuWidth = 176;
                                      setDesktopTableMenu({
                                        patient,
                                        top: rect.bottom + 6,
                                        left: Math.max(8, rect.right - menuWidth),
                                      });
                                    }}
                                    className="grid size-9 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50"
                                  >
                                    <MoreVertical className="size-4" aria-hidden />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {!isMobile && !isRecentlyDeletedView ? (
                <div className="mt-5 flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">
                    Page {pagination.page} of {pagination.totalPages}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={pagination.page <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() =>
                        setPage((current) => Math.min(pagination.totalPages, current + 1))
                      }
                      className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
                ) : null}
              </>
            ) : (
              <EmptyState
                title={isRecentlyDeletedView ? "No recently deleted patients" : "No patients found"}
                description={
                  isRecentlyDeletedView
                    ? "Patients soft-deleted in the last 30 days will appear here so you can restore them."
                    : "Try a broader search or add a new patient to start tracking consultations and billing."
                }
                action={!isRecentlyDeletedView && canCreatePatients ? headerActions : null}
              />
            )}
        </>
      </SectionCard>

      {desktopTableMenu ? (
        <>
          <button
            type="button"
            aria-label="Dismiss menu"
            className="fixed inset-0 z-[45] cursor-default bg-transparent"
            onClick={() => setDesktopTableMenu(null)}
          />
          <div
            role="menu"
            className="fixed z-[50] min-w-[11rem] rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
            style={{ top: desktopTableMenu.top, left: desktopTableMenu.left }}
          >
            {canEditPatient(desktopTableMenu.patient) ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const p = desktopTableMenu.patient;
                  setDesktopTableMenu(null);
                  setEditor({ mode: "edit", patient: p });
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <SquarePen className="size-4 shrink-0 text-slate-500" />
                Edit
              </button>
            ) : null}
            {canOpenBilling && canBillPatientForUser(user, desktopTableMenu.patient) ? (
              <Link
                role="menuitem"
                to={`/billing?patientId=${desktopTableMenu.patient.id}`}
                onClick={() => setDesktopTableMenu(null)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <CreditCard className="size-4 shrink-0 text-slate-500" />
                Billing
              </Link>
            ) : null}
            {shouldShowReviewLogUpdate(desktopTableMenu.patient) ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const patient = desktopTableMenu.patient;
                  setDesktopTableMenu(null);
                  openLogUpdate(patient);
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <span aria-hidden className="text-base leading-none">
                  📝
                </span>
                Log update
              </button>
            ) : null}
            {canDeletePatients ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const p = desktopTableMenu.patient;
                  setDesktopTableMenu(null);
                  setPatientToDelete(p);
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
              >
                <Trash2 className="size-4 shrink-0" />
                Delete
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {isMobile && patientCardMenu ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-[1px]"
            onClick={() => setPatientCardMenu(null)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-[61] rounded-t-[28px] border border-slate-200/80 bg-white px-4 pt-3 shadow-[0_-12px_40px_rgba(15,23,42,0.12)]"
            style={{
              paddingBottom: "max(1rem, var(--sab))",
              paddingLeft: "max(1rem, var(--sal))",
              paddingRight: "max(1rem, var(--sar))",
            }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" aria-hidden />
            <p className="truncate text-base font-semibold text-slate-950">{patientCardMenu.full_name}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {displayText(patientCardMenu.patient_identifier)}
            </p>
            <div className="mt-4 grid gap-2">
              {canEditPatient(patientCardMenu) ? (
                <button
                  type="button"
                  onClick={() => {
                    setPatientCardMenu(null);
                    setEditor({ mode: "edit", patient: patientCardMenu });
                  }}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 py-3 text-sm font-semibold text-slate-800 transition active:bg-slate-100"
                >
                  <SquarePen className="size-4" />
                  Edit patient
                </button>
              ) : null}
              {canOpenBilling && canBillPatientForUser(user, patientCardMenu) ? (
                <Link
                  to={`/billing?patientId=${patientCardMenu.id}`}
                  onClick={() => setPatientCardMenu(null)}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 py-3 text-sm font-semibold text-slate-800 transition active:bg-slate-100"
                >
                  <CreditCard className="size-4" />
                  Billing
                </Link>
              ) : null}
              {shouldShowReviewLogUpdate(patientCardMenu) ? (
                <button
                  type="button"
                  onClick={() => {
                    const patient = patientCardMenu;
                    setPatientCardMenu(null);
                    openLogUpdate(patient);
                  }}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 py-3 text-sm font-semibold text-slate-800 transition active:bg-slate-100"
                >
                  <span aria-hidden>📝</span>
                  Log update
                </button>
              ) : null}
              {canDeletePatients ? (
                <button
                  type="button"
                  onClick={() => {
                    setPatientCardMenu(null);
                    setPatientToDelete(patientCardMenu);
                  }}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/60 py-3 text-sm font-semibold text-rose-700 transition active:bg-rose-100"
                >
                  <Trash2 className="size-4" />
                  Delete patient
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setPatientCardMenu(null)}
                className="mt-1 min-h-12 w-full rounded-2xl py-3 text-sm font-semibold text-slate-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      ) : null}

      <PatientFormModal
        canEditPatientIdentifier={canEditPatientIdentifier}
        canSelectAssignedDoctor={user.role === "admin" || user.role === "operator"}
        doctors={doctors}
        isSaving={isSaving}
        mode={editor?.mode}
        open={Boolean(editor)}
        patient={editor?.patient}
        onClose={() => setEditor(null)}
        onSubmit={handleSave}
      />

      <ConfirmDialog
        open={Boolean(patientToDelete)}
        onClose={() => {
          setPatientToDelete(null);
          setDeleteReason("");
        }}
        onConfirm={handleDelete}
        title="Delete patient?"
        description={
          patientToDelete
            ? `${patientToDelete.full_name} will be removed from the patient directory. Clinical history stays in the database but the record will no longer appear in searches.`
            : ""
        }
        confirmLabel="Remove patient"
        busy={lifecycleBusy}
        confirmDisabled={deleteReason.trim().length < 10}
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Reason for removal *</span>
          <textarea
            autoFocus
            rows={3}
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
            placeholder="Record why this patient is being removed"
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-ocs-teal"
          />
          <span className="text-xs text-slate-500">At least 10 characters. This is kept in the audit trail.</span>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(patientToRestore)}
        onClose={() => {
          setPatientToRestore(null);
          setRestoreReason("");
        }}
        onConfirm={handleRestore}
        title="Restore patient?"
        description={
          patientToRestore
            ? `${patientToRestore.full_name} will return to the patient directory with their clinical history intact.`
            : ""
        }
        confirmLabel="Restore patient"
        tone="default"
        busy={lifecycleBusy}
        confirmDisabled={restoreReason.trim().length < 10}
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Reason for restoration *</span>
          <textarea
            autoFocus
            rows={3}
            value={restoreReason}
            onChange={(event) => setRestoreReason(event.target.value)}
            placeholder="Record why this patient is being restored"
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-ocs-teal"
          />
          <span className="text-xs text-slate-500">At least 10 characters. This is kept in the audit trail.</span>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(patientToPurge)}
        onClose={() => setPatientToPurge(null)}
        onConfirm={handlePermanentDelete}
        title="Permanently delete patient?"
        description={
          patientToPurge
            ? `${patientToPurge.full_name} and linked clinical records will be permanently removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete forever"
      />

      {longTermReviewLogDialogs}
    </div>
  );
}

export default PatientsPage;
