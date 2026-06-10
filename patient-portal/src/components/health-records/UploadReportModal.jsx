import { useCallback, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import toast from "react-hot-toast";
import { Calendar, FileUp, X } from "lucide-react";
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

function UploadFormFields({
  reportName,
  setReportName,
  reportDateText,
  setReportDateText,
  selectedFile,
  dragOver,
  setDragOver,
  requestedBySource,
  setRequestedBySource,
  requestedByName,
  setRequestedByName,
  fileInputRef,
  datePickerRef,
  parsedDate,
  handleFileSelect,
  openDatePicker,
  handleDatePickerChange,
}) {
  return (
    <>
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
          "upload-dropzone squircle-inner cursor-pointer border-none px-4 py-9 text-center transition active:scale-[0.99] max-lg:rounded-lg max-lg:border max-lg:border-gray-100 max-lg:bg-gray-50 lg:rounded-[14px] lg:py-10",
          dragOver ? "upload-dropzone--active max-lg:bg-gray-100" : "",
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
    </>
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
  const [isUploading, setIsUploading] = useState(false);
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

  const handleClose = useCallback(() => {
    if (isUploading) return;
    resetForm();
    onClose();
  }, [isUploading, onClose]);

  function handleFileSelect(file) {
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) {
      toast.error("PDF and image files only.");
      return;
    }
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

  async function handleSubmit(e) {
    e.preventDefault();
    const reportDate = parseReportDate();
    if (!selectedFile || !reportName.trim() || !reportDate || isUploading) return;

    const isPdf = selectedFile.type === "application/pdf";
    setIsUploading(true);
    try {
      await onUpload({
        name: reportName.trim(),
        report_date: reportDate,
        uploaded_at: dayjs().format("YYYY-MM-DD"),
        file_type: isPdf ? "PDF" : "Image",
        file: selectedFile,
        requested_by_source: requestedBySource,
        requested_by: requestedByName.trim(),
        patient_uploaded: true,
      });
      resetForm();
      onClose();
    } catch {
      // Parent surfaces toast; keep modal open for retry.
    } finally {
      setIsUploading(false);
    }
  }

  const parsedDate = parseReportDate();
  const canSubmit = Boolean(selectedFile && reportName.trim() && parsedDate);

  const formFieldsProps = {
    reportName,
    setReportName,
    reportDateText,
    setReportDateText,
    selectedFile,
    dragOver,
    setDragOver,
    requestedBySource,
    setRequestedBySource,
    requestedByName,
    setRequestedByName,
    fileInputRef,
    datePickerRef,
    parsedDate,
    handleFileSelect,
    openDatePicker,
    handleDatePickerChange,
  };

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") handleClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div
      ref={modalRef}
      className="app-modal-root fixed inset-0 z-[var(--z-modal)] flex flex-col justify-end lg:block"
      role="dialog"
      aria-modal="true"
      aria-label="Upload medical report"
    >
      <button
        type="button"
        aria-label="Close upload dialog"
        onClick={handleClose}
        disabled={isUploading}
        className="animate-sheet-overlay absolute inset-0 bg-[rgba(13,42,46,0.45)] backdrop-blur-[2px] disabled:pointer-events-none"
      />

      {/* Mobile — native bottom sheet */}
      <div
        className="upload-sheet animate-sheet-up relative w-full rounded-t-3xl rounded-b-none bg-white px-6 pt-6 pb-safe lg:hidden"
        style={{
          paddingBottom: keyboardInset.bottom
            ? `calc(max(env(safe-area-inset-bottom, 0px), 12px) + ${keyboardInset.bottom}px)`
            : undefined,
          transform: keyboardInset.top ? `translateY(-${keyboardInset.top}px)` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="mx-auto mb-5 block h-1 w-10 rounded-full bg-gray-300"
          aria-hidden="true"
        />

        <div className="upload-sheet-scroll max-h-[min(80dvh,100dvh-env(safe-area-inset-bottom,0px))] overflow-y-auto overscroll-contain">
          <h2 className="text-left text-[20px] font-bold text-[#1a5c52]">
            Upload a Medical Report
          </h2>
          <p className="mt-2 text-left text-[14px] leading-relaxed text-[#8a9e9a]">
            Add test results, specialist reports or any health documents to your personal records.
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <UploadFormFields {...formFieldsProps} />

            <div className="flex items-center gap-5 pt-1 pb-2">
              <button
                type="submit"
                disabled={!canSubmit || isUploading}
                className="upload-submit-btn min-h-[44px] rounded-full bg-ocs-orange px-6 py-3.5 text-[14px] font-bold text-white shadow-[0_4px_16px_rgba(232,160,32,0.3)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isUploading ? "Uploading…" : "Upload Report"}
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={isUploading}
                className="inline-flex min-h-[44px] items-center px-2 text-[14px] font-medium text-[#5b7f8a] transition active:text-[#1a5c52] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Desktop — right slide-over drawer */}
      <aside
        className="upload-drawer animate-drawer-slide-in absolute inset-y-0 right-0 hidden w-full max-w-[420px] flex-col bg-white shadow-[-8px_0_40px_rgba(13,42,46,0.12)] lg:flex"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[rgba(0,0,0,0.06)] px-6 py-5">
          <div>
            <h2 className="native-display text-[20px] text-[#1a5c52]">Upload Medical Report</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#8a9e9a]">
              Add test results or specialist documents to your records.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close upload drawer"
            className="flex size-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-[#8a9e9a] transition hover:bg-[rgba(0,0,0,0.04)] hover:text-[#1a5c52]"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="upload-drawer-scroll flex-1 overflow-y-auto overscroll-contain px-6 py-5">
            <div className="space-y-5">
              <UploadFormFields {...formFieldsProps} />
            </div>
          </div>

          <footer className="upload-drawer-footer shrink-0">
            <button
              type="button"
              onClick={handleClose}
              disabled={isUploading}
              className="upload-drawer-cancel-btn min-h-[44px] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit || isUploading}
              className="upload-drawer-upload-btn min-h-[44px] px-7 py-3 text-[14px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUploading ? "Uploading…" : "Upload"}
            </button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

export default UploadReportModal;
