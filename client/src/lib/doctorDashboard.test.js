import assert from "node:assert/strict";
import test from "node:test";
import { getDoctorSchedule } from "./doctorDashboard.js";

test("next scheduled visit uses Mauritius time, skips earlier slots and active assignments", () => {
  const scheduledVisits = [
    { id: 1, status: "scheduled", appointment_date: "2026-10-13", appointment_time: "9:00" },
    { id: 2, status: "scheduled", appointment_date: "2026-10-13", appointment_time: "15:00" },
    { id: 3, status: "scheduled", appointment_date: "2026-10-13", appointment_time: "16:00" },
    { id: 4, status: "scheduled", appointment_date: "2026-10-14", appointment_time: "08:00" },
    { id: 5, status: "cancelled", appointment_date: "2026-10-13", appointment_time: "14:30" },
  ];
  const result = getDoctorSchedule({ doctorWorkspace: { scheduledVisits } }, [{ appointment_id: 2 }], new Date("2026-10-13T10:00:00Z"));
  assert.equal(result.today, "2026-10-13");
  assert.equal(result.todayCount, 3);
  assert.equal(result.nextVisit.id, 3);
});

test("a next-day visit is labelled against the Mauritius calendar after midnight", () => {
  const result = getDoctorSchedule({ doctorWorkspace: { scheduledVisits: [
    { id: 1, status: "scheduled", appointment_date: "2026-10-13", appointment_time: "23:00" },
    { id: 2, status: "scheduled", appointment_date: "2026-10-15", appointment_time: "10:00" },
  ] } }, [], new Date("2026-10-13T21:00:00Z"));
  assert.equal(result.today, "2026-10-14");
  assert.equal(result.todayCount, 0);
  assert.equal(result.nextVisit.id, 2);
});

test("a doctor with no upcoming slots gets no fabricated next appointment", () => {
  assert.equal(getDoctorSchedule({}, [], new Date("2026-10-13T10:00:00Z")).nextVisit, null);
});
