import { ChevronRight, MapPin, Navigation, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import OperatorLiveHeading from "../operator-dashboard/OperatorLiveHeading.jsx";

const ACTIONS = { assigned: "I'm on my way", en_route: "I've arrived", arrived: "Start consultation", in_consultation: "Complete visit" };

export default function DoctorAssignedCare({ care, mobile, readOnly }) {
  const { visits, calls, errors, loading, busyId, load, advance } = care;
  const priority = { emergency: 0, urgent: 1, routine: 2 };
  const orderedVisits = [...visits].sort((a, b) => (priority[a.urgency] ?? 2) - (priority[b.urgency] ?? 2));
  const orderedCalls = [...calls].sort((a, b) => Number(b.status === "in_consultation") - Number(a.status === "in_consultation") || a.id - b.id);
  const hasError = errors.visits || errors.calls;
  const titleClass = "inline-flex items-center gap-2 rounded-full bg-[#ddf2ee] px-3 py-1.5 text-xs font-semibold text-[#173f4a]";
  const actionClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#137b80] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#10696d] disabled:opacity-50";

  function errorMessage(message) {
    return <p role="alert" className="mt-3 text-sm text-red-800">{message}<button type="button" onClick={load} className="ml-2 min-h-11 font-semibold underline">Retry assigned care</button></p>;
  }

  return (
    <section aria-label="Assigned care" className="min-w-0 overflow-hidden rounded-[30px] border border-[#bfe4df] bg-[linear-gradient(135deg,#edf9f7,#f9fdfc)] px-4 py-5 shadow-[0_8px_28px_rgba(26,127,122,0.05)] sm:px-5">
      <div className="mb-4"><OperatorLiveHeading title="Assigned care" count={!loading && !hasError ? visits.length + calls.length : null} countLabel={`${visits.length + calls.length} active assignments`} /></div>
      <div className={`grid min-w-0 grid-cols-1 divide-y divide-[#cce4e0] ${!mobile ? "lg:grid-cols-2 lg:divide-x lg:divide-y-0" : ""}`}>
        <section aria-label="Assigned home visits" className={`min-w-0 pb-4 ${!mobile ? "lg:pb-0 lg:pr-5" : ""}`}>
          <div className={`flex flex-wrap items-center justify-between gap-2 ${mobile ? "" : "min-h-11"}`}>
            <h3 className={titleClass}>Home visits{!loading && !errors.visits ? <span className="rounded-full bg-white/70 px-2 py-0.5 tabular-nums">{visits.length}</span> : null}</h3>
            {!mobile ? <Link to="/visit-requests" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[#137b80]">View visits<ChevronRight className="size-3.5" aria-hidden="true" /></Link> : null}
          </div>
          {errors.visits ? errorMessage(errors.visits) : null}
          {loading ? <p role="status" className="py-3 text-sm text-[#485e65]">Loading home visits…</p> : !errors.visits && !visits.length ? <p className="py-3 text-sm text-[#485e65]">No assigned home visits</p> : null}
          {visits.length > 0 ? <ul className="max-h-[28rem] divide-y divide-[#d6e9e6] overflow-y-auto overscroll-contain">
            {orderedVisits.map(visit => {
              const coverageBlocked = visit.insurance_coverage?.is_linkham && visit.insurance_coverage.allowed !== true && ["assigned", "en_route"].includes(visit.status);
              return <li key={visit.id} className="py-3" aria-label={`Home visit for ${visit.patient_name}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/patients/${visit.patient_id}`} className="break-words text-base font-bold text-[#173f4a] hover:underline">{visit.patient_name}</Link>
                  {visit.urgency !== "routine" ? <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize ${visit.urgency === "emergency" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{visit.urgency}</span> : null}
                </div>
                <p className="mt-1 break-words text-[13px] leading-5 text-[#485e65]">{visit.reason || "No reason provided"}</p>
                <p className="mt-2 flex items-start gap-1.5 text-[13px] text-[#485e65]"><MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{visit.address || "Address not provided"}</span></p>
                <p className="mt-1.5 text-xs font-medium text-[#376168]">{visit.status_label || "Doctor assigned"}{visit.eta_minutes != null ? ` · ETA ${visit.eta_minutes} min` : ""}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {!readOnly && ACTIONS[visit.status] ? <button type="button" disabled={busyId !== null || coverageBlocked} onClick={() => advance(visit)} className={actionClass}>{busyId === visit.id ? "Updating visit…" : ACTIONS[visit.status]}</button> : null}
                  {visit.address ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(visit.address)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-[#137b80]"><Navigation className="size-3.5" aria-hidden="true" />Directions</a> : null}
                  {visit.patient_contact_number ? <a href={`tel:${visit.patient_contact_number}`} aria-label={`Call ${visit.patient_name}`} className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-xs font-semibold text-[#137b80]"><Phone className="size-3.5" aria-hidden="true" />Call</a> : null}
                </div>
                {coverageBlocked ? <p className="mt-1 text-xs leading-5 text-red-800">Contact dispatch to confirm insurance coverage before continuing.</p> : null}
              </li>;
            })}
          </ul> : null}
        </section>
        <section aria-label="Assigned teleconsultations" className={`min-w-0 pt-4 ${!mobile ? "lg:pl-5 lg:pt-0" : ""}`}>
          <div className={`flex flex-wrap items-center justify-between gap-2 ${mobile ? "" : "min-h-11"}`}>
            <h3 className={titleClass}>Teleconsultations{!loading && !errors.calls ? <span className="rounded-full bg-white/70 px-2 py-0.5 tabular-nums">{calls.length}</span> : null}</h3>
            {!mobile ? <Link to="/teleconsultations" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[#137b80]">View calls<ChevronRight className="size-3.5" aria-hidden="true" /></Link> : null}
          </div>
          {errors.calls ? errorMessage(errors.calls) : null}
          {loading ? <p role="status" className="py-3 text-sm text-[#485e65]">Loading teleconsultations…</p> : !errors.calls && !calls.length ? <p className="py-3 text-sm text-[#485e65]">No assigned teleconsultations</p> : null}
          {calls.length > 0 ? <ul className="max-h-80 divide-y divide-[#d6e9e6] overflow-y-auto overscroll-contain">
            {orderedCalls.map(call => <li key={call.id} className="py-3" aria-label={`Teleconsultation for ${call.patient_name}`}>
              <Link to={`/patients/${call.patient_id}`} className="break-words text-base font-bold text-[#173f4a] hover:underline">{call.patient_name}</Link>
              <p className="mt-1 break-words text-[13px] leading-5 text-[#485e65]">{call.reason}</p>
              <p className="mt-2 text-xs font-medium text-[#376168]">{call.status === "in_consultation" ? "In consultation" : "Assigned to you"}</p>
              <Link to={`/teleconsultations?request=${call.id}`} aria-label={`Open call for ${call.patient_name}`} className={`${actionClass} mt-3`}>Open call<ChevronRight className="size-3.5" aria-hidden="true" /></Link>
            </li>)}
          </ul> : null}
        </section>
      </div>
    </section>
  );
}
