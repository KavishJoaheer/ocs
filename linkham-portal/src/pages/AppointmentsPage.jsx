import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  List,
  Plus,
  SquarePen,
  Trash2,
  XCircle,
} from "lucide-react";
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
import { cx } from "../lib/utils.js";
import { formatDateTime } from "../lib/format.js";

const emptyAppointment = {
  patient_id: "",
  doctor_id: "",
  appointment_date: dayjs().format("YYYY-MM-DD"),
  appointment_time: "09:00",
  status: "scheduled",
};

function buildCalendarDays(visibleMonth) {
  const firstDay = new Date(visibleMonth.year(), visibleMonth.month(), 1);
  const gridStart = new Date(firstDay);
  gridStart.setDate(1 - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    return {
      iso: dayjs(date).format("YYYY-MM-DD"),
      label: date.getDate(),
      isCurrentMonth: date.getMonth() === visibleMonth.month(),
    };
  });
}

function AppointmentFormModal({
  open,
  appointment,
  patients,
  doctors,
  onClose,
  onSubmit,
  isSaving,
}) {
  const [form, setForm] = useState(emptyAppointment);

  useEffect(() => {
    if (!open) return;

    setForm(
      appointment
        ? {
            patient_id: String(appointment.patient_id),
            doctor_id: String(appointment.doctor_id),
            appointment_date: appointment.appointment_date,
            appointment_time: appointment.appointment_time,
            status: appointment.status,
          }
        : emptyAppointment,
    );
  }, [open, appointment]);

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      ...form,
      patient_id: Number(form.patient_id),
      doctor_id: Number(form.doctor_id),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={appointment ? "Edit appointment" : "Add appointment"}
      description="Schedule patient visits, update timing, and keep doctor assignments organized."
      size="lg"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Patient</span>
            <select
              required
              value={form.patient_id}
              onChange={(event) =>
                setForm((current) => ({ ...current, patient_id: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            >
              <option value="">Select patient</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.full_name}
                </option>
              ))}
            </select>
          </label>

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
                  {doctor.full_name} • {doctor.specialization}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Date</span>
            <input
              required
              type="date"
              value={form.appointment_date}
              onChange={(event) =>
                setForm((current) => ({ ...current, appointment_date: event.target.value }))
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

          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-semibold text-slate-700">Status</span>
            <select
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            >
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
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
            {isSaving ? "Saving..." : appointment ? "Update appointment" : "Create appointment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AppointmentsPage() {
  const { user } = useAuth();
  const canManageAppointments = user.role === "admin";
  const canUpdateStatus = user.role === "admin" || user.role === "doctor";
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [refsLoading, setRefsLoading] = useState(true);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [filters, setFilters] = useState({ doctorId: "", status: "" });
  const [viewMode, setViewMode] = useState("calendar");
  const [visibleMonth, setVisibleMonth] = useState(dayjs().startOf("month"));
  const [editor, setEditor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  async function loadReferences() {
    try {
      const [patientOptions, doctorOptions] = await Promise.all([
        api.get("/patients/options"),
        api.get("/doctors"),
      ]);
      setPatients(patientOptions);
      setDoctors(doctorOptions);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRefsLoading(false);
    }
  }

  async function loadAppointments() {
    setAppointmentsLoading(true);

    try {
      const query = new URLSearchParams();
      if (filters.doctorId) query.set("doctorId", filters.doctorId);
      if (filters.status) query.set("status", filters.status);

      const data = await api.get(`/appointments?${query.toString()}`);
      setAppointments(data);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAppointmentsLoading(false);
    }
  }

  useEffect(() => {
    loadReferences();
  }, []);

  useEffect(() => {
    loadAppointments();
  }, [filters]);

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const appointmentsByDate = useMemo(() => {
    return appointments.reduce((grouped, appointment) => {
      grouped[appointment.appointment_date] = grouped[appointment.appointment_date] || [];
      grouped[appointment.appointment_date].push(appointment);
      return grouped;
    }, {});
  }, [appointments]);

  async function handleSave(payload) {
    setIsSaving(true);

    try {
      if (editor?.appointment) {
        await api.put(`/appointments/${editor.appointment.id}`, payload);
        toast.success("Appointment updated.");
      } else {
        await api.post("/appointments", payload);
        toast.success("Appointment created.");
      }

      setEditor(null);
      await loadAppointments();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStatusUpdate(appointmentId, status) {
    try {
      await api.patch(`/appointments/${appointmentId}/status`, { status });
      toast.success(`Appointment marked as ${status}.`);
      await loadAppointments();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;

    try {
      await api.delete(`/appointments/${deleteTarget.id}`);
      toast.success("Appointment deleted.");
      setDeleteTarget(null);
      await loadAppointments();
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (refsLoading || appointmentsLoading) {
    return <LoadingState label="Loading appointments" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Scheduling"
        title="Appointments"
        description="Switch between a month calendar and a detailed list, then update doctor assignments or patient status in a few clicks."
        actions={
          canManageAppointments ? (
            <button
              type="button"
              onClick={() => setEditor({ appointment: null })}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700"
            >
              <Plus className="size-4" />
              Add appointment
            </button>
          ) : null
        }
      />

      <SectionCard
        title="Schedule"
        subtitle="Filter by doctor or status, then review by calendar or list."
        actions={
          <div className="flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={cx(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
                viewMode === "calendar"
                  ? "bg-white text-sky-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-900",
              )}
            >
              <Calendar className="size-4" />
              Calendar
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cx(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
                viewMode === "list"
                  ? "bg-white text-sky-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-900",
              )}
            >
              <List className="size-4" />
              List
            </button>
          </div>
        }
      >
        <div className="mb-5 grid gap-4 md:grid-cols-2">
          <select
            value={filters.doctorId}
            onChange={(event) =>
              setFilters((current) => ({ ...current, doctorId: event.target.value }))
            }
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
          >
            <option value="">All doctors</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.full_name} • {doctor.specialization}
              </option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, status: event.target.value }))
            }
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
          >
            <option value="">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {appointments.length ? (
          viewMode === "calendar" ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between rounded-[24px] bg-slate-50 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setVisibleMonth((current) => current.subtract(1, "month"))}
                  className="rounded-2xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:text-slate-900"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <p className="text-lg font-semibold text-slate-950">
                  {visibleMonth.format("MMMM YYYY")}
                </p>
                <button
                  type="button"
                  onClick={() => setVisibleMonth((current) => current.add(1, "month"))}
                  className="rounded-2xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:text-slate-900"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-3 text-center text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <div key={day} className="py-2">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
                {calendarDays.map((day) => {
                  const dayAppointments = appointmentsByDate[day.iso] || [];

                  return (
                    <div
                      key={day.iso}
                      className={cx(
                        "min-h-44 rounded-[24px] border p-4",
                        day.isCurrentMonth
                          ? "border-slate-200 bg-white"
                          : "border-slate-100 bg-slate-50/80 text-slate-400",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">{day.label}</p>
                        {dayAppointments.length ? (
                          <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                            {dayAppointments.length}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 space-y-2">
                        {dayAppointments.slice(0, 3).map((appointment) => (
                          <button
                            key={appointment.id}
                            type="button"
                            onClick={canManageAppointments ? () => setEditor({ appointment }) : undefined}
                            className={cx(
                              "w-full rounded-2xl border border-sky-100 bg-sky-50/70 p-3 text-left transition",
                              canManageAppointments
                                ? "hover:border-sky-200 hover:bg-sky-50"
                                : "cursor-default",
                            )}
                          >
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                              {appointment.appointment_time}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-950">
                              {appointment.patient_name}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {appointment.doctor_name}
                            </p>
                          </button>
                        ))}

                        {dayAppointments.length > 3 ? (
                          <p className="text-xs font-medium text-slate-500">
                            +{dayAppointments.length - 3} more appointments
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white text-left">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                    <tr>
                      <th className="px-5 py-4">Patient</th>
                      <th className="px-5 py-4">Doctor</th>
                      <th className="px-5 py-4">Schedule</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map((appointment) => (
                      <tr key={appointment.id} className="border-t border-slate-200/70">
                        <td className="px-5 py-4 font-semibold text-slate-950">
                          {appointment.patient_name}
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          <p>{appointment.doctor_name}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            {appointment.specialization}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {formatDateTime(
                            appointment.appointment_date,
                            appointment.appointment_time,
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge value={appointment.status} />
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap justify-end gap-2">
                            {canManageAppointments ? (
                              <button
                                type="button"
                                onClick={() => setEditor({ appointment })}
                                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                              >
                                <SquarePen className="size-4" />
                                Edit
                              </button>
                            ) : null}
                            {canUpdateStatus && appointment.status === "scheduled" ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleStatusUpdate(appointment.id, "completed")
                                  }
                                  className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
                                >
                                  <CheckCircle2 className="size-4" />
                                  Complete
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleStatusUpdate(appointment.id, "cancelled")
                                  }
                                  className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
                                >
                                  <XCircle className="size-4" />
                                  Cancel
                                </button>
                              </>
                            ) : null}
                            {canManageAppointments ? (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(appointment)}
                                className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                              >
                                <Trash2 className="size-4" />
                                Delete
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
          )
        ) : (
          <EmptyState
            title="No appointments match the current filters"
            description="Try another doctor or status filter, or create a new appointment to populate the schedule."
          />
        )}
      </SectionCard>

      <AppointmentFormModal
        open={Boolean(editor)}
        appointment={editor?.appointment}
        patients={patients}
        doctors={doctors}
        onClose={() => setEditor(null)}
        onSubmit={handleSave}
        isSaving={isSaving}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete appointment?"
        description={
          deleteTarget
            ? `This will remove the appointment for ${deleteTarget.patient_name} scheduled on ${formatDateTime(
                deleteTarget.appointment_date,
                deleteTarget.appointment_time,
              )}.`
            : ""
        }
        confirmLabel="Delete appointment"
      />
    </div>
  );
}

export default AppointmentsPage;
