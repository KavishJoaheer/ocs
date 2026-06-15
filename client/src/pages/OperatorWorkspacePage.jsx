import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  ClipboardList,
  CreditCard,
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
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { formatCurrency, formatDate, formatDateTime } from "../lib/format.js";
const workspaceMeta = {
  "current-week-roster": {
    eyebrow: "Coordination",
    title: () => "SOS Planning",
    description: "Emergency SOS shift planning for the doctor team (inactive).",
    icon: CalendarClock,
  },
  "april-roster": {
    eyebrow: "Operator roster",
    title: (data) => `${data?.periods?.monthLabel || "Current month"} roster`,
    description:
      "See the full monthly visit roster across all doctors from the operator coordination desk.",
    icon: ClipboardList,
  },
  "scheduled-visits": {
    eyebrow: "Visit planner",
    title: () => "Scheduled visits",
    description:
      "Track all future scheduled visits for every doctor without leaving the operator workspace.",
    icon: CalendarClock,
  },
  "pending-payment": {
    eyebrow: "Payment follow-up",
    title: () => "Pending payment",
    description:
      "Review unpaid consultation billing for every doctor so operators can keep follow-up visible.",
    icon: CreditCard,
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

function AppointmentQueueList({ appointments, emptyTitle, emptyDescription }) {
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
                {appointment.doctor_name} - {appointment.specialization}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {formatDateTime(appointment.appointment_date, appointment.appointment_time)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge value={appointment.status} />
              <Link
                className="rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                to={`/patients/${appointment.patient_id}`}
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

function PendingPaymentsList({ bills }) {
  if (!bills.length) {
    return (
      <EmptyState
        title="No pending payment"
        description="All consultation-linked bills are currently settled across the doctor roster."
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
              <p className="mt-2 text-sm text-slate-500">{bill.doctor_name}</p>
              <p className="mt-1 text-sm text-slate-500">
                Consultation on {formatDate(bill.consultation_date)}
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
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OperatorWorkspacePage({ workspaceKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const meta = workspaceMeta[workspaceKey];
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function loadWorkspace() {
      try {
        const payload = await api.get("/dashboard/operator-workspace");
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
  }, [refreshKey]);

  const title = useMemo(() => (meta ? meta.title(data) : "Operator workspace"), [data, meta]);

  if (!meta) {
    return (
      <EmptyState
        title="Operator workspace unavailable"
        description="This operator workspace page could not be matched to a valid section."
      />
    );
  }

  if (loading) {
    return <LoadingState label="Loading operator workspace" />;
  }

  if (!data) {
    return (
      <EmptyState
        title="Operator workspace unavailable"
        description="The operator workspace could not be loaded right now. Please refresh and try again."
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
        to="/patients"
      >
        Open patients
      </Link>
    </>
  );

  let metrics = [];
  let content = null;

  if (workspaceKey === "current-week-roster") {
    metrics = [];
    content = (
      <SectionCard
        actions={sharedActions}
        subtitle="This workspace is reserved for SOS shift planning."
        title="SOS Planning"
      >
        <EmptyState
          title="Feature inactive"
          description="SOS Planning is not available for operators yet. Use the May roster or return to the dashboard."
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
        description: `Every rostered visit for ${monthLabel}.`,
        accent: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: CalendarClock,
        label: "Scheduled",
        value: data.currentMonthRoster.filter((appointment) => appointment.status === "scheduled").length,
        description: `Visits still on the shared calendar in ${monthLabel}.`,
        accent: "bg-gradient-to-br from-cyan-500 to-sky-600",
      },
      {
        icon: UsersRound,
        label: "Doctors involved",
        value: new Set(data.currentMonthRoster.map((appointment) => appointment.doctor_id)).size,
        description: `Doctors appearing in the ${monthLabel} roster.`,
        accent: "bg-gradient-to-br from-emerald-500 to-teal-600",
      },
    ];

    content = (
      <SectionCard
        actions={sharedActions}
        subtitle={`The shared monthly doctor schedule for ${monthLabel}.`}
        title={`${monthLabel} roster details`}
      >
        <AppointmentQueueList
          appointments={data.currentMonthRoster}
          emptyDescription={`No visits have been added to the ${monthLabel} roster yet.`}
          emptyTitle={`No rostered visits in ${monthLabel}`}
        />
      </SectionCard>
    );
  }

  if (workspaceKey === "scheduled-visits") {
    metrics = [
      {
        icon: CalendarClock,
        label: "Scheduled visits",
        value: data.summary.scheduledVisitsCount,
        description: "Future visits across all doctors still marked as scheduled.",
        accent: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: UsersRound,
        label: "Doctors active",
        value: new Set(data.scheduledVisits.map((appointment) => appointment.doctor_id)).size,
        description: "Doctors currently represented in the upcoming queue.",
        accent: "bg-gradient-to-br from-cyan-500 to-sky-600",
      },
      {
        icon: ClipboardList,
        label: "Next visit",
        value: data.scheduledVisits[0]
          ? formatDate(data.scheduledVisits[0].appointment_date)
          : "None",
        description: "The next scheduled home visit on the operator board.",
        accent: "bg-gradient-to-br from-emerald-500 to-teal-600",
      },
    ];

    content = (
      <SectionCard
        actions={sharedActions}
        subtitle="Upcoming doctor visits still waiting on completion."
        title="Scheduled visits"
      >
        <AppointmentQueueList
          appointments={data.scheduledVisits}
          emptyDescription="There are no future scheduled visits across the doctor roster right now."
          emptyTitle="No scheduled visits"
        />
      </SectionCard>
    );
  }

  if (workspaceKey === "pending-payment") {
    metrics = [
      {
        icon: CreditCard,
        label: "Unpaid bills",
        value: data.summary.pendingPaymentsCount,
        description: "Consultation-linked bills still waiting on payment.",
        accent: "bg-gradient-to-br from-amber-400 to-brand-gold",
      },
      {
        icon: ClipboardList,
        label: "Pending total",
        value: formatCurrency(data.summary.pendingPaymentAmount),
        description: "Combined unpaid amount across all doctors.",
        accent: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: UsersRound,
        label: "Doctors involved",
        value: new Set(data.pendingPayments.map((bill) => bill.doctor_id)).size,
        description: "Doctors with consultation billing still awaiting settlement.",
        accent: "bg-gradient-to-br from-cyan-500 to-sky-600",
      },
    ];

    content = (
      <SectionCard
        actions={sharedActions}
        subtitle="All unpaid consultation billing entries that still need follow-up."
        title="Pending payment queue"
      >
        <PendingPaymentsList bills={data.pendingPayments} />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={meta.eyebrow}
        title={title}
        description={meta.description}
      />

      {metrics.length ? (
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
      ) : null}

      {content}
    </div>
  );
}

export default OperatorWorkspacePage;
