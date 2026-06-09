import dayjs from "dayjs";

/** Build and download a minimal .ics file for an appointment. */
export function downloadAppointmentIcs(appointment) {
  const start = dayjs(`${appointment.date}T${appointment.time || "09:00"}`);
  const end = start.add(appointment.kind === "review" ? 90 : 60, "minute");

  const formatIcs = (d) => d.format("YYYYMMDD[T]HHmmss");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OCS Virtual Practice//EN",
    "BEGIN:VEVENT",
    `UID:ocs-appointment-${appointment.id}@ocs.care`,
    `DTSTAMP:${formatIcs(dayjs())}`,
    `DTSTART:${formatIcs(start)}`,
    `DTEND:${formatIcs(end)}`,
    `SUMMARY:${appointment.type || "OCS Appointment"}`,
    `DESCRIPTION:${appointment.doctor_name || "OCS Care Team"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ocs-appointment-${appointment.date}.ics`;
  anchor.click();
  URL.revokeObjectURL(url);
}
