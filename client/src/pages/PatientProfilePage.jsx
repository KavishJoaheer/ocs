import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Download,
  FileText,
  FlaskConical,
  GitMerge,
  History,
  HeartPulse,
  LockKeyhole,
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
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import PatientLinkhamPolicyBadge from "../components/PatientLinkhamPolicyBadge.jsx";
import { PatientFormModal } from "../components/PatientIntakeForm.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import {
  canEditConsultationNote,
  canManageConsultationNotes,
} from "../lib/consultationAccess.js";
import { canBillPatientForUser } from "../lib/access.js";
import {
  canDeleteLabReportAttachment,
  canManageLabReportsForUser,
} from "../lib/labReportAccess.js";
import {
  formatAgeFromDateOfBirth,
  formatCurrency,
  formatDate,
  formatPaymentMethod,
} from "../lib/format.js";
import { isPatientSubscribed } from "../lib/patientSubscription.js";
import {
  defaultReviewDueDateInputValue,
  formatScheduledReviewDate,
  isPatientUnderReview,
} from "../lib/patientReview.js";
import { cx } from "../lib/utils.js";
import PatientLocationTags from "../components/PatientLocationTags.jsx";

function HealthPlanBadge({ className, compact = false }) {
  return (
    <span
      className={cx(
        "inline-flex w-fit items-center rounded-full border border-[#e6ebd9]/70 bg-[#404a42] font-bold uppercase tracking-widest text-[#f4f6f0] shadow-sm",
        compact ? "px-2 py-0.5 text-[10px]" : "ml-3 px-2.5 py-1 text-xs tracking-wide",
        className,
      )}
    >
      ★ HEALTH PLAN
    </span>
  );
}

function LongTermReviewAlertBanner({ note, dueDate }) {
  const trimmed = String(note || "").trim();
  const scheduledLabel = formatScheduledReviewDate(dueDate);
  if (!trimmed && !scheduledLabel) {
    return null;
  }

  return (
    <div
      className="mb-4 rounded-xl border border-[#f5e3d7] border-l-4 border-l-[#d9744b] bg-[#fcf3ee] p-4 text-[#6e2f14] shadow-sm"
      role="status"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[#ba5a32]">
        Long term review — operator desk flag
      </p>
      {scheduledLabel ? (
        <p className="mt-1 text-xs font-semibold text-[#6e2f14]">Target date: {scheduledLabel}</p>
      ) : null}
      {trimmed ? (
        <p className="mt-1 text-sm font-medium leading-relaxed text-[#6e2f14]">{trimmed}</p>
      ) : null}
    </div>
  );
}

function ScheduledReviewIndicator({ dueDate }) {
  const label = formatScheduledReviewDate(dueDate);
  if (!label) {
    return null;
  }

  return (
    <span className="mt-1.5 inline-block rounded border border-amber-100 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
      Scheduled Review: {label}
    </span>
  );
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
      title="Flag for long term review"
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
        👤 Under Active Review
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
      🔍 Flag for Long Term Review
    </button>
  );
}

