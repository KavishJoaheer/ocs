import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, X } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { api } from "../lib/api.js";
import { formatDate } from "../lib/format.js";

function toTimeInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.slice(0, 5);
}

function AppointmentChangeRow({ request, updatingId, onResolve }) {
  const [appointmentDate, setAppointmentDate] = useState(
    request.preferred_date || request.appointment_date || "",
  );
  const [appointmentTime, setAppointmentTime] = useState(
    toTimeInput(request.preferred_time || request.appointment_time),
  );
  const busy = Boolean(updatingId);
  const isReschedule = request.request_type === "reschedule";

  function handleApply() {
    if (isReschedule && !appointmentDate) {
      toast.error("Choose the new appointment date before applying.");
      return;
    }
    onResolve(request, "resolved", {
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
    });
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">
          {request.patient_name} · {isReschedule ? "Reschedule" : "Cancel"}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Current: {formatDate(request.appointment_date)}
          {request.appointment_time ? ` · ${request.appointment_time}` : ""}
          {request.doctor_name ? ` · ${request.doctor_name}` : ""}
        </p>
        {request.patient_message ? (
          <p className="mt-1 text-sm text-slate-600">{request.patient_message}</p>
        ) : null}
        {isReschedule ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="text-xs font-medium text-slate-500">
              New date
              <input
                type="date"
                value={appointmentDate}
                onChange={(event) => setAppointmentDate(event.target.value)}
                className="mt-1 block h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
              />
            </label>
            <label className="text-xs font-medium text-slate-500">
              Time
              <input
                type="time"
                value={appointmentTime}
                onChange={(event) => setAppointmentTime(event.target.value)}
                className="mt-1 block h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
              />
            </label>
          </div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleApply}
          className="inline-flex items-center gap-1 rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          <Check className="size-3.5" />
          {isReschedule ? "Apply" : "Confirm cancellation"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(request, "rejected")}
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50"
        >
          <X className="size-3.5" />
          Decline
        </button>
      </div>
    </div>
  );
}

function AppointmentChangeInbox() {
  const refreshKey = useLiveRefreshKey();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const payload = await api.get("/appointment-change-requests?status=pending");
      setRequests(payload.requests || []);
    } catch (error) {
      toast.error(error.message || "Could not load appointment change requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function resolve(request, status, override = {}) {
    if (updatingId) return;
    setUpdatingId(request.id);
    try {
      const body = { status };
      if (status === "resolved" && request.request_type === "reschedule") {
        body.appointment_date = override.appointment_date;
        body.appointment_time = override.appointment_time;
      }
      await api.patch(`/appointment-change-requests/${request.id}`, body);
      toast.success(status === "resolved" ? "Appointment updated." : "Request declined.");
      await load();
    } catch (error) {
      toast.error(error.message || "Could not update this request.");
    } finally {
      setUpdatingId(null);
    }
  }

  if (!loading && !requests.length) {
    return (
      <SectionCard
        title="Appointment changes"
        subtitle="Cancel and reschedule requests from Care land here."
      >
        <p className="text-sm text-slate-500">No appointment changes waiting.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Appointment changes"
      subtitle={loading ? "Loading…" : `${requests.length} waiting for the clinic`}
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-[#2d8f98]/10 px-3 py-1.5 text-xs font-bold text-[#2d8f98]">
          <CalendarClock className="size-3.5" />
          Inbox
        </span>
      }
    >
      <div className="space-y-3">
        {requests.map((request) => (
          <AppointmentChangeRow
            key={request.id}
            request={request}
            updatingId={updatingId}
            onResolve={resolve}
          />
        ))}
      </div>
    </SectionCard>
  );
}

export default AppointmentChangeInbox;
