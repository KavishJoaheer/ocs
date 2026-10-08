import { useState } from "react";
import { Download, FileSpreadsheet, LoaderCircle, Upload, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";

const HEADER_ALIASES = {
  policy_number: ["policy_number", "policy_no", "policy", "policy number", "policy no"],
  national_id: ["national_id", "mauritius_id", "id_number", "nic", "mauritius id", "id no"],
  holder_name: ["holder_name", "policy_holder", "name", "policy holder", "holder"],
  coverage_status: ["coverage_status", "flag", "status", "coverage", "eligibility"],
  status_reason: ["status_reason", "reason", "note", "status note"],
};

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function readAliasedValue(row, aliases) {
  const entries = Object.entries(row || {});
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const match = entries.find(([header]) => normalizeHeader(header) === normalizedAlias);
    if (match) return match[1];
  }
  return "";
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["green", "eligible", "allowed", "yes"].includes(normalized)) return "green";
  if (["red", "blocked", "ineligible", "not eligible", "no"].includes(normalized)) return "red";
  return normalized;
}

function parseSheetRows(XLSX, sheet) {
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false })
    .map((row, index) => ({
      row_number: index + 2,
      policy_number: String(readAliasedValue(row, HEADER_ALIASES.policy_number) || "").trim(),
      national_id: String(readAliasedValue(row, HEADER_ALIASES.national_id) || "").trim(),
      holder_name: String(readAliasedValue(row, HEADER_ALIASES.holder_name) || "").trim(),
      coverage_status: normalizeStatus(readAliasedValue(row, HEADER_ALIASES.coverage_status)),
      status_reason: String(readAliasedValue(row, HEADER_ALIASES.status_reason) || "").trim(),
    }))
    .filter((row) => row.policy_number || row.national_id || row.holder_name || row.coverage_status);
}

export default function LinkhamPolicyImportPanel({ onImported }) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [fileKey, setFileKey] = useState(0);

  function clearImport() {
    setFileName("");
    setRows([]);
    setErrors([]);
    setFileKey((value) => value + 1);
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setErrors([]);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsedRows = parseSheetRows(XLSX, firstSheet);
      if (!parsedRows.length) {
        throw new Error("No policy rows were found. Check the column headings and try again.");
      }
      setFileName(file.name);
      setRows(parsedRows);
    } catch (error) {
      clearImport();
      toast.error(error.message || "Could not read this policy file.");
    }
  }

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const worksheet = XLSX.utils.json_to_sheet([
      {
        policy_number: "LKM-12345",
        national_id: "J0605914619061",
        holder_name: "Example Policy Holder",
        coverage_status: "green",
        status_reason: "",
      },
      {
        policy_number: "LKM-67890",
        national_id: "A0101901234567",
        holder_name: "Example Red Policy",
        coverage_status: "red",
        status_reason: "Coverage suspended",
      },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Policies");
    XLSX.writeFile(workbook, "linkham-policy-import-template.xlsx");
  }

  async function importRows() {
    if (!rows.length || saving) return;
    setSaving(true);
    setErrors([]);
    try {
      const result = await api.post("/linkham/policies/import", { rows });
      toast.success(
        `${result.createdCount || 0} added · ${result.updatedCount || 0} updated · ${result.unchangedCount || 0} unchanged`,
      );
      clearImport();
      setOpen(false);
      await onImported?.();
    } catch (error) {
      setErrors(Array.isArray(error.data?.errors) ? error.data.errors : []);
      toast.error(error.message || "Policy import could not be completed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#065a60]/15 bg-white shadow-sm">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#065a60]/8 text-[#065a60]">
            <FileSpreadsheet className="size-5" />
          </span>
          <div>
            <p className="text-sm font-black text-slate-900">Import the insured portfolio</p>
            <p className="mt-0.5 text-xs font-medium text-slate-400">Excel or CSV · validated before any policy is saved</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void downloadTemplate()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600">
            <Download className="size-3.5" /> Template
          </button>
          <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-[#065a60] px-3 py-2 text-xs font-black text-white">
            {open ? <X className="size-3.5" /> : <Upload className="size-3.5" />}
            {open ? "Close" : "Import file"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-slate-100 bg-slate-50/55 p-5">
          {!rows.length ? (
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white px-5 py-8 text-center transition hover:border-[#065a60]/40">
              <Upload className="size-5 text-[#065a60]" />
              <span className="mt-2 text-sm font-black text-slate-800">Choose the Linkham policy file</span>
              <span className="mt-1 text-xs font-medium text-slate-400">.xlsx, .xls, or .csv · maximum 5,000 rows</span>
              <input key={fileKey} type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void chooseFile(event)} className="sr-only" />
            </label>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black text-slate-800">{fileName}</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-400">{rows.length} policy row{rows.length === 1 ? "" : "s"} ready for validation</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={clearImport} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600">Choose another</button>
                  <button type="button" disabled={saving} onClick={() => void importRows()} className="inline-flex items-center gap-2 rounded-xl bg-[#065a60] px-4 py-2 text-xs font-black text-white disabled:opacity-50">
                    {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                    {saving ? "Validating…" : "Validate and import"}
                  </button>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="grid grid-cols-[1fr_1.25fr_0.65fr] gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                  <span>Policy</span><span>Mauritius ID / holder</span><span>Flag</span>
                </div>
                {rows.slice(0, 5).map((row) => (
                  <div key={row.row_number} className="grid grid-cols-[1fr_1.25fr_0.65fr] gap-3 border-b border-slate-100 px-3 py-2.5 text-xs last:border-0">
                    <span className="truncate font-mono font-black text-slate-800">{row.policy_number || "Missing"}</span>
                    <span className="min-w-0"><span className="block truncate font-mono font-bold text-slate-700">{row.national_id || "Missing"}</span><span className="block truncate text-[10px] text-slate-400">{row.holder_name || "Name not recorded"}</span></span>
                    <span className={row.coverage_status === "red" ? "font-black text-rose-700" : "font-black text-emerald-700"}>{row.coverage_status || "Missing"}</span>
                  </div>
                ))}
              </div>

              {errors.length ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900">
                  <p className="font-black">Fix these rows and upload the file again:</p>
                  <ul className="mt-2 space-y-1 font-semibold">
                    {errors.slice(0, 8).map((item) => <li key={`${item.row_number}-${item.message}`}>Row {item.row_number}: {item.message}</li>)}
                  </ul>
                  {errors.length > 8 ? <p className="mt-2 font-bold">And {errors.length - 8} more row errors.</p> : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
