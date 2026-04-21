import dayjs from "dayjs";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../hooks/useAuth.jsx";

const pageMeta = {
  "/": {
    label: "Dashboard",
    helper: "Live operational view of patients, appointments, billing, and dispatch activity.",
  },
  "/patients": {
    label: "Patients",
    helper: "Manage patient records and review each OCS Medecins care timeline at a glance.",
  },
  "/appointments": {
    label: "Appointments",
    helper: "Coordinate home visit schedules in calendar and list form without losing context.",
  },
  "/doctor/current-week-roster": {
    label: "Current week roster",
    helper: "Review this week's doctor visits and move directly into patient or consultation records.",
  },
  "/doctor/april-roster": {
    label: "April roster",
    helper: "See the full monthly roster for the doctor dashboard in one filtered workspace.",
  },
  "/doctor/hcm-updates": {
    label: "HCM updates",
    helper: "Track doctor activity, consultation saves, and payment-related movement from one feed.",
  },
  "/hcm-news": {
    label: "HCM news",
    helper: "Read team-wide updates from the health care manager and review live staff status in one shared board.",
  },
  "/doctor/scheduled-visits": {
    label: "Scheduled visits",
    helper: "Focus on all future scheduled visits still waiting on doctor completion.",
  },
  "/doctor/pending-payment": {
    label: "Pending payment",
    helper: "Review unpaid consultation-linked billing entries tied to the doctor workspace.",
  },
  "/doctor/patients-seen-april": {
    label: "Patients seen",
    helper: "Open every unique patient seen this month based on doctor consultation records.",
  },
  "/doctor/assigned-patients": {
    label: "Assigned patients",
    helper: "Review all patients currently assigned to this doctor account.",
  },
  "/operator/current-week-roster": {
    label: "Current week roster",
    helper: "Review the shared doctor roster for the current week from the operator desk.",
  },
  "/operator/april-roster": {
    label: "Current month roster",
    helper: "See the full monthly doctor schedule from the operator coordination workspace.",
  },
  "/operator/scheduled-visits": {
    label: "Scheduled visits",
    helper: "Track all future visits across the doctor team without leaving the operator board.",
  },
  "/operator/billing-status": {
    label: "Billing status",
    helper: "Read-only billing visibility for operators to track payment status without editing finance records.",
  },
  "/operator/pending-payment": {
    label: "Pending payment",
    helper: "Review unpaid consultation billing across all doctors from the operator workspace.",
  },
  "/operator/long-term-review": {
    label: "Long term review",
    helper: "Open the active-care review list for patients needing longer-term operator follow-up.",
  },
  "/operator/review-appointments-april": {
    label: "Monthly review",
    helper: "Review the full current-month appointment board across all doctors.",
  },
  "/consultations": {
    label: "Consultations",
    helper: "Capture doctor notes and keep billing linked automatically.",
  },
  "/lab": {
    label: "Lab Workspace",
    helper: "Review recent consultations and coordinate the internal lab intake queue.",
  },
  "/billing": {
    label: "Billing",
    helper: "Track invoices, payment status, and each patient's billing summary.",
  },
  "/team-operations": {
    label: "Team operations",
    helper: "Maintain doctor, operator, and accountant accounts from one admin workspace.",
  },
  "/doctors": {
    label: "Team operations",
    helper: "Maintain doctor, operator, and accountant accounts from one admin workspace.",
  },
};

function AppShell() {
  const location = useLocation();
  const { user } = useAuth();
  const isPatientProfile = location.pathname.startsWith("/patients/");
  const isDashboard = location.pathname === "/";
  const hideTopHeader = isDashboard && user.role === "doctor";

  const dashboardMetaByRole = {
    doctor: {
      label: "Doctor dashboard",
      helper: "Clinical operations, patient requests, consultation flow, and billing tracking.",
    },
    operator: {
      label: "Operator dashboard",
      helper: "Dispatch, roster updates, patient coordination, and payment follow-up.",
    },
    lab_tech: {
      label: "Lab dashboard",
      helper: "Review blood-test workflow, consultation handoffs, patient follow-up, and stock visibility.",
    },
    admin: {
      label: "Admin dashboard",
      helper: "Clinic-wide control for patients, staffing, billing, HCM notices, and access approvals.",
    },
    accountant: {
      label: "Finance dashboard",
      helper: "Track billing, payment follow-up, revenue visibility, and finance-side operations updates.",
    },
  };

  const activeMeta = isPatientProfile
    ? {
        label: "Patient profile",
        helper: "A complete record of visits, notes, and billing for one patient.",
      }
    : isDashboard
      ? dashboardMetaByRole[user.role] || pageMeta["/"]
      : pageMeta[location.pathname] || pageMeta["/"];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(65,200,198,0.24),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(242,193,77,0.12),_transparent_20%),linear-gradient(180deg,_#f9fdfd_0%,_#eef8f8_100%)] text-slate-900">
      <div className="mx-auto min-h-screen max-w-[1600px] lg:flex">
        <Sidebar />

        <main className="min-w-0 flex-1">
          {!hideTopHeader ? (
            <div className="border-b border-white/70 bg-white/65 px-5 py-5 backdrop-blur lg:px-8">
              <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
                    OCS Medecins Operations
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">
                    {activeMeta.label}
                  </p>
                  <p className="mt-2 max-w-3xl text-sm leading-7 text-[#3f6270]">
                    {activeMeta.helper}
                  </p>
                </div>

                <div className="rounded-[30px] border border-[rgba(65,200,198,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(241,251,250,0.9))] px-5 py-4 shadow-[0_16px_40px_rgba(34,72,91,0.1)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#4c727d]">
                    OCS Medecins Dispatch Desk
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {dayjs().format("dddd, MMMM D")}
                  </p>
                  <p className="mt-1 text-sm text-[#2d8f98]">Home visit coordination ready</p>
                </div>
              </div>
            </div>
          ) : null}

          <div className={`px-5 py-6 lg:px-8 ${hideTopHeader ? "lg:py-6" : "lg:py-8"}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default AppShell;
