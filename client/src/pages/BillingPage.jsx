import { useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  DollarSign,
  Plus,
  ReceiptText,
  SquarePen,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import {
  formatCurrency,
  formatDate,
  formatPaymentMethod,
} from "../lib/format.js";

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "juice", label: "Juice" },
  { value: "card", label: "Card" },
  { value: "ib", label: "IB" },
];

function createEmptyLineItem() {
  return { description: "", amount: "0" };
}

function BillingStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
      <div className="flex items-center gap-4">
        <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
        </div>
      </div>
    </div>
  );
}

function BillingItemsEditor({ items, setItems }) {
  function updateItem(index, key, value) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <input
            required
            value={item.description}
            onChange={(event) => updateItem(index, "description", event.target.value)}
            placeholder="Description"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
          />
          <input
            required
            min="0"
            step="0.01"
            type="number"
            value={item.amount}
            onChange={(event) => updateItem(index, "amount", event.target.value)}
            placeholder="Amount"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
          />
          <button
            type="button"
            onClick={() =>
              setItems((current) =>
                current.length > 1
                  ? current.filter((_, itemIndex) => itemIndex !== index)
                  : current,
              )
            }
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setItems((current) => [...current, createEmptyLineItem()])}
        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
      >
        Add line item
      </button>
    </div>
  );
}

