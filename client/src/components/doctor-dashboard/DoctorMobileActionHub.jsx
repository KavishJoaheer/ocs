import dayjs from "dayjs";
import { ArrowUpRight, CalendarClock, ChevronDown, ChevronRight, ClipboardList, House, MapPin, Package, UsersRound, Video } from "lucide-react";
import { Link } from "react-router-dom";
import { getTimeOfDayGreeting } from "../operator-dashboard/operatorDashboardCopy.js";
import { formatReviewAppointmentTime } from "../../lib/patientReview.js";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import HcmBulletinBanner from "../HcmBulletinBanner.jsx";
import DoctorAssignedCare from "./DoctorAssignedCare.jsx";
import "./doctorMobileActionHub.css";

export default function DoctorMobileActionHub({ user, firstName, now, care, bag, supply, schedule, followUps, onStatusChange, isSavingStatus, latestHcmPost }) {
  const knownCount = !care.loading && !care.errors.visits && !care.errors.calls;
  const countLabel = (rows, error) => care.loading ? "Loading…" : error ? "Unavailable" : `${rows.length} active`;
  return <section aria-label="Doctor dashboard" className="doctor-dashboard-root doctor-action-hub mx-auto w-full min-w-0 max-w-md">
    <header className="hub-header">
      <div className="hub-greeting"><div><p className="hub-eyebrow">Your care workspace</p><h1>{getTimeOfDayGreeting(now)}, Dr {firstName}</h1><p className="hub-date">{dayjs(now).format("dddd, D MMMM")}</p></div><AppUpdateBanner compact /></div>
      <div className="hub-availability"><span className="hub-status-dot" data-status={user.operation_status || "offline"} aria-hidden="true" /><select aria-label="Availability" title="Available for new requests; Active means on duty; Offline means unavailable." value={user.operation_status || "offline"} disabled={isSavingStatus || user.is_read_only} onChange={event => onStatusChange(event.target.value)}><option value="available">Available</option><option value="active">Active</option><option value="offline">Offline</option></select><ChevronDown className="size-3.5" aria-hidden="true" /></div>
      <div className="hub-attention" role="status"><span className="hub-attention-number">{knownCount ? care.visits.length + care.calls.length : care.loading ? "…" : "—"}</span><div><strong>{knownCount ? "Active assignments" : care.loading ? "Checking your assignments" : "Assignments need refreshing"}</strong><p>{knownCount ? `${care.visits.length} home ${care.visits.length === 1 ? "visit" : "visits"} · ${care.calls.length} ${care.calls.length === 1 ? "teleconsultation" : "teleconsultations"}` : "Check the care sections below for details."}</p></div></div>
    </header>

    <nav aria-label="Doctor workspace shortcuts" className="hub-shortcuts">
      <h2>What would you like to do?</h2>
      <div className="hub-shortcut-grid">
        <Link to="/visit-requests" aria-label="Open home visits" className="hub-shortcut hub-shortcut-teal"><House aria-hidden="true" /><span>{countLabel(care.visits, care.errors.visits)}</span><strong>Home visits</strong></Link>
        <Link to="/teleconsultations" aria-label="Open teleconsultations" className="hub-shortcut hub-shortcut-slate"><Video aria-hidden="true" /><span>{countLabel(care.calls, care.errors.calls)}</span><strong>Teleconsultations</strong></Link>
        <Link to="/patients" aria-label="Open patients" className="hub-shortcut"><UsersRound aria-hidden="true" /><ArrowUpRight className="hub-shortcut-arrow" aria-hidden="true" /><strong>Patients</strong></Link>
        <Link to="/inventory?context=my" aria-label="Open doctor bag" className="hub-shortcut"><Package aria-hidden="true" /><ArrowUpRight className="hub-shortcut-arrow" aria-hidden="true" /><strong>Doctor bag</strong></Link>
      </div>
    </nav>

    <DoctorAssignedCare care={care} mobile readOnly={Boolean(user.is_read_only)} />

    <section aria-label="Next scheduled visit" className="hub-upcoming">
      <div className="hub-section-heading"><h2>Coming up</h2><Link to="/appointments">View schedule<ChevronRight aria-hidden="true" /></Link></div>
      {care.loading || care.errors.visits ? <p>{care.loading ? "Checking your schedule…" : "Open your schedule to see upcoming appointments."}</p> : schedule.nextVisit ? <Link to={`/patients/${schedule.nextVisit.patient_id}`} aria-label={`Open record for ${schedule.nextVisit.patient_name}`} className="hub-scheduled-visit"><span className="hub-time">{formatReviewAppointmentTime(schedule.nextVisit.appointment_time) || "Time pending"}</span><span><strong>{schedule.nextVisit.patient_name}</strong><span className="hub-scheduled-detail"><MapPin aria-hidden="true" />{schedule.nextVisit.location || "Location pending"}{schedule.nextVisit.appointment_date !== schedule.today ? ` · ${dayjs(schedule.nextVisit.appointment_date).format("ddd, D MMM")}` : ""}</span></span></Link> : <p>No upcoming scheduled visits</p>}
    </section>

    <nav aria-label="Doctor quick actions" className="hub-support-links">
      <Link to="/doctor/long-term-review"><span><ClipboardList aria-hidden="true" />Review appointments</span><strong>{followUps}</strong></Link>
      <Link to="/supply-requests"><span><Package aria-hidden="true" />Supply requests</span><strong>{supply.loading ? "…" : supply.error ? "!" : supply.activeCount}</strong></Link>
      <Link to="/inventory?context=my"><span><CalendarClock aria-hidden="true" />My bag</span><strong>{bag.loading ? "Checking stock…" : bag.error ? "Status unavailable" : bag.readiness.label}</strong></Link>
    </nav>
    {bag.error ? <p role="alert" className="hub-error">Could not load your bag stock.<button type="button" onClick={bag.reload}>Retry bag stock</button></p> : null}
    {supply.error ? <p role="alert" className="hub-error">Could not load supply requests. Open Supply requests to retry.</p> : null}
    {latestHcmPost ? <div className="hub-bulletin"><HcmBulletinBanner post={latestHcmPost} /></div> : null}
  </section>;
}
