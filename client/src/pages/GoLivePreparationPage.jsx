import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, DatabaseBackup } from "lucide-react";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import LoadingState from "../components/LoadingState.jsx";
import { api } from "../lib/api.js";
import { pageContainerClass } from "../lib/utils.js";

const CONFIRMATION = "RESET_TRIAL_BILLING_2026_10_02";

export default function GoLivePreparationPage() {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  async function loadPreview() {
    setLoading(true);
    try {
      setPreview(await api.get("/go-live-reset?format=json"));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPreview();
  }, []);

  async function runReset() {
    setRunning(true);
    try {
      const result = await api.post(
        `/go-live-reset/execute?confirmation=${CONFIRMATION}&format=json`,
        {},
      );
      toast.success("The go-live reset is complete.");
      setPreview((current) => ({ ...current, completed: true, result }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRunning(false);
    }
  }

  async function createBackup() {
    setBackingUp(true);
    try {
      await api.post("/go-live-reset/backup", {});
      toast.success("The verified backup is ready.");
      await loadPreview();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBackingUp(false);
    }
  }

  if (loading) return <LoadingState label="Checking opening balances…" />;
  if (!preview) return null;

  const counts = preview.counts || {};
  const rows = [
    ["Bills", counts.bills],
    ["Billing and finance records", counts.billing_and_finance_rows],
    ["Supply requests", counts.supply_requests],
    ["Stock movements", counts.stock_movements],
    ["Stock batches", counts.batches],
    ["Items currently holding stock", counts.stock_items_with_quantity],
  ];

  return (
    <div className={pageContainerClass}>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Go-live preparation"
        helper="Create the clean opening position for inventory and billing."
      />

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="flex items-start gap-4">
          {preview.completed ? (
            <CheckCircle2 className="mt-1 size-7 text-emerald-600" />
          ) : (
            <DatabaseBackup className="mt-1 size-7 text-teal-700" />
          )}
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {preview.completed ? "Opening balance reset completed" : "Reset preview"}
            </h2>
            <p className="mt-1 text-slate-600">
              Backup: <strong>{preview.backup_name}</strong> · Cutover: <strong>{preview.cutover_date}</strong>
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-slate-50 p-4">
              <div className="text-sm text-slate-600">{label}</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{Number(value || 0)}</div>
            </div>
          ))}
        </div>

        {!preview.completed && (
          <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-6 shrink-0 text-amber-700" />
              <div>
                <h3 className="font-semibold text-amber-950">Permanent production reset</h3>
                <p className="mt-1 text-sm leading-6 text-amber-900">
                  This first creates and verifies the backup. It then clears trial billing, finance,
                  supply requests, stock history, batches, cost prices and expiry dates, and sets all
                  warehouse and doctor-bag quantities to zero. Catalogue items, selling prices,
                  patients, visits, consultations and staff remain.
                </p>
              </div>
            </div>
            {!preview.backup_ready ? (
              <button
                type="button"
                disabled={backingUp}
                onClick={createBackup}
                className="mt-5 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-60"
              >
                {backingUp ? "Creating and verifying backup…" : "Create and verify backup"}
              </button>
            ) : (
              <>
                <p className="mt-4 font-semibold text-emerald-800">Verified backup ready.</p>
                <button
                  type="button"
                  disabled={running}
                  onClick={runReset}
                  className="mt-3 rounded-xl bg-red-700 px-5 py-3 font-semibold text-white disabled:opacity-60"
                >
                  {running ? "Resetting trial data…" : "Reset trial data"}
                </button>
              </>
            )}
          </div>
        )}

        {preview.completed && preview.result && (
          <p className="mt-6 rounded-2xl bg-emerald-50 p-4 text-emerald-900">
            Backup verified and saved. Database check: {preview.result.sqlite_quick_check}; foreign-key violations: {preview.result.foreign_key_violations}.
          </p>
        )}
      </section>
    </div>
  );
}
