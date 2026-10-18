import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { CalendarClock, ChevronDown, ChevronRight, ClipboardList, MapPin, Package, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { useDoctorAssignedCare } from "../../hooks/useDoctorAssignedCare.js";
import { useDoctorBagInventory } from "../../hooks/useDoctorBagInventory.js";
import { useDoctorSupplyRequests } from "../../hooks/useDoctorSupplyRequests.js";
import { prefetchPatientOfflineDirectory } from "../../lib/patientOfflineSync.js";
import { resolveClinicalTwinCounts } from "../../lib/clinicalTwinMetrics.js";
import { getDoctorSchedule } from "../../lib/doctorDashboard.js";
import { formatReviewAppointmentTime } from "../../lib/patientReview.js";
import { getTimeOfDayGreeting } from "../operator-dashboard/operatorDashboardCopy.js";
import { cx } from "../../lib/utils.js";
import DoctorAssignedCare from "./DoctorAssignedCare.jsx";
import DoctorMobileActionHub from "./DoctorMobileActionHub.jsx";
import OperationStatusSelector from "../OperationStatusSelector.jsx";
import PushNotificationBanner from "../PushNotificationBanner.jsx";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import HcmBulletinBanner from "../HcmBulletinBanner.jsx";
import "../operator-dashboard/operatorDashboard.css";
import "./doctorDashboard.css";

export default function DoctorDashboard({ user, dashboard, mobile = false, onStatusChange, isSavingStatus, latestHcmPost }) {
  const firstName = String(user.full_name || "").replace(/^dr\.?\s+/i, "").trim().split(/\s+/)[0] || "Doctor";
  const care = useDoctorAssignedCare(user.doctor_id, Boolean(user.is_read_only));
  const bag = useDoctorBagInventory();
  const supply = useDoctorSupplyRequests();
  const [now, setNow] = useState(() => new Date());
  const schedule = getDoctorSchedule(dashboard, care.visits, now);
  const followUps = resolveClinicalTwinCounts("doctor", { dashboard }).longTermReviewCount;
  const pill = "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (mobile && user.id) void prefetchPatientOfflineDirectory(user.id); }, [mobile, user.id]);

  const followUpLink = (
    <Link to="/doctor/long-term-review" className={cx(pill, followUps > 0 ? "border-amber-200 bg-amber-50/80 text-amber-900 hover:bg-amber-100" : "border-[#d5e4e1] bg-white text-[#173f4a] hover:bg-[#edf9f7]")}>
      <ClipboardList className="size-4 shrink-0" aria-hidden="true" /><span className={mobile ? "text-center text-xs" : ""}>Review appointments</span>
      <span className={cx("rounded-full px-2 py-0.5 text-xs tabular-nums", followUps > 0 ? "bg-amber-200/70" : "bg-slate-100")}>{followUps}</span>
    </Link>
  );
  const supplyLink = (
    <Link to="/supply-requests" className={cx(pill, "border-[#d5e4e1] bg-white text-[#173f4a] hover:bg-[#edf9f7]")}>
      <Package className="size-4 shrink-0" aria-hidden="true" />Supply requests
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums">{supply.loading ? "…" : supply.error ? "!" : supply.activeCount}</span>
    </Link>
  );
  const bagContent = (
    <div className="flex flex-wrap items-center gap-2">
      <Package className="size-4 shrink-0 text-[#137b80]" aria-hidden="true" />
      <span className="text-sm font-semibold text-[#173f4a]">My bag</span>
      <span className={cx("rounded-full px-2.5 py-1 text-xs font-medium", bag.readiness.attention && !bag.error ? "bg-amber-100 text-amber-900" : "bg-[#edf6f3] text-[#376168]")}>{bag.loading ? "Checking stock…" : bag.error ? "Status unavailable" : bag.readiness.label}</span>
    </div>
  );

  if (mobile) return <DoctorMobileActionHub user={user} firstName={firstName} now={now} care={care} bag={bag} supply={supply} schedule={schedule} followUps={followUps} onStatusChange={onStatusChange} isSavingStatus={isSavingStatus} latestHcmPost={latestHcmPost} />;

  return (
    <section aria-label="Doctor dashboard" className={cx("doctor-dashboard-root mx-auto w-full min-w-0 space-y-5", mobile ? "max-w-md pb-4 pt-2" : "ocs-cc")}>
      <header className={mobile ? "space-y-2" : "ocs-cc-header"}>
        <div className="min-w-0">
          <h1 className={cx("font-bold leading-tight tracking-tight text-[#173f4a]", mobile ? "text-[1.6rem]" : "text-2xl")}>{getTimeOfDayGreeting(now)}, Dr {firstName}</h1>
          {!mobile ? <p className="mt-1 text-sm text-[#485e65]">{dayjs(now).format("dddd, D MMMM")}</p> : null}
        </div>
        <div className={mobile ? "flex flex-wrap items-center justify-between gap-2" : "ocs-cc-header-tools"}>
          {mobile ? <>
            <p className="text-xs text-[#485e65]">{dayjs(now).format("dddd, D MMMM")}</p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <span aria-hidden="true" className={cx("pointer-events-none absolute left-3 top-1/2 size-2 -translate-y-1/2 rounded-full", user.operation_status === "available" ? "bg-emerald-500" : user.operation_status === "active" ? "bg-[#20c9c0]" : "bg-slate-400")} />
                <select aria-label="Availability" title="Available for new requests; Active means on duty; Offline means unavailable." value={user.operation_status || "offline"} disabled={isSavingStatus || user.is_read_only} onChange={event => onStatusChange(event.target.value)} className="min-h-11 appearance-none rounded-full border border-[#b8d9d4] bg-white pl-7 pr-7 text-xs font-semibold text-[#173f4a] disabled:opacity-50">
                  <option value="available">Available</option><option value="active">Active</option><option value="offline">Offline</option>
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-[#376168]" />
              </div>
              <AppUpdateBanner compact />
            </div>
          </> : <>
            <OperationStatusSelector description="Available for new requests; Active means on duty; Offline means unavailable." tone="teal" value={user.operation_status} options={["available", "active", "offline"]} disabled={isSavingStatus || user.is_read_only} onChange={onStatusChange} showLabel={false} />
            {!user.is_read_only ? <PushNotificationBanner role="doctor" compact /> : null}
            <AppUpdateBanner compact />
          </>}
        </div>
      </header>

      {!mobile ? <nav aria-label="Doctor quick actions" className="flex flex-wrap items-center gap-3">
        <Link to="/appointments" className={cx(pill, "border-[#cde7e3] bg-[#edf9f7] text-[#173f4a] hover:bg-[#dff3ef]")}><CalendarClock className="size-4" aria-hidden="true" />Today's visits<span className="rounded-full bg-white/80 px-2 py-0.5 text-xs tabular-nums">{schedule.todayCount}</span></Link>
        {followUpLink}
        <Link to="/patients/add" className={cx(pill, "ml-auto border-[#b8d9d4] bg-white text-[#137b80] hover:bg-[#edf9f7]")}><UserPlus className="size-4" aria-hidden="true" />Add patient</Link>
      </nav> : null}

      <DoctorAssignedCare care={care} mobile={mobile} readOnly={Boolean(user.is_read_only)} />

      <div className={mobile ? "space-y-4" : "grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"}>
        <section aria-label="Next scheduled visit" className="min-w-0 rounded-[26px] border border-[#dce9e6] bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-[#173f4a]">Next scheduled visit</h2><Link to="/appointments" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[#137b80]">View schedule<ChevronRight className="size-3.5" aria-hidden="true" /></Link></div>
          {care.loading || care.errors.visits ? <p className="mt-2 text-sm text-[#485e65]">{care.loading ? "Checking your schedule…" : "Open your schedule to see upcoming appointments."}</p> : schedule.nextVisit ? <Link to={`/patients/${schedule.nextVisit.patient_id}`} aria-label={`Open record for ${schedule.nextVisit.patient_name}`} className="mt-2 flex min-h-11 items-center gap-3 rounded-xl">
            <div className="shrink-0 rounded-full bg-[#e2f3ef] px-3 py-2 text-xs font-semibold text-[#173f4a]">{formatReviewAppointmentTime(schedule.nextVisit.appointment_time) || "Time pending"}</div>
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-bold text-[#173f4a]">{schedule.nextVisit.patient_name}</p><p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[#485e65]"><MapPin className="size-3 shrink-0" aria-hidden="true" />{schedule.nextVisit.location || "Location pending"}{schedule.nextVisit.appointment_date !== schedule.today ? ` · ${dayjs(schedule.nextVisit.appointment_date).format("ddd, D MMM")}` : ""}</p></div><ChevronRight className="size-4 shrink-0 text-[#137b80]" aria-hidden="true" />
          </Link> : <p className="mt-2 text-sm text-[#485e65]">No upcoming scheduled visits</p>}
        </section>
        {mobile ? <>
          <nav aria-label="Doctor quick actions" className="grid grid-cols-2 gap-3">{followUpLink}{supplyLink}</nav>
          <Link to="/inventory?context=my" className="flex min-h-16 items-center justify-between gap-2 rounded-full border border-[#dce9e6] bg-white px-4 py-3">{bagContent}<ChevronRight className="size-4 shrink-0 text-[#137b80]" aria-hidden="true" /></Link>
        </> : <section aria-label="Doctor supplies" className="min-w-0 space-y-3 rounded-[26px] border border-[#dce9e6] bg-white p-5">
          <Link to="/inventory?context=my" className="flex min-h-11 flex-wrap items-center justify-between gap-2">{bagContent}<span className="text-xs font-semibold text-[#137b80]">Review stock →</span></Link>
          <div className="border-t border-[#e3eeeb] pt-3">{supplyLink}</div>
        </section>}
      </div>
      {bag.error ? <p role="alert" className="text-xs text-red-800">Could not load your bag stock.<button type="button" onClick={bag.reload} className="ml-2 min-h-11 font-semibold underline">Retry bag stock</button></p> : null}
      {supply.error ? <p role="alert" className="text-xs text-red-800">Could not load supply requests. Open Supply requests to retry.</p> : null}
      {latestHcmPost ? <HcmBulletinBanner post={latestHcmPost} /> : null}
    </section>
  );
}
