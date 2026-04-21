import { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CalendarClock,
  ClipboardList,
  CreditCard,
  Stethoscope,
  UsersRound,
} from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { api } from "../lib/api.js";
import {
  formatAgeFromDateOfBirth,
  formatCurrency,
  formatDate,
  formatDateTime,
  truncate,
} from "../lib/format.js";

const workspaceMeta = {
  "current-week-roster": {
    eyebrow: "Doctor roster",
    title: () => "Current week roster",
    description:
      "Review your scheduled home visits for the current week with direct links back to the patient and consultation records.",
    icon: CalendarClock,
  },
  "april-roster": {
    eyebrow: "Doctor roster",
    title: (data) => `${data?.periods?.monthLabel || "Current month"} roster`,
    description:
      "See the full doctor roster for the current month, including scheduled, completed, and cancelled visits.",
    icon: ClipboardList,
  },
  "hcm-updates": {
    eyebrow: "HCM updates",
    title: () => "Updates from HCM",
    description:
      "Track the latest visit movements, consultation saves, and payment-related updates for your doctor workspace.",
    icon: BellRing,
  },
  "scheduled-visits": {
    eyebrow: "Visit planner",
    title: () => "Scheduled visits",
    description:
      "Focus on all upcoming scheduled visits assigned to your doctor account and move quickly into patient records.",
    icon: CalendarClock,
  },
  "pending-payment": {
    eyebrow: "Finance follow-up",
    title: () => "Pending payment",
    description:
      "Review unpaid consultation bills linked to your visits so the doctor team can keep payment follow-up visible.",
    icon: CreditCard,
  },
  "patients-seen-april": {
    eyebrow: "Doctor patients",
    title: (data) => `Total patients seen in ${data?.periods?.monthLabel || "this month"}`,
    description:
      "Review every unique patient you have seen this month based on saved consultations, with direct access to each profile.",
    icon: Stethoscope,
  },
  "assigned-patients": {
    eyebrow: "Doctor patients",
    title: () => "Assigned patients",
    description:
      "Open the patient panel for everyone currently assigned to you and jump straight into their ongoing care records.",
    icon: UsersRound,
  },
};

function MetricCard({ icon: Icon, label, value, description, accent }) {
  return (
    <div className="rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-white/88 p-5 shadow-[0_24px_64px_rgba(34,72,91,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            {label}
          </p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
          <p className="mt-2 text-sm leading-6 text-[#4f6f7a]">{description}</p>
        </div>
        <div className={`rounded-3xl p-4 ${accent}`}>
          <Icon className="size-6 text-white" />
        </div>
      </div>
    </div>
  );
}

