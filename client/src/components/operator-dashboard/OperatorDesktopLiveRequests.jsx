import { ArrowRight, ChevronRight, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { useOperatorTeleconsultations, teleconsultationRequestStatus } from "../../hooks/useOperatorTeleconsultations.js";
import { getOperatorInitials } from "./operatorDashboardCopy.js";
import OperatorLiveHeading from "./OperatorLiveHeading.jsx";

function PatientAvatar({ name }) {
  return <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-[#dff3ef] text-xs font-semibold text-[#137b80]">{getOperatorInitials({ full_name: name || "Patient" })}</span>;
}

export default function OperatorDesktopLiveRequests({ visits, readOnly = false }) {
  const { requests, loading, error, busyId, load, accept } = useOperatorTeleconsultations({ readOnly });
  const urgencyOrder = { emergency: 0, urgent: 1, routine: 2 };
  const homeVisits = [...(visits?.visit_requests || [])].sort((a, b) => (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2));
  const visitCount = Number(visits?.active_count ?? homeVisits.length);
  const total = visitCount + requests.length;

  return (
    <section aria-label="Live requests" className="overflow-hidden rounded-[30px] border border-[#bfe4df] bg-[linear-gradient(135deg,#edf9f7,#f9fdfc)] px-5 py-5 shadow-[0_8px_28px_rgba(26,127,122,0.05)]">
      <div className="mb-4">
        <OperatorLiveHeading count={!loading && !error && visits ? total : null} />
      </div>

      <div className="grid min-w-0 grid-cols-1 divide-y divide-[#cce4e0] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <section aria-label="Home Visit Request" className="min-w-0 pb-4 lg:pb-0 lg:pr-5">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-2 rounded-full bg-[#ddf2ee] px-3 py-1.5 text-sm font-semibold text-[#173f4a]">Home Visit Request{visits ? <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs tabular-nums">{visitCount}</span> : null}</h3>
            <Link to="/visit-requests" className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-[#137b80]">View requests <ChevronRight className="size-3.5" aria-hidden="true" /></Link>
          </div>
          {!visits ? <p role="alert" className="py-3 text-sm text-red-800">Could not load home visits. Open View requests to retry.</p> : !homeVisits.length ? <p className="py-3 text-sm text-[#485e65]">No active home visits</p> : (
            <ul className="max-h-80 divide-y divide-[#d6e9e6] overflow-y-auto overscroll-contain">
              {homeVisits.map(request => {
                const unassigned = !request.assigned_doctor_id;
                return <li key={request.id}>
                  <Link to="/visit-requests" aria-label={`${unassigned ? "Assign home visit" : "Manage home visit"} for ${request.patient_name}`} className="flex items-start gap-3 rounded-lg py-4 transition hover:bg-white/60">
                    <PatientAvatar name={request.patient_name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words text-sm font-bold text-[#173f4a]">{request.patient_name || "Patient"}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${request.urgency === "emergency" ? "bg-red-100 text-red-800" : request.urgency === "urgent" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-500"}`}>{request.urgency || "routine"}</span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-[13px] text-[#485e65]">{request.reason || "No reason provided"}</p>
                      <p className="mt-1 flex items-start gap-1 text-[13px] text-[#485e65]"><MapPin className="size-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{request.address || "Address not provided"}</span></p>
                      <p className={`mt-1 text-xs ${unassigned ? "text-amber-800" : "text-[#376168]"}`}>{request.status === "pending" ? "Awaiting assignment" : request.status_label || "Request received"}{request.doctor_name ? ` · ${request.doctor_name}` : ""}{request.eta_minutes != null ? ` · ETA ${request.eta_minutes} min` : ""}</p>
                    </div>
                    <span className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-semibold text-[#137b80]">{unassigned ? "Assign" : "Manage"}<ChevronRight className="size-3.5" aria-hidden="true" /></span>
                  </Link>
                </li>;
              })}
            </ul>
          )}
        </section>

        <section aria-label="Teleconsultations" className="min-w-0 pt-4 lg:pl-5 lg:pt-0">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-2 rounded-full bg-[#ddf2ee] px-3 py-1.5 text-sm font-semibold text-[#173f4a]">Teleconsultations{!loading && !error ? <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs tabular-nums">{requests.length}</span> : null}</h3>
            <Link to="/teleconsultations" aria-label="Manage teleconsultations" className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-[#137b80]">Manage calls <ChevronRight className="size-3.5" aria-hidden="true" /></Link>
          </div>
          {error ? <p role="alert" className="py-3 text-sm text-red-800">{error}<button type="button" onClick={load} className="ml-2 min-h-11 font-semibold underline">Retry teleconsultations</button></p> : null}
          {loading ? <p role="status" className="py-3 text-sm text-[#485e65]">Loading teleconsultations…</p> : null}
          {!loading && !error && !requests.length ? <p className="py-3 text-sm text-[#485e65]">No active teleconsultations</p> : null}
          {requests.length ? <ul className="max-h-80 divide-y divide-[#d6e9e6] overflow-y-auto overscroll-contain">
            {requests.map(request => {
              const waiting = request.status === "pending" && !request.accepted_at;
              return <li key={request.id} className="flex items-start gap-3 py-4">
                <PatientAvatar name={request.patient_name} />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-bold text-[#173f4a]">{request.patient_name || "Patient"}</p>
                  <p className="mt-1 line-clamp-1 text-[13px] text-[#485e65]">{request.reason}</p>
                  <p className={`mt-2 inline-block rounded-full text-xs ${waiting ? "bg-amber-100 px-2 py-0.5 text-amber-900" : "text-[#376168]"}`}>{teleconsultationRequestStatus(request)}{request.doctor_name ? ` · ${request.doctor_name}` : ""}</p>
                </div>
                {waiting && !readOnly ? <button type="button" disabled={busyId !== null} onClick={() => accept(request)} aria-label={`Accept request for ${request.patient_name}`} className="min-h-11 shrink-0 rounded-full bg-[#137b80] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#10696d] disabled:opacity-50">{busyId === request.id ? "Accepting…" : "Accept"}</button> : <Link to={`/teleconsultations?request=${request.id}`} aria-label={`Manage teleconsultation for ${request.patient_name}`} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-semibold text-[#137b80]">Manage <ArrowRight className="size-3.5" aria-hidden="true" /></Link>}
              </li>;
            })}
          </ul> : null}
        </section>
      </div>
    </section>
  );
}
