import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { Calendar, FileUp } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { useKeyboardOffset } from "../../hooks/useKeyboardOffset.js";
import { useScrollLock } from "../../hooks/useScrollLock.js";

dayjs.extend(customParseFormat);

const REQUESTED_BY_OPTIONS = ["OCS Doctor", "External Doctor"];

const DOCTOR_NAME_PLACEHOLDER = {
  "OCS Doctor": "Name of OCS doctor who requested this",
  "External Doctor": "Name of doctor who requested this",
};

function FieldLabel({ htmlFor, children }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a9e9a]"
    >
      {children}
    </label>
  );
}

function UploadReportModal({ open, onClose, onUpload }) {
  const modalRef = useRef(null);
  const fileInputRef = useRef(null);
  const datePickerRef = useRef(null);
  const [reportName, setReportName] = useState("");
  const [reportDateText, setReportDateText] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [requestedBySource, setRequestedBySource] = useState("OCS Doctor");
  const [requestedByName, setRequestedByName] = useState("");
  const keyboardInset = useKeyboardOffset(open);
  useScrollLock(open);
  useFocusTrap(open, modalRef);

  function resetForm() {
    setReportName("");
    setReportDateText("");
    setSelectedFile(null);
    setDragOver(false);
    setRequestedBySource("OCS Doctor");
    setRequestedByName("");
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleFileSelect(file) {
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) return;
    setSelectedFile(file);
    if (!reportName) {
      setReportName(file.name.replace(/\.[^.]+$/, ""));
    }
  }

  function parseReportDate() {
    const trimmed = reportDateText.trim();
    if (!trimmed) return null;

    const parsed = dayjs(trimmed, ["DD/MM/YYYY", "D/M/YYYY"], true);
    return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
  }

  function handleDatePickerChange(isoValue) {
    if (!isoValue) {
      setReportDateText("");
      return;
    }
    const parsed = dayjs(isoValue);
    if (parsed.isValid()) {
      setReportDateText(parsed.format("DD/MM/YYYY"));
    }
  }

  function openDatePicker() {
    const picker = datePickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
    } else {
      picker.click();
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    const reportDate = parseReportDate();
    if (!selectedFile || !reportName.trim() || !reportDate) return;

    const isPdf = selectedFile.type === "application/pdf";
    onUpload({
      name: reportName.trim(),
      report_date: reportDate,
      uploaded_at: dayjs().format("YYYY-MM-DD"),
      file_type: isPdf ? "PDF" : "Image",
      url: URL.createObjectURL(selectedFile),
      requested_by_source: requestedBySource,
      requested_by: requestedByName.trim(),
      patient_uploaded: true,
    });
    resetForm();
    onClose();
  }

  const parsedDate = parseReportDate();
  const canSubmit = Boolean(selectedFile && reportName.trim() && parsedDate);

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") handleClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={modalRef}
      className="app-modal-root fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-report-title"
    >
      {/* Dimmed / blurred overlay */}
      <button
        type="button"
        aria-label="Close upload dialog"
        onClick={handleClose}
        className="animate-sheet-overlay absolute inset-0 bg-[rgba(13,42,46,0.45)] backdrop-blur-[2px]"
      />

      {/* Bottom sheet — shifts above the mobile keyboard */}
      <div
        className="upload-sheet animate-sheet-up absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-[24px] bg-white shadow-[0_-12px_48px_rgba(13,42,46,0.16)]"
        style={{
          paddingBottom: `calc(max(env(safe-area-inset-bottom, 0px), 16px) + ${keyboardInset.bottom}px)`,
          transform: keyboardInset.top ? `translateY(-${keyboardInset.top}px)` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3">
          <span className="h-[5px] w-[40px] rounded-full bg-[rgba(13,42,46,0.14)]" aria-hidden="true" />
        </div>

        <div className="upload-sheet-scroll flex-1 overflow-y-auto overscroll-contain px-5 pb-2 pt-4">
          <h2 id="upload-report-title" className="native-display text-left text-[20px] text-[#1a5c52]">
            Upload a Medical Report
          </h2>
          <p className="mt-2 text-left text-[14px] leading-relaxed text-[#8a9e9a]">
            Add test results, specialist reports or any health documents to your personal records.
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            {/* Dropzone */}
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
              }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFileSelect(e.dataTransfer.files[0]);
              }}
              className={[
                "upload-dropzone squircle-inner cursor-pointer px-4 py-9 text-center transition active:scale-[0.99]",
                dragOver ? "bg-[rgba(26,160,140,0.12)]" : "",
              ].join(" ")}
            >
              <FileUp className="mx-auto size-9 text-[#2d8f98]" strokeWidth={1.5} />
              <p className="mt-3 text-[15px] font-medium text-[#5b7f8a]">
                {selectedFile ? selectedFile.name : "Tap to scan or upload document"}
              </p>
              <p className="mt-1 text-[12px] text-[#8a9ea3]">PDF and image files only</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0])}
              />
            </div>

            {/* Report name */}
            <div>
              <FieldLabel htmlFor="report-name">Report name</FieldLabel>
              <input
                id="report-name"
                type="text"
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                placeholder="Name this report"
                className="upload-field-input"
              />
            </div>

            {/* Date of report */}
            <div>
              <FieldLabel htmlFor="report-date">Date of report</FieldLabel>
              <div className="relative">
                <input
                  id="report-date"
                  type="text"
                  inputMode="numeric"
                  value={reportDateText}
                  onChange={(e) => setReportDateText(e.target.value)}
                  placeholder="dd/mm/yyyy"
                  className="upload-field-input pr-12"
                />
                <button
                  type="button"
                  onClick={openDatePicker}
                  aria-label="Open calendar"
                  className="absolute right-1 top-1/2 flex size-11 min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-[10px] text-[#5b7f8a] transition active:bg-[rgba(26,160,140,0.08)]"
                >
                  <Calendar className="size-[18px]" strokeWidth={1.75} />
                </button>
                <input
                  ref={datePickerRef}
                  type="date"
                  value={parsedDate || ""}
                  onChange={(e) => handleDatePickerChange(e.target.value)}
                  className="pointer-events-none absolute h-0 w-0 opacity-0"
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </div>
            </div>

            {/* Requested by */}
            <div>
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a9e9a]">
                Requested by
              </span>
              <div className="grid grid-cols-2 gap-3">
                {REQUESTED_BY_OPTIONS.map((source) => {
                  const isActive = requestedBySource === source;
                  return (
                    <button
                      key={source}
                      type="button"
                      onClick={() => setRequestedBySource(source)}
                      className={[
                        "upload-toggle-btn squircle-inner px-3 py-3 text-[13px] font-semibold transition",
                        isActive ? "upload-toggle-btn-active" : "upload-toggle-btn-inactive",
                      ].join(" ")}
                    >
                      {source}
                    </button>
                  );
                })}
              </div>

              <input
                type="text"
                value={requestedByName}
                onChange={(e) => setRequestedByName(e.target.value)}
                placeholder={DOCTOR_NAME_PLACEHOLDER[requestedBySource]}
                className="upload-field-input mt-3"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-5 pt-1">
              <button
                type="submit"
                disabled={!canSubmit}
                className="upload-submit-btn min-h-[44px] rounded-full bg-ocs-orange px-6 py-3.5 text-[14px] font-bold text-white shadow-[0_4px_16px_rgba(232,160,32,0.3)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Upload Report
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-[44px] items-center px-2 text-[14px] font-medium text-[#5b7f8a] transition active:text-[#1a5c52]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default UploadReportModal;
