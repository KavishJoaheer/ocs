import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { FilePenLine, Plus, ReceiptText, SquarePen } from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { formatDate, formatDateTime, truncate } from "../lib/format.js";

const noteTemplates = [
  {
    label: "Subjective",
    content: "Subjective:\n- Symptoms reported:\n- Duration:\n- Patient concerns:",
  },
  {
    label: "Assessment",
    content: "Assessment:\n- Findings:\n- Clinical impression:",
  },
  {
    label: "Plan",
    content: "Plan:\n- Medication or treatment:\n- Tests ordered:\n- Follow-up:",
  },
  {
    label: "Follow-up",
    content: "Follow-up:\n- Return visit:\n- Patient instructions:",
  },
];

const emptyConsultation = {
  appointment_id: "",
  consultation_date: dayjs().format("YYYY-MM-DD"),
  doctor_notes: "",
};

function ConsultationModal({
  open,
  consultation,
  availableAppointments,
  onClose,
  onSubmit,
  isSaving,
}) {
  const [form, setForm] = useState(emptyConsultation);

  useEffect(() => {
    if (!open) return;

    setForm(
      consultation
        ? {
            appointment_id: String(consultation.appointment_id),
            consultation_date: consultation.consultation_date,
            doctor_notes: consultation.doctor_notes,
          }
        : emptyConsultation,
    );
  }, [open, consultation]);

  const selectedAppointment = useMemo(() => {
    if (!form.appointment_id) return null;

    return (
      availableAppointments.find((appointment) => appointment.id === Number(form.appointment_id)) ||
      consultation ||
      null
    );
  }, [availableAppointments, consultation, form.appointment_id]);

  function appendTemplate(content) {
    setForm((current) => ({
      ...current,
      doctor_notes: current.doctor_notes
        ? `${current.doctor_notes}\n\n${content}`
        : content,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      ...form,
      appointment_id: Number(form.appointment_id),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={consultation ? "Edit consultation" : "Add consultation"}
      description="Consultation notes automatically create a linked bill, so the clinical and billing workflows stay aligned."
      size="xl"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-[1fr_0.5fr]">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Appointment</span>
            <select
              required
              disabled={Boolean(consultation)}
              value={form.appointment_id}
              onChange={(event) =>
                setForm((current) => ({ ...current, appointment_id: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              <option value="">Select appointment</option>
              {availableAppointments.map((appointment) => (
                <option key={appointment.id} value={appointment.id}>
                  {appointment.patient_name} • {appointment.doctor_name} •{" "}
                  {formatDateTime(appointment.appointment_date, appointment.appointment_time)}
                </option>
              ))}
              {consultation ? (
                <option value={consultation.appointment_id}>
                  {consultation.patient_name} • {consultation.doctor_name} •{" "}
                  {formatDateTime(consultation.appointment_date, consultation.appointment_time)}
                </option>
              ) : null}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Consultation date</span>
            <input
              required
              type="date"
              value={form.consultation_date}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  consultation_date: event.target.value,
                }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>
        </div>

        {selectedAppointment ? (
          <div className="rounded-[26px] border border-sky-100 bg-sky-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
              Linked visit
            </p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
              {selectedAppointment.patient_name}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {selectedAppointment.doctor_name}
              {selectedAppointment.specialization
                ? ` • ${selectedAppointment.specialization}`
                : ""}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {formatDateTime(
                selectedAppointment.appointment_date,
                selectedAppointment.appointment_time,
              )}
            </p>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {noteTemplates.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => appendTemplate(template.content)}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
              >
                Add {template.label}
              </button>
            ))}
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Doctor notes</span>
            <textarea
              required
              rows="14"
              value={form.doctor_notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, doctor_notes: event.target.value }))
              }
              placeholder="Record findings, clinical reasoning, treatment plans, and follow-up instructions."
              className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 leading-7 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>
        </div>

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
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : consultation ? "Update consultation" : "Save consultation"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConsultationsPage() {
  const { user } = useAuth();
  const canManageConsultations = user.role === "admin" || user.role === "doctor";
  const [consultations, setConsultations] = useState([]);
  const [availableAppointments, setAvailableAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  async function loadData() {
    try {
      const [consultationData, appointmentData] = await Promise.all([
        api.get("/consultations"),
        api.get("/consultations/available-appointments"),
      ]);

      setConsultations(consultationData);
      setAvailableAppointments(appointmentData);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSave(payload) {
    setIsSaving(true);

    try {
      if (editor?.consultation) {
        await api.put(`/consultations/${editor.consultation.id}`, payload);
        toast.success("Consultation updated.");
      } else {
        await api.post("/consultations", payload);
        toast.success("Consultation saved and billing linked.");
      }

      setEditor(null);
      await loadData();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading consultations" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clinical notes"
        title="Consultations"
        description="Write structured doctor notes tied to appointments, then let the system generate billing automatically behind the scenes."
        actions={
          canManageConsultations ? (
            <button
              type="button"
              onClick={() => setEditor({ consultation: null })}
              disabled={!availableAppointments.length}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="size-4" />
              Add consultation
            </button>
          ) : null
        }
      />

      {canManageConsultations && !availableAppointments.length ? (
        <SectionCard>
          <EmptyState
            title="No available appointments for new consultations"
            description="All non-cancelled appointments already have consultation notes, or there are no appointments yet."
          />
        </SectionCard>
      ) : null}

      <SectionCard
        title="Consultation list"
        subtitle={`${consultations.length} consultation records`}
      >
        {consultations.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {consultations.map((consultation) => (
              <article
                key={consultation.id}
                className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_12px_40px_rgba(15,23,42,0.06)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-slate-950">
                      {consultation.patient_name}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {consultation.doctor_name} • {consultation.specialization}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatDateTime(
                        consultation.appointment_date,
                        consultation.appointment_time,
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge value={consultation.bill_status || "unpaid"} />
                    <Link
                      to={`/consultations/${consultation.id}`}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                    >
                      Open
                    </Link>
                    {canManageConsultations ? (
                      <button
                        type="button"
                        onClick={() => setEditor({ consultation })}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                      >
                        <SquarePen className="size-4" />
                        Edit
                      </button>
                    ) : null}
                  </div>
                </div>

                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-600">
                  {truncate(consultation.doctor_notes, 260)}
                </p>

                <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <FilePenLine className="size-4" />
                    Saved {formatDate(consultation.consultation_date)}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <ReceiptText className="size-4" />
                    {consultation.bill_count || 0} bill
                    {Number(consultation.bill_count || 0) === 1 ? "" : "s"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No consultations yet"
            description="Save a consultation note after a patient visit to begin building the clinical record."
          />
        )}
      </SectionCard>

      <ConsultationModal
        open={Boolean(editor)}
        consultation={editor?.consultation}
        availableAppointments={availableAppointments}
        onClose={() => setEditor(null)}
        onSubmit={handleSave}
        isSaving={isSaving}
      />
    </div>
  );
}

export default ConsultationsPage;
