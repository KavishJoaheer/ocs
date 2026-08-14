import { useState } from "react";
import { Upload } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { ApiError, api } from "../lib/api.js";

const SAMPLE = `folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date
Consumable,Gauze 10x10,20,5,pack,12,20,2027-01-01`;

function InventoryCsvImport({ onImported }) {
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function handleImport() {
    if (importing) return;
    setImporting(true);
    try {
      const payload = await api.post("/inventory/staging/import-csv", { csv_text: csvText });
      const summary = payload.import_summary || {
        imported: 0,
        skipped: 0,
        skipped_rows: [],
      };
      setLastResult(summary);
      setCsvText("");
      const skipBit = summary.skipped ? `, ${summary.skipped} skipped` : "";
      toast.success(`${summary.imported} imported${skipBit}.`);
      await onImported?.();
    } catch (error) {
      const summary = error instanceof ApiError ? error.data?.import_summary || error.data : null;
      if (summary?.skipped_rows?.length) {
        setLastResult({
          imported: Number(summary.imported || 0),
          skipped: Number(summary.skipped || summary.skipped_rows.length),
          skipped_rows: summary.skipped_rows,
        });
      }
      toast.error(error.message || "Could not import this CSV.");
    } finally {
      setImporting(false);
    }
  }

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(file);
    event.target.value = "";
  }

  return (
    <SectionCard
      title="Import CSV shipment"
      subtitle="Rows land in Incoming shipments until you release them into OCS stock."
    >
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#2d8f98]">
        <Upload className="size-4" />
        Choose CSV file
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      </label>
      <textarea
        value={csvText}
        onChange={(event) => setCsvText(event.target.value)}
        rows={5}
        placeholder={SAMPLE}
        className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700"
      />
      <p className="mt-2 text-xs text-slate-500">
        Required headers: folder, item_name, quantity, minimum_quantity, unit, cost_price, selling_price, expiry_date
      </p>
      <button
        type="button"
        disabled={importing || !csvText.trim()}
        onClick={handleImport}
        className="mt-3 rounded-xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {importing ? "Importing…" : "Import to staging"}
      </button>
      {lastResult ? (
        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">
            {lastResult.imported} imported
            {lastResult.skipped ? `, ${lastResult.skipped} skipped` : ""}
          </p>
          {lastResult.skipped_rows?.length ? (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {lastResult.skipped_rows.map((row) => (
                <li key={`${row.line}-${row.reason}`}>
                  Line {row.line}: {row.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

export default InventoryCsvImport;
