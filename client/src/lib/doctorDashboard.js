export function getDoctorSchedule(dashboard, activeVisits = [], now = new Date()) {
  const workspace = dashboard?.doctorWorkspace || dashboard || {};
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Mauritius", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = type => parts.find(value => value.type === type)?.value;
  const today = workspace.periods?.today || dashboard?.periods?.today || `${part("year")}-${part("month")}-${part("day")}`;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Indian/Mauritius", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const scheduled = (workspace.scheduledVisits || []).filter(visit => visit.status === "scheduled");
  const assignedAppointments = new Set(activeVisits.map(visit => Number(visit.appointment_id)).filter(Boolean));
  const visitTime = visit => {
    const match = String(visit.appointment_time || "").match(/^(\d{1,2}):(\d{2})/);
    return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
  };
  const upcoming = scheduled.filter(visit => !assignedAppointments.has(Number(visit.id)) && (visit.appointment_date > today || (visit.appointment_date === today && (!visitTime(visit) || visitTime(visit) >= time))));
  upcoming.sort((a, b) => `${a.appointment_date}T${visitTime(a)}`.localeCompare(`${b.appointment_date}T${visitTime(b)}`));
  return { today, todayCount: scheduled.filter(visit => visit.appointment_date === today).length, nextVisit: upcoming[0] || null };
}
