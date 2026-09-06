import { useEffect, useState } from "react";
import { Download, Upload } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { ApiError, api } from "../lib/api.js";
import { formatRupees } from "../lib/format.js";
import { requiresOperationalOverride, withOperationalOverride } from "../lib/inventoryAccess.js";
import OperationalOverrideFields from "./inventory/OperationalOverrideFields.jsx";
import { setUnsavedWork } from "../lib/unsavedWork.js";

function InventoryCsvImport({ onImported }) {
  const { user } = useAuth();
  const [csvText, setCsvText] = useState("");
  const [supplier, setSupplier] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    setUnsavedWork("shipment-import", Boolean(csvText.trim() || preview));
    return () => setUnsavedWork("shipment-import", false);
  }, [csvText, preview]);

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ""));
      setPreview(null);
    };
    reader.readAsText(file);
  }

  async function downloadTemplate() {
    try {
      const { blob, filename } = await api.getBlob("/inventory/staging/csv-template");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "ocs-shipment-template.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.message || "Could not download the CSV template.");
    }
  }

  async function handlePreview() {
    if (!csvText.trim() || previewing) return;
    setPreviewing(true);
    try {
      const payload = await api.post("/inventory/staging/preview-csv", {
        csv_text: csvText,
        supplier,
        delivery_note: deliveryNote,
      });
      setPreview(payload);
    } catch (error) {
      toast.error(error.message || "Could not validate this CSV.");
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (importing) return;
    if (requiresOperationalOverride(user) && String(overrideReason).trim().length < 10) {
      toast.error("Administrators must enter an operational override reason.");
      return;
    }
    setImporting(true);
    try {
      const payload = await api.post(
        "/inventory/staging/import-csv",
        withOperationalOverride(
          user,
          {
            csv_text: csvText,
            supplier,
            delivery_note: deliveryNote,
          },
          overrideReason,
        ),
      );
      const summary = payload.import_summary || {
        imported: 0,
        skipped: 0,
        skipped_rows: [],
      };
      setLastResult(summary);
      setCsvText("");
      setPreview(null);
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

  const summary = preview?.preview || preview?.summary;

  return (
    <SectionCard
      title="Import CSV shipment"
      subtitle="Validate the file, then import into Incoming shipments. Release posts warehouse stock."
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={downloadTemplate}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"
        >
          <Download className="size-4" />
          Download CSV template
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          Supplier
          <input
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
            className="w-full min-h-11 rounded-xl border border-slate-200 px-3 py-2 font-normal"
          />
        </label>
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          Delivery note
          <input
            value={deliveryNote}
            onChange={(event) => setDeliveryNote(event.target.value)}
            className="w-full min-h-11 rounded-xl border border-slate-200 px-3 py-2 font-normal"
          />
        </label>
      </div>

      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          readFile(event.dataTransfer.files?.[0]);
        }}
        className={`mt-3 flex min-h-[8rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center text-sm font-semibold ${
          dragActive ? "border-[#2d8f98] bg-[#ecf8f7] text-[#2d8f98]" : "border-slate-200 text-[#2d8f98]"
        }`}
      >
        <Upload className="size-5" />
        Drop a CSV here or choose a file
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            readFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>

      <p className="mt-2 text-xs text-slate-500">
        Supported columns include folder, item name, quantity, minimum quantity, unit, cost, selling price, expiry and an optional non-expiring flag.
      </p>

      <button
        type="button"
        onClick={() => setPasteOpen((open) => !open)}
        className="mt-2 text-xs font-semibold text-slate-500 underline"
        aria-expanded={pasteOpen}
      >
        {pasteOpen ? "Hide CSV paste" : "Paste CSV text instead"}
      </button>
      {pasteOpen ? (
        <textarea
          value={csvText}
          onChange={(event) => {
            setCsvText(event.target.value);
            setPreview(null);
          }}
          rows={5}
          className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700"
        />
      ) : csvText ? (
        <p className="mt-2 text-xs text-slate-500">{csvText.split(/\r?\n/).filter(Boolean).length} line(s) loaded.</p>
      ) : null}

      <OperationalOverrideFields user={user} reason={overrideReason} onChange={setOverrideReason} />

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={previewing || !csvText.trim()}
          onClick={handlePreview}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"
        >
          {previewing ? "Validating…" : "Validate preview"}
        </button>
        <button
          type="button"
          disabled={importing || !csvText.trim() || !preview}
          onClick={handleImport}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {importing ? "Importing…" : "Import to staging"}
        </button>
      </div>

      {summary ? (
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-700 md:grid-cols-3">
          <p>Total rows: <strong>{summary.total_rows}</strong></p>
          <p>Valid: <strong>{summary.valid_rows}</strong></p>
          <p>Invalid: <strong>{summary.invalid_rows}</strong></p>
          <p>Duplicate: <strong>{summary.duplicate_rows}</strong></p>
          <p>Missing expiry: <strong>{summary.missing_expiry}</strong></p>
          <p>Quantity: <strong>{summary.total_quantity}</strong></p>
          <p className="col-span-2 md:col-span-3">Value: <strong>{formatRupees(summary.total_value || 0)}</strong></p>
        </div>
      ) : null}

      {(preview?.rows || []).some((row) => row.errors?.length) ? (
        <ul className="mt-3 space-y-1 text-xs text-rose-700">
          {preview.rows
            .filter((row) => row.errors?.length)
            .map((row) => (
              <li key={row.line}>
                Line {row.line}: {row.errors.join("; ")}
              </li>
            ))}
        </ul>
      ) : null}

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
