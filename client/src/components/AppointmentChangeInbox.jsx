import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, X } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { api } from "../lib/api.js";
import { formatDate } from "../lib/format.js";

function AppointmentChangeInbox() {
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
  }, [load]);

  async function resolve(request, status) {
    if (updatingId) return;
    setUpdatingId(request.id);
    try {
      await api.patch(`/appointment-change-requests/${request.id}`, { status });
      toast.success(status === "resolved" ? "Appointment updated." : "Request declined.");
      await load();
    } catch (error) {
      toast.error(error.message || "Could not update this request.");
    } finally {
      setUpdatingId(null);
    }
  }

  if (!loading && !requests.length) {
    return null;
  }

  return (
    <SectionCard
      title="Appointment changes"
      subtitle={loading ? "Loading…" : `${requests.length} waiting for the clinic`}
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-[#2d8f98]/10 px-3 py-1.5 text-xs font-bold text-[#2d8f98]">
          <CalendarClock className="size-3.5" />
          Board
        </span>
      }
    >
      <div className="space-y-3">
        {requests.map((request) => (
          <div
            key={request.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">
                {request.patient_name} · {request.request_type === "cancel" ? "Cancel" : "Reschedule"}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatDate(request.appointment_date)}
                {request.appointment_time ? ` · ${request.appointment_time}` : ""}
                {request.doctor_name ? ` · ${request.doctor_name}` : ""}
              </p>
              {request.preferred_date ? (
                <p className="mt-1 text-xs text-[#2d8f98]">
                  Preferred: {formatDate(request.preferred_date)}
                  {request.preferred_time ? ` ${request.preferred_time}` : ""}
                </p>
              ) : null}
              {request.patient_message ? (
                <p className="mt-1 text-sm text-slate-600">{request.patient_message}</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={Boolean(updatingId)}
                onClick={() => resolve(request, "resolved")}
                className="inline-flex items-center gap-1 rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Check className="size-3.5" />
                {request.request_type === "cancel" ? "Cancel visit" : "Apply"}
              </button>
              <button
                type="button"
                disabled={Boolean(updatingId)}
                onClick={() => resolve(request, "rejected")}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50"
              >
                <X className="size-3.5" />
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export default AppointmentChangeInbox;