function BillingStatusFields({
  status,
  setStatus,
  paymentMethod,
  setPaymentMethod,
  paymentDate,
  setPaymentDate,
  total,
}) {
  function handleStatusChange(nextStatus) {
    setStatus(nextStatus);

    if (nextStatus !== "paid") {
      setPaymentMethod("");
      setPaymentDate("");
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <label className="space-y-2">
        <span className="text-sm font-semibold text-slate-700">Status</span>
        <select
          value={status}
          onChange={(event) => handleStatusChange(event.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
        >
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
        </select>
      </label>

      <label className="space-y-2">
        <span className="text-sm font-semibold text-slate-700">Pay by</span>
        <select
          disabled={status !== "paid"}
          value={paymentMethod}
          onChange={(event) => setPaymentMethod(event.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100"
        >
          <option value="">Select method</option>
          {PAYMENT_METHOD_OPTIONS.map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-2">
        <span className="text-sm font-semibold text-slate-700">Payment date</span>
        <input
          type="date"
          disabled={status !== "paid"}
          value={paymentDate}
          onChange={(event) => setPaymentDate(event.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100"
        />
      </label>

      <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          Total
        </p>
        <p className="mt-2 text-2xl font-bold text-slate-950">{formatCurrency(total)}</p>
      </div>
    </div>
  );
}

function EditBillingModal({ open, bill, onClose, onSubmit, isSaving }) {
  const [status, setStatus] = useState("unpaid");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [items, setItems] = useState([createEmptyLineItem()]);

  useEffect(() => {
    if (!open || !bill) {
      return;
    }

    setStatus(bill.status);
    setPaymentMethod(bill.payment_method || "");
    setPaymentDate(bill.payment_date || "");
    setItems(
      bill.items.length
        ? bill.items.map((item) => ({
            description: item.description,
            amount: String(item.amount),
          }))
        : [createEmptyLineItem()],
    );
  }, [open, bill]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [items],
  );

  function handleSubmit(event) {
    event.preventDefault();

    if (status === "paid" && !paymentMethod) {
      toast.error("Select how the payment was made.");
      return;
    }

    onSubmit({
      items: items.map((item) => ({
        description: item.description,
        amount: Number(item.amount || 0),
      })),
      status,
      payment_method: status === "paid" ? paymentMethod : null,
      payment_date: status === "paid" ? paymentDate || null : null,
    });
  }

  if (!bill) {
    return null;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit bill #${bill.id}`}
      description="Update line items, payment status, payment method, and payment date for this billing entry."
      size="xl"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="rounded-[26px] border border-sky-100 bg-sky-50/70 p-4">
          <p className="text-lg font-semibold text-slate-950">{bill.patient_name}</p>
          <p className="mt-1 text-sm text-slate-600">
            {bill.doctor_name} - {formatDate(bill.consultation_date)}
          </p>
        </div>

        <BillingItemsEditor items={items} setItems={setItems} />

        <BillingStatusFields
          status={status}
          setStatus={setStatus}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          paymentDate={paymentDate}
          setPaymentDate={setPaymentDate}
          total={total}
        />

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Update bill"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateBillingModal({
  open,
  onClose,
  onSubmit,
  isSaving,
  patients,
  consultations,
  preselectedPatientId,
}) {
  const [patientId, setPatientId] = useState("");
  const [consultationId, setConsultationId] = useState("");
  const [status, setStatus] = useState("unpaid");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [items, setItems] = useState([createEmptyLineItem()]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setPatientId(preselectedPatientId || "");
    setConsultationId("");
    setStatus("unpaid");
    setPaymentMethod("");
    setPaymentDate("");
    setItems([createEmptyLineItem()]);
  }, [open, preselectedPatientId]);

  const patientConsultations = useMemo(
    () =>
      consultations.filter(
        (consultation) => Number(consultation.patient_id) === Number(patientId || 0),
      ),
    [consultations, patientId],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!patientConsultations.length) {
      setConsultationId("");
      return;
    }

    if (!patientConsultations.some((consultation) => consultation.id === Number(consultationId))) {
      setConsultationId(String(patientConsultations[0].id));
    }
  }, [consultationId, open, patientConsultations]);

  const selectedConsultation =
    patientConsultations.find((consultation) => consultation.id === Number(consultationId)) || null;

  const total = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [items],
  );

  function handleSubmit(event) {
    event.preventDefault();

    if (!patientId) {
      toast.error("Select a patient.");
      return;
    }

    if (!consultationId) {
      toast.error("Select a consultation.");
      return;
    }

    if (status === "paid" && !paymentMethod) {
      toast.error("Select how the payment was made.");
      return;
    }

    onSubmit({
      patient_id: Number(patientId),
      consultation_id: Number(consultationId),
      items: items.map((item) => ({
        description: item.description,
        amount: Number(item.amount || 0),
      })),
      status,
      payment_method: status === "paid" ? paymentMethod : null,
      payment_date: status === "paid" ? paymentDate || null : null,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add billing entry"
      description="Create another bill for a patient by selecting the linked consultation and line items."
      size="xl"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Patient</span>
            <select
              required
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            >
              <option value="">Select patient</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.full_name} - {patient.patient_identifier || patient.patient_id_number}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Consultation</span>
            <select
              required
              disabled={!patientId || !patientConsultations.length}
              value={consultationId}
              onChange={(event) => setConsultationId(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              <option value="">
                {!patientId
                  ? "Select a patient first"
                  : patientConsultations.length
                    ? "Select consultation"
                    : "No consultations available"}
              </option>
              {patientConsultations.map((consultation) => (
                <option key={consultation.id} value={consultation.id}>
                  {formatDate(consultation.consultation_date)} - {consultation.doctor_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedConsultation ? (
          <div className="rounded-[26px] border border-sky-100 bg-sky-50/70 p-4">
            <p className="text-lg font-semibold text-slate-950">
              {selectedConsultation.patient_name}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {selectedConsultation.doctor_name} - {formatDate(selectedConsultation.consultation_date)}
            </p>
          </div>
        ) : null}

        <BillingItemsEditor items={items} setItems={setItems} />

        <BillingStatusFields
          status={status}
          setStatus={setStatus}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          paymentDate={paymentDate}
          setPaymentDate={setPaymentDate}
          total={total}
        />

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Create bill"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BillingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const patientIdFilter = searchParams.get("patientId") || "";
  const [statusFilter, setStatusFilter] = useState("");
  const [bills, setBills] = useState([]);
  const [patientSummary, setPatientSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [patientOptions, setPatientOptions] = useState([]);
  const [consultationOptions, setConsultationOptions] = useState([]);
  const canCreateBills = user.role === "admin" || user.role === "doctor";

  async function loadData() {
    try {
      const filterQuery = new URLSearchParams();

      if (statusFilter) {
        filterQuery.set("status", statusFilter);
      }

      if (patientIdFilter) {
        filterQuery.set("patientId", patientIdFilter);
      }

      const queryString = filterQuery.toString();
      const [billingData, summaryData] = await Promise.all([
        api.get(`/billing${queryString ? `?${queryString}` : ""}`),
        api.get("/billing/patient-summary"),
      ]);

      setBills(billingData);
      setPatientSummary(summaryData);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadReferenceData() {
    if (!canCreateBills) {
      return;
    }

    try {
      const [patients, consultations] = await Promise.all([
        api.get("/patients/options"),
        api.get("/consultations"),
      ]);

      setPatientOptions(patients);
      setConsultationOptions(consultations);
    } catch (error) {
      toast.error(error.message);
    }
  }

  useEffect(() => {
    loadData();
  }, [statusFilter, patientIdFilter]);

  useEffect(() => {
    loadReferenceData();
  }, [canCreateBills]);

  const overallPaid = patientSummary.reduce(
    (sum, patient) => sum + Number(patient.paid_amount || 0),
    0,
  );
  const overallUnpaid = patientSummary.reduce(
    (sum, patient) => sum + Number(patient.unpaid_amount || 0),
    0,
  );
  const overallBilled = patientSummary.reduce(
    (sum, patient) => sum + Number(patient.total_billed || 0),
    0,
  );

  async function handleSave(payload) {
    if (!editor?.bill) {
      return;
    }

    setIsSaving(true);

    try {
      await api.put(`/billing/${editor.bill.id}`, payload);
      toast.success("Bill updated.");
      setEditor(null);
      await loadData();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreate(payload) {
    setIsSaving(true);

    try {
      await api.post("/billing", payload);
      toast.success("Billing entry created.");
      setCreatorOpen(false);
      await loadData();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  function clearPatientFilter() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("patientId");
    setSearchParams(nextParams);
  }

  if (loading) {
    return <LoadingState label="Loading billing" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Revenue"
        title="Billing"
        description={
          user.role === "doctor"
            ? "Review consultation-linked billing, update payment status, and add new billing entries for your patients."
            : "Track every billing entry, maintain line items, and monitor which patients still have balances outstanding."
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <BillingStat icon={DollarSign} label="Total billed" value={formatCurrency(overallBilled)} />
        <BillingStat icon={CreditCard} label="Collected" value={formatCurrency(overallPaid)} />
        <BillingStat
          icon={ReceiptText}
          label="Outstanding"
          value={formatCurrency(overallUnpaid)}
        />
      </div>

      {patientIdFilter ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-sky-100 bg-sky-50/80 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Patient billing filter active</p>
            <p className="mt-1 text-sm text-slate-600">
              Showing bills only for the selected patient.
            </p>
          </div>
          <button
            type="button"
            onClick={clearPatientFilter}
            className="rounded-2xl border border-sky-200 px-4 py-2.5 text-sm font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100"
          >
            Clear patient filter
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard
          title="Bills"
          subtitle="Review line items, payment status, and each consultation-linked billing entry."
          actions={
            <div className="flex flex-wrap gap-2">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 outline-none transition focus:border-sky-400 focus:bg-white"
              >
                <option value="">All bills</option>
                <option value="unpaid">Unpaid only</option>
                <option value="paid">Paid only</option>
              </select>

              {canCreateBills ? (
                <button
                  type="button"
                  onClick={() => setCreatorOpen(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
                >
                  <Plus className="size-4" />
                  Add bill
                </button>
              ) : null}
            </div>
          }
        >
          {bills.length ? (
            <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white text-left">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                    <tr>
                      <th className="px-5 py-4">Patient</th>
                      <th className="px-5 py-4">Consultation</th>
                      <th className="px-5 py-4">Total</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4">Pay by</th>
                      <th className="px-5 py-4">Payment date</th>
                      <th className="px-5 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((bill) => (
                      <tr key={bill.id} className="border-t border-slate-200/70">
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-950">{bill.patient_name}</p>
                          <p className="mt-1 text-sm text-slate-500">{bill.doctor_name}</p>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          <p>{formatDate(bill.consultation_date)}</p>
                          <p className="mt-1 text-slate-500">
                            Bill #{bill.id} - {bill.items.length} line item
                            {bill.items.length === 1 ? "" : "s"}
                          </p>
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-950">
                          {formatCurrency(bill.total_amount)}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge value={bill.status} />
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {formatPaymentMethod(bill.payment_method)}
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {bill.payment_date ? formatDate(bill.payment_date) : "Not paid yet"}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditor({ bill })}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                            >
                              <SquarePen className="size-4" />
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No bills found"
              description="Bills are created from consultations, and admin or doctor accounts can add more billing entries here when needed."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Per-patient summary"
          subtitle="Balances and collections grouped by patient across all billing entries."
        >
          {patientSummary.length ? (
            <div className="space-y-3">
              {patientSummary.map((patient) => (
                <div
                  key={patient.patient_id}
                  className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{patient.patient_name}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {patient.bill_count} bill{patient.bill_count === 1 ? "" : "s"} total
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-slate-950">
                        {formatCurrency(patient.total_billed)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Paid {formatCurrency(patient.paid_amount)} - Due{" "}
                        {formatCurrency(patient.unpaid_amount)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No billing summary available"
              description="Patient billing totals will appear here once consultations generate bills."
            />
          )}
        </SectionCard>
      </div>

      <EditBillingModal
        open={Boolean(editor)}
        bill={editor?.bill}
        onClose={() => setEditor(null)}
        onSubmit={handleSave}
        isSaving={isSaving}
      />

      <CreateBillingModal
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        onSubmit={handleCreate}
        isSaving={isSaving}
        patients={patientOptions}
        consultations={consultationOptions}
        preselectedPatientId={patientIdFilter}
      />
    </div>
  );
}

export default BillingPage;
