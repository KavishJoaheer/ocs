import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarClock,
  Camera,
  ChevronRight,
  CreditCard,
  FileText,
  Flag,
  FlaskConical,
  GitMerge,
  History,
  HeartPulse,
  LockKeyhole,
  MoreHorizontal,
  Paperclip,
  Phone,
  Pill,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  SquarePen,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import { LongTermReviewLogUpdateButton } from "../components/LongTermReviewLogUpdate.jsx";
import {
  canFlagLongTermReview,
  canLogLongTermReviewUpdate,
} from "../lib/longTermReviewAccess.js";
import { useLongTermReviewLogUpdate } from "../hooks/useLongTermReviewLogUpdate.jsx";
import Modal from "../components/Modal.jsx";
import PatientWorkspaceHeader from "../components/patient-workspace/PatientWorkspaceHeader.jsx";
import { PATIENT_ID_TYPES } from "../lib/patientIdentity.js";
import PatientLinkhamPolicyBadge from "../components/PatientLinkhamPolicyBadge.jsx";
import { PatientFormModal } from "../components/PatientIntakeForm.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import { formatVitalInput } from "../lib/consultationVitals.js";
import {
  closePreviewTab,
  openInlinePreviewTab,
  presentFileBlob,
  supportsInlineBlobPreview,
} from "../lib/fileBlobViewer.js";
import { sanitizeLocationTagsForDisplay } from "../lib/locationTags.js";
import {
  canEditConsultationNote,
  canManageConsultationNotes,
  canViewConsultationNotes,
  isOperatorConsultationViewOnly,
} from "../lib/consultationAccess.js";
import { canBillPatientForUser } from "../lib/access.js";
import {
  canDeleteLabReportAttachment,
  canManageLabReportsForUser,
  canViewLabReportsForUser,
} from "../lib/labReportAccess.js";
import {
  LAB_REPORT_CAMERA_ACCEPT,
  LAB_REPORT_LIBRARY_ACCEPT,
  LAB_REPORT_MAX_NEW_FILES,
  labReportFileKey,
  mergeLabReportFiles,
} from "../lib/labReportFiles.js";
import {
  formatAgeFromDateOfBirth,
  formatCurrency,
  formatDate,
  formatPaymentMethod,
} from "../lib/format.js";
import {
  defaultReviewDueDateInputValue,
  formatScheduledReviewDate,
  formatReviewAppointmentTime,
  getReviewDoctorName,
  isPatientUnderReview,
} from "../lib/patientReview.js";
import { cx } from "../lib/utils.js";
import PatientCareInvitation from "../components/PatientCareInvitation.jsx";
import PatientLocationTags from "../components/PatientLocationTags.jsx";

