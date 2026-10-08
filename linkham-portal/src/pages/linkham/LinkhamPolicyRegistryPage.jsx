import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Pencil, Plus, ShieldAlert, X } from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "../../components/EmptyState.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { api } from "../../lib/api.js";

const EMPTY_FORM = {
  policy_number: "",
  national_id: "",
  holder_name: "",
  coverage_status: "green",
  status_reason: "",
};

function statusClasses(status) {
  return status === "green"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-red-200 bg-red-50 text-red-800";
}

export default function LinkhamPolicyRegistryPage() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  async function loadPolicies() {
    setLoading(true);
    try {
      const data = await api.get("/linkham/policies");
      setPolicies(Array.isArray(data?.policies) ? data.policies : []);
    } catch (error) {
      toast.error(error.message || "Could not load the policy registry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPolicies();
  }, []);

  const visiblePolicies = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return policies.filter((policy) => {
      if (statusFilter !== "all" && policy.coverage_status !== statusFilter) return false;
      if (!needle) return true;
      return [policy.policy_number, policy.national_id, policy.holder_name]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(needle));
    });
  }, [policies, search, statusFilter]);

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function startEdit(policy) {
    setEditingId(policy.id);
    setForm({
      policy_number: policy.policy_number || "",
      national_id: policy.national_id || "",
      holder_name: policy.holder_name || "",
      coverage_status: policy.coverage_status || "green",
      status_reason: policy.status_reason || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/linkham/policies/${editingId}`, form);
        toast.success("Policy updated.");
      } else {
        await api.post("/linkham/policies", form);
        toast.success("Policy added to the registry.");
      }
      resetForm();
      await loadPolicies();
    } catch (error) {
      toast.error(error.message || "Could not save this policy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Linkham insurer portal"
        title="Policy registry"
        description="Maintain the policy number, Mauritius ID and OCS eligibility flag used by operators during patient registration."
      />

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-gray-900">
              {editingId ? "Edit policy" : "Add insured policy"}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Operators must enter the same policy and Mauritius ID combination to receive a green result.
            </p>
          </div>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
              aria-label="Cancel editing"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1.5">
            <span className="text-xs font-bold text-gray-600">Policy number *</span>
            <input
              required
              value={form.policy_number}
              onChange={(event) => setForm((current) => ({ ...current, policy_number: event.target.value }))}
              placeholder="e.g. 12345"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold uppercase outline-none focus:border-[#065a60] focus:bg-white"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-bold text-gray-600">Mauritius ID number *</span>
            <input
              required
              minLength={14}
              maxLength={14}
              value={form.national_id}
              onChange={(event) => setForm((current) => ({ ...current, national_id: event.target.value }))}
              placeholder="J0605914619061"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 font-mono text-sm font-semibold uppercase outline-none focus:border-[#065a60] focus:bg-white"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-bold text-gray-600">Policy-holder name</span>
            <input
              value={form.holder_name}
              onChange={(event) => setForm((current) => ({ ...current, holder_name: event.target.value }))}
              placeholder="Optional when not yet in OCS"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#065a60] focus:bg-white"
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-gray-600">OCS eligibility *</span>
            <div className="grid grid-cols-2 gap-2">
              {["green", "red"].map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, coverage_status: status }))}
                  className={`rounded-xl border px-3 py-2.5 text-xs font-extrabold capitalize transition ${
                    form.coverage_status === status
                      ? statusClasses(status)
                      : "border-gray-200 bg-white text-gray-500"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
          <label className="space-y-1.5 md:col-span-2 xl:col-span-3">
            <span className="text-xs font-bold text-gray-600">Status note</span>
            <input
              value={form.status_reason}
              onChange={(event) => setForm((current) => ({ ...current, status_reason: event.target.value }))}
              placeholder={form.coverage_status === "red" ? "Reason the policy holder is not eligible" : "Optional coverage note"}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium outline-none focus:border-[#065a60] focus:bg-white"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-2 self-end rounded-xl bg-[#065a60] px-4 py-2.5 text-sm font-extrabold text-white shadow-sm disabled:opacity-60"
          >
            {editingId ? <Pencil className="size-4" /> : <Plus className="size-4" />}
            {saving ? "Saving…" : editingId ? "Save changes" : "Add policy"}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search policy, Mauritius ID, or holder"
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium md:max-w-md"
        />
        <div className="flex gap-2">
          {["all", "green", "red"].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-xl border px-3 py-2 text-xs font-extrabold capitalize ${
                statusFilter === status
                  ? status === "all"
                    ? "border-[#065a60] bg-[#065a60]/5 text-[#065a60]"
                    : statusClasses(status)
                  : "border-gray-200 bg-white text-gray-500"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading policy registry" />
      ) : visiblePolicies.length ? (
        <div className="grid gap-3">
          {visiblePolicies.map((policy) => {
            const StatusIcon = policy.coverage_status === "green" ? CheckCircle2 : ShieldAlert;
            return (
              <article
                key={policy.id}
                className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between"
              >
                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Policy number</p>
                    <p className="mt-1 font-mono text-sm font-black text-gray-900">{policy.policy_number}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Mauritius ID</p>
                    <p className="mt-1 font-mono text-sm font-bold text-gray-800">{policy.national_id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Policy holder</p>
                    <p className="mt-1 truncate text-sm font-bold text-gray-800">{policy.holder_name || "Not recorded"}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 md:justify-end">
                  <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${statusClasses(policy.coverage_status)}`}>
                    <StatusIcon className="size-4" />
                    <div>
                      <p className="text-xs font-extrabold capitalize">{policy.coverage_status} flag</p>
                      {policy.status_reason ? <p className="max-w-52 text-[10px] font-medium">{policy.status_reason}</p> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEdit(policy)}
                    className="rounded-xl border border-gray-200 p-2.5 text-gray-600 hover:border-[#065a60] hover:text-[#065a60]"
                    aria-label={`Edit policy ${policy.policy_number}`}
                  >
                    <Pencil className="size-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No policies found"
          description="Add the first policy or change the current search and status filters."
        />
      )}
    </div>
  );
}
