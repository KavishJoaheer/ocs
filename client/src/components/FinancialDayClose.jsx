import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";

const METHODS = [
  { id: "juice", label: "Juice" },
  { id: "card", label: "Card" },
  { id: "ib", label: "IB / bank" },
];

function todayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function money(value) {
  return `Rs ${Number(value || 0).toLocaleString("en-MU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function FinancialDayClose({ refreshToken, initialDate }) {
  const [date, setDate] = useState(() => initialDate || todayInputValue());
  const [data, setData] = useState(null);
  const [countedCash, setCountedCash] = useState("0");
  const [settlements, setSettlements] = useState(() => Object.fromEntries(
    METHODS.map(({ id }) => [id, { amount: "0", reference: "" }]),
  ));
  const [notes, setNotes] = useState("");
  const [outstanding, setOutstanding] = useState({ count: 0, dates: [] });
  const [busy, setBusy] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correction, setCorrection] = useState(() => ({
    cash_delta: "0",
    reason: "",
    settlements: Object.fromEntries(METHODS.map(({ id }) => [id, { delta: "0", reference: "" }])),
  }));

  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);

  const load = useCallback(async () => {
    const payload = await api.get(`/billing/day-close?date=${encodeURIComponent(date)}`);
    setData(payload);
    if (!payload.closing) {
      setCountedCash(String(Number(payload.expected_totals?.cash?.expected || 0).toFixed(2)));
      setSettlements(Object.fromEntries(METHODS.map(({ id }) => [id, {
        amount: String(Number(payload.expected_totals?.[id]?.expected || 0).toFixed(2)),
        reference: "",
      }])));
      setNotes("");
    }
  }, [date]);

  const loadOutstanding = useCallback(async () => {
    const payload = await api.get("/billing/day-close/outstanding");
    setOutstanding({
      count: Number(payload?.count || 0),
      dates: Array.isArray(payload?.dates) ? payload.dates : [],
    });
  }, []);

  useEffect(() => {
    load().catch((error) => toast.error(error.message || "Could not load day closing."));
    loadOutstanding().catch((error) => toast.error(error.message || "Could not load overdue day-close reminders."));
  }, [load, loadOutstanding, refreshToken]);

  const expected = useMemo(() => data?.expected_totals || {}, [data?.expected_totals]);
  const variance = useMemo(() => {
    const cash = Number(countedCash || 0) - Number(expected.cash?.expected || 0);
    const providers = METHODS.reduce(
      (sum, { id }) => sum + Number(settlements[id]?.amount || 0) - Number(expected[id]?.expected || 0),
      0,
    );
    return Number((cash + providers).toFixed(2));
  }, [countedCash, expected, settlements]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    const key = `ocs-day-close:${date}`;
    const operationId = sessionStorage.getItem(key) || crypto.randomUUID();
    sessionStorage.setItem(key, operationId);
    try {
      await api.post("/billing/day-close", {
        business_date: date,
        counted_cash: Number(countedCash || 0),
        settlements: Object.fromEntries(METHODS.map(({ id }) => [id, {
          amount: Number(settlements[id]?.amount || 0),
          reference: String(settlements[id]?.reference || "").trim(),
        }])),
        notes: notes.trim(),
        operation_id: operationId,
      });
      sessionStorage.removeItem(key);
      toast.success("Day closing recorded and locked.");
      await Promise.all([load(), loadOutstanding()]);
    } catch (error) {
      toast.error(error.message || "Could not record day closing.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrection(event) {
    event.preventDefault();
    if (!data?.closing?.id) return;
    setBusy(true);
    const operationId = crypto.randomUUID();
    try {
      await api.post(`/billing/day-close/${data.closing.id}/adjustments`, {
        cash_delta: Number(correction.cash_delta || 0),
        settlement_deltas: Object.fromEntries(METHODS.map(({ id }) => [id, Number(correction.settlements[id]?.delta || 0)])),
        settlement_references: Object.fromEntries(METHODS.map(({ id }) => [id, String(correction.settlements[id]?.reference || "").trim()])),
        reason: correction.reason.trim(),
        operation_id: operationId,
      });
      toast.success("Compensating day-close adjustment recorded.");
      setShowCorrection(false);
      setCorrection({ cash_delta: "0", reason: "", settlements: Object.fromEntries(METHODS.map(({ id }) => [id, { delta: "0", reference: "" }])) });
      await load();
    } catch (error) {
      toast.error(error.message || "Could not record the day-close correction.");
    } finally {
      setBusy(false);
    }
  }

  const closing = data?.closing;
  return (
    <details className="rounded-[24px] border border-slate-200 bg-white" open={!closing}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="font-bold text-slate-950">Daily settlement close</p>
          <p className="mt-1 text-sm text-slate-500">Finance must match cash and provider settlements after the final collection each business day.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${closing ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {closing ? "Closed" : "Open"}
        </span>
      </summary>
      <div className="border-t border-slate-100 p-5">
        {outstanding.count ? (
          <div role="alert" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold">{outstanding.count} overdue day close{outstanding.count === 1 ? "" : "s"} require attention</p>
            <p className="mt-1">Financial activity exists on these dates, but no locked daily settlement has been recorded.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {outstanding.dates.map((entry) => (
                <button
                  key={entry.business_date}
                  type="button"
                  onClick={() => setDate(entry.business_date)}
                  className="min-h-11 rounded-xl border border-amber-300 bg-white px-3 font-bold"
                >
                  {entry.business_date} · {money(entry.expected_total)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <label className="block max-w-xs text-sm font-semibold text-slate-700">
          Business date
          <input type="date" max={todayInputValue()} value={date} onChange={(event) => setDate(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3" />
        </label>

        {closing ? (
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">Expected cash</p><p className="mt-1 font-black">{money(closing.expected_totals?.cash?.expected)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">Effective counted cash</p><p className="mt-1 font-black">{money(closing.effective_counted_cash ?? closing.counted_cash)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">Effective variance</p><p className={`mt-1 font-black ${Math.abs(Number(closing.effective_variance_total ?? closing.variance_total ?? 0)) >= 0.005 ? "text-rose-700" : "text-emerald-700"}`}>{money(closing.effective_variance_total ?? closing.variance_total)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">Closed by</p><p className="mt-1 font-black">{closing.closed_by_name || "Finance"}</p></div>
            {closing.settlements?.map((entry) => (
              <div key={entry.payment_method} className="rounded-2xl border border-slate-100 p-4 md:col-span-1">
                <p className="text-xs font-bold uppercase text-slate-500">{entry.payment_method}</p>
                <p className="mt-1 font-bold">{money(closing.effective_settlement_totals?.[entry.payment_method] ?? entry.settled_amount)}</p>
                <p className="mt-1 break-all text-xs text-slate-500">{entry.external_reference || "No settlement due"}</p>
              </div>
            ))}
            {closing.notes ? <p className="text-sm text-slate-600 md:col-span-4">{closing.notes}</p> : null}
            {closing.adjustments?.length ? <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm md:col-span-4"><p className="font-bold text-amber-950">Compensating adjustments</p>{closing.adjustments.map((entry) => <div key={entry.id} className="border-t border-amber-200 pt-2 text-amber-950"><p className="font-semibold">{entry.adjusted_by_name || "Finance"} · {entry.created_at}</p><p>{entry.reason}</p><p className="text-xs">Cash {money(entry.cash_delta)} · Juice {money(entry.settlement_deltas?.juice)} · Card {money(entry.settlement_deltas?.card)} · IB {money(entry.settlement_deltas?.ib)}</p></div>)}</div> : null}
            <div className="md:col-span-4">
              {!showCorrection ? <button type="button" onClick={() => setShowCorrection(true)} className="min-h-11 rounded-xl border border-amber-300 px-4 text-sm font-bold text-amber-900">Add audited correction</button> : (
                <form onSubmit={submitCorrection} className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="font-bold text-amber-950">Compensating adjustment</p>
                  <div className="grid gap-3 md:grid-cols-4">
                    <label className="text-sm font-semibold">Cash change<input required type="number" step="0.01" value={correction.cash_delta} onChange={(event) => setCorrection((current) => ({ ...current, cash_delta: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-amber-200 bg-white px-3" /></label>
                    {METHODS.map(({ id, label }) => <div key={id}><label className="text-sm font-semibold">{label} change<input required type="number" step="0.01" value={correction.settlements[id]?.delta || "0"} onChange={(event) => setCorrection((current) => ({ ...current, settlements: { ...current.settlements, [id]: { ...current.settlements[id], delta: event.target.value } } }))} className="mt-1 min-h-11 w-full rounded-xl border border-amber-200 bg-white px-3" /></label><input aria-label={`${label} corrected reference`} value={correction.settlements[id]?.reference || ""} onChange={(event) => setCorrection((current) => ({ ...current, settlements: { ...current.settlements, [id]: { ...current.settlements[id], reference: event.target.value } } }))} placeholder="Corrected reference" className="mt-2 min-h-11 w-full rounded-xl border border-amber-200 bg-white px-3 text-sm" /></div>)}
                  </div>
                  <label className="block text-sm font-semibold">Reason<textarea required minLength={8} rows={2} value={correction.reason} onChange={(event) => setCorrection((current) => ({ ...current, reason: event.target.value }))} className="mt-1 w-full rounded-xl border border-amber-200 bg-white p-3" placeholder="Explain what was wrong and why this correction is required." /></label>
                  <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setShowCorrection(false)} className="min-h-11 rounded-xl border px-4">Cancel</button><button disabled={busy || correction.reason.trim().length < 8} className="min-h-11 rounded-xl bg-amber-800 px-4 font-bold text-white disabled:opacity-50">{busy ? "Recording…" : "Record immutable adjustment"}</button></div>
                </form>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <label className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                Cash counted
                <span className="mt-1 block text-xs font-medium text-slate-500">Expected {money(expected.cash?.expected)}</span>
                <input required type="number" min="0" step="0.01" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3" />
              </label>
              {METHODS.map(({ id, label }) => (
                <div key={id} className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-700">{label} settled</p>
                  <p className="mt-1 text-xs text-slate-500">Expected {money(expected[id]?.expected)}</p>
                  <input required aria-label={`${label} settled amount`} type="number" step="0.01" value={settlements[id]?.amount || ""} onChange={(event) => setSettlements((current) => ({ ...current, [id]: { ...current[id], amount: event.target.value } }))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3" />
                  <input aria-label={`${label} settlement reference`} value={settlements[id]?.reference || ""} onChange={(event) => setSettlements((current) => ({ ...current, [id]: { ...current[id], reference: event.target.value } }))} placeholder="Settlement reference" className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" />
                </div>
              ))}
            </div>
            <label className="block text-sm font-semibold text-slate-700">
              Variance explanation {Math.abs(variance) >= 0.005 ? "(required)" : "(optional)"}
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} minLength={Math.abs(variance) >= 0.005 ? 8 : undefined} rows={2} className="mt-2 w-full rounded-xl border border-slate-200 p-3" placeholder="Document shortages, overages, reversals, or delayed provider settlement." />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className={`text-sm font-bold ${Math.abs(variance) >= 0.005 ? "text-rose-700" : "text-emerald-700"}`}>Calculated variance: {money(variance)}</p>
              <button disabled={busy} className="min-h-11 rounded-xl bg-[#17666a] px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? "Closing…" : "Confirm and lock day"}</button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

export default FinancialDayClose;
