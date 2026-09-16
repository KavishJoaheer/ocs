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
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { api } from "../lib/api.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { formatCurrency, formatDate, formatDateTime } from "../lib/format.js";
const workspaceMeta = {
  "current-week-roster": {
    eyebrow: "Weekly coverage",
    title: () => "This week's coverage",
    description:
      "This week's visits across the doctor team, plus who is available for emergency coverage.",
    icon: CalendarClock,
  },
  "monthly-roster": {
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

const COVERAGE_GROUPS = [
  {
    key: "available",
    label: "Available now",
    stateLabel: "Available",
    empty: "No doctor is free for an emergency visit right now.",
    cardClass: "border-l-4 border-[#1a7f4b] bg-[rgba(26,127,75,0.07)]",
    stateClass: "text-[#1a7f4b]",
  },
  {
    key: "on_visit",
    label: "On a visit",
    stateLabel: "Active visit",
    empty: "No doctor is currently with a patient.",
    cardClass: "border-l-4 border-[#d97706] bg-[rgba(217,119,6,0.08)]",
    stateClass: "text-[#b45309]",
  },
  {
    key: "unavailable",
    label: "Unavailable",
    stateLabel: "Unavailable",
    empty: "No signed-in doctor is marked unavailable.",
    cardClass: "border-l-4 border-[#8b5cf6] bg-[rgba(139,92,246,0.07)]",
    stateClass: "text-[#6d28d9]",
  },
  {
    key: "offline",
    label: "Offline",
    stateLabel: "Offline",
    empty: "Every doctor is signed in.",
    cardClass: "border-l-4 border-slate-300 bg-slate-50",
    stateClass: "text-slate-500",
  },
];

function coverageStatus(doctor) {
  const derived = String(doctor?.coverage_status || "").toLowerCase();
  if (["available", "on_visit", "unavailable", "offline"].includes(derived)) {
    return derived;
  }
  const status = String(doctor?.operation_status || "offline").toLowerCase();
  if (status === "available") return "available";
  if (status === "active") return "unavailable";
  return "offline";
}

function CoverageDoctorRoster({ doctors }) {
  if (!doctors.length) {
    return (
      <EmptyState
        title="No doctor coverage yet"
        description="Doctor availability appears here when doctors set their operation status."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {COVERAGE_GROUPS.map((group) => {
        const rows = doctors.filter((doctor) => coverageStatus(doctor) === group.key);
        return (
          <section
            key={group.key}
            className={group.key === "offline" ? "lg:col-span-2" : undefined}
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">{group.label}</h3>
              <span className="text-xs font-bold tabular-nums text-slate-500">{rows.length}</span>
            </div>
            {rows.length ? (
              <div className={group.key === "offline" ? "grid gap-2 sm:grid-cols-2" : "space-y-2"}>
                {rows.map((doctor) => (
                  <div key={doctor.id} className={`rounded-2xl px-4 py-3 ${group.cardClass}`}>
                    <p className={`text-[11px] font-bold uppercase tracking-wide ${group.stateClass}`}>
                      {group.stateLabel}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{doctor.full_name}</p>
                    <p className="text-xs text-slate-500">{doctor.specialization || "Doctor"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
                {group.empty}
              </p>
            )}
          </section>
        );
      })}
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
                className="rounded-2xl bg-[#2d8f98] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#23767f]"
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

function todayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function OperatorPaymentModal({ bill, busy, onClose, onConfirm }) {
  const balance = Math.max(0, Number(bill?.payment_balance_amount ?? bill?.total_amount ?? 0));
  const [amount, setAmount] = useState(balance ? balance.toFixed(2) : "");
  const [method, setMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayInputValue);
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const amountNumber = Number(amount || 0);
  const valid = amountNumber > 0 && amountNumber <= balance && method && paymentDate &&
    (method === "cash" || reference.trim().length >= 3) && confirmed;

  return (
    <Modal open onClose={onClose} title={`Record payment · ${bill.invoice_number || `Bill #${bill.id}`}`} size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && valid) {
            onConfirm({
              amount: amountNumber,
              payment_method: method,
              payment_date: paymentDate,
              external_reference: reference.trim() || null,
              operation_id: operationId,
              expected_version: bill.row_version,
            });
          }
        }}
      >
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="font-bold text-slate-950">{bill.patient_name}</p>
          <p className="mt-1 text-sm text-slate-500">{bill.doctor_name} · {formatDate(bill.consultation_date)}</p>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Outstanding balance</p>
          <p className="mt-1 text-2xl font-black text-slate-950">{formatCurrency(balance)}</p>
        </div>
        <label className="block text-sm font-semibold text-slate-700">
          Amount received
          <input required type="number" min="0.01" max={balance} step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4" />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          Payment method
          <select required value={method} onChange={(event) => { setMethod(event.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4">
            <option value="">Select method</option>
            <option value="cash">Cash</option>
            <option value="juice">Juice</option>
            <option value="card">Card</option>
            <option value="ib">IB / bank</option>
          </select>
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          Payment date
          <input required type="date" max={todayInputValue()} value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4" />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          Transaction reference {method === "cash" ? <span className="font-normal text-slate-500">(optional)</span> : null}
          <input required={method !== "cash"} minLength={method === "cash" ? undefined : 3} value={reference} onChange={(event) => { setReference(event.target.value); setConfirmed(false); }} placeholder={method === "cash" ? "Receipt or cash reference" : "Provider transaction reference"} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4" />
        </label>
        <label className="flex min-h-11 items-start gap-3 text-sm text-slate-700">
          <input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>I confirm that this amount was received using this method on this date.</span>
        </label>
        <p className="text-xs text-slate-500">This creates an immutable payment transaction. A partial payment leaves the remaining balance open.</p>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 px-4 font-semibold">Cancel</button>
          <button disabled={busy || !valid} className="min-h-11 rounded-xl bg-[#17666a] px-4 font-bold text-white disabled:opacity-50">{busy ? "Recording…" : amountNumber < balance ? "Record partial payment" : "Confirm payment"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PendingPaymentsList({ bills, onRecordPayment }) {
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
                  {formatCurrency(bill.payment_balance_amount ?? bill.total_amount)}
                </p>
                {Number(bill.payment_received_amount || 0) > 0 ? (
                  <p className="mt-1 text-xs font-semibold text-emerald-700">
                    {formatCurrency(bill.payment_received_amount)} already received
                  </p>
                ) : null}
                <p className="mt-2 text-sm text-[#4f6f7a]">
                  {bill.items.length} billing item{bill.items.length === 1 ? "" : "s"}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-[#2d8f98] hover:text-[#2d8f98]"
                  to={`/patients/${bill.patient_id}`}
                >
                  Open patient
                </Link>
                <button
                  type="button"
                  onClick={() => onRecordPayment(bill)}
                  className="min-h-11 rounded-2xl bg-[#17666a] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#12575a]"
                >
                  Record payment
                </button>
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
  const [reloadToken, setReloadToken] = useState(0);
  const [paymentBill, setPaymentBill] = useState(null);
  const [paymentBusy, setPaymentBusy] = useState(false);

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
  }, [refreshKey, reloadToken]);

  async function recordPayment(payload) {
    if (!paymentBill || paymentBusy) return;
    setPaymentBusy(true);
    try {
      await api.patch(`/billing/${paymentBill.id}/pay`, payload);
      toast.success("Payment recorded in the transaction ledger.");
      setPaymentBill(null);
      setReloadToken((value) => value + 1);
    } catch (error) {
      toast.error(error.message || "Payment could not be recorded.");
    } finally {
      setPaymentBusy(false);
    }
  }

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
        className="rounded-2xl bg-[#2d8f98] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#23767f]"
        to="/patients"
      >
        Open patients
      </Link>
    </>
  );

  let metrics = [];
  let content = null;

  if (workspaceKey === "current-week-roster") {
    const availableDoctors = (data.doctorStatuses || []).filter(
      (doctor) => coverageStatus(doctor) === "available",
    );
    metrics = [
      {
        icon: CalendarClock,
        label: "Week visits",
        value: data.summary.currentWeekRosterCount,
        description: `${formatDate(data.periods.weekStart)} to ${formatDate(data.periods.weekEnd)}`,
        accent: "bg-[#2d8f98]",
      },
      {
        icon: ClipboardList,
        label: "Scheduled",
        value: data.currentWeekRoster.filter((appointment) => appointment.status === "scheduled").length,
        description: "Visits still on the live calendar this week.",
        accent: "bg-[#41c8c6]",
      },
      {
        icon: UsersRound,
        label: "Available now",
        value: availableDoctors.length,
        description: "Doctors currently free to accept an emergency visit.",
        accent: "bg-[#1a7f4b]",
      },
    ];

    content = (
      <div className="space-y-6">
        <SectionCard
          actions={sharedActions}
          subtitle="Who can take an emergency visit right now."
          title="Doctor coverage"
        >
          <CoverageDoctorRoster doctors={data.doctorStatuses || []} />
        </SectionCard>
        <SectionCard
          subtitle="Every scheduled visit this week, across the doctor team."
          title="This week's visits"
        >
          <AppointmentQueueList
            appointments={data.currentWeekRoster}
            emptyDescription="No visits are currently scheduled for this week."
            emptyTitle="No visits this week"
          />
        </SectionCard>
        <div className="flex justify-end">
          <Link
            className="rounded-2xl bg-[#2d8f98] px-4 py-2.5 text-sm font-semibold text-white"
            to="/visit-requests"
          >
            Open dispatch board
          </Link>
        </div>
      </div>
    );
  }

  if (workspaceKey === "monthly-roster") {
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
        <PendingPaymentsList bills={data.pendingPayments} onRecordPayment={setPaymentBill} />
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
      {paymentBill ? (
        <OperatorPaymentModal
          bill={paymentBill}
          busy={paymentBusy}
          onClose={() => !paymentBusy && setPaymentBill(null)}
          onConfirm={recordPayment}
        />
      ) : null}
    </div>
  );
}

export default OperatorWorkspacePage;
