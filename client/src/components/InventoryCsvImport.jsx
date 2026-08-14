import { useState } from "react";
import { Upload } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { api } from "../lib/api.js";

const SAMPLE = `folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date
Consumable,Gauze 10x10,20,5,pack,12,20,2027-01-01`;

function InventoryCsvImport({ onImported }) {
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);

  async function handleImport() {
    if (importing) return;
    setImporting(true);
    try {
      await api.post("/inventory/staging/import-csv", { csv_text: csvText });
      setCsvText("");
      toast.success("Shipment imported to staging.");
      await onImported?.();
    } catch (error) {
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
        className="mt-3 rounded-xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {importing ? "Importing…" : "Import to staging"}
      </button>
    </SectionCard>
  );
}

export default InventoryCsvImport;