function LongTermReviewAlertBanner({ patient, actions }) {
  const date = patient.review_due_date ? formatScheduledReviewDate(patient.review_due_date) : "Date not scheduled";
  const time = formatReviewAppointmentTime(patient.review_appointment_time);
  const doctor = getReviewDoctorName(patient);
  return <aside data-testid="patient-review-summary" className="patient-priority-notice rounded-[24px] border border-amber-200 bg-[#fff9ed] px-4 py-3 text-[#705822]">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="text-sm font-bold">Review appointment</p><p className="mt-1 break-words text-sm">{[date, time, doctor].filter(Boolean).join(" · ")}</p></div>{actions}</div>
    {patient.review_reason_note ? <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">Review reason</summary><p className="mt-2 whitespace-pre-wrap break-words">{patient.review_reason_note}</p></details> : null}
  </aside>;
}

function PatientDetailsDisclosure({ title, hint, children }) {
  return <details className="rounded-[26px] border border-[#d5e4e1] bg-white px-4 py-3">
    <summary className="min-h-11 cursor-pointer content-center text-sm font-bold text-[#173f4a]">{title}{hint ? <span className="ml-2 font-normal text-slate-500">{hint}</span> : null}</summary>
    <div className="mt-3 border-t border-slate-100 pt-3">{children}</div>
  </details>;
}

function LongTermReviewReasonModal({ open, onClose, onSubmit, isSaving }) {
  const [dueDate, setDueDate] = useState(defaultReviewDueDateInputValue);
  const [note, setNote] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDueDate(defaultReviewDueDateInputValue());
      setNote("");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Flag for review appointment"
      description="Set the target review date and reason for continuous follow-up tracking."
      size="md"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = note.trim();
          if (!dueDate) {
            toast.error("Select a target review date.");
            return;
          }
          if (!trimmed) {
            toast.error("Enter a reason for continuous follow-up tracking.");
            return;
          }
          onSubmit({ review_due_date: dueDate, review_reason_note: trimmed });
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Target review date</span>
          <input
            required
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-amber-400 focus:bg-white"
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Reason note</span>
          <textarea
            required
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. chronic glucose monitoring, geriatric fall risk, medication adherence"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-amber-400 focus:bg-white"
          />
        </label>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save flag"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LongTermReviewFlagButton({ patient, disabled, isSaving, onRequestFlag, onUnflag }) {
  const flagged = isPatientUnderReview(patient);

  if (flagged) {
    return (
      <button
        type="button"
        disabled={disabled || isSaving}
        onClick={onUnflag}
        className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CalendarCheck className="size-4" />
        Under Active Review
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || isSaving}
      onClick={onRequestFlag}
      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Flag className="size-4" />
      Flag for Review Appointment
    </button>
  );
}

function HighlightStat({ icon: Icon, label, value, prominent = false, primary = false }) {
  return (
    <span className={cx(
      "inline-flex max-w-full min-w-0 items-center gap-2 rounded-full px-3 py-2",
      prominent ? "patient-profile-highlight" : "bg-[#eaf5f1] text-xs text-[#376168]",
    )}>
      {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
      <span className={prominent ? "patient-profile-highlight-label" : undefined}>{label}</span>
      {prominent ? <span aria-hidden="true">·</span> : null}
      <strong className={cx(
        "min-w-0 break-words",
        prominent ? "patient-profile-highlight-value" : "text-[#173f4a]",
        prominent && primary && "patient-profile-highlight-value-primary",
      )}>{value}</strong>
    </span>
  );
}

function MobileBillingStatusBar({ status }) {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "paid") {
    return (
      <span className="inline-flex rounded-lg border border-[#e6ebd9]/80 bg-[#e6ebd9]/40 px-3 py-1 text-xs font-bold text-[#3b4733]">
        Paid
      </span>
    );
  }

  if (normalized === "unpaid") {
    return (
      <span className="inline-flex rounded-lg bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800">
        Unpaid
      </span>
    );
  }

  if (normalized === "ready_to_issue") {
    return (
      <span className="inline-flex rounded-lg bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
        Ready to issue
      </span>
    );
  }

  return <StatusBadge value={status} />;
}

function patientBillStatus(bill) {
  return bill?.finalized_at ? (bill.payment_status || bill.status) : "ready_to_issue";
}

function patientBillOpenPath(bill, patientId, role) {
  if (role === "operator") {
    if (bill?.finalized_at) {
      const status = String(bill.status || "").toLowerCase() === "paid" ? "paid" : "unpaid";
      return `/operator/pending-payment?billId=${bill.id}&status=${status}`;
    }
    if (bill?.active_submission_id) {
      return `/billing?view=status&submissionConsultationId=${bill.consultation_id}`;
    }
    return `/billing?doctorId=${bill.consultation_doctor_id || bill.doctor_id_snapshot || ""}&consultationId=${bill.consultation_id}`;
  }
  return `/billing?patientId=${patientId}&billId=${bill.id}`;
}

function getMobileBillingCanvasClass(bills) {
  if (!bills?.length) {
    return "space-y-4";
  }

  const hasUnpaid = bills.some(
    (bill) => String(patientBillStatus(bill)).trim().toLowerCase() === "unpaid",
  );

  return cx(
    "space-y-4 rounded-2xl border p-4",
    hasUnpaid
      ? "border-rose-100/80 bg-rose-50/30"
      : "border-[#e6ebd9]/80 bg-[#e6ebd9]/40 text-[#3b4733]",
  );
}

function getMobileBillingCardClass(bill) {
  const normalized = String(patientBillStatus(bill)).trim().toLowerCase();

  if (normalized === "paid") {
    return "rounded-[24px] border border-[#e6ebd9]/80 bg-[#e6ebd9]/40 p-4 text-[#3b4733]";
  }

  if (normalized === "unpaid") {
    return cx(
      "rounded-[24px] border border-slate-200/80 p-4",
      getBillingHistoryRowClass(normalized),
    );
  }

  return "rounded-[24px] border border-slate-200/80 bg-white p-4";
}


function ProfileField({ label, value, emphasize = false }) {
  return (
    <div className="max-w-full min-w-0 rounded-[18px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 break-words text-sm leading-6 ${
          emphasize ? "font-semibold text-slate-900" : "text-slate-600"
        }`}
      >
        {value || "Not recorded"}
      </p>
    </div>
  );
}

function profileLine(value, emptyLabel = "Not recorded") {
  const t = value != null && String(value).trim() !== "" ? String(value).trim() : "";
  return { text: t || emptyLabel, isEmpty: !t };
}

function ProfileDlItem({ label, value, emphasize = false, emptyLabel }) {
  const { text, isEmpty } = profileLine(value, emptyLabel);
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-ocs-grey">{label}</dt>
      <dd
        className={cx(
          "mt-0.5 break-words text-sm leading-snug",
          isEmpty ? "text-ocs-grey" : emphasize ? "font-bold text-slate-800" : "font-medium text-slate-800",
        )}
      >
        {text}
      </dd>
    </div>
  );
}

function ClinicalGridItem({ label, value }) {
  const { text, isEmpty } = profileLine(value);
  return (
    <div className="min-w-0 border-b border-gray-100 pb-2">
      <p className="text-xs font-bold uppercase tracking-widest text-ocs-grey">{label}</p>
      <p
        className={cx(
          "mt-0.5 whitespace-pre-line break-words text-sm leading-snug",
          isEmpty ? "text-ocs-grey" : "text-slate-800",
        )}
      >
        {text}
      </p>
    </div>
  );
}

function getBillingHistoryRowClass(status) {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "paid") {
    return "bg-emerald-50/30 transition-colors hover:bg-emerald-50/60";
  }

  if (normalized === "unpaid") {
    return "bg-rose-50/40 transition-colors hover:bg-rose-50/70";
  }

  return "";
}

const CONSULTATION_ROWS_LIMIT = 5;
/** Collapses runs of blank lines so pre-line rendering stays readable. */
function formatConsultationNoteForDisplay(text) {
  if (text == null || text === "") {
    return "";
  }

  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function hasMeaningfulPatientField(value) {
  if (value == null) return false;
  const t = String(value).trim();
  if (!t) return false;
  if (t.toLowerCase() === "not recorded") return false;
  return true;
}

function formatMobileDoctorName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr ${trimmed}`;
}

function formatDoctorDisplayName(name) {
  const trimmed = String(name || "").trim().split(" - ")[0].trim();
  if (!trimmed) return "";
  const withoutPrefix = trimmed.replace(/^dr\.?\s+/i, "").trim();
  return withoutPrefix ? `Dr ${withoutPrefix}` : "";
}

const DESKTOP_SECTION_TITLE_CLASS =
  "inline-block rounded-full border border-white/60 bg-slate-200/40 px-3 py-1 text-sm font-semibold text-ocs-slate";

const MOBILE_TABS = [
  { key: "summary", label: "Summary" },
  { key: "notes", label: "Notes" },
  { key: "reports", label: "Reports" },
  { key: "billing", label: "Billing" },
];

function getEmptyLabReport() {
  return {
    consultation_id: "",
    report_title: "",
    report_date: dayjs().format("YYYY-MM-DD"),
    report_details: "",
  };
}

function formatAttachmentSize(bytes) {
  const value = Number(bytes || 0);

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${value} B`;
}

function getEmptyConsultationEntry(user) {
  return {
    doctor_id: user?.role === "doctor" && user?.doctor_id ? String(user.doctor_id) : "",
    consultation_date: dayjs().format("YYYY-MM-DD"),
    appointment_time: dayjs().format("HH:mm"),
    doctor_notes: "",
    clinical_note: "",
    patient_diagnosis: "",
    patient_prescription: "",
    vital_bp: "",
    vital_temperature: "",
    vital_glycemia: "",
    vital_spo2: "",
    vital_pulse: "",
  };
}

const DESKTOP_CONSULTATION_FIELD_CLASS =
  "w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 leading-7 outline-none transition focus:border-ocs-teal focus:bg-white focus:ring-2 focus:ring-ocs-teal/20";

const CONSULTATION_VITAL_FIELD_CLASS =
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20";

const CONSULTATION_VITAL_FIELDS = [
  { key: "vital_bp", label: "BP", placeholder: "120/80" },
  { key: "vital_temperature", label: "T", placeholder: "36.6", unit: "°C" },
  { key: "vital_glycemia", label: "Gr", placeholder: "5.5 / 100" },
  { key: "vital_spo2", label: "SpO2", placeholder: "98", unit: "%" },
  { key: "vital_pulse", label: "Pulse", placeholder: "72" },
];

function roleLabel(role) {
  if (role === "admin") return "Admin";
  if (role === "lab_tech") return "Lab tech";
  if (role === "doctor") return "Doctor";
  if (role === "operator") return "Operator";
  return "Team";
}

/** Public http(s) URLs: use a real <a> so mobile Safari/Chrome do not block navigation. */
function getLabReportAttachmentPublicUrl(attachment) {
  if (!attachment) {
    return null;
  }

  const candidates = [attachment.public_url, attachment.file_url, attachment.download_url];
  for (const value of candidates) {
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) {
      return value.trim();
    }
  }

  return null;
}

const LAB_REPORT_OPEN_FILE_BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700 md:text-ocs-slate md:hover:border-ocs-teal md:hover:text-ocs-teal";

function LabReportAttachmentRow({
  attachment,
  user,
  onOpen,
  onDelete,
  className,
  compact = false,
}) {
  const canDelete = canDeleteLabReportAttachment(user, attachment);
  const touchStyle = compact ? { minHeight: 48 } : undefined;
  const publicFileUrl = getLabReportAttachmentPublicUrl(attachment);

  return (
    <div
      className={cx(
        "flex flex-wrap items-center justify-between gap-3",
        className || "rounded-2xl bg-white px-4 py-3",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{attachment.original_name}</p>
        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
          {formatAttachmentSize(attachment.file_size)}
          {attachment.uploaded_by_role ? (
            <>
              {" "}
              • {roleLabel(attachment.uploaded_by_role)} upload
            </>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-row items-center gap-2">
        {publicFileUrl ? (
          <a
            href={publicFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={LAB_REPORT_OPEN_FILE_BUTTON_CLASS}
            style={touchStyle}
          >
            <Paperclip className="size-4" />
            Open file
          </a>
        ) : (
          <button
            type="button"
            onClick={() => onOpen(attachment)}
            className={LAB_REPORT_OPEN_FILE_BUTTON_CLASS}
            style={touchStyle}
          >
            <Paperclip className="size-4" />
            Open file
          </button>
        )}
        {canDelete ? (
          <button
            type="button"
            onClick={() => onDelete(attachment)}
            className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-semibold text-red-500 transition hover:bg-red-50"
            style={touchStyle}
          >
            <Trash2 className="size-4" />
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

function getConsultationDraft(consultation) {
  return {
    doctor_id: consultation?.doctor_id ? String(consultation.doctor_id) : "",
    consultation_date: consultation?.consultation_date ?? dayjs().format("YYYY-MM-DD"),
    doctor_notes: consultation?.doctor_notes ?? "",
  };
}

function LabReportFilePickerButton({ accept, capture, disabled, icon: Icon, label, multiple, onFiles }) {
  return (
    <label
      className={`relative inline-flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-2xl border px-3 py-2.5 text-sm font-semibold transition ${
        disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
          : "border-slate-200 bg-white text-ocs-slate hover:border-ocs-teal hover:text-ocs-teal"
      }`}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
      <input
        accept={accept}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        disabled={disabled}
        multiple={Boolean(multiple)}
        type="file"
        {...(capture ? { capture } : {})}
        onChange={(event) => {
          const picker = event.currentTarget;
          onFiles(Array.from(picker.files || []));
          picker.value = "";
        }}
      />
    </label>
  );
}

function LabReportModal({
  open,
  report,
  consultations,
  user,
  onDeleteAttachment,
  onDownloadAttachment,
  onClose,
  onSubmit,
  isSaving,
}) {
  const [form, setForm] = useState(getEmptyLabReport());
  const [selectedFiles, setSelectedFiles] = useState([]);
  const selectedFilesRef = useRef([]);
  const isEditing = Boolean(report?.id);
  const [syncedDeps, setSyncedDeps] = useState({ open, report, isEditing });

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  if (
    syncedDeps.open !== open ||
    syncedDeps.report !== report ||
    syncedDeps.isEditing !== isEditing
  ) {
    setSyncedDeps({ open, report, isEditing });
    if (open) {
      setForm(
        isEditing
          ? {
              consultation_id: report.consultation_id ? String(report.consultation_id) : "",
              report_title: report.report_title ?? "",
              report_date: report.report_date ?? dayjs().format("YYYY-MM-DD"),
              report_details: report.report_details ?? "",
            }
          : getEmptyLabReport(),
      );
      setSelectedFiles([]);
    }
  }

  const selectedConsultation = form.consultation_id
    ? consultations.find((consultation) => consultation.id === Number(form.consultation_id)) || null
    : null;

  function handleIncomingFiles(incoming) {
    if (!incoming?.length) {
      return;
    }

    const result = mergeLabReportFiles(selectedFilesRef.current, incoming);
    setSelectedFiles(result.files);
    if (result.skippedOverflow) {
      toast.error(`You can attach up to ${result.max} files at a time.`);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();

    onSubmit({
      consultation_id: form.consultation_id ? Number(form.consultation_id) : null,
      report_title: form.report_title,
      report_date: form.report_date,
      report_details: form.report_details,
      attachments: selectedFiles,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Medical & Lab Report" : "Add Medical & Lab Report"}
      size="xl"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-[1fr_0.45fr]">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Report title</span>
            <input
              required
              value={form.report_title}
              onChange={(event) =>
                setForm((current) => ({ ...current, report_title: event.target.value }))
              }
              placeholder="CBC panel, urine analysis, liver function test..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Report date</span>
            <input
              required
              type="date"
              value={form.report_date}
              onChange={(event) =>
                setForm((current) => ({ ...current, report_date: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
            />
          </label>
        </div>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">
            Linked consultation
            <span className="ml-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              Optional
            </span>
          </span>
          <select
            value={form.consultation_id}
            onChange={(event) =>
              setForm((current) => ({ ...current, consultation_id: event.target.value }))
            }
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
          >
            <option value="">No linked consultation</option>
            {consultations.map((consultation) => (
              <option key={consultation.id} value={consultation.id}>
                {consultation.doctor_name} - {formatDate(consultation.consultation_date)}
              </option>
            ))}
          </select>
        </label>

        {selectedConsultation ? (
          <div className="rounded-[24px] border border-sky-100 bg-sky-50/75 p-4 md:border-ocs-teal/20 md:bg-ocs-teal/10">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 md:text-ocs-teal">
              Linked consultation
            </p>
            <p className="mt-2 text-lg font-semibold text-slate-950 md:text-ocs-slate">
              {selectedConsultation.doctor_name}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {selectedConsultation.specialization} -{" "}
              {formatDate(selectedConsultation.consultation_date)}
            </p>
          </div>
        ) : null}

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Medical & Lab Report details</span>
          <textarea
            required
            rows="12"
            value={form.report_details}
            onChange={(event) =>
              setForm((current) => ({ ...current, report_details: event.target.value }))
            }
            placeholder="Record the requested test, clinical findings, reference notes, abnormalities, and any follow-up recommendation."
            className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 leading-7 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
          />
        </label>

        <div className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Upload files</span>
          <div className="flex gap-2">
            <LabReportFilePickerButton
              accept={LAB_REPORT_LIBRARY_ACCEPT}
              disabled={selectedFiles.length >= LAB_REPORT_MAX_NEW_FILES}
              icon={Paperclip}
              label={selectedFiles.length ? "Add more files" : "Add files"}
              multiple
              onFiles={handleIncomingFiles}
            />
            <LabReportFilePickerButton
              accept={LAB_REPORT_CAMERA_ACCEPT}
              capture="environment"
              disabled={selectedFiles.length >= LAB_REPORT_MAX_NEW_FILES}
              icon={Camera}
              label="Take photo"
              onFiles={handleIncomingFiles}
            />
          </div>
          <p className="text-xs leading-5 text-slate-500">
            PDF or image files. Each new photo or file is added to the list — it does not replace
            files already attached. You can add up to {LAB_REPORT_MAX_NEW_FILES} files.
          </p>
        </div>

        {selectedFiles.length ? (
          <div className="space-y-2 rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Files ready to upload
            </p>
            <div className="space-y-2">
              {selectedFiles.map((file, index) => (
                <div
                  key={labReportFileKey(file) || `${file.name}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{file.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                      {formatAttachmentSize(file.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))
                    }
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
                  >
                    <X className="size-4" />
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {isEditing && report?.attachments?.length ? (
          <div className="space-y-2 rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Saved files
            </p>
            <div className="space-y-2">
              {report.attachments.map((attachment) => (
                <LabReportAttachmentRow
                  key={attachment.id}
                  attachment={attachment}
                  user={user}
                  onOpen={onDownloadAttachment}
                  onDelete={onDeleteAttachment}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 md:text-ocs-slate md:hover:border-ocs-teal md:hover:text-ocs-teal"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60 md:bg-ocs-teal md:hover:bg-ocs-teal/90"
          >
            {isSaving
              ? "Saving..."
              : isEditing
                ? "Update Medical & Lab Report"
                : "Save Medical & Lab Report"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConsultationCreateModal({
  open,
  user,
  doctors,
  onClose,
  onSubmit,
  isSaving,
}) {
  const [form, setForm] = useState(getEmptyConsultationEntry(user));
  const isAdmin = user.role === "admin";
  const [syncedDeps, setSyncedDeps] = useState({ open, user });

  if (syncedDeps.open !== open || syncedDeps.user !== user) {
    setSyncedDeps({ open, user });
    if (open) {
      setForm(getEmptyConsultationEntry(user));
    }
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!form.clinical_note.trim()) {
      toast.error("Internal clinical note is required.");
      return;
    }

    if (!form.patient_diagnosis.trim()) {
      toast.error("Patient-facing diagnosis is required.");
      return;
    }

    onSubmit({
      doctor_id: isAdmin ? Number(form.doctor_id) : Number(user.doctor_id),
      consultation_date: form.consultation_date,
      appointment_time: form.appointment_time,
      doctor_notes: form.doctor_notes,
      clinical_note: form.clinical_note,
      patient_diagnosis: form.patient_diagnosis,
      patient_prescription: form.patient_prescription,
      vital_bp: form.vital_bp,
      vital_temperature: form.vital_temperature,
      vital_glycemia: form.vital_glycemia,
      vital_spo2: form.vital_spo2,
      vital_pulse: form.vital_pulse,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add consultation note"
      size="xl"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-[1fr_0.45fr_0.4fr]">
          {isAdmin ? (
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Doctor</span>
              <select
                required
                value={form.doctor_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, doctor_id: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
              >
                <option value="">Select doctor</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.full_name} - {doctor.specialization}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-[24px] border border-sky-100 bg-sky-50/80 p-4 md:border-ocs-teal/20 md:bg-ocs-teal/10">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 md:text-ocs-teal">
                Doctor
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950 md:text-ocs-slate">
                {user.full_name}
              </p>
            </div>
          )}

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Consultation date</span>
            <input
              required
              type="date"
              value={form.consultation_date}
              onChange={(event) =>
                setForm((current) => ({ ...current, consultation_date: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Time</span>
            <input
              required
              type="time"
              value={form.appointment_time}
              onChange={(event) =>
                setForm((current) => ({ ...current, appointment_time: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
            />
          </label>
        </div>

        <div className="flex flex-col gap-4">
          <div className="block space-y-2">
            <span className="text-sm font-semibold text-ocs-slate">
              Internal Clinical Note (Private)
            </span>

            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Vitals
              </span>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                {CONSULTATION_VITAL_FIELDS.map((field) => (
                  <label key={field.key} className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-600">{field.label}</span>
                    <div className="relative">
                      <input
                        type="text"
                        name={field.key}
                        aria-label={field.label}
                        inputMode={field.key === "vital_bp" ? "text" : "decimal"}
                        value={form[field.key]}
                        onChange={(event) => {
                          const value = event.target.value;
                          setForm((current) => ({
                            ...current,
                            [field.key]: formatVitalInput(field.key, value, current[field.key]),
                          }));
                        }}
                        placeholder={field.placeholder}
                        className={cx(CONSULTATION_VITAL_FIELD_CLASS, field.unit && "pr-10")}
                        aria-describedby={field.unit ? `${field.key}-unit` : undefined}
                      />
                      {field.unit ? (
                        <span id={`${field.key}-unit`} className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">
                          {field.unit}
                        </span>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <textarea
              rows="8"
              value={form.clinical_note}
              onChange={(event) =>
                setForm((current) => ({ ...current, clinical_note: event.target.value }))
              }
              placeholder="Record assessment and private clinical observations. This will not be visible to the patient."
              className={DESKTOP_CONSULTATION_FIELD_CLASS}
            />
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-ocs-slate">Diagnosis (Patient-Facing)</span>
            <textarea
              rows="3"
              value={form.patient_diagnosis}
              onChange={(event) =>
                setForm((current) => ({ ...current, patient_diagnosis: event.target.value }))
              }
              placeholder="Enter the clear, finalized diagnosis for the patient."
              className={DESKTOP_CONSULTATION_FIELD_CLASS}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-ocs-slate">
              Prescription &amp; Instructions (Patient-Facing)
            </span>
            <textarea
              rows="4"
              value={form.patient_prescription}
              onChange={(event) =>
                setForm((current) => ({ ...current, patient_prescription: event.target.value }))
              }
              placeholder="Enter prescribed medications and dosage instructions."
              className={DESKTOP_CONSULTATION_FIELD_CLASS}
            />
          </label>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 md:text-ocs-slate md:hover:border-ocs-teal md:hover:text-ocs-teal"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60 md:bg-ocs-teal md:hover:bg-ocs-teal/90"
          >
            {isSaving ? "Saving..." : "Add consultation note"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const LINK_STATUS_BADGES = {
  self_registered: {
    label: "Self-registered",
    className: "bg-brand-gold/15 text-brand-gold-dark",
  },
  pending_review: {
    label: "Pending link review",
    className: "bg-brand-gold/15 text-brand-gold-dark",
  },
};

function LinkStatusBadge({ status }) {
  const badge = LINK_STATUS_BADGES[status];
  if (!badge) return null;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold",
        badge.className,
      )}
    >
      <ShieldAlert className="size-3.5" />
      {badge.label}
    </span>
  );
}

// Lets admin/operator confirm a self-registered patient's portal link, or merge
// the record into the canonical chart it duplicates.
function AccountLinkReview({ patient, onChanged }) {
  const [open, setOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [mergingId, setMergingId] = useState(null);

  const needsReview =
    patient?.link_status === "self_registered" || patient?.link_status === "pending_review";

  useEffect(() => {
    if (!open) return undefined;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return undefined;
    }
    let ignore = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.get(`/patients?search=${encodeURIComponent(term)}&limit=8`);
        if (!ignore) {
          setResults((data.items || []).filter((item) => item.id !== patient.id));
        }
      } catch {
        if (!ignore) setResults([]);
      } finally {
        if (!ignore) setSearching(false);
      }
    }, 300);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [open, query, patient?.id]);

  if (!needsReview) return null;

  async function handleVerify() {
    setVerifying(true);
    try {
      await api.patch(`/patients/${patient.id}/verify-link`, { verified: true });
      toast.success("Account link verified.");
      setOpen(false);
      await onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Could not verify the account link.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleMerge(target) {
    if (
      !window.confirm(
        `Merge "${patient.full_name}" into "${target.full_name}" (${target.patient_identifier || "no OCS no."})? ` +
          "All visits, consultations, bills and records will move to the canonical record and this duplicate will be archived.",
      )
    ) {
      return;
    }
    setMergingId(target.id);
    try {
      await api.post(`/patients/${target.id}/merge`, { source_id: patient.id });
      toast.success("Records merged into the canonical patient.");
      window.location.assign(`/patients/${target.id}`);
    } catch (error) {
      toast.error(error?.message || "Could not merge the records.");
      setMergingId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-2xl border border-brand-gold/40 bg-brand-gold/8 px-4 py-3 text-sm font-semibold text-brand-gold-dark transition hover:bg-brand-gold/16"
      >
        <ShieldAlert className="size-4" />
        Review account link
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Review patient account link"
        description="This patient registered themselves on the portal. Confirm the record is correct, or merge it into the existing chart it duplicates."
        size="md"
      >
        <div className="space-y-6">
          <div className="rounded-2xl border border-[rgba(65,200,198,0.18)] bg-white/70 p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-[#2d8f98]" />
              <p className="text-sm font-semibold text-slate-900">This is a genuine, separate patient</p>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Mark the account as verified and keep this record as-is.
            </p>
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying}
              className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 active:scale-95 disabled:opacity-50"
            >
              {verifying ? "Verifying…" : "Mark verified"}
            </button>
          </div>

          <div className="rounded-2xl border border-[rgba(65,200,198,0.18)] bg-white/70 p-4">
            <div className="flex items-center gap-2">
              <GitMerge className="size-5 text-brand-gold-dark" />
              <p className="text-sm font-semibold text-slate-900">This duplicates an existing chart</p>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Search for the canonical record. Merging moves all visits, consultations, bills and
              records onto it and archives this duplicate.
            </p>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, OCS number, national ID, phone…"
                className="w-full rounded-xl border border-[rgba(65,200,198,0.25)] bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-[#2d8f98]"
              />
            </div>
            <div className="mt-3 space-y-2">
              {searching ? (
                <p className="px-1 py-2 text-sm text-slate-400">Searching…</p>
              ) : results.length === 0 && query.trim().length >= 2 ? (
                <p className="px-1 py-2 text-sm text-slate-400">No matching records.</p>
              ) : (
                results.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.full_name}</p>
                      <p className="truncate text-xs text-slate-400">
                        {item.patient_identifier || "No OCS no."}
                        {item.patient_id_number ? ` · ${item.patient_id_number}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleMerge(item)}
                      disabled={mergingId === item.id}
                      className="shrink-0 rounded-xl border border-brand-gold/40 bg-brand-gold/8 px-3 py-1.5 text-xs font-semibold text-brand-gold-dark transition hover:bg-brand-gold/16 disabled:opacity-50"
                    >
                      {mergingId === item.id ? "Merging…" : "Merge into this"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

function OperatorAccessManager({ patientId, access = [], operatorOptions = [], onChanged }) {
  const [open, setOpen] = useState(false);
  const [operatorUserId, setOperatorUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState(null);

  async function handleGrant() {
    const selectedId = Number(operatorUserId);
    if (!Number.isInteger(selectedId) || selectedId <= 0) {
      toast.error("Select an operator to grant access.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/patients/${patientId}/operator-access`, {
        operator_user_id: selectedId,
      });
      toast.success("Operator access granted.");
      setOperatorUserId("");
      await onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Could not grant operator access.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(accessId) {
    setRevokingId(accessId);
    try {
      await api.delete(`/patients/${patientId}/operator-access/${accessId}`);
      toast.success("Operator access revoked.");
      await onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Could not revoke operator access.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
      >
        <LockKeyhole className="size-4" />
        Operator access
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Operator chart access"
        description="Grant time-limited edit access. Operators can edit this chart only while a grant is active."
        size="md"
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={operatorUserId}
              onChange={(event) => setOperatorUserId(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-ocs-teal"
            >
              <option value="">Select operator</option>
              {operatorOptions.map((operator) => (
                <option key={operator.id} value={String(operator.id)}>
                  {operator.full_name || operator.username}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleGrant}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-2xl bg-ocs-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Granting…" : "Grant 24h"}
            </button>
          </div>
          <div className="space-y-2">
            {access.length === 0 ? (
              <p className="text-sm text-slate-500">No active grants. Operators cannot edit this chart until you grant access.</p>
            ) : (
              access.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {row.operator_name || row.operator_username}
                    </p>
                    <p className="text-xs text-slate-400">
                      Expires {row.expires_at ? dayjs(row.expires_at).format("D MMM YYYY, HH:mm") : "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevoke(row.id)}
                    disabled={revokingId === row.id}
                    className="text-sm font-semibold text-rose-600 disabled:opacity-50"
                  >
                    {revokingId === row.id ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

function PatientProfilePage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reportEditor, setReportEditor] = useState(null);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [consultationEditorId, setConsultationEditorId] = useState(null);
  const [consultationDraft, setConsultationDraft] = useState(() => getConsultationDraft());
  const [isSavingConsultation, setIsSavingConsultation] = useState(false);
  const [showAllConsultations, setShowAllConsultations] = useState(false);
  const [consultationComposerOpen, setConsultationComposerOpen] = useState(false);
  const [isCreatingConsultation, setIsCreatingConsultation] = useState(false);
  const [consultationToDelete, setConsultationToDelete] = useState(null);
  const [consultationVoidReason, setConsultationVoidReason] = useState("");
  const [consultationFieldSaleDisposition, setConsultationFieldSaleDisposition] = useState("");
  const [consultationNoteViewer, setConsultationNoteViewer] = useState(null);
  const [activeTab, setActiveTab] = useState(() => searchParams.get("view") || "summary");
  const [patientEditorOpen, setPatientEditorOpen] = useState(false);
  const [careInvitationPatientId, setCareInvitationPatientId] = useState(null);
  const [isSavingPatient, setIsSavingPatient] = useState(false);
  const [longTermReviewModalOpen, setLongTermReviewModalOpen] = useState(false);
  const [isSavingLongTermReview, setIsSavingLongTermReview] = useState(false);
  const canModifyClinicalData = user.role === "doctor" || user.role === "admin";
  const canViewConsultations = canViewConsultationNotes(user);
  const canViewLabReports = canViewLabReportsForUser(user);
  const canManageLabReports = canManageLabReportsForUser(user);
  const canManageConsultations =
    canManageConsultationNotes(user) && !isOperatorConsultationViewOnly(user);
  const canFlagLongTermReviewAccess = canFlagLongTermReview(user.role);
  const canLogLongTermReview = canLogLongTermReviewUpdate(user.role);
  const onLongTermReviewUpdatedRef = useRef(null);
  const { openLogUpdate, dialogs: longTermReviewLogDialogs } = useLongTermReviewLogUpdate({
    onUpdated: async () => {
      await onLongTermReviewUpdatedRef.current?.();
    },
  });

  const canEditPatientProfile = useMemo(() => {
    if (!data) {
      return false;
    }
    return ["admin", "doctor", "operator"].includes(user.role);
  }, [data, user.role]);

  useEffect(() => {
    if (searchParams.get("composeConsultation") !== "1" || !canManageConsultations) {
      return;
    }
    setConsultationComposerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("composeConsultation");
    setSearchParams(next, { replace: true });
  }, [canManageConsultations, searchParams, setSearchParams]);

  const showPatientBillingUi = useMemo(
    () => Boolean(data && canBillPatientForUser(user, data.patient) && !(user.role === "doctor" && isMobile)),
    [data, user, isMobile],
  );

  const mobileProfileTabs = useMemo(
    () =>
      MOBILE_TABS.filter((tab) => {
        if (tab.key === "billing") return showPatientBillingUi;
        if (tab.key === "notes") return canViewConsultations;
        if (tab.key === "reports") return canViewLabReports;
        return true;
      }),
    [showPatientBillingUi, canViewConsultations, canViewLabReports],
  );

  function selectProfileTab(tab) {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set("view", tab);
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    const next = searchParams.get("view") || "summary";
    setActiveTab(["summary", "notes", "reports", "billing"].includes(next) ? next : "summary");
  }, [searchParams]);

  useEffect(() => {
    if (!data) return;
    if (
      (activeTab === "billing" && !showPatientBillingUi) ||
      (activeTab === "notes" && !canViewConsultations) ||
      (activeTab === "reports" && !canViewLabReports)
    ) {
      setActiveTab("summary");
    }
  }, [data, activeTab, showPatientBillingUi, canViewConsultations, canViewLabReports]);

  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function loadPatient() {
      try {
        const [response, doctorOptions] = await Promise.all([
          api.get(`/patients/${id}`),
          user.role === "admin" || user.role === "operator" ? api.get("/doctors") : Promise.resolve([]),
        ]);

        if (!ignore) {
          setData(response);
          setDoctors(doctorOptions);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
          setData(null);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadPatient();

    return () => {
      ignore = true;
    };
  }, [id, refreshKey, user.role]);

  async function handleSaveLabReport(payload) {
    if (!data?.patient?.id) {
      return;
    }

    setIsSavingReport(true);

    try {
      const formData = new FormData();
      formData.append("patient_id", String(data.patient.id));
      formData.append("report_title", payload.report_title);
      formData.append("report_date", payload.report_date);
      formData.append("report_details", payload.report_details);
      formData.append(
        "consultation_id",
        payload.consultation_id ? String(payload.consultation_id) : "",
      );

      (payload.attachments || []).forEach((file) => {
        formData.append("attachments", file);
      });

      if (reportEditor?.id) {
        await api.put(`/lab-reports/${reportEditor.id}`, formData);
        toast.success("Medical & Lab Report updated.");
      } else {
        await api.post("/lab-reports", formData);
        toast.success("Medical & Lab Report added.");
      }

      await reloadPatientProfile();
      setReportEditor(null);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSavingReport(false);
    }
  }

  function removeLabReportAttachmentFromState(attachment) {
    setData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        labReports: (current.labReports || []).map((report) =>
          Number(report.id) === Number(attachment.report_id)
            ? {
                ...report,
                attachments: (report.attachments || []).filter(
                  (item) => item.id !== attachment.id,
                ),
              }
            : report,
        ),
      };
    });

    setReportEditor((current) =>
      current && Number(current.id) === Number(attachment.report_id)
        ? {
            ...current,
            attachments: (current.attachments || []).filter((item) => item.id !== attachment.id),
          }
        : current,
    );
  }

  async function handleOpenLabReportAttachment(attachment) {
    if (getLabReportAttachmentPublicUrl(attachment)) {
      return;
    }

    const previewTab = openInlinePreviewTab();
    if (!previewTab && supportsInlineBlobPreview()) {
      toast.error("Pop-up blocked. Allow pop-ups to open this file.");
      return;
    }

    try {
      const response = await api.getBlob(attachment.download_url);
      const mime =
        response.contentType ||
        attachment.mime_type ||
        (attachment.original_name?.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "application/octet-stream");
      const blob =
        response.blob instanceof Blob ? response.blob : new Blob([response.blob], { type: mime });
      const mode = presentFileBlob({
        blob,
        filename: response.filename || attachment.original_name || "report-file",
        mimeType: mime,
        previewTab,
      });

      if (mode === "download") {
        toast.success("File saved to your device. Open it from your downloads.");
      }
    } catch (error) {
      closePreviewTab(previewTab);
      toast.error(error.message);
    }
  }

  async function handleDeleteLabReportAttachment(attachment) {
    if (!canDeleteLabReportAttachment(user, attachment)) {
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to remove this attached report?",
    );
    if (!confirmed) {
      return;
    }

    try {
      await api.delete(`/lab-reports/attachments/${attachment.id}`);
      removeLabReportAttachmentFromState(attachment);
      toast.success("Attached file removed.");
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function reloadPatientProfile() {
    try {
      const [response, doctorOptions] = await Promise.all([
        api.get(`/patients/${id}`),
        user.role === "admin" || user.role === "operator" ? api.get("/doctors") : Promise.resolve(doctors),
      ]);

      setData(response);
      setDoctors(doctorOptions);
    } catch (error) {
      toast.error(error?.message || "Could not refresh the patient profile.");
    }
  }

  onLongTermReviewUpdatedRef.current = reloadPatientProfile;

  const longTermReviewLogAction =
    data?.patient && isPatientUnderReview(data.patient) && canLogLongTermReview ? (
      <LongTermReviewLogUpdateButton
        onClick={() => openLogUpdate(data.patient)}
        className="rounded-lg border border-[#e8c4b0] bg-white/80 px-3 py-1.5 text-sm font-semibold text-[#6e2f14] transition hover:bg-white"
      />
    ) : null;

  async function handleSavePatient(payload) {
    if (!data?.patient?.id) {
      return;
    }

    setIsSavingPatient(true);

    try {
      await api.put(`/patients/${data.patient.id}`, payload);
      toast.success("Patient record updated.");
      setPatientEditorOpen(false);
      await reloadPatientProfile();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSavingPatient(false);
    }
  }

  async function saveLongTermReviewFlag(isUnderReview, { reviewReasonNote = "", reviewDueDate = "" } = {}) {
    if (!data?.patient?.id) {
      return;
    }

    setIsSavingLongTermReview(true);

    try {
      const updatedPatient = await api.patch(`/patients/${data.patient.id}/long-term-review`, {
        is_under_review: isUnderReview,
        review_reason_note: reviewReasonNote,
        review_due_date: isUnderReview ? reviewDueDate : "",
      });
      setData((current) =>
        current
          ? {
              ...current,
              patient: {
                ...current.patient,
                ...updatedPatient,
              },
            }
          : current,
      );
      toast.success(
        isUnderReview ? "Patient flagged for a review appointment." : "Review appointment flag removed.",
      );
      setLongTermReviewModalOpen(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSavingLongTermReview(false);
    }
  }

  async function handleUnflagLongTermReview() {
    await saveLongTermReviewFlag(false);
  }

  async function handleConfirmLongTermReviewFlag(payload) {
    await saveLongTermReviewFlag(true, {
      reviewReasonNote: payload.review_reason_note,
      reviewDueDate: payload.review_due_date,
    });
  }

  function canEditConsultation(consultation) {
    return canEditConsultationNote(user, consultation);
  }

  function handleConsultationEditStart(consultation) {
    setConsultationNoteViewer(null);
    setConsultationEditorId(consultation.id);
    setConsultationDraft(getConsultationDraft(consultation));
  }

  function handleConsultationEditCancel() {
    setConsultationEditorId(null);
    setConsultationDraft(getConsultationDraft());
  }

  async function handleConsultationSave(consultation) {
    const doctorNotes = consultationDraft.doctor_notes.trim();
    const consultationDate = String(consultationDraft.consultation_date || "").trim();
    const doctorId = Number(consultationDraft.doctor_id);

    if (!doctorNotes) {
      toast.error("Consultation note cannot be empty.");
      return;
    }

    if (!consultationDate) {
      toast.error("Consultation date is required.");
      return;
    }

    if (user.role === "admin" && (!Number.isInteger(doctorId) || doctorId <= 0)) {
      toast.error("Select a doctor for this consultation.");
      return;
    }

    setIsSavingConsultation(true);

    try {
      await api.put(`/consultations/${consultation.id}`, {
        ...(user.role === "admin" ? { doctor_id: doctorId } : {}),
        consultation_date: consultationDate,
        doctor_notes: doctorNotes,
      });

      await reloadPatientProfile();
      setConsultationEditorId(null);
      setConsultationDraft(getConsultationDraft());
      toast.success("Consultation updated.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSavingConsultation(false);
    }
  }

  async function handleCreateConsultation(payload) {
    setIsCreatingConsultation(true);

    try {
      await api.post(`/patients/${id}/consultations`, payload);
      await reloadPatientProfile();
      setConsultationComposerOpen(false);
      toast.success("Consultation note added.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsCreatingConsultation(false);
    }
  }

  async function handleDeleteConsultation() {
    if (!consultationToDelete) {
      return;
    }

    try {
      await api.delete(`/consultations/${consultationToDelete.id}`, {
        body: {
          reason: consultationVoidReason.trim(),
          field_sale_disposition: consultationFieldSaleDisposition || undefined,
        },
      });
      if (consultationEditorId === consultationToDelete.id) {
        setConsultationEditorId(null);
        setConsultationDraft(getConsultationDraft());
      }
      setConsultationToDelete(null);
      setConsultationVoidReason("");
      setConsultationFieldSaleDisposition("");
      await reloadPatientProfile();
      toast.success("Consultation note deleted.");
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (loading) {
    return <LoadingState label="Loading patient profile" />;
  }

  if (!data) {
    return (
      <EmptyState
        title="Patient unavailable"
        description="The requested record could not be loaded. Return to the patient directory and try again."
        action={
          <Link
            to="/patients"
            className="rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white"
          >
            Back to patients
          </Link>
        }
      />
    );
  }

  const assignedDoctor = data.patient.assigned_doctor_name || "Unassigned";
  const patientContactNumber =
    data.patient.patient_contact_number || data.patient.contact_number || "Not recorded";
  const consultations = data.consultations || [];
  const labReports = data.labReports || [];
  const visibleConsultations = showAllConsultations
    ? consultations
    : consultations.slice(0, CONSULTATION_ROWS_LIMIT);
  const hiddenConsultationCount = Math.max(
    consultations.length - visibleConsultations.length,
    0,
  );
  const lastVisitDate = consultations[0]?.consultation_date
    ? formatDate(consultations[0].consultation_date)
    : data.appointments[0]?.appointment_date
      ? formatDate(data.appointments[0].appointment_date)
      : "Not recorded";
  const profileAgeLabel = data.patient.date_of_birth || data.patient.manual_age != null
    ? formatAgeFromDateOfBirth(data.patient.date_of_birth, data.patient.manual_age)
    : "Not recorded";
  const profileAddressLabel = hasMeaningfulPatientField(data.patient.address)
    ? data.patient.address
    : "Not recorded";

  const rawContactDigits = data.patient.patient_contact_number || data.patient.contact_number;
  const showMobileContact = hasMeaningfulPatientField(rawContactDigits);
  const showMobileAddress = hasMeaningfulPatientField(data.patient.address);
  const showMobileLocations =
    (data.patient.location_tags && data.patient.location_tags.length > 0) ||
    hasMeaningfulPatientField(data.patient.location);

  const mobileNokHasAny =
    hasMeaningfulPatientField(data.patient.next_of_kin_name) ||
    hasMeaningfulPatientField(data.patient.next_of_kin_relationship) ||
    hasMeaningfulPatientField(data.patient.next_of_kin_contact_number) ||
    hasMeaningfulPatientField(data.patient.next_of_kin_email);

  const mobileClinicalBlocks = [
    ...(data.patient.status === "active" && hasMeaningfulPatientField(data.patient.ongoing_treatment)
      ? [
          {
            key: "ongoing",
            icon: HeartPulse,
            label: "Ongoing treatment",
            value: data.patient.ongoing_treatment,
            iconBg: "bg-teal-50 text-teal-700",
          },
        ]
      : []),
    ...(hasMeaningfulPatientField(data.patient.past_medical_history)
      ? [
          {
            key: "pmh",
            icon: UserRound,
            label: "Past medical history",
            value: data.patient.past_medical_history,
            iconBg: "bg-sky-50 text-sky-700",
          },
        ]
      : []),
    ...(hasMeaningfulPatientField(data.patient.past_surgical_history)
      ? [
          {
            key: "psh",
            icon: HeartPulse,
            label: "Past surgical history",
            value: data.patient.past_surgical_history,
            iconBg: "bg-sky-50 text-sky-700",
          },
        ]
      : []),
    ...(hasMeaningfulPatientField(data.patient.drug_history)
      ? [
          {
            key: "drug",
            icon: Pill,
            label: "Drug history",
            value: data.patient.drug_history,
            iconBg: "bg-emerald-50 text-emerald-700",
          },
        ]
      : []),
  ];

  const identityType = PATIENT_ID_TYPES.find((type) => type.value === (data.patient.patient_id_type || "national_id"))?.label || "Identity document";
  const identityValue = data.patient.patient_id_type === "no_id" ? "No identification provided" : data.patient.patient_id_type === "old_age" && !data.patient.patient_id_number ? "No identifier required" : profileLine(data.patient.patient_id_number);
  const patientSummary = <div className="patient-summary-cards space-y-3">
    <div className="flex flex-wrap gap-2"><HighlightStat icon={CalendarClock} label="Appointments" value={data.appointments.length} />{canViewConsultations ? <HighlightStat icon={FileText} label="Notes" value={consultations.length} /> : null}{canViewLabReports ? <HighlightStat icon={FlaskConical} label="Reports" value={labReports.length} /> : null}{canViewConsultations ? <HighlightStat icon={History} label="Last visit" value={lastVisitDate} prominent /> : null}</div>
    <SectionCard title="Patient details" compact>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-3">
        <ProfileDlItem label={identityType} value={identityValue} emphasize />
        <ProfileDlItem label="Date of birth" value={data.patient.date_of_birth ? formatDate(data.patient.date_of_birth) : "Not recorded"} />
        <ProfileDlItem label="Gender" value={data.patient.gender} />
        <ProfileDlItem label="Assigned doctor" value={assignedDoctor} />
        {showMobileContact ? <ProfileDlItem label="Contact" value={patientContactNumber} /> : null}
        {showMobileAddress ? <ProfileDlItem label="Address" value={data.patient.address} /> : null}
      </dl>
      {showMobileLocations ? <div className="mt-4 border-t border-slate-100 pt-3"><p className="mb-2 text-xs font-semibold text-slate-500">Locations and affiliations</p><PatientLocationTags tags={sanitizeLocationTagsForDisplay(data.patient.location_tags || [])} onChange={() => {}} readOnly /></div> : null}
    </SectionCard>
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <PatientDetailsDisclosure title="Clinical history" hint={mobileClinicalBlocks.length ? `${mobileClinicalBlocks.length} recorded fields` : "Not provided"}>
        {mobileClinicalBlocks.length ? <div className="space-y-4">{mobileClinicalBlocks.map((block) => <ClinicalGridItem key={block.key} label={block.label} value={block.value} />)}</div> : <p className="text-sm text-slate-500">No clinical history recorded.</p>}
      </PatientDetailsDisclosure>
      <PatientDetailsDisclosure title="Next of kin" hint={mobileNokHasAny ? data.patient.next_of_kin_name || "Details recorded" : "Not provided"}>
        {mobileNokHasAny ? <dl className="grid grid-cols-2 gap-4"><ProfileDlItem label="Name" value={data.patient.next_of_kin_name} /><ProfileDlItem label="Relationship" value={data.patient.next_of_kin_relationship} /><ProfileDlItem label="Phone" value={data.patient.next_of_kin_contact_number} /><ProfileDlItem label="Email" value={data.patient.next_of_kin_email} /></dl> : <p className="text-sm text-slate-500">No next of kin details recorded.</p>}
      </PatientDetailsDisclosure>
      {hasMeaningfulPatientField(data.patient.particularity) ? <PatientDetailsDisclosure title="Particularity"><p className="whitespace-pre-wrap break-words text-sm text-slate-700">{data.patient.particularity}</p></PatientDetailsDisclosure> : null}
    </div>
  </div>;

  return (
    <div className="patient-workspace patient-profile ocs-page w-full min-w-0 max-w-full space-y-3">
      <PatientWorkspaceHeader title={data.patient.full_name} subtitle={showMobileAddress ? profileAddressLabel : undefined} role={user.role} onRefresh={reloadPatientProfile} actions={<>
        <Link className="patient-icon-control" to={location.state?.patientsReturnTo || "/patients"} state={{ directoryContext: location.state?.directoryContext, patientsScrollY: location.state?.patientsScrollY }} aria-label="Back to patients"><ArrowLeft className="size-4" /></Link>
        {canManageConsultations ? <button className="patient-control patient-control-primary" aria-label="Add consultation note" onClick={() => setConsultationComposerOpen(true)}><Plus className="size-4" /><span>{isMobile ? "Add note" : "Add consultation note"}</span></button> : showPatientBillingUi ? <Link className="patient-control patient-control-primary" to={`/billing?patientId=${id}&create=1`}><CreditCard className="size-4" />New bill</Link> : null}
        {showMobileContact ? <a className="patient-control" href={`tel:${rawContactDigits}`}><Phone className="size-4" />Call</a> : null}
        <details className="patient-more-actions"><summary aria-label="More actions" title="More actions" className={isMobile ? "patient-icon-control" : "patient-control"}><MoreHorizontal className="size-4" /><span className={isMobile ? "sr-only" : ""}>More actions</span></summary><div>
          {canEditPatientProfile ? <button type="button" className="patient-control" onClick={() => setPatientEditorOpen(true)}><SquarePen className="size-4" />Edit profile</button> : null}
          {["admin", "operator"].includes(user.role) ? <button type="button" className="patient-control" onClick={() => setCareInvitationPatientId(data.patient.id)}>Send OCS Care link</button> : null}
          {canFlagLongTermReviewAccess ? <AccountLinkReview patient={data.patient} onChanged={reloadPatientProfile} /> : null}
          {user.role === "admin" ? <OperatorAccessManager patientId={data.patient.id} access={data.operatorAccess || []} operatorOptions={data.operatorOptions || []} onChanged={reloadPatientProfile} /> : null}
          {canFlagLongTermReviewAccess ? <LongTermReviewFlagButton patient={data.patient} disabled={isSavingLongTermReview} isSaving={isSavingLongTermReview} onRequestFlag={() => setLongTermReviewModalOpen(true)} onUnflag={handleUnflagLongTermReview} /> : null}
          {canManageLabReports && (canModifyClinicalData || user.role === "lab_tech") ? <button type="button" className="patient-control" onClick={() => setReportEditor({ id: null })}><Paperclip className="size-4" />Attach report</button> : null}
          {showPatientBillingUi && canManageConsultations ? <Link className="patient-control" to={`/billing?patientId=${id}&create=1`}><CreditCard className="size-4" />New bill</Link> : null}
        </div></details>
      </>}>
        <HighlightStat label="OCS care number" value={data.patient.patient_identifier || "Not assigned"} prominent primary />
        <HighlightStat icon={UserRound} label="Age" value={profileAgeLabel} prominent />
        <StatusBadge value={data.patient.status} /><PatientLinkhamPolicyBadge patient={data.patient} /><LinkStatusBadge status={data.patient.link_status} />
      </PatientWorkspaceHeader>
      {hasMeaningfulPatientField(data.patient.drug_allergy_history) ? <aside className="patient-priority-notice rounded-[24px] border border-amber-200/70 bg-[#fff9ed] px-4 py-3"><p className="flex items-center gap-2 text-sm font-bold text-[#705822]"><ShieldAlert className="size-4" aria-hidden="true" />Allergy history</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{data.patient.drug_allergy_history}</p></aside> : null}
      {isPatientUnderReview(data.patient) ? <LongTermReviewAlertBanner patient={data.patient} actions={longTermReviewLogAction} /> : null}
      <nav aria-label="Patient profile sections" className="patient-profile-tabs flex max-w-full gap-2 overflow-x-auto rounded-full py-1">
        {mobileProfileTabs.map((tab) => <button key={tab.key} type="button" aria-pressed={activeTab === tab.key} onClick={() => selectProfileTab(tab.key)} className={cx("patient-control shrink-0", activeTab === tab.key && "patient-control-primary")}>{tab.label}</button>)}
      </nav>
      {isMobile ? (
        <>
          {activeTab === "summary" ? patientSummary : null}

          {activeTab === "notes" && canViewConsultations && (
            <div className="space-y-4">


              {consultations.length ? (
                <div className="space-y-3">
                  {visibleConsultations.map((consultation) => {
                    const isEditing = consultationEditorId === consultation.id;
                    const canEditRow = canEditConsultation(consultation);
                    const note = consultation.doctor_notes || "";
                    return (
                      <div
                        key={consultation.id}
                        className="rounded-[24px] border border-slate-200/80 bg-white"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            !isEditing && setConsultationNoteViewer(consultation)
                          }
                          className="flex w-full min-w-0 items-center justify-between gap-3 p-4"
                          style={{ minHeight: 48 }}
                        >
                          <span className="shrink-0 text-sm font-semibold text-slate-900">
                            {formatDate(consultation.consultation_date)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-right text-sm font-bold text-slate-900">
                            {formatMobileDoctorName(consultation.doctor_name)}
                          </span>
                          {isEditing ? null : (
                            <ChevronRight className="size-4 shrink-0 text-slate-400" />
                          )}
                        </button>

                        {isEditing ? (
                          <div className="space-y-3 border-t border-slate-100 p-4">
                            {user.role === "admin" && (
                              <div className="space-y-3">
                                <label className="space-y-2">
                                  <span className="text-sm font-semibold text-slate-700">
                                    Doctor
                                  </span>
                                  <select
                                    value={consultationDraft.doctor_id}
                                    onChange={(event) =>
                                      setConsultationDraft((current) => ({
                                        ...current,
                                        doctor_id: event.target.value,
                                      }))
                                    }
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
                                  >
                                    <option value="">Select doctor</option>
                                    {doctors.map((doctor) => (
                                      <option key={doctor.id} value={doctor.id}>
                                        {doctor.full_name} - {doctor.specialization}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="space-y-2">
                                  <span className="text-sm font-semibold text-slate-700">
                                    Consultation date
                                  </span>
                                  <input
                                    type="date"
                                    value={consultationDraft.consultation_date}
                                    onChange={(event) =>
                                      setConsultationDraft((current) => ({
                                        ...current,
                                        consultation_date: event.target.value,
                                      }))
                                    }
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
                                  />
                                </label>
                              </div>
                            )}

                            <textarea
                              rows="7"
                              value={consultationDraft.doctor_notes}
                              onChange={(event) =>
                                setConsultationDraft((current) => ({
                                  ...current,
                                  doctor_notes: event.target.value,
                                }))
                              }
                              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
                              placeholder="Update the clinical note for this consultation."
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={handleConsultationEditCancel}
                                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                                style={{ minHeight: 48 }}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={isSavingConsultation}
                                onClick={() => handleConsultationSave(consultation)}
                                className="rounded-2xl bg-ocs-teal px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                style={{ minHeight: 48 }}
                              >
                                {isSavingConsultation ? "Saving..." : "Save changes"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {note ? (
                              <button
                                type="button"
                                onClick={() => setConsultationNoteViewer(consultation)}
                                className="w-full px-4 pb-3 text-left"
                              >
                                <p className="line-clamp-2 break-words text-sm leading-snug text-slate-600">
                                  {formatConsultationNoteForDisplay(note)}
                                </p>
                              </button>
                            ) : (
                              <p className="px-4 pb-3 text-sm text-slate-500">No note recorded.</p>
                            )}
                            <div className="flex flex-wrap gap-2 px-4 pb-4">
                              {canModifyClinicalData && canEditRow ? (
                                <button
                                  type="button"
                                  onClick={() => handleConsultationEditStart(consultation)}
                                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
                                  style={{ minHeight: 48 }}
                                >
                                  <SquarePen className="size-4" />
                                  Edit
                                </button>
                              ) : canModifyClinicalData && !canEditRow ? (
                                <span
                                  className="inline-flex items-center gap-1 px-1 text-xs font-medium text-slate-500"
                                  title="You can only edit notes you authored"
                                >
                                  <LockKeyhole className="size-3 shrink-0 text-slate-400" aria-hidden />
                                  View only
                                </span>
                              ) : null}
                              {user.role === "admin" && canEditRow && consultation.bill_status !== "paid" ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConsultationVoidReason("");
                                    setConsultationToDelete(consultation);
                                  }}
                                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600"
                                  style={{ minHeight: 48 }}
                                >
                                  <Trash2 className="size-4" />
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {consultations.length > CONSULTATION_ROWS_LIMIT ? (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => setShowAllConsultations((current) => !current)}
                        className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100"
                        style={{ minHeight: 48 }}
                      >
                        {showAllConsultations
                          ? "Show fewer consultation notes"
                          : `View more (${hiddenConsultationCount} more)`}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  title="No consultations recorded"
                  description="Consultation notes will appear here as soon as a doctor completes a visit and saves the note."
                />
              )}
            </div>
          )}

          {activeTab === "reports" && canViewLabReports && (
            <div className="space-y-4">
              {(canModifyClinicalData || user.role === "lab_tech") && canManageLabReports && (
                <button
                  type="button"
                  onClick={() => setReportEditor({ id: null })}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-ocs-teal px-4 py-3 text-sm font-semibold text-white"
                  style={{ minHeight: 48 }}
                >
                  <Plus className="size-4" />
                  Add Medical & Lab Report
                </button>
              )}

              {labReports.length ? (
                <div className="space-y-4">
                  {labReports.map((report) => (
                    <article
                      key={report.id}
                      className="rounded-[26px] border border-slate-200/80 bg-white p-5"
                    >
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-lg font-semibold text-slate-950">
                            {report.report_title}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {formatDate(report.report_date)}
                          </p>
                        </div>

                        {(canModifyClinicalData || user.role === "lab_tech") && canManageLabReports ? (
                          <button
                            type="button"
                            onClick={() => setReportEditor(report)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                            style={{ minHeight: 48 }}
                          >
                            <SquarePen className="size-4" />
                            Edit
                          </button>
                        ) : null}
                      </div>

                      {report.consultation_id ? (
                        <div className="mt-4 rounded-[22px] border border-sky-100 bg-sky-50/75 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                            Linked consultation
                          </p>
                          <p className="mt-2 text-sm font-semibold text-slate-900">
                            {report.consultation_doctor_name || "Consultation linked"}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {report.consultation_doctor_specialization
                              ? `${report.consultation_doctor_specialization} - `
                              : ""}
                            {report.consultation_date
                              ? formatDate(report.consultation_date)
                              : "Consultation date unavailable"}
                          </p>
                        </div>
                      ) : null}

                      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
                        {report.report_details}
                      </p>

                      {report.attachments?.length ? (
                        <div className="mt-4 space-y-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Attached files
                          </p>
                          <div className="space-y-2">
                            {report.attachments.map((attachment) => (
                              <LabReportAttachmentRow
                                key={attachment.id}
                                attachment={attachment}
                                user={user}
                                onOpen={handleOpenLabReportAttachment}
                                onDelete={handleDeleteLabReportAttachment}
                                className="rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                                compact
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-500">
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                          Reported by {report.created_by_name || "OCS team"}
                        </span>
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                          {roleLabel(report.created_by_role)}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No Medical & Lab Reports yet"
                  description="Add a Medical & Lab Report here to keep investigations, consultation notes, and uploaded files together on the same patient profile."
                />
              )}
            </div>
          )}

          {activeTab === "billing" && (
            <div className={getMobileBillingCanvasClass(data.bills)}>
              {showPatientBillingUi && (
                <Link
                  to={`/billing?patientId=${id}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                  style={{ minHeight: 48 }}
                >
                  <CreditCard className="size-4" />
                  Open billing workspace
                </Link>
              )}

              {data.bills.length ? (
                <div className="space-y-3">
                  {data.bills.map((bill) => (
                    <div
                      key={bill.id}
                      className={getMobileBillingCardClass(bill)}
                    >
                      <div className="flex flex-col gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">
                            {formatCurrency(bill.total_amount)}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            Bill #{bill.id} - {bill.doctor_name} -{" "}
                            {formatDate(bill.consultation_date)}
                          </p>
                        </div>
                        <MobileBillingStatusBar status={patientBillStatus(bill)} />
                      </div>
                      {bill.payment_method || bill.payment_date ? <p className="mt-3 text-sm text-slate-600">{[bill.payment_method ? formatPaymentMethod(bill.payment_method) : "", bill.payment_date ? formatDate(bill.payment_date) : ""].filter(Boolean).join(" · ")}</p> : null}
                      <details className="mt-3 text-sm text-slate-600"><summary className="min-h-11 cursor-pointer content-center font-semibold">Bill items ({bill.items.length})</summary><ul className="mt-2 space-y-1">{bill.items.map((item, index) => <li key={`${bill.id}-${index}`}>{item.description}: {formatCurrency(item.amount)}</li>)}</ul></details>
                      {showPatientBillingUi ? (
                        <Link
                          to={patientBillOpenPath(bill, id, user.role)}
                          className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-ocs-slate"
                        >
                          {bill.finalized_at && bill.status === "unpaid" ? "Open payment follow-up" : "Open bill"}
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No billing records"
                  description="Bills are created automatically when a consultation is saved."
                />
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {activeTab === "summary" ? patientSummary : null}

          {canViewConsultations && activeTab === "notes" ? (
          <SectionCard
            compact
            id="consultation-notes"
            className="scroll-mt-28"
            title="Consultation notes"
            titleClassName={DESKTOP_SECTION_TITLE_CLASS}

          >
            {consultations.length ? (
              <div className="space-y-2">
                <div className="overflow-x-auto">
                  <table className="min-w-full table-fixed divide-y divide-slate-200 text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="w-[11%] px-3 py-2 text-xs font-bold uppercase tracking-wider text-ocs-slate">
                          Date
                        </th>
                        <th className="w-[17%] px-3 py-2 text-xs font-bold uppercase tracking-wider text-ocs-slate">
                          Doctor
                        </th>
                        <th className="min-w-0 px-3 py-2 text-xs font-bold uppercase tracking-wider text-ocs-slate">
                          Consultation note
                        </th>
                        <th className="w-[28%] px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-ocs-slate">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleConsultations.map((consultation) => {
                        const isEditing = consultationEditorId === consultation.id;
                        const canEditRow = canEditConsultation(consultation);
                        const note = consultation.doctor_notes || "";

                        return (
                          <tr key={consultation.id} className="align-top">
                            <td className="px-3 py-2 text-sm font-semibold text-slate-900">
                              {formatDate(consultation.consultation_date)}
                            </td>
                            <td className="px-3 py-2 text-sm text-slate-600">
                              <p className="text-sm font-bold text-slate-900">
                                {formatDoctorDisplayName(consultation.doctor_name)}
                              </p>
                            </td>
                            <td className="min-w-0 max-w-0 px-3 py-2">
                                {isEditing ? (
                                  <div className="space-y-3">
                                    {user.role === "admin" ? (
                                      <div className="grid gap-3 md:grid-cols-[1fr_0.5fr]">
                                        <label className="space-y-2">
                                          <span className="text-sm font-semibold text-slate-700">
                                            Doctor
                                          </span>
                                          <select
                                            value={consultationDraft.doctor_id}
                                            onChange={(event) =>
                                              setConsultationDraft((current) => ({
                                                ...current,
                                                doctor_id: event.target.value,
                                              }))
                                            }
                                            className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
                                          >
                                            <option value="">Select doctor</option>
                                            {doctors.map((doctor) => (
                                              <option key={doctor.id} value={doctor.id}>
                                                {doctor.full_name} - {doctor.specialization}
                                              </option>
                                            ))}
                                          </select>
                                        </label>

                                        <label className="space-y-2">
                                          <span className="text-sm font-semibold text-slate-700">
                                            Consultation date
                                          </span>
                                          <input
                                            type="date"
                                            value={consultationDraft.consultation_date}
                                            onChange={(event) =>
                                              setConsultationDraft((current) => ({
                                                ...current,
                                                consultation_date: event.target.value,
                                              }))
                                            }
                                            className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
                                          />
                                        </label>
                                      </div>
                                    ) : null}

                                    <textarea
                                      rows="7"
                                      value={consultationDraft.doctor_notes}
                                      onChange={(event) =>
                                        setConsultationDraft((current) => ({
                                          ...current,
                                          doctor_notes: event.target.value,
                                        }))
                                      }
                                      className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
                                      placeholder="Update the clinical note for this consultation."
                                    />
                                    <div className="flex flex-wrap justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={handleConsultationEditCancel}
                                        className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isSavingConsultation}
                                        onClick={() => handleConsultationSave(consultation)}
                                        className="rounded-2xl bg-ocs-teal px-3 py-2 text-sm font-semibold text-white transition hover:bg-ocs-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {isSavingConsultation ? "Saving..." : "Save changes"}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="min-w-0">
                                    <p className="line-clamp-3 break-words text-sm leading-snug text-slate-800 [overflow-wrap:anywhere]">
                                      {formatConsultationNoteForDisplay(note) || "No note recorded."}
                                    </p>
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setConsultationNoteViewer(consultation)}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
                                  >
                                    Open
                                  </button>
                                  {canModifyClinicalData && canEditRow && !isEditing ? (
                                    <button
                                      type="button"
                                      onClick={() => handleConsultationEditStart(consultation)}
                                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
                                    >
                                      <SquarePen className="size-4" />
                                      {user.role === "admin" ? "Edit consultation" : "Edit note"}
                                    </button>
                                  ) : canModifyClinicalData && !canEditRow && !isEditing ? (
                                    <span
                                      className="pointer-events-none inline-flex select-none items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium normal-case tracking-normal text-slate-500"
                                      title="You can only edit notes you authored"
                                    >
                                      <LockKeyhole className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                                      View only
                                    </span>
                                  ) : null}
                                  {user.role === "admin" && canEditRow && consultation.bill_status !== "paid" ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConsultationVoidReason("");
                                        setConsultationToDelete(consultation);
                                      }}
                                      className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                                    >
                                      <Trash2 className="size-4" />
                                      Delete note
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                </div>

                {consultations.length > CONSULTATION_ROWS_LIMIT ? (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setShowAllConsultations((current) => !current)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
                    >
                      {showAllConsultations
                        ? "Show fewer consultation notes"
                        : `View more consultation notes (${hiddenConsultationCount} more)`}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                compact
                title="No consultations recorded"
                description="Consultation notes will appear here as soon as a doctor completes a visit and saves the note."
              />
            )}
          </SectionCard>
          ) : null}

          {canViewLabReports && activeTab === "reports" ? (
          <SectionCard
            compact
            title="Medical & Lab Reports"
            titleClassName={DESKTOP_SECTION_TITLE_CLASS}
            actions={
              canManageLabReports ? (
                  <button
                    type="button"
                    onClick={() => setReportEditor({ id: null })}
                    className="inline-flex items-center gap-2 rounded-2xl bg-ocs-teal px-3 py-2 text-sm font-semibold text-white transition hover:bg-ocs-teal/90"
                  >
                  <Plus className="size-4" />
                  Add Medical & Lab Report
                </button>
              ) : null
            }
          >
            {labReports.length ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {labReports.map((report) => (
                  <article
                    key={report.id}
                    className="rounded-2xl border border-transparent bg-white p-4 shadow-md"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-ocs-slate">{report.report_title}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {formatDate(report.report_date)}
                        </p>
                      </div>

                      {canManageLabReports ? (
                        <button
                          type="button"
                          onClick={() => setReportEditor(report)}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
                      >
                        <SquarePen className="size-4" />
                        Edit
                      </button>
                      ) : null}
                    </div>

                    {report.consultation_id ? (
                      <div className="mt-4 rounded-[22px] border border-ocs-teal/20 bg-ocs-teal/10 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ocs-teal">
                          Linked consultation
                        </p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {report.consultation_doctor_name || "Consultation linked"}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {report.consultation_doctor_specialization
                            ? `${report.consultation_doctor_specialization} - `
                            : ""}
                          {report.consultation_date
                            ? formatDate(report.consultation_date)
                            : "Consultation date unavailable"}
                        </p>
                      </div>
                    ) : null}

                    <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
                      {report.report_details}
                    </p>

                    {report.attachments?.length ? (
                      <div className="mt-4 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Attached files
                        </p>
                        <div className="space-y-2">
                          {report.attachments.map((attachment) => (
                              <LabReportAttachmentRow
                                key={attachment.id}
                                attachment={attachment}
                                user={user}
                                onOpen={handleOpenLabReportAttachment}
                                onDelete={handleDeleteLabReportAttachment}
                                className="rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                                compact
                              />
                            ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-500">
                      <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                        Reported by {report.created_by_name || "OCS team"}
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                        {roleLabel(report.created_by_role)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-snug text-ocs-grey">
                No Medical & Lab Reports yet. Add a Medical & Lab Report here to keep investigations, consultation notes, and uploaded files together on the same patient profile.
              </p>
            )}
          </SectionCard>
          ) : null}

          {showPatientBillingUi && activeTab === "billing" ? (
            <SectionCard
              compact
              title="Billing history"
              titleClassName={DESKTOP_SECTION_TITLE_CLASS}
              actions={
                <Link
                  to={`/billing?patientId=${id}`}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
                >
                  <CreditCard className="size-4" />
                  Open billing workspace
                </Link>
              }
            >
              {data.bills.length ? (
                <div className="overflow-x-auto rounded-xl border border-transparent bg-white shadow-md">
                  <table className="min-w-full table-fixed text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-ocs-slate">
                      <tr>
                        <th className="w-[26%] px-3 py-2">Bill / recorded</th>
                        <th className="w-[22%] px-3 py-2">Consultation</th>
                        <th className="w-[18%] px-3 py-2">Amount</th>
                        <th className="w-[18%] px-3 py-2">Status</th>
                        <th className="w-[16%] px-3 py-2 text-right">Open</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.bills.map((bill) => (
                        <tr
                          key={bill.id}
                          className={cx(
                            "align-middle",
                            getBillingHistoryRowClass(bill.payment_status || bill.status),
                          )}
                        >
                          <td className="px-3 py-1.5 align-middle">
                            <p className="truncate font-semibold text-slate-900">Bill #{bill.id}</p>
                            <p className="truncate text-xs text-slate-500">
                              Recorded {formatDate(bill.created_at)}
                            </p>
                          </td>
                          <td className="px-3 py-1.5 align-middle text-xs text-slate-600">
                            {formatDate(bill.consultation_date)}
                          </td>
                          <td className="px-3 py-1.5 align-middle font-semibold text-slate-900">
                            {formatCurrency(bill.total_amount)}
                          </td>
                          <td className="px-3 py-1.5 align-middle">
                            <MobileBillingStatusBar status={patientBillStatus(bill)} />
                          </td>
                          <td className="px-3 py-1.5 align-middle text-right">
                            <Link
                              to={patientBillOpenPath(bill, id, user.role)}
                              className="patient-control whitespace-nowrap"
                            >
                              Open bill
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  compact
                  title="No billing records"
                  description="Bills are created automatically when a consultation is saved."
                />
              )}
            </SectionCard>
          ) : null}
        </>
      )}

      {["admin", "operator"].includes(user.role) && (
        <Modal
          open={careInvitationPatientId === data.patient.id && data.patient.id === Number(id)}
          onClose={() => setCareInvitationPatientId(null)}
          title="Send OCS Care link"
          description="Create a personal sign-in link, valid for 10 minutes and one use."
          size="sm"
        >
          <PatientCareInvitation key={data.patient.id} patient={data.patient} readOnly={user.is_read_only} onSignedIn={() => setCareInvitationPatientId(null)} />
        </Modal>
      )}

      <LongTermReviewReasonModal
        open={longTermReviewModalOpen}
        isSaving={isSavingLongTermReview}
        onClose={() => setLongTermReviewModalOpen(false)}
        onSubmit={handleConfirmLongTermReviewFlag}
      />

      {longTermReviewLogDialogs}

      <PatientFormModal
        canEditPatientIdentifier={user.role === "admin"}
        canSelectAssignedDoctor={user.role === "admin" || user.role === "operator"}
        doctors={doctors}
        isSaving={isSavingPatient}
        mode="edit"
        open={patientEditorOpen}
        patient={data.patient}
        onClose={() => setPatientEditorOpen(false)}
        onSubmit={handleSavePatient}
      />

      <LabReportModal
        open={Boolean(reportEditor)}
        report={reportEditor}
        consultations={consultations}
        user={user}
        onDeleteAttachment={handleDeleteLabReportAttachment}
        onDownloadAttachment={handleOpenLabReportAttachment}
        onClose={() => setReportEditor(null)}
        onSubmit={handleSaveLabReport}
        isSaving={isSavingReport}
      />

      <ConsultationCreateModal
        open={consultationComposerOpen}
        user={user}
        doctors={doctors}
        onClose={() => setConsultationComposerOpen(false)}
        onSubmit={handleCreateConsultation}
        isSaving={isCreatingConsultation}
      />

      {consultationNoteViewer ? (
        <Modal
          open
          onClose={() => setConsultationNoteViewer(null)}
          title={`${formatDate(consultationNoteViewer.consultation_date)} · ${formatDoctorDisplayName(consultationNoteViewer.doctor_name) || consultationNoteViewer.doctor_name}`}
          description="Consultation note"
          size="lg"
        >
          <div className="flex min-h-0 flex-col gap-4">
            <p className="whitespace-pre-line break-words text-sm leading-snug text-slate-800">
              {formatConsultationNoteForDisplay(consultationNoteViewer.doctor_notes) ||
                "No note recorded."}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setConsultationNoteViewer(null)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
              >
                Close
              </button>
              {canModifyClinicalData && canEditConsultation(consultationNoteViewer) ? (
                <button
                  type="button"
                  onClick={() => handleConsultationEditStart(consultationNoteViewer)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
                >
                  <SquarePen className="size-4" />
                  Edit
                </button>
              ) : null}
              {canViewConsultations ? (
                <Link
                  to={`/consultations/${consultationNoteViewer.id}${isOperatorConsultationViewOnly(user) ? "#manual-invoice-photos" : ""}`}
                  onClick={() => setConsultationNoteViewer(null)}
                  className="inline-flex items-center justify-center rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 md:bg-ocs-teal md:hover:bg-ocs-teal/90"
                >
                  {isOperatorConsultationViewOnly(user)
                    ? "Attach manual invoice photo"
                    : "Open full consultation record"}
                </Link>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={Boolean(consultationToDelete)}
        onClose={() => {
          setConsultationToDelete(null);
          setConsultationVoidReason("");
          setConsultationFieldSaleDisposition("");
        }}
        onConfirm={handleDeleteConsultation}
        title="Delete consultation note?"
        description={
          consultationToDelete
            ? `This will void the unpaid consultation dated ${formatDate(
                consultationToDelete.consultation_date,
              )}. Its unpaid billing will be retained as voided history and linked supplies will be reversed.`
            : ""
        }
        confirmLabel="Void consultation"
        confirmDisabled={consultationVoidReason.trim().length < 8}
      >
        <label className="block space-y-2 text-sm font-semibold text-ocs-slate">
          Reason for voiding
          <textarea
            value={consultationVoidReason}
            onChange={(event) => setConsultationVoidReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Explain why this unpaid consultation must be voided"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none transition focus:border-ocs-teal focus:ring-2 focus:ring-ocs-teal/15"
          />
          <span className="block text-xs font-normal text-slate-500">Minimum 8 characters. This reason is retained in the audit history.</span>
        </label>
        <label className="mt-4 block space-y-2 text-sm font-semibold text-ocs-slate">
          Field-dispensed supply outcome
          <select
            value={consultationFieldSaleDisposition}
            onChange={(event) => setConsultationFieldSaleDisposition(event.target.value)}
            className="w-full min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-normal outline-none transition focus:border-ocs-teal focus:ring-2 focus:ring-ocs-teal/15"
          >
            <option value="">No field-dispensed supplies</option>
            <option value="returned_to_stock">Returned unopened to the doctor bag</option>
            <option value="consumed_or_wasted">Consumed or wasted — do not restore stock</option>
          </select>
          <span className="block text-xs font-normal text-slate-500">
            If supplies were dispensed from the doctor bag for this visit, an outcome is compulsory and retained in the audit trail.
          </span>
        </label>
      </ConfirmDialog>
    </div>
  );
}

export default PatientProfilePage;
