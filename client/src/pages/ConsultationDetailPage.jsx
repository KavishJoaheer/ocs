import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  FilePenLine,
  ReceiptText,
  SquarePen,
} from "lucide-react";
import toast from "react-hot-toast";
import { Link, useParams } from "react-router-dom";
import LoadingState from "../components/LoadingState.jsx";
import EmptyState from "../components/EmptyState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPaymentMethod,
} from "../lib/format.js";

function ConsultationDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [consultation, setConsultation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({
    consultation_date: "",
    doctor_notes: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const canEdit =
    consultation &&
    (user.role === "admin" ||
      (user.role === "doctor" && Number(user.doctor_id) === Number(consultation.doctor_id)));

  useEffect(() => {
    let ignore = false;

    async function loadConsultation() {
      try {
        const data = await api.get(`/consultations/${id}`);

        if (!ignore) {
          setConsultation(data);
          setForm({
            consultation_date: data.consultation_date ?? "",
            doctor_notes: data.doctor_notes ?? "",
          });
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadConsultation();

    return () => {
      ignore = true;
    };
  }, [id]);

  async function handleSave(event) {
    event.preventDefault();
    setIsSaving(true);

    try {
      const updated = await api.put(`/consultations/${id}`, form);
      setConsultation(updated);
      setForm({
        consultation_date: updated.consultation_date ?? "",
        doctor_notes: updated.doctor_notes ?? "",
      });
      setIsEditing(false);
      toast.success("Consultation updated.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading consultation" />;
  }

  if (!consultation) {
    return (
      <EmptyState
        title="Consultation unavailable"
        description="The requested consultation could not be loaded."
        action={
          <Link
            to="/consultations"
            className="rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white"
          >
            Back to consultations
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Consultation record"
        title={`${consultation.patient_name} - ${formatDate(consultation.consultation_date)}`}
        description={`${consultation.doctor_name} - ${consultation.specialization} - ${consultation.patient_identifier || "No OCS care number yet"}`}
        actions={
          <div className="flex flex-wrap gap-3">
            <Link
              to="/consultations"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
            >
              <ArrowLeft className="size-4" />
              Back to consultations
            </Link>
            <Link
              to={`/patients/${consultation.patient_id}`}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700"
            >
              View patient
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            OCS care number
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950">
            {consultation.patient_identifier || "Not assigned"}
          </p>
        </div>

        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Patient ID
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950">
            {consultation.patient_id_number || "Not recorded"}
          </p>
        </div>

        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Appointment time
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950">
            {formatDateTime(consultation.appointment_date, consultation.appointment_time)}
          </p>
        </div>

        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Billing
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {consultation.bill_count ? (
              <StatusBadge value={consultation.bill_status || "paid"} />
            ) : (
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                No bills yet
              </span>
            )}
            <span className="text-lg font-semibold text-slate-950">
              {formatCurrency(consultation.bill_total_amount)}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {consultation.bill_count || 0} billing entr
            {Number(consultation.bill_count || 0) === 1 ? "y" : "ies"}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
        <SectionCard
          title="Visit details"
          subtitle="Linked patient, doctor, schedule, and billing context."
        >
          <div className="space-y-4">
            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Patient
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {consultation.patient_name}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Patient ID: {consultation.patient_id_number || "Not recorded"}
              </p>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Doctor
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {consultation.doctor_name}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {consultation.specialization || "General practice"}
              </p>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <CalendarClock className="size-5 text-sky-700" />
                <div>
                  <p className="text-sm font-semibold text-slate-950">Appointment status</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <StatusBadge value={consultation.appointment_status || "completed"} />
                    <span className="text-sm text-slate-600">
                      Saved {formatDate(consultation.consultation_date)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <ReceiptText className="size-5 text-sky-700" />
                <div>
                  <p className="text-sm font-semibold text-slate-950">
                    {consultation.bill_count || 0} billing entr
                    {Number(consultation.bill_count || 0) === 1 ? "y" : "ies"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatCurrency(consultation.bill_total_amount)}
                  </p>
                </div>
              </div>

              {consultation.bills?.length ? (
                <div className="mt-4 space-y-3">
                  {consultation.bills.map((bill) => (
                    <div
                      key={bill.id}
                      className="rounded-[22px] border border-slate-200/80 bg-white p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">Bill #{bill.id}</p>
                          <p className="mt-1 text-sm text-slate-600">
                            {formatCurrency(bill.total_amount)}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                            {bill.items.length} line item
                            {bill.items.length === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge value={bill.status} />
                          <span className="text-sm text-slate-500">
                            {bill.payment_date && bill.payment_method
                              ? `${formatPaymentMethod(bill.payment_method)} - ${formatDate(bill.payment_date)}`
                              : bill.payment_date
                                ? formatDate(bill.payment_date)
                                : formatPaymentMethod(bill.payment_method)}
                          </span>
                        </div>
                      </div>

                      {bill.items.length ? (
                        <div className="mt-3 space-y-2">
                          {bill.items.map((item, index) => (
                            <div
                              key={`${bill.id}-${index}`}
                              className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600"
                            >
                              <span>{item.description}</span>
                              <span className="font-semibold text-slate-900">
                                {formatCurrency(item.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  No billing entries have been created for this consultation yet.
                </p>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Consultation note"
          subtitle="Open the full note, then edit it directly on this page when needed."
          actions={
            canEdit && !isEditing ? (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
              >
                <SquarePen className="size-4" />
                Edit consultation
              </button>
            ) : null
          }
        >
          {isEditing ? (
            <form className="space-y-4" onSubmit={handleSave}>
              <label className="block space-y-2">
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

              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Doctor notes</span>
                <textarea
                  required
                  rows="18"
                  value={form.doctor_notes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      doctor_notes: event.target.value,
                    }))
                  }
                  className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 leading-7 outline-none transition focus:border-sky-400 focus:bg-white"
                />
              </label>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setForm({
                      consultation_date: consultation.consultation_date ?? "",
                      doctor_notes: consultation.doctor_notes ?? "",
                    });
                  }}
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : "Save consultation"}
                </button>
              </div>
            </form>
          ) : (
            <div className="rounded-[26px] border border-slate-200/80 bg-slate-50/70 p-5">
              <div className="flex items-center gap-3">
                <FilePenLine className="size-5 text-sky-700" />
                <div>
                  <p className="text-sm font-semibold text-slate-950">
                    Full consultation note
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDate(consultation.consultation_date)}
                  </p>
                </div>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                {consultation.doctor_notes}
              </p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

export default ConsultationDetailPage;
