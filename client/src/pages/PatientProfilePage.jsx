import { useEffect, useState } from "react";
import dayjs from "dayjs";
import {
  ArrowLeft,
  CalendarClock,
  CreditCard,
  Download,
  FileText,
  FlaskConical,
  HeartPulse,
  Paperclip,
  Pill,
  Plus,
  ShieldAlert,
  SquarePen,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import {
  formatAgeFromDateOfBirth,
  formatCurrency,
  formatDate,
  formatPaymentMethod,
} from "../lib/format.js";

function HighlightStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-[26px] border border-white/80 bg-white/85 p-5">
      <div className="flex items-center gap-4">
        <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
        </div>
      </div>
    </div>
  );
}

function ProfileField({ label, value, emphasize = false }) {
  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      <p
        className={`mt-2 text-sm leading-6 ${
          emphasize ? "font-semibold text-slate-900" : "text-slate-600"
        }`}
      >
        {value || "Not recorded"}
      </p>
    </div>
  );
}

const CONSULTATION_ROWS_LIMIT = 5;
const CONSULTATION_PREVIEW_LIMIT = 220;

function getConsultationPreview(note, limit = CONSULTATION_PREVIEW_LIMIT) {
  const normalized = String(note || "").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit).trimEnd()}...`;
}

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
  const canDeleteSavedAttachments = user?.role === "admin";

  useEffect(() => {
    if (!open) {
      return;
    }

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
  }, [isEditing, open, report]);

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
      description="Attach investigation findings and supporting files directly to this patient so the clinical profile carries both consultation notes and medical follow-up."
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
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
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
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
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
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
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
          <div className="rounded-[24px] border border-sky-100 bg-sky-50/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
              Linked consultation
            </p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
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
            className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 leading-7 outline-none transition focus:border-sky-400 focus:bg-white"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Upload files</span>
          <input
            type="file"
            multiple
            accept=".pdf,image/*"
            onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
            className="w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 outline-none transition file:mr-4 file:rounded-xl file:border-0 file:bg-sky-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-sky-300 focus:border-sky-400 focus:bg-white"
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
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
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
                <div
                  key={attachment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {attachment.original_name}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                      {formatAttachmentSize(attachment.file_size)} •{" "}
                      {roleLabel(attachment.uploaded_by_role)} upload
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onDownloadAttachment(attachment)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                    >
                      <Download className="size-4" />
                      Open file
                    </button>
                    {canDeleteSavedAttachments ? (
                      <button
                        type="button"
                        onClick={() => onDeleteAttachment(attachment)}
                        className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                      >
                        <Trash2 className="size-4" />
                        Delete file
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {!canDeleteSavedAttachments ? (
              <p className="text-xs leading-5 text-slate-500">
                Uploaded files are visible to Doctor, Admin, and Lab Tech. Only Admin can delete a
                saved file.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
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

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm(getEmptyConsultationEntry(user));
  }, [open, user]);

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
      description="Create a new patient consultation directly from the profile. This also creates a completed visit and linked billing record."
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
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
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
            <div className="rounded-[24px] border border-sky-100 bg-sky-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                Doctor
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">
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
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
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
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
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
            className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 leading-7 outline-none transition focus:border-sky-400 focus:bg-white"
          />
        </label>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Add consultation note"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PatientProfilePage() {
  const { id } = useParams();
  const { user } = useAuth();
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
  const canManageLabReports =
    user.role === "admin" || user.role === "doctor" || user.role === "lab_tech";
  const canDeleteReportFiles = user.role === "admin";
  const canManageConsultations = user.role === "admin" || user.role === "doctor";

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
  }, [id]);

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

  async function handleDownloadLabReportAttachment(attachment) {
    try {
      const response = await api.getBlob(attachment.download_url);
      const objectUrl = window.URL.createObjectURL(response.blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = decodeURIComponent(response.filename || attachment.original_name || "report-file");
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function handleDeleteLabReportAttachment(attachment) {
    if (!canDeleteReportFiles) {
      return;
    }

    try {
      await api.delete(`/lab-reports/attachments/${attachment.id}`);
      await reloadPatientProfile();
      if (reportEditor?.id === attachment.report_id) {
        setReportEditor((current) =>
          current
            ? {
                ...current,
                attachments: (current.attachments || []).filter((item) => item.id !== attachment.id),
              }
            : current,
        );
      }
      toast.success("Uploaded file deleted.");
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function reloadPatientProfile() {
    const [response, doctorOptions] = await Promise.all([
      api.get(`/patients/${id}`),
      user.role === "admin" ? api.get("/doctors") : Promise.resolve(doctors),
    ]);

    setData(response);
    setDoctors(doctorOptions);
  }

  function canEditConsultation(consultation) {
    if (!canManageConsultations) {
      return false;
    }

    if (user.role === "admin") {
      return true;
    }

    return Number(consultation.doctor_id) === Number(user.doctor_id);
  }

  function handleConsultationEditStart(consultation) {
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

  const totalBilled = data.bills.reduce((sum, bill) => sum + Number(bill.total_amount || 0), 0);
  const statusDetail =
    data.patient.status === "active"
      ? data.patient.ongoing_treatment || "Ongoing treatment not recorded"
      : "Patient has been discharged from active treatment.";
  const canOpenBilling = user.role === "admin" || user.role === "doctor";
  const assignedDoctor = data.patient.assigned_doctor_name
    ? `${data.patient.assigned_doctor_name}${
        data.patient.assigned_doctor_specialization
          ? ` - ${data.patient.assigned_doctor_specialization}`
          : ""
      }`
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Patient profile"
        title={data.patient.full_name}
        description={`${data.patient.patient_identifier || "No OCS care number yet"} - ${data.patient.gender} - ${formatAgeFromDateOfBirth(data.patient.date_of_birth)}`}
        actions={
          <div className="flex flex-wrap justify-end gap-3">
            {canOpenBilling ? (
              <Link
                to={`/billing?patientId=${id}`}
                className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700"
              >
                <CreditCard className="size-4" />
                Open billing
              </Link>
            ) : null}

            <Link
              to="/patients"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
            >
              <ArrowLeft className="size-4" />
              Back to patients
            </Link>
          </div>
        }
      />

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
          icon={CreditCard}
          label="Total billed"
          value={formatCurrency(totalBilled)}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard
          title="Patient details"
          subtitle="Core demographics, assigned doctor, and current care status."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <ProfileField
              label="OCS care number"
              value={data.patient.patient_identifier}
              emphasize
            />
            <ProfileField label="Patient ID" value={data.patient.patient_id_number} emphasize />
            <ProfileField label="First name" value={data.patient.first_name} emphasize />
            <ProfileField label="Last name" value={data.patient.last_name} emphasize />
            <ProfileField
              label="Age"
              value={formatAgeFromDateOfBirth(data.patient.date_of_birth)}
              emphasize
            />
            <ProfileField label="Gender" value={data.patient.gender} emphasize />
            <ProfileField label="Assigned doctor" value={assignedDoctor} emphasize />
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                Status
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <StatusBadge value={data.patient.status} />
                <span className="text-sm text-slate-600">{statusDetail}</span>
              </div>
            </div>
            <ProfileField label="Patient contact number" value={patientContactNumber} />
            <ProfileField label="Address" value={data.patient.address} />
            <ProfileField label="Location" value={data.patient.location} />
          </div>
        </SectionCard>

        <SectionCard
          title="Next of kin"
          subtitle="Family or support contact details kept alongside the patient record."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <ProfileField label="Name" value={data.patient.next_of_kin_name} emphasize />
            <ProfileField
              label="Relationship with patient"
              value={data.patient.next_of_kin_relationship}
            />
            <ProfileField
              label="Contact number"
              value={data.patient.next_of_kin_contact_number}
            />
            <ProfileField label="Email address" value={data.patient.next_of_kin_email} />
          </div>
        </SectionCard>

        <SectionCard
          title="Clinical history"
          subtitle="Historical information captured at registration."
        >
          <div className="space-y-4">
            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
                  <UserRound className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-950">Past medical history</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {data.patient.past_medical_history || "Not recorded"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
                  <HeartPulse className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-950">Past surgical history</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {data.patient.past_surgical_history || "Not recorded"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                  <Pill className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-950">Drug history</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {data.patient.drug_history || "Not recorded"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
                  <ShieldAlert className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-950">Allergy History</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {data.patient.drug_allergy_history || "Not recorded"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Particularity"
          subtitle="Additional patient-specific notes captured at registration."
        >
          <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Particularity
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">
              {data.patient.particularity || "No particularity recorded during intake."}
            </p>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Billing history"
        subtitle="Every bill attached to this patient's consultations."
        actions={
          canOpenBilling ? (
            <Link
              to={`/billing?patientId=${id}`}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
            >
              <CreditCard className="size-4" />
              Open billing workspace
            </Link>
          ) : null
        }
      >
          {data.bills.length ? (
            <div className="space-y-3">
              {data.bills.map((bill) => (
                <div
                  key={bill.id}
                  className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">
                        {formatCurrency(bill.total_amount)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Bill #{bill.id} - {bill.doctor_name} - {formatDate(bill.consultation_date)}
                      </p>
                    </div>
                    <StatusBadge value={bill.status} />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
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
      </SectionCard>

      <SectionCard
        title="Consultation notes"
        subtitle="A patient-level consultation notes table with expandable rows and dedicated consultation pages."
        actions={
          canManageConsultations ? (
            <button
              type="button"
              onClick={() => setConsultationComposerOpen(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700"
            >
              <Plus className="size-4" />
              Add consultation note
            </button>
          ) : null
        }
      >
        {data.consultations.length ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_22px_50px_-38px_rgba(15,23,42,0.35)]">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left">
                  <thead className="bg-slate-50/90">
                    <tr>
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Date
                      </th>
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Doctor
                      </th>
                      <th className="min-w-[22rem] px-5 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Consultation note
                      </th>
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Created
                      </th>
                      <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleConsultations.map((consultation) => {
                      const isEditing = consultationEditorId === consultation.id;
                      const canEditRow = canEditConsultation(consultation);
                      const note = consultation.doctor_notes || "";
                      const isExpanded = expandedConsultations[consultation.id] || isEditing;
                      const shouldTruncate = note.length > CONSULTATION_PREVIEW_LIMIT;
                      const noteToDisplay = isExpanded
                        ? note
                        : getConsultationPreview(note, CONSULTATION_PREVIEW_LIMIT);

                      return (
                        <tr key={consultation.id} className="align-top">
                          <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                            {formatDate(consultation.consultation_date)}
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-600">
                            <p className="font-semibold text-slate-900">
                              {consultation.doctor_name}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                              {consultation.specialization || "General practice"}
                            </p>
                          </td>
                          <td className="px-5 py-4">
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
                                        className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white"
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
                                        className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white"
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
                                  className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white"
                                  placeholder="Update the clinical note for this consultation."
                                />
                                <div className="flex flex-wrap justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={handleConsultationEditCancel}
                                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isSavingConsultation}
                                    onClick={() => handleConsultationSave(consultation)}
                                    className="rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {isSavingConsultation ? "Saving..." : "Save changes"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">
                                  {noteToDisplay || "No note recorded."}
                                </p>
                                {shouldTruncate ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedConsultations((current) => ({
                                        ...current,
                                        [consultation.id]: !current[consultation.id],
                                      }))
                                    }
                                    className="text-sm font-semibold text-sky-700 transition hover:text-sky-800"
                                  >
                                    {isExpanded ? "View less" : "View more"}
                                  </button>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-600">
                            {formatDate(consultation.created_at)}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-2">
                              <Link
                                to={`/consultations/${consultation.id}`}
                                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                              >
                                Open
                              </Link>
                              {canEditRow ? (
                                !isEditing ? (
                                  <button
                                    type="button"
                                    onClick={() => handleConsultationEditStart(consultation)}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                                  >
                                    <SquarePen className="size-4" />
                                    {user.role === "admin" ? "Edit consultation" : "Edit note"}
                                  </button>
                                ) : null
                              ) : (
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                  View only
                                </span>
                              )}
                              {user.role === "admin" ? (
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
                  className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100"
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
                  className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700"
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
        subtitle="Investigation results, clinical documents, and specimen follow-up kept directly on the patient record."
        actions={
          canManageLabReports ? (
              <button
                type="button"
                onClick={() => setReportEditor({ id: null })}
                className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700"
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
                className="rounded-[26px] border border-slate-200/80 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-slate-950">{report.report_title}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatDate(report.report_date)}
                    </p>
                  </div>

                  {canManageLabReports ? (
                    <button
                      type="button"
                      onClick={() => setReportEditor(report)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
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

                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-600">
                  {report.report_details}
                </p>

                {report.attachments?.length ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Attached files
                    </p>
                    <div className="space-y-2">
                      {report.attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {attachment.original_name}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                              {formatAttachmentSize(attachment.file_size)}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleDownloadLabReportAttachment(attachment)}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                            >
                              <Paperclip className="size-4" />
                              Open file
                            </button>
                            {canDeleteReportFiles ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteLabReportAttachment(attachment)}
                                className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                              >
                                <Trash2 className="size-4" />
                                Delete file
                              </button>
                            ) : null}
                          </div>
                        </div>
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
            action={
              canManageLabReports ? (
                <button
                  type="button"
                  onClick={() => setReportEditor({ id: null })}
                  className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700"
                >
                  <Plus className="size-4" />
                  Add Medical & Lab Report
                </button>
              ) : null
            }
          />
        )}
      </SectionCard>

      <LabReportModal
        open={Boolean(reportEditor)}
        report={reportEditor}
        consultations={data.consultations}
        user={user}
        onDeleteAttachment={handleDeleteLabReportAttachment}
        onDownloadAttachment={handleDownloadLabReportAttachment}
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