function AppointmentList({ appointments, emptyTitle, emptyDescription }) {
  if (!appointments.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-4">
      {appointments.map((appointment) => (
        <div
          key={appointment.id}
          className="rounded-[26px] border border-slate-200/80 bg-slate-50/70 p-4"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-950">{appointment.patient_name}</p>
              <p className="mt-1 text-sm text-[#4f6f7a]">
                {appointment.patient_identifier || "No OCS care number"}
                {appointment.location ? ` - ${appointment.location}` : ""}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {formatDateTime(appointment.appointment_date, appointment.appointment_time)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge value={appointment.status} />
              <Link
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                to={`/patients/${appointment.patient_id}`}
              >
                Open patient
              </Link>
              {appointment.consultation_id ? (
                <Link
                  className="rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                  to={`/consultations/${appointment.consultation_id}`}
                >
                  Open consultation
                </Link>
              ) : (
                <Link
                  className="rounded-2xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  to="/appointments"
                >
                  Open calendar
                </Link>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PaymentList({ bills }) {
  if (!bills.length) {
    return (
      <EmptyState
        title="No pending payments"
        description="All consultation-linked billing entries for this doctor are currently settled."
      />
    );
  }

  return (
    <div className="space-y-4">
      {bills.map((bill) => (
        <div key={bill.id} className="rounded-[26px] border border-slate-200/80 bg-slate-50/70 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-950">{bill.patient_name}</p>
              <p className="mt-1 text-sm text-[#4f6f7a]">
                {bill.patient_identifier || "No OCS care number"}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Consultation on {formatDate(bill.consultation_date)}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {truncate(bill.doctor_notes, 140) || "Consultation note available on the detail page."}
              </p>
            </div>

            <div className="min-w-[220px]">
              <div className="rounded-[22px] bg-white/85 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2d8f98]">
                  Unpaid amount
                </p>
                <p className="mt-2 text-3xl font-bold text-slate-950">
                  {formatCurrency(bill.total_amount)}
                </p>
                <p className="mt-2 text-sm text-[#4f6f7a]">
                  {bill.items.length} billing item{bill.items.length === 1 ? "" : "s"}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                  to={`/patients/${bill.patient_id}`}
                >
                  Open patient
                </Link>
                <Link
                  className="rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                  to={`/consultations/${bill.consultation_id}`}
                >
                  Open consultation
                </Link>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SeenPatientsList({ patients, monthLabel }) {
  if (!patients.length) {
    return (
      <EmptyState
        title={`No patients seen in ${monthLabel}`}
        description="Patients will appear here as soon as consultation notes are saved for this month."
      />
    );
  }

  return (
    <div className="space-y-4">
      {patients.map((patient) => (
        <div key={patient.patient_id} className="rounded-[26px] border border-slate-200/80 bg-slate-50/70 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-950">{patient.patient_name}</p>
              <p className="mt-1 text-sm text-[#4f6f7a]">
                {patient.patient_identifier || "No OCS care number"}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Last consultation saved on {formatDate(patient.consultation_date)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                to={`/patients/${patient.patient_id}`}
              >
                Open patient
              </Link>
              <Link
                className="rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                to={`/consultations/${patient.id}`}
              >
                Open consultation
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AssignedPatientsList({ patients }) {
  if (!patients.length) {
    return (
      <EmptyState
        title="No assigned patients"
        description="Patients assigned to this doctor will appear here once they are added or reassigned."
      />
    );
  }

  return (
    <div className="space-y-4">
      {patients.map((patient) => (
        <div key={patient.id} className="rounded-[26px] border border-slate-200/80 bg-slate-50/70 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-950">{patient.full_name}</p>
              <p className="mt-1 text-sm text-[#4f6f7a]">
                {patient.patient_identifier || "No OCS care number"} - {patient.gender} -{" "}
                {formatAgeFromDateOfBirth(patient.date_of_birth)}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {patient.patient_contact_number || "No patient contact number"}
                {patient.location ? ` - ${patient.location}` : ""}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Last consultation:{" "}
                {patient.last_consultation_date ? formatDate(patient.last_consultation_date) : "Not yet recorded"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge value={patient.status} />
              <Link
                className="rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                to={`/patients/${patient.id}`}
              >
                Open patient
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function UpdatesFeed({ updates }) {
  if (!updates.length) {
    return (
      <EmptyState
        title="No HCM updates yet"
        description="Doctor activity updates will appear here once visits, consultation notes, and payment records start moving."
      />
    );
  }

  return (
    <div className="space-y-4">
      {updates.map((update, index) => (
        <div key={`${update.type}-${update.activity_at}-${index}`} className="flex gap-4">
          <div className="mt-1 h-3 w-3 shrink-0 rounded-full bg-sky-500" />
          <div className="flex-1 rounded-[24px] border border-slate-200/70 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-semibold text-slate-950">{update.title}</p>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {update.type}
              </span>
            </div>
            <p className="mt-1 text-sm text-[#4f6f7a]">{update.patient_name}</p>
            <p className="mt-2 text-sm text-slate-500">
              {update.reference_time
                ? formatDateTime(update.reference_date, update.reference_time)
                : formatDate(update.reference_date)}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">{truncate(update.detail, 150)}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {update.patient_id ? (
                <Link
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                  to={`/patients/${update.patient_id}`}
                >
                  Open patient
                </Link>
              ) : null}
              {update.consultation_id ? (
                <Link
                  className="rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                  to={`/consultations/${update.consultation_id}`}
                >
                  Open consultation
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DoctorWorkspacePage({ workspaceKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const meta = workspaceMeta[workspaceKey];

  useEffect(() => {
    let ignore = false;

    async function loadWorkspace() {
      try {
        const payload = await api.get("/dashboard/doctor-workspace");
        if (!ignore) {
          setData(payload);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadWorkspace();

    return () => {
      ignore = true;
    };
  }, []);

  const title = useMemo(() => (meta ? meta.title(data) : "Doctor workspace"), [data, meta]);

  if (!meta) {
    return (
      <EmptyState
        title="Doctor workspace unavailable"
        description="This doctor workspace page could not be matched to a valid section."
      />
    );
  }

  if (loading) {
    return <LoadingState label="Loading doctor workspace" />;
  }

  if (!data) {
    return (
      <EmptyState
        title="Doctor workspace unavailable"
        description="The doctor workspace could not be loaded right now. Please refresh and try again."
      />
    );
  }

  const monthLabel = data.periods?.monthLabel || "this month";
  const sharedActions = (
    <>
      <Link
        className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
        to="/"
      >
        Back to dashboard
      </Link>
      <Link
        className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
        to="/appointments"
      >
        Open appointments
      </Link>
    </>
  );

  let metrics = [];
  let content = null;

  if (workspaceKey === "current-week-roster") {
    metrics = [
      {
        icon: CalendarClock,
        label: "Week visits",
        value: data.summary.currentWeekRosterCount,
        description: `${formatDate(data.periods.weekStart)} to ${formatDate(data.periods.weekEnd)}`,
        accent: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: ClipboardList,
        label: "Scheduled",
        value: data.currentWeekRoster.filter((appointment) => appointment.status === "scheduled").length,
        description: "Visits still on the live doctor calendar this week.",
        accent: "bg-gradient-to-br from-cyan-500 to-sky-600",
      },
      {
        icon: Stethoscope,
        label: "Completed",
        value: data.currentWeekRoster.filter((appointment) => appointment.status === "completed").length,
        description: "Weekly visits that already resulted in a completed appointment.",
        accent: "bg-gradient-to-br from-emerald-500 to-teal-600",
      },
    ];

    content = (
      <SectionCard
        actions={sharedActions}
        subtitle="Your weekly doctor roster in one place."
        title="Current week visits"
      >
        <AppointmentList
          appointments={data.currentWeekRoster}
          emptyDescription="No doctor visits are currently scheduled for this week."
          emptyTitle="No visits in the current week"
        />
      </SectionCard>
    );
  }

  if (workspaceKey === "april-roster") {
    metrics = [
      {
        icon: ClipboardList,
        label: `${monthLabel} roster`,
        value: data.summary.currentMonthRosterCount,
        description: `All rostered doctor visits for ${monthLabel}.`,
        accent: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: Stethoscope,
        label: "Completed",
        value: data.summary.completedAppointmentsThisMonth,
        description: `Visits completed during ${monthLabel}.`,
        accent: "bg-gradient-to-br from-emerald-500 to-teal-600",
      },
      {
        icon: BellRing,
        label: "Cancelled",
        value: data.summary.cancelledAppointmentsThisMonth,
        description: `Appointments that dropped out of the ${monthLabel} roster.`,
        accent: "bg-gradient-to-br from-amber-400 to-orange-500",
      },
    ];

    content = (
      <SectionCard
        actions={sharedActions}
        subtitle={`The full doctor schedule for ${monthLabel}.`}
        title={`${monthLabel} roster details`}
      >
        <AppointmentList
          appointments={data.currentMonthRoster}
          emptyDescription={`No doctor visits have been rostered in ${monthLabel} yet.`}
          emptyTitle={`No rostered visits in ${monthLabel}`}
        />
      </SectionCard>
    );
  }

  if (workspaceKey === "hcm-updates") {
    metrics = [
      {
        icon: BellRing,
        label: "Recent updates",
        value: data.hcmUpdates.length,
        description: "Latest doctor activity items in the HCM-style operations feed.",
        accent: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: CalendarClock,
        label: "Scheduled visits",
        value: data.summary.scheduledVisitsCount,
        description: "Upcoming visits still waiting on completion.",
        accent: "bg-gradient-to-br from-cyan-500 to-sky-600",
      },
      {
        icon: CreditCard,
        label: "Pending payment",
        value: data.summary.pendingPaymentsCount,
        description: "Unpaid consultation bills linked to your doctor record.",
        accent: "bg-gradient-to-br from-amber-400 to-orange-500",
      },
    ];

    content = (
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          actions={
            <>
              <Link
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                to="/"
              >
                Back to dashboard
              </Link>
              <Link
                className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
                to="/doctor/pending-payment"
              >
                Open pending payment
              </Link>
            </>
          }
          subtitle="Doctor operations movement, visit changes, consultation saves, and billing follow-up."
          title="HCM activity feed"
        >
          <UpdatesFeed updates={data.hcmUpdates} />
        </SectionCard>

        <SectionCard
          subtitle="Fast doctor shortcuts tied directly to your dashboard buttons."
          title="Next steps"
        >
          <div className="space-y-3">
            <Link
              className="block rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
              to="/doctor/current-week-roster"
            >
              Current week roster
            </Link>
            <Link
              className="block rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
              to="/doctor/scheduled-visits"
            >
              Scheduled visits
            </Link>
            <Link
              className="block rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
              to="/doctor/assigned-patients"
            >
              Assigned patients
            </Link>
          </div>
        </SectionCard>
      </div>
    );
  }

  if (workspaceKey === "scheduled-visits") {
    metrics = [
      {
        icon: CalendarClock,
        label: "Scheduled visits",
        value: data.summary.scheduledVisitsCount,
        description: "All future visits still marked as scheduled.",
        accent: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: ClipboardList,
        label: "Next visit",
        value: data.scheduledVisits[0]
          ? formatDate(data.scheduledVisits[0].appointment_date)
          : "None",
        description: "The next scheduled doctor visit on your calendar.",
        accent: "bg-gradient-to-br from-cyan-500 to-sky-600",
      },
      {
        icon: UsersRound,
        label: "Assigned patients",
        value: data.summary.assignedPatientsCount,
        description: "Patients currently assigned to your doctor account.",
        accent: "bg-gradient-to-br from-emerald-500 to-teal-600",
      },
    ];

    content = (
      <SectionCard
        actions={sharedActions}
        subtitle="Every future visit that still needs doctor completion."
        title="Upcoming scheduled visits"
      >
        <AppointmentList
          appointments={data.scheduledVisits}
          emptyDescription="There are no future scheduled visits on your doctor calendar right now."
          emptyTitle="No scheduled visits"
        />
      </SectionCard>
    );
  }

  if (workspaceKey === "pending-payment") {
    const uniquePatients = new Set(data.pendingPayments.map((bill) => bill.patient_id)).size;

    metrics = [
      {
        icon: CreditCard,
        label: "Unpaid bills",
        value: data.summary.pendingPaymentsCount,
        description: "Consultation-linked bills still waiting for payment.",
        accent: "bg-gradient-to-br from-amber-400 to-orange-500",
      },
      {
        icon: ClipboardList,
        label: "Pending total",
        value: formatCurrency(data.summary.pendingPaymentAmount),
        description: "Combined unpaid amount across this doctor's consultation billing.",
        accent: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: UsersRound,
        label: "Patients involved",
        value: uniquePatients,
        description: "Unique patients represented in the unpaid doctor billing queue.",
        accent: "bg-gradient-to-br from-cyan-500 to-sky-600",
      },
    ];

    content = (
      <SectionCard
        actions={
          <>
            <Link
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              to="/"
            >
              Back to dashboard
            </Link>
            <Link
              className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
              to="/consultations"
            >
              Open consultations
            </Link>
          </>
        }
        subtitle="Doctor-visible finance follow-up for unpaid consultation bills."
        title="Pending payment queue"
      >
        <PaymentList bills={data.pendingPayments} />
      </SectionCard>
    );
  }

  if (workspaceKey === "patients-seen-april") {
    metrics = [
      {
        icon: UsersRound,
        label: `${monthLabel} patients`,
        value: data.summary.patientsSeenThisMonthCount,
        description: "Unique patients seen this month based on saved consultations.",
        accent: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: Stethoscope,
        label: "Consultations",
        value: data.monthConsultations.length,
        description: `Total consultation notes saved in ${monthLabel}.`,
        accent: "bg-gradient-to-br from-emerald-500 to-teal-600",
      },
      {
        icon: ClipboardList,
        label: "Assigned follow-up",
        value: data.assignedPatients.filter((patient) =>
          data.patientsSeenThisMonth.some((seenPatient) => seenPatient.patient_id === patient.id),
        ).length,
        description: "Seen patients who are also directly assigned to you.",
        accent: "bg-gradient-to-br from-cyan-500 to-sky-600",
      },
    ];

    content = (
      <SectionCard
        actions={
          <>
            <Link
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              to="/"
            >
              Back to dashboard
            </Link>
            <Link
              className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
              to="/consultations"
            >
              Open consultations
            </Link>
          </>
        }
        subtitle={`Unique patients seen during ${monthLabel}.`}
        title={`${monthLabel} patients seen`}
      >
        <SeenPatientsList monthLabel={monthLabel} patients={data.patientsSeenThisMonth} />
      </SectionCard>
    );
  }

  if (workspaceKey === "assigned-patients") {
    metrics = [
      {
        icon: UsersRound,
        label: "Assigned patients",
        value: data.summary.assignedPatientsCount,
        description: "The full number of patients directly assigned to this doctor.",
        accent: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: Stethoscope,
        label: "Active care",
        value: data.summary.activeAssignedPatientsCount,
        description: "Assigned patients still in active status.",
        accent: "bg-gradient-to-br from-emerald-500 to-teal-600",
      },
      {
        icon: ClipboardList,
        label: "Discharged",
        value: data.summary.dischargedAssignedPatientsCount,
        description: "Assigned patients currently marked as discharged.",
        accent: "bg-gradient-to-br from-amber-400 to-orange-500",
      },
    ];

    content = (
      <SectionCard
        actions={
          <>
            <Link
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              to="/"
            >
              Back to dashboard
            </Link>
            <Link
              className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
              to="/patients"
            >
              Open patients
            </Link>
          </>
        }
        subtitle="Assigned patient records linked to this doctor account."
        title="Assigned patient panel"
      >
        <AssignedPatientsList patients={data.assignedPatients} />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={meta.eyebrow} title={title} description={meta.description} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            accent={metric.accent}
            description={metric.description}
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
          />
        ))}
      </div>

      {content}
    </div>
  );
}

export default DoctorWorkspacePage;
