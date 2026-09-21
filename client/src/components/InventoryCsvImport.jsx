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

function newShipmentOperationId() {
  return globalThis.crypto?.randomUUID?.() || `shipment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function InventoryCsvImport({ onImported }) {
  const { user } = useAuth();
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [operationId, setOperationId] = useState(() => newShipmentOperationId());

  useEffect(() => {
    setUnsavedWork("shipment-import", Boolean(csvText.trim() || preview));
    return () => setUnsavedWork("shipment-import", false);
  }, [csvText, preview]);

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ""));
      setFileName(file.name || "delivery.csv");
      setPreview(null);
      setLastResult(null);
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

  function readyToCheck() {
    if (!csvText.trim()) {
      toast.error("Choose the supplier file first.");
      return false;
    }
    if (supplier.trim().length < 2 || deliveryNote.trim().length < 2) {
      toast.error("Enter the supplier and the delivery note.");
      return false;
    }
    return true;
  }

  async function handlePreview() {
    if (previewing || !readyToCheck()) return;
    setPreviewing(true);
    try {
      const payload = await api.post("/inventory/staging/preview-csv", {
        csv_text: csvText,
        supplier,
        delivery_note: deliveryNote,
      });
      setPreview(payload);
    } catch (error) {
      toast.error(error.message || "Could not check this delivery.");
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (importing || !preview) return;
    if (!readyToCheck()) return;
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
            operation_id: operationId,
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
      setFileName("");
      setPreview(null);
      setSupplier("");
      setDeliveryNote("");
      setOperationId(newShipmentOperationId());
      toast.success(
        summary.skipped
          ? `${summary.imported} saved as incoming. ${summary.skipped} line${summary.skipped === 1 ? "" : "s"} need a fix.`
          : `${summary.imported} saved. Add ${summary.imported === 1 ? "it" : "them"} to the shelf below.`,
      );
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
      toast.error(error.message || "Could not save this delivery.");
    } finally {
      setImporting(false);
    }
  }

  const summary = preview?.preview || preview?.summary;
  const problemRows = (preview?.rows || []).filter((row) => row.errors?.length);
  const canSave = Boolean(preview && Number(summary?.valid_rows || 0) > 0);

  return (
    <SectionCard
      title="Receive a delivery"
      subtitle="Check the supplier file, then save it as incoming. Stock changes only when you add it to the shelf."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          Supplier
          <input
            value={supplier}
            onChange={(event) => {
              setSupplier(event.target.value);
              setPreview(null);
            }}
            placeholder="Who delivered this?"
            className="w-full min-h-11 rounded-xl border border-slate-200 px-3 py-2 font-normal"
          />
        </label>
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          Delivery note
          <input
            value={deliveryNote}
            onChange={(event) => {
              setDeliveryNote(event.target.value);
              setPreview(null);
            }}
            placeholder="Note or invoice number"
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
        className={`mt-3 flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-5 text-center ${
          dragActive ? "border-[#2d8f98] bg-[#ecf8f7] text-[#2d8f98]" : "border-slate-200 text-slate-700"
        }`}
      >
        <Upload className="size-5 text-[#2d8f98]" />
        <span className="text-sm font-semibold">{fileName || "Drop the supplier file here, or choose it"}</span>
        <span className="text-xs font-medium text-slate-500">CSV from the template</span>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Delivery file"
          className="sr-only"
          onChange={(event) => {
            readFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      <button
        type="button"
        onClick={downloadTemplate}
        className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#2d8f98]"
      >
        <Download className="size-4" />
        Download the template
      </button>

      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-semibold text-slate-600">Paste the file instead</summary>
        <label htmlFor="shipment-csv-text" className="mt-2 block text-sm font-semibold text-slate-800">
          CSV shipment data
        </label>
        <p id="shipment-csv-help" className="mt-1 text-xs text-slate-500">
          Columns: folder, item name, quantity, minimum, unit, cost, selling price, expiry.
        </p>
        <textarea
          id="shipment-csv-text"
          value={csvText}
          onChange={(event) => {
            setCsvText(event.target.value);
            setFileName(event.target.value.trim() ? "Pasted delivery" : "");
            setPreview(null);
          }}
          rows={5}
          aria-describedby={`shipment-csv-help${problemRows.length || lastResult?.skipped_rows?.length ? " shipment-csv-errors" : ""}`}
          className="mt-2 block w-full rounded-2xl border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700"
        />
      </details>

      <OperationalOverrideFields user={user} reason={overrideReason} onChange={setOverrideReason} />

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={previewing || !csvText.trim()}
          onClick={handlePreview}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 disabled:opacity-50 sm:w-auto"
        >
          {previewing ? "Checking…" : "Check delivery"}
        </button>
        <button
          type="button"
          disabled={importing || !canSave}
          aria-disabled={importing || !canSave}
          onClick={handleImport}
          className={`inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold sm:w-auto ${
            importing || !canSave
              ? "cursor-not-allowed bg-slate-200 text-slate-600"
              : "bg-[#2d8f98] text-white hover:brightness-95"
          }`}
        >
          {importing ? "Saving…" : "Save as incoming"}
        </button>
      </div>

      {summary ? (
        <p className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <strong>{summary.valid_rows}</strong> ready
          {Number(summary.invalid_rows || 0) > 0 ? (
            <>
              {" "}
              · <strong className="text-rose-700">{summary.invalid_rows}</strong>{" "}
              {Number(summary.invalid_rows) === 1 ? "needs a fix" : "need a fix"}
            </>
          ) : null}
          {" "}
          · {summary.total_quantity} units · {formatRupees(summary.total_value || 0)}
        </p>
      ) : null}

      {problemRows.length ? (
        <ul id="shipment-csv-errors" role="alert" className="mt-3 space-y-1 text-sm text-rose-700">
          {problemRows.map((row) => (
            <li key={row.line}>
              Line {row.line}: {row.errors.join("; ")}
            </li>
          ))}
        </ul>
      ) : null}

      {lastResult?.skipped_rows?.length ? (
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          {lastResult.skipped_rows.map((row) => (
            <li key={`${row.line}-${row.reason}`}>
              Line {row.line}: {row.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}

export default InventoryCsvImport;
