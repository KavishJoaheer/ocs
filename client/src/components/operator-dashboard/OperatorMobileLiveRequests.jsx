import { ArrowRight, ChevronRight, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { useOperatorTeleconsultations, teleconsultationRequestStatus } from "../../hooks/useOperatorTeleconsultations.js";
import OperatorLiveHeading from "./OperatorLiveHeading.jsx";

export default function OperatorMobileLiveRequests({ visits, readOnly = false }) {
  const { requests, loading, error, busyId, load, accept } = useOperatorTeleconsultations({ readOnly });
  const urgencyOrder = { emergency: 0, urgent: 1, routine: 2 };
  const homeVisits = [...(visits?.visit_requests || [])]
    .sort((a, b) => (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2)).slice(0, 2);
  const visitCount = Number(visits?.active_count ?? homeVisits.length);
  const total = visitCount + requests.length;

  return (
    <section aria-label="Live requests" className="overflow-hidden rounded-[30px] border border-[#cde9e6] bg-[linear-gradient(145deg,#edf9f7,#f6fcfb)] shadow-[0_8px_26px_rgba(26,127,122,0.06)]">
      <div className="px-4 pb-2 pt-5">
        <OperatorLiveHeading count={!loading && !error && visits ? total : null} />
      </div>

      <section aria-label="Home Visit Request" className="px-4 pb-4 pt-3">
        <h3 className="inline-flex rounded-full bg-[#d9f0ed] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#376168]">Home Visit Request</h3>
        {!visits ? <p role="alert" className="mt-3 text-xs text-red-800">Could not load home visit requests. Open View requests to retry.</p> : homeVisits.length ? (
          <ul className="mt-1 divide-y divide-[#d0e7e4]">
            {homeVisits.map(request => (
              <li key={request.id}>
                <Link to="/visit-requests" className="block rounded-lg py-3 transition active:bg-white/60">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words text-base font-bold leading-snug text-[#173f4a]">{request.patient_name || "Patient"}</p>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize ${request.urgency === "emergency" ? "bg-red-100 text-red-800" : request.urgency === "urgent" ? "bg-amber-200/80 text-amber-900" : "bg-white/80 text-slate-500"}`}>{request.urgency || "routine"}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="min-w-0 line-clamp-1 text-[13px] text-[#485e65]">{request.reason || "No reason provided"}</p>
                    <ChevronRight className="size-4 shrink-0 text-[#376168]" aria-hidden="true" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#485e65]">
                    <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="size-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{request.address || "Address not provided"}</span></span>
                    <span className="text-[#c2dad7]" aria-hidden="true">|</span>
                    <span>{request.status_label || "Request received"}{request.eta_minutes != null ? ` · ETA ${request.eta_minutes} min` : ""}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-[13px] text-[#485e65]">{visitCount ? "Open View requests for active requests." : "No active home visits"}</p>}
      </section>

      <section aria-labelledby="operator-mobile-calls-heading" className="mx-4 border-t border-[#cce4e0] py-4">
        <h3 id="operator-mobile-calls-heading" className="inline-flex rounded-full bg-[#d9f0ed] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#376168]">Teleconsultations</h3>
        {loading ? <p role="status" className="mt-3 text-[13px] text-[#485e65]">Loading teleconsultations…</p> : null}
        {error ? <p role="alert" className="mt-2 text-xs text-red-800">{error}<button type="button" onClick={load} className="ml-2 min-h-11 font-semibold underline">Retry teleconsultations</button></p> : null}
        {!loading && !error && !requests.length ? <p className="mt-3 text-[13px] text-[#485e65]">No active teleconsultations</p> : null}
        {requests.length ? <ul className="mt-1 max-h-80 divide-y divide-[#d0e7e4] overflow-y-auto overscroll-contain">
          {requests.map(request => {
            const waiting = request.status === "pending" && !request.accepted_at;
            return <li key={request.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-base font-bold leading-snug text-[#173f4a]">{request.patient_name || "Patient"}</p>
                <p className="mt-1 line-clamp-1 text-[13px] text-[#485e65]">{request.reason}</p>
                <p className={`mt-2 inline-block rounded-full text-[11px] leading-5 ${waiting ? "bg-amber-100 px-2.5 py-0.5 font-medium text-amber-900" : "text-[#376168]"}`}>
                  {teleconsultationRequestStatus(request)}{request.doctor_name ? ` · ${request.doctor_name}` : ""}
                </p>
              </div>
              {waiting && !readOnly ? <button type="button" disabled={busyId !== null} onClick={() => accept(request)} aria-label={`Accept request for ${request.patient_name}`} className="min-h-11 shrink-0 rounded-full bg-[#137b80] px-4 py-2 text-xs font-semibold text-white transition active:bg-[#10696d] disabled:opacity-50">{busyId === request.id ? "Accepting…" : "Accept"}</button> : <Link to={`/teleconsultations?request=${request.id}`} aria-label={`Manage teleconsultation for ${request.patient_name}`} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-semibold text-[#137b80]">Manage <ChevronRight className="size-3.5" aria-hidden="true" /></Link>}
            </li>;
          })}
        </ul> : null}
      </section>

      <div className="mx-4 grid grid-cols-2 border-t border-[#cce4e0] py-2">
        <Link to="/visit-requests" className="inline-flex min-h-11 items-center justify-center gap-2 border-r border-[#cce4e0] text-xs font-semibold text-[#137b80]">View requests <ArrowRight className="size-3.5" aria-hidden="true" /></Link>
        <Link to="/teleconsultations" aria-label="Manage teleconsultations" className="inline-flex min-h-11 items-center justify-center gap-2 text-xs font-semibold text-[#137b80]">Manage calls <ArrowRight className="size-3.5" aria-hidden="true" /></Link>
      </div>
    </section>
  );
}
