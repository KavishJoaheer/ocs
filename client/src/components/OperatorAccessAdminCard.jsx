import { useEffect, useState } from "react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import { api } from "../lib/api.js";

function OperatorAccessAdminCard({ compact = false }) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState({ patients: [], operators: [], access: [] });
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState("");
  const [operatorUserId, setOperatorUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState(null);

  async function loadAccess() {
    const next = await api.get("/dashboard/operator-access");
    setPayload({
      patients: next?.patients || [],
      operators: next?.operators || [],
      access: next?.access || [],
    });
  }

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const next = await api.get("/dashboard/operator-access");
        if (!ignore) {
          setPayload({
            patients: next?.patients || [],
            operators: next?.operators || [],
            access: next?.access || [],
          });
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message || "Could not load operator access.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  async function handleGrant() {
    const nextPatientId = Number(patientId);
    const nextOperatorId = Number(operatorUserId);
    if (!Number.isInteger(nextPatientId) || nextPatientId <= 0) {
      toast.error("Select a patient.");
      return;
    }
    if (!Number.isInteger(nextOperatorId) || nextOperatorId <= 0) {
      toast.error("Select an operator.");
      return;
    }
    setSaving(true);
    try {
      const next = await api.post("/dashboard/operator-access", {
        patient_id: nextPatientId,
        operator_user_id: nextOperatorId,
      });
      setPayload({
        patients: next?.patients || payload.patients,
        operators: next?.operators || payload.operators,
        access: next?.access || [],
      });
      setPatientId("");
      setOperatorUserId("");
      toast.success("Operator access granted.");
    } catch (error) {
      toast.error(error.message || "Could not grant operator access.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(accessId) {
    setRevokingId(accessId);
    try {
      await api.delete(`/dashboard/operator-access/${accessId}`);
      await loadAccess();
      toast.success("Operator access revoked.");
    } catch (error) {
      toast.error(error.message || "Could not revoke operator access.");
    } finally {
      setRevokingId(null);
    }
  }

  const activeCount = payload.access.length;

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between gap-3 py-1 text-left"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800">Operator grants</p>
            <p className="text-xs text-slate-400">
              {loading ? "Loading…" : `${activeCount} active`}
            </p>
          </div>
          <span className="text-xs font-semibold text-ocs-teal">Manage</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-xl border border-[rgba(65,200,198,0.22)] bg-white px-4 py-3 text-left transition hover:border-ocs-teal"
        >
          <p className="text-3xl font-black leading-none text-gray-900 tabular-nums">
            {loading ? "—" : activeCount}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-500">Active time-boxed operator grants</p>
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Operator chart access"
        description="Operators can edit a patient chart only while a grant is active."
        size="md"
      >
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-ocs-teal"
            >
              <option value="">Select patient</option>
              {payload.patients.map((patient) => (
                <option key={patient.id} value={String(patient.id)}>
                  {patient.full_name}
                </option>
              ))}
            </select>
            <select
              value={operatorUserId}
              onChange={(event) => setOperatorUserId(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-ocs-teal"
            >
              <option value="">Select operator</option>
              {payload.operators.map((operator) => (
                <option key={operator.id} value={String(operator.id)}>
                  {operator.full_name || operator.username}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleGrant}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-2xl bg-ocs-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Granting…" : "Grant 24h"}
            </button>
          </div>
          <div className="space-y-2">
            {payload.access.length === 0 ? (
              <p className="text-sm text-slate-500">No active grants.</p>
            ) : (
              payload.access.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {row.operator_name || row.operator_username} · {row.patient_name}
                    </p>
                    <p className="text-xs text-slate-400">
                      Expires {row.expires_at ? dayjs(row.expires_at).format("D MMM YYYY, HH:mm") : "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevoke(row.id)}
                    disabled={revokingId === row.id}
                    className="text-sm font-semibold text-rose-600 disabled:opacity-50"
                  >
                    {revokingId === row.id ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

export default OperatorAccessAdminCard;