function HighlightStat({ icon: Icon, label, value, compact = false }) {
  if (compact) {
    return (
      <div className="min-w-0 rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="rounded-lg bg-sky-50 p-1.5 text-sky-700">
            <Icon className="size-4" />
          </div>
          <p className="w-full truncate text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className="text-lg font-bold leading-none text-slate-950 tabular-nums">{value}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full min-w-0 rounded-[22px] border border-transparent bg-white px-4 py-3.5 shadow-md">
      <div className="flex min-w-0 items-center gap-3">
        <div className="shrink-0 rounded-xl bg-ocs-teal/10 p-2.5 text-ocs-teal">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ocs-grey">
            {label}
          </p>
          <p className="mt-0.5 break-words text-xl font-bold text-slate-800">{value}</p>
        </div>
      </div>
    </div>
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

  return <StatusBadge value={status} />;
}

function getMobileBillingCanvasClass(bills) {
  if (!bills?.length) {
    return "space-y-4";
  }

  const hasUnpaid = bills.some(
    (bill) => String(bill.payment_status || bill.status).trim().toLowerCase() === "unpaid",
  );

  return cx(
    "space-y-4 rounded-2xl border p-4",
    hasUnpaid
      ? "border-rose-100/80 bg-rose-50/30"
      : "border-[#e6ebd9]/80 bg-[#e6ebd9]/40 text-[#3b4733]",
  );
}

function getMobileBillingCardClass(bill) {
  const normalized = String(bill.payment_status || bill.status).trim().toLowerCase();

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
          "mt-1 break-words text-sm leading-snug",
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
    <div className="min-w-0 border-b border-gray-100 pb-3">
      <p className="text-xs font-bold uppercase tracking-widest text-ocs-grey">{label}</p>
      <p
        className={cx(
          "mt-1 line-clamp-3 break-words text-sm leading-snug",
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
  };
}

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
  const isEditing = Boolean(report?.id);
  const [syncedDeps, setSyncedDeps] = useState({ open, report, isEditing });

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

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Upload files</span>
          <input
            type="file"
            multiple
            accept=".pdf,image/*"
            onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
            className="w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 outline-none transition file:mr-4 file:rounded-xl file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ocs-slate hover:border-slate-300 focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20 md:file:hover:border-ocs-teal md:file:hover:text-ocs-teal"
          />
          <p className="text-xs leading-5 text-slate-500">
            Upload PDF or image files. These files will be linked to this Medical & Lab Report and
            to the selected consultation when one is chosen.
          </p>
        </label>

        {selectedFiles.length ? (
          <div className="space-y-2 rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Files ready to upload
            </p>
            <div className="space-y-2">
              {selectedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
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

    onSubmit({
      doctor_id: isAdmin ? Number(form.doctor_id) : Number(user.doctor_id),
      consultation_date: form.consultation_date,
      appointment_time: form.appointment_time,
      doctor_notes: form.doctor_notes,
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

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Consultation note</span>
          <textarea
            required
            rows="12"
            value={form.doctor_notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, doctor_notes: event.target.value }))
            }
            placeholder="Record assessment, plan, medication advice, and follow-up instructions."
            className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 leading-7 outline-none transition focus:border-sky-400 focus:bg-white md:focus:border-ocs-teal md:focus:ring-2 md:focus:ring-ocs-teal/20"
          />
        </label>

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

function PatientProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
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
  const [expandedConsultations, setExpandedConsultations] = useState({});
  const [showAllConsultations, setShowAllConsultations] = useState(false);
  const [consultationComposerOpen, setConsultationComposerOpen] = useState(false);
  const [isCreatingConsultation, setIsCreatingConsultation] = useState(false);
  const [consultationToDelete, setConsultationToDelete] = useState(null);
  const [consultationNoteViewer, setConsultationNoteViewer] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [fabOpen, setFabOpen] = useState(false);
  const [patientEditorOpen, setPatientEditorOpen] = useState(false);
  const [isSavingPatient, setIsSavingPatient] = useState(false);
  const [longTermReviewModalOpen, setLongTermReviewModalOpen] = useState(false);
  const [isSavingLongTermReview, setIsSavingLongTermReview] = useState(false);
  const canModifyClinicalData = user.role === "doctor" || user.role === "admin";
  const canManageLabReports = canManageLabReportsForUser(user);
  const canManageConsultations = canManageConsultationNotes(user);
  const canFlagLongTermReview = ["admin", "operator"].includes(user.role);

  const canEditPatientProfile = useMemo(() => {
    if (!data) {
      return false;
    }
    return ["admin", "doctor", "operator"].includes(user.role);
  }, [data, user.role]);

  const showPatientBillingUi = useMemo(
    () => Boolean(data && canBillPatientForUser(user, data.patient)),
    [data, user],
  );

  const showMobileFab =
    canEditPatientProfile ||
    (canModifyClinicalData &&
      (canManageConsultations || showPatientBillingUi || canManageLabReports)) ||
    (user.role === "accountant" && showPatientBillingUi) ||
    (user.role === "lab_tech" && canManageLabReports);

  const mobileProfileTabs = useMemo(
    () => MOBILE_TABS.filter((tab) => tab.key !== "billing" || showPatientBillingUi),
    [showPatientBillingUi],
  );

  useEffect(() => {
    if (activeTab === "billing" && !showPatientBillingUi) {
      setActiveTab("summary");
    }
  }, [activeTab, showPatientBillingUi]);

  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function loadPatient() {
      try {
        const [response, doctorOptions] = await Promise.all([
          api.get(`/patients/${id}`),
          user.role === "admin" ? api.get("/doctors") : Promise.resolve([]),
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
  }, [id, refreshKey]);

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

    const previewTab = window.open("about:blank", "_blank");
    if (!previewTab) {
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
      const objectUrl = window.URL.createObjectURL(blob);
      const isViewable =
        mime.includes("pdf") ||
        mime.startsWith("image/") ||
        /\.(pdf|png|jpe?g|gif|webp)$/i.test(attachment.original_name || "");

      if (isViewable) {
        previewTab.location.href = objectUrl;
        window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 120_000);
        return;
      }

      previewTab.close();

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = decodeURIComponent(
        response.filename || attachment.original_name || "report-file",
      );
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      previewTab.close();
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
        user.role === "admin" ? api.get("/doctors") : Promise.resolve(doctors),
      ]);

      setData(response);
      setDoctors(doctorOptions);
    } catch (error) {
      toast.error(error?.message || "Could not refresh the patient profile.");
    }
  }

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
        isUnderReview ? "Patient flagged for long term review." : "Long term review flag removed.",
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
    setExpandedConsultations((current) => ({ ...current, [consultation.id]: true }));
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
      await api.delete(`/consultations/${consultationToDelete.id}`);
      if (consultationEditorId === consultationToDelete.id) {
        setConsultationEditorId(null);
        setConsultationDraft(getConsultationDraft());
      }
      setConsultationToDelete(null);
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

  const statusDetail =
    data.patient.status === "active"
      ? data.patient.ongoing_treatment || "Ongoing treatment not recorded"
      : "Patient has been discharged from active treatment.";
  const assignedDoctor = data.patient.assigned_doctor_name
    ? (() => {
        const baseName = String(data.patient.assigned_doctor_name).trim().split(" - ")[0].trim();
        const nameWithoutPrefix = baseName.replace(/^dr\.?\s+/i, "").trim();
        return nameWithoutPrefix ? `Dr ${nameWithoutPrefix}` : "Unassigned";
      })()
    : "Unassigned";
  const patientContactNumber =
    data.patient.patient_contact_number || data.patient.contact_number || "Not recorded";
  const visibleConsultations = showAllConsultations
    ? data.consultations
    : data.consultations.slice(0, CONSULTATION_ROWS_LIMIT);
  const hiddenConsultationCount = Math.max(
    data.consultations.length - visibleConsultations.length,
    0,
  );
  const lastVisitDate = data.consultations[0]?.consultation_date
    ? formatDate(data.consultations[0].consultation_date)
    : "Not recorded";
  const profileAgeLabel = data.patient.date_of_birth
    ? formatAgeFromDateOfBirth(data.patient.date_of_birth)
    : "Not recorded";
  const profileAddressLabel = hasMeaningfulPatientField(data.patient.address)
    ? data.patient.address
    : "Not recorded";

  const mobileDemographicsPrimary = [
    [data.patient.first_name, data.patient.last_name].filter(Boolean).join(" ").trim(),
    data.patient.gender,
  ]
    .filter(Boolean)
    .join(" - ");

  const mobileAssignedDoctor = data.patient.assigned_doctor_name
    ? /^dr\.?\s/i.test(String(data.patient.assigned_doctor_name).trim())
      ? String(data.patient.assigned_doctor_name).trim()
      : `Dr ${String(data.patient.assigned_doctor_name).trim()}`
    : "Unassigned";

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
    ...(hasMeaningfulPatientField(data.patient.drug_allergy_history)
      ? [
          {
            key: "allergy",
            icon: ShieldAlert,
            label: "Allergy history",
            value: data.patient.drug_allergy_history,
            iconBg: "bg-amber-50 text-amber-700",
          },
        ]
      : []),
  ];

  return (
    <div className="ocs-page w-full min-w-0 max-w-full space-y-6 overflow-x-hidden md:bg-slate-50">
      {isMobile && (
        <div
          className="sticky top-0 z-20 w-full min-w-0 max-w-full border-b border-slate-200/80 bg-white/80 px-4 pb-3 backdrop-blur-lg"
          style={{ paddingTop: "var(--sat)" }}
        >
          <div className="flex min-w-0 items-start justify-between gap-3 pt-3">
            <div className="min-w-0 flex-1">
              <div className="flex w-full flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-base font-extrabold leading-snug text-ocs-slate">
                    {data.patient.full_name}
                  </h1>
                  <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-bold text-gray-500">
                    {data.patient.patient_identifier || "No OCS care number"}
                  </span>
                  <PatientLinkhamPolicyBadge patient={data.patient} />
                </div>
                {isPatientSubscribed(data.patient) ? (
                  <div className="mt-0.5">
                    <HealthPlanBadge className="ml-0" compact />
                  </div>
                ) : null}
                <span className="text-xs text-ocs-grey">
                  📍 {profileAddressLabel} • Age: {profileAgeLabel}
                </span>
              </div>
            </div>
            <a
              href={`tel:${patientContactNumber}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-ocs-slate px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Phone className="size-4" />
              Quick Call
            </a>
          </div>
        </div>
      )}

      <div className="hidden md:block">
        <PageHeader
          title={
            <div className="mb-4 flex w-full flex-col gap-1 border-b border-gray-100 pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg font-extrabold text-ocs-slate">
                  {data.patient.full_name}
                </span>
                <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-bold text-gray-500">
                  {data.patient.patient_identifier || "No OCS care number"}
                </span>
                <PatientLinkhamPolicyBadge patient={data.patient} />
                <LinkStatusBadge status={data.patient.link_status} />
              </div>
              {isPatientSubscribed(data.patient) ? (
                <HealthPlanBadge className="ml-0" />
              ) : null}
              <span className="text-xs text-ocs-grey">
                📍 {profileAddressLabel} • Age: {profileAgeLabel}
              </span>
            </div>
          }
          actions={(
            <div className="flex flex-row flex-wrap items-center justify-end gap-3">
              {canFlagLongTermReview ? (
                <AccountLinkReview patient={data.patient} onChanged={reloadPatientProfile} />
              ) : null}
              {canFlagLongTermReview ? (
                <LongTermReviewFlagButton
                  patient={data.patient}
                  disabled={isSavingLongTermReview}
                  isSaving={isSavingLongTermReview}
                  onRequestFlag={() => setLongTermReviewModalOpen(true)}
                  onUnflag={handleUnflagLongTermReview}
                />
              ) : null}
              {canEditPatientProfile ? (
                <button
                  type="button"
                  onClick={() => setPatientEditorOpen(true)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
                >
                  <SquarePen className="size-4" />
                  Edit patient
                </button>
              ) : null}
              {canManageConsultations ? (
                <button
                  type="button"
                  onClick={() => setConsultationComposerOpen(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-ocs-teal px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-ocs-teal/90"
                >
                  <Plus className="size-4" />
                  New Consultation Note
                </button>
              ) : null}
              <a
                href="#consultation-notes"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
              >
                <FileText className="size-4" />
                View Past Notes
              </a>
              {showPatientBillingUi ? (
                <Link
                  to={`/billing?patientId=${id}`}
                  aria-label="Open billing"
                  title="Open billing"
                  className="inline-flex items-center justify-center rounded-2xl border border-transparent p-3 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <CreditCard className="size-5" />
                </Link>
              ) : null}
              <Link
                to="/patients"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
              >
                <ArrowLeft className="size-4" />
                Back to patients
              </Link>
            </div>
          )
          }
        />
      </div>

      {isMobile ? (
        <>
          <div className="w-full min-w-0 overflow-x-auto overflow-y-hidden [-webkit-overflow-scrolling:touch] pb-0.5">
            <div className="flex w-max min-w-0 gap-2">
              {mobileProfileTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={cx(
                    "whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold transition",
                    activeTab === tab.key
                      ? "bg-ocs-teal text-white"
                      : "bg-slate-100 text-slate-600",
                  )}
                  style={{ minHeight: 48 }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
            {canFlagLongTermReview ? (
              <AccountLinkReview patient={data.patient} onChanged={reloadPatientProfile} />
            ) : null}
            {canFlagLongTermReview ? (
              <LongTermReviewFlagButton
                patient={data.patient}
                disabled={isSavingLongTermReview}
                isSaving={isSavingLongTermReview}
                onRequestFlag={() => setLongTermReviewModalOpen(true)}
                onUnflag={handleUnflagLongTermReview}
              />
            ) : null}
            {canEditPatientProfile ? (
              <button
                type="button"
                onClick={() => setPatientEditorOpen(true)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-ocs-teal/40 hover:text-ocs-teal"
              >
                <SquarePen className="size-4" />
                Edit profile
              </button>
            ) : null}
          </div>


          {activeTab === "summary" && (
            <div className="space-y-4 rounded-2xl border border-[#e6ebd9] bg-[#f4f6f0] p-4">
              <div className="grid min-w-0 grid-cols-3 gap-2">
                <HighlightStat
                  compact
                  icon={CalendarClock}
                  label="Appointments"
                  value={data.appointments.length}
                />
                <HighlightStat
                  compact
                  icon={FileText}
                  label="Consultations"
                  value={data.consultations.length}
                />
                <HighlightStat
                  compact
                  icon={FlaskConical}
                  label="Lab Reports"
                  value={data.labReports.length}
                />
              </div>

              <SectionCard title="Patient details" variant="demographic">
                <div className="space-y-3">
                  {mobileDemographicsPrimary ? (
                    <p className="break-words text-sm font-semibold leading-snug text-slate-900">
                      {mobileDemographicsPrimary}
                    </p>
                  ) : null}
                  {hasMeaningfulPatientField(data.patient.patient_id_number) ? (
                    <p className="text-sm text-slate-600">
                      Patient ID: {data.patient.patient_id_number}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge value={data.patient.status} />
                    {mobileAssignedDoctor !== "Unassigned" ? (
                      <span className="min-w-0 text-xs text-slate-600">{mobileAssignedDoctor}</span>
                    ) : null}
                  </div>
                  {isPatientUnderReview(data.patient) ? (
                    <ScheduledReviewIndicator dueDate={data.patient.review_due_date} />
                  ) : null}
                  {data.patient.status === "active" &&
                  hasMeaningfulPatientField(data.patient.ongoing_treatment) ? (
                    <p className="text-xs leading-snug text-slate-600">
                      {data.patient.ongoing_treatment}
                    </p>
                  ) : null}
                  {showMobileContact ? (
                    <p className="text-sm text-slate-700">
                      <span className="font-medium text-slate-500">Contact </span>
                      {rawContactDigits}
                    </p>
                  ) : null}
                  {showMobileAddress ? (
                    <p className="text-sm leading-snug text-slate-700">
                      <span className="font-medium text-slate-500">Address </span>
                      {data.patient.address}
                    </p>
                  ) : null}
                  {showMobileLocations ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Locations
                      </p>
                      <div className="mt-1">
                        <PatientLocationTags
                          tags={data.patient.location_tags || []}
                          onChange={() => {}}
                          readOnly
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              {mobileNokHasAny ? (
                <SectionCard title="Next of kin" variant="demographic">
                  <dl className="space-y-2 text-sm">
                    {hasMeaningfulPatientField(data.patient.next_of_kin_name) ? (
                      <div>
                        <dt className="text-xs font-semibold text-[#67755d]">
                          Name
                        </dt>
                        <dd className="font-medium text-slate-900">{data.patient.next_of_kin_name}</dd>
                      </div>
                    ) : null}
                    {hasMeaningfulPatientField(data.patient.next_of_kin_relationship) ? (
                      <div>
                        <dt className="text-xs font-semibold text-[#67755d]">
                          Relationship
                        </dt>
                        <dd className="text-slate-700">{data.patient.next_of_kin_relationship}</dd>
                      </div>
                    ) : null}
                    {hasMeaningfulPatientField(data.patient.next_of_kin_contact_number) ? (
                      <div>
                        <dt className="text-xs font-semibold text-[#67755d]">
                          Contact
                        </dt>
                        <dd className="text-slate-700">{data.patient.next_of_kin_contact_number}</dd>
                      </div>
                    ) : null}
                    {hasMeaningfulPatientField(data.patient.next_of_kin_email) ? (
                      <div>
                        <dt className="text-xs font-semibold text-[#67755d]">
                          Email
                        </dt>
                        <dd className="text-slate-700">{data.patient.next_of_kin_email}</dd>
                      </div>
                    ) : null}
                  </dl>
                </SectionCard>
              ) : null}

              {mobileClinicalBlocks.length || isPatientUnderReview(data.patient) ? (
                <SectionCard title="Clinical history">
                  <LongTermReviewAlertBanner
                    note={data.patient.review_reason_note}
                    dueDate={data.patient.review_due_date}
                  />
                  <div className="space-y-2">
                    {mobileClinicalBlocks.map((block) => {
                      const Icon = block.icon;
                      return (
                        <div key={block.key} className="border-b border-gray-100 pb-3">
                          <div className="flex items-start gap-2.5">
                            <div className={cx("shrink-0 rounded-lg p-2", block.iconBg)}>
                              <Icon className="size-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
                                {block.label}
                              </p>
                              <p className="mt-1 line-clamp-3 break-words text-sm leading-snug text-slate-700">
                                {block.value}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              ) : null}

              {hasMeaningfulPatientField(data.patient.particularity) ? (
                <SectionCard title="Particularity">
                  <p className="whitespace-pre-line break-words text-sm leading-snug text-slate-700">
                    {data.patient.particularity}
                  </p>
                </SectionCard>
              ) : null}
            </div>
          )}

          {activeTab === "notes" && (
            <div className="space-y-4">
              {canModifyClinicalData && (
                <button
                  type="button"
                  onClick={() => setConsultationComposerOpen(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-ocs-teal px-4 py-3 text-sm font-semibold text-white"
                  style={{ minHeight: 48 }}
                >
                  <Plus className="size-4" />
                  Add consultation note
                </button>
              )}

              {data.consultations.length ? (
                <div className="space-y-3">
                  {visibleConsultations.map((consultation) => {
                    const isEditing = consultationEditorId === consultation.id;
                    const canEditRow = canEditConsultation(consultation);
                    const note = consultation.doctor_notes || "";
                    const isExpanded = expandedConsultations[consultation.id] || isEditing;
                    return (
                      <div
                        key={consultation.id}
                        className="rounded-[24px] border border-slate-200/80 bg-white"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            !isEditing &&
                            setExpandedConsultations((prev) => ({
                              ...prev,
                              [consultation.id]: !prev[consultation.id],
                            }))
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
                          {isExpanded ? (
                            <ChevronUp className="size-4 shrink-0 text-slate-400" />
                          ) : (
                            <ChevronDown className="size-4 shrink-0 text-slate-400" />
                          )}
                        </button>

                        {!isExpanded && note && (
                          <p className="line-clamp-2 px-4 pb-4 break-words text-sm leading-snug text-slate-600">
                            {formatConsultationNoteForDisplay(note)}
                          </p>
                        )}

                        {isExpanded && (
                          <div className="space-y-3 border-t border-slate-100 p-4">
                            {isEditing ? (
                              <div className="space-y-3">
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
                                <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-800">
                                  {formatConsultationNoteForDisplay(note) || "No note recorded."}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setConsultationNoteViewer(consultation)}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
                                    style={{ minHeight: 48 }}
                                  >
                                    Open
                                  </button>
                                  {canModifyClinicalData && canEditRow && !isEditing ? (
                                    <button
                                      type="button"
                                      onClick={() => handleConsultationEditStart(consultation)}
                                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
                                      style={{ minHeight: 48 }}
                                    >
                                      <SquarePen className="size-4" />
                                      Edit
                                    </button>
                                  ) : canModifyClinicalData && !canEditRow && !isEditing ? (
                                    <span
                                      className="inline-flex items-center gap-1 px-1 text-xs font-medium text-slate-500"
                                      title="You can only edit notes you authored"
                                    >
                                      <LockKeyhole className="size-3 shrink-0 text-slate-400" aria-hidden />
                                      View only
                                    </span>
                                  ) : null}
                                  {user.role === "admin" && canEditRow ? (
                                    <button
                                      type="button"
                                      onClick={() => setConsultationToDelete(consultation)}
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
                        )}
                      </div>
                    );
                  })}

                  {data.consultations.length > CONSULTATION_ROWS_LIMIT ? (
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

          {activeTab === "reports" && (
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

              {data.labReports.length ? (
                <div className="space-y-4">
                  {data.labReports.map((report) => (
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
                        <MobileBillingStatusBar status={bill.payment_status || bill.status} />
                      </div>
                      <div className="mt-3 space-y-3">
                        <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Pay by
                          </p>
                          <p className="mt-2 text-sm font-semibold text-slate-900">
                            {formatPaymentMethod(bill.payment_method)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Payment date
                          </p>
                          <p className="mt-2 text-sm font-semibold text-slate-900">
                            {bill.payment_date ? formatDate(bill.payment_date) : "Not recorded"}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Consultation
                          </p>
                          <p className="mt-2 text-sm font-semibold text-slate-900">
                            {formatDate(bill.consultation_date)}
                          </p>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-1 text-sm text-slate-600">
                        {bill.items.map((item, index) => (
                          <li key={`${bill.id}-${index}`}>
                            {item.description}: {formatCurrency(item.amount)}
                          </li>
                        ))}
                      </ul>
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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <HighlightStat
              icon={CalendarClock}
              label="Appointments"
              value={data.appointments.length}
            />
            <HighlightStat
              icon={FileText}
              label="Consultations"
              value={data.consultations.length}
            />
            <HighlightStat
              icon={FlaskConical}
              label="Medical & Lab Reports"
              value={data.labReports.length}
            />
            <HighlightStat
              icon={History}
              label="Last visit date"
              value={lastVisitDate}
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-12">
            <SectionCard className="xl:col-span-7" title="Patient details" variant="demographic">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                <ProfileDlItem label="Patient ID" value={data.patient.patient_id_number} emphasize />
                <ProfileDlItem label="First name" value={data.patient.first_name} emphasize />
                <ProfileDlItem label="Last name" value={data.patient.last_name} emphasize />
                <ProfileDlItem label="Gender" value={data.patient.gender} emphasize />
                <ProfileDlItem label="Assigned doctor" value={assignedDoctor} emphasize />
                <ProfileDlItem label="Contact" value={patientContactNumber} />
                <ProfileDlItem label="Address" value={data.patient.address} />
              </dl>
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ocs-grey">
                  Status
                </span>
                <StatusBadge value={data.patient.status} />
                <span className="min-w-0 text-xs leading-snug text-ocs-grey">{statusDetail}</span>
              </div>
              {isPatientUnderReview(data.patient) ? (
                <ScheduledReviewIndicator dueDate={data.patient.review_due_date} />
              ) : null}
              <div className="mt-2 border-t border-slate-100 pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Locations and affiliations
                </p>
                <div className="mt-1">
                  <PatientLocationTags
                    tags={data.patient.location_tags || []}
                    onChange={() => {}}
                    readOnly
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard className="xl:col-span-5" title="Next of kin" variant="demographic">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <ProfileDlItem label="Name" value={data.patient.next_of_kin_name} emphasize />
                <ProfileDlItem label="Relationship" value={data.patient.next_of_kin_relationship} />
                <ProfileDlItem label="Phone" value={data.patient.next_of_kin_contact_number} />
                <ProfileDlItem label="Email" value={data.patient.next_of_kin_email} />
              </dl>
            </SectionCard>

            <SectionCard className="xl:col-span-7" title="Clinical history">
              <LongTermReviewAlertBanner
                note={data.patient.review_reason_note}
                dueDate={data.patient.review_due_date}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ClinicalGridItem label="Past medical history" value={data.patient.past_medical_history} />
                <ClinicalGridItem label="Past surgical history" value={data.patient.past_surgical_history} />
                <ClinicalGridItem label="Drug history" value={data.patient.drug_history} />
                <ClinicalGridItem label="Allergy history" value={data.patient.drug_allergy_history} />
              </div>
            </SectionCard>

            <SectionCard className="xl:col-span-5" title="Particularity">
              <p
                className={cx(
                  "whitespace-pre-wrap text-xs leading-snug",
                  data.patient.particularity ? "text-slate-800 line-clamp-4" : "text-ocs-grey",
                )}
              >
                {data.patient.particularity || "No particularity recorded during intake."}
              </p>
            </SectionCard>
          </div>

          <SectionCard
            id="consultation-notes"
            className="scroll-mt-28"
            title="Consultation notes"
            actions={
              canManageConsultations ? (
                <button
                  type="button"
                  onClick={() => setConsultationComposerOpen(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-ocs-teal px-4 py-3 text-sm font-semibold text-white transition hover:bg-ocs-teal/90"
                >
                  <Plus className="size-4" />
                  Add consultation note
                </button>
              ) : null
            }
          >
            {data.consultations.length ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-[28px] border border-transparent bg-white shadow-md">
                  <div className="overflow-x-auto">
                    <table className="min-w-full table-fixed divide-y divide-slate-200 text-left">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="w-[11%] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-ocs-slate">
                            Date
                          </th>
                          <th className="w-[17%] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-ocs-slate">
                            Doctor
                          </th>
                          <th className="min-w-0 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-ocs-slate">
                            Consultation note
                          </th>
                          <th className="w-[28%] px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wider text-ocs-slate">
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
                              <td className="px-4 py-2.5 text-sm font-semibold text-slate-900">
                                {formatDate(consultation.consultation_date)}
                              </td>
                              <td className="px-4 py-2.5 text-sm text-slate-600">
                                <p className="text-sm font-bold text-slate-900">
                                  {consultation.doctor_name}
                                </p>
                                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                                  {consultation.specialization || "General practice"}
                                </p>
                              </td>
                              <td className="min-w-0 max-w-0 px-4 py-2.5">
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
                              <td className="px-4 py-2.5">
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
                                  {user.role === "admin" && canEditRow ? (
                                    <button
                                      type="button"
                                      onClick={() => setConsultationToDelete(consultation)}
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
                </div>

                {data.consultations.length > CONSULTATION_ROWS_LIMIT ? (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setShowAllConsultations((current) => !current)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
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
                title="No consultations recorded"
                description="Consultation notes will appear here as soon as a doctor completes a visit and saves the note."
                action={
                  canManageConsultations ? (
                    <button
                      type="button"
                      onClick={() => setConsultationComposerOpen(true)}
                      className="inline-flex items-center gap-2 rounded-2xl bg-ocs-teal px-4 py-3 text-sm font-semibold text-white transition hover:bg-ocs-teal/90"
                    >
                      <Plus className="size-4" />
                      Add consultation note
                    </button>
                  ) : null
                }
              />
            )}
          </SectionCard>

          <SectionCard
        title="Medical & Lab Reports"
            actions={
              canManageLabReports ? (
                  <button
                    type="button"
                    onClick={() => setReportEditor({ id: null })}
                    className="inline-flex items-center gap-2 rounded-2xl bg-ocs-teal px-4 py-3 text-sm font-semibold text-white transition hover:bg-ocs-teal/90"
                  >
                  <Plus className="size-4" />
                  Add Medical & Lab Report
                </button>
              ) : null
            }
          >
            {data.labReports.length ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {data.labReports.map((report) => (
                  <article
                    key={report.id}
                    className="rounded-[26px] border border-transparent bg-white p-5 shadow-md"
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
              <EmptyState
                title="No Medical & Lab Reports yet"
                description="Add a Medical & Lab Report here to keep investigations, consultation notes, and uploaded files together on the same patient profile."
              />
            )}
          </SectionCard>

          {showPatientBillingUi ? (
            <SectionCard
              title="Billing history"
              actions={
                <Link
                  to={`/billing?patientId=${id}`}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
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
                            <StatusBadge value={bill.status} />
                          </td>
                          <td className="px-3 py-1.5 align-middle text-right">
                            <Link
                              to={`/billing?patientId=${id}`}
                              className="inline-flex rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No billing records"
                  description="Bills are created automatically when a consultation is saved."
                />
              )}
            </SectionCard>
          ) : null}
        </>
      )}

      {isMobile && showMobileFab && (
        <>
          {fabOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
              onClick={() => setFabOpen(false)}
            />
          )}
          <div className="fixed bottom-24 right-5 z-50 flex flex-col items-end gap-3">
            {fabOpen && (
              <>
                {canManageLabReports && (canModifyClinicalData || user.role === "lab_tech") && (
                  <button
                    type="button"
                    onClick={() => {
                      setReportEditor({ id: null });
                      setFabOpen(false);
                    }}
                    className="flex items-center gap-3"
                  >
                    <span className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow">
                      Attach Report
                    </span>
                    <span className="flex size-11 items-center justify-center rounded-full bg-ocs-teal text-white shadow-lg">
                      <Paperclip className="size-5" />
                    </span>
                  </button>
                )}
                {showPatientBillingUi &&
                  (canModifyClinicalData || user.role === "accountant") && (
                  <button
                    type="button"
                    onClick={() => {
                      navigate(`/billing?patientId=${id}&create=1`);
                      setFabOpen(false);
                    }}
                    className="flex items-center gap-3"
                  >
                    <span className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow">
                      New Bill
                    </span>
                    <span className="flex size-11 items-center justify-center rounded-full bg-ocs-teal text-white shadow-lg">
                      <CreditCard className="size-5" />
                    </span>
                  </button>
                )}
                {canModifyClinicalData && canManageConsultations && (
                  <button
                    type="button"
                    onClick={() => {
                      setConsultationComposerOpen(true);
                      setFabOpen(false);
                    }}
                    className="flex items-center gap-3"
                  >
                    <span className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow">
                      Add Note
                    </span>
                    <span className="flex size-11 items-center justify-center rounded-full bg-ocs-teal text-white shadow-lg">
                      <FileText className="size-5" />
                    </span>
                  </button>
                )}
                {canEditPatientProfile && user.role === "operator" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPatientEditorOpen(true);
                      setFabOpen(false);
                    }}
                    className="flex items-center gap-3"
                  >
                    <span className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow">
                      Edit profile
                    </span>
                    <span className="flex size-11 items-center justify-center rounded-full bg-ocs-teal text-white shadow-lg">
                      <SquarePen className="size-5" />
                    </span>
                  </button>
                ) : null}
              </>
            )}
            <button
              type="button"
              onClick={() => setFabOpen((prev) => !prev)}
              className="flex size-14 items-center justify-center rounded-full bg-ocs-yellow text-slate-900 shadow-lg"
            >
              <Plus
                className={cx(
                  "size-6 transition-transform duration-200",
                  fabOpen && "rotate-45",
                )}
              />
            </button>
          </div>
        </>
      )}

      <LongTermReviewReasonModal
        open={longTermReviewModalOpen}
        isSaving={isSavingLongTermReview}
        onClose={() => setLongTermReviewModalOpen(false)}
        onSubmit={handleConfirmLongTermReviewFlag}
      />

      <PatientFormModal
        canEditPatientIdentifier={user.role === "admin"}
        canSelectAssignedDoctor={user.role === "admin"}
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
        consultations={data.consultations}
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
          title={`${formatDate(consultationNoteViewer.consultation_date)} · ${consultationNoteViewer.doctor_name}`}
          description={`${consultationNoteViewer.specialization || "General practice"} · Consultation note`}
          size="lg"
        >
          <div className="space-y-5">
            <div className="max-h-[min(60vh,28rem)] overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-4">
              <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-800">
                {formatConsultationNoteForDisplay(consultationNoteViewer.doctor_notes) ||
                  "No note recorded."}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setConsultationNoteViewer(null)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-ocs-slate transition hover:border-ocs-teal hover:text-ocs-teal"
              >
                Close
              </button>
              {canManageConsultations ? (
                <Link
                  to={`/consultations/${consultationNoteViewer.id}`}
                  onClick={() => setConsultationNoteViewer(null)}
                  className="inline-flex items-center justify-center rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 md:bg-ocs-teal md:hover:bg-ocs-teal/90"
                >
                  Open full consultation record
                </Link>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={Boolean(consultationToDelete)}
        onClose={() => setConsultationToDelete(null)}
        onConfirm={handleDeleteConsultation}
        title="Delete consultation note?"
        description={
          consultationToDelete
            ? `This will remove the consultation note dated ${formatDate(
                consultationToDelete.consultation_date,
              )}. Linked billing entries will be removed and linked Medical & Lab Reports will stay but become unlinked.`
            : ""
        }
        confirmLabel="Delete note"
      />
    </div>
  );
}

export default PatientProfilePage;
