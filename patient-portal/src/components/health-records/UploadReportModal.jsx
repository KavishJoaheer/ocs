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

const MOBILE_INPUT_CLASS =
  "h-14 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-[15px] font-medium text-gray-900 outline-none transition focus:border-teal-500 focus:ring-1 focus:ring-teal-500";

function FieldLabel({ htmlFor, children, mobile = false }) {
  return (
    <label
      htmlFor={htmlFor}
      className={
        mobile
          ? "mb-2 block text-[14px] font-bold text-gray-900"
          : "mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a9e9a]"
      }
    >
      {children}
    </label>
  );
}

function UploadFormFields({
  layout = "desktop",
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
  const isMobile = layout === "mobile";

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
        className={
          isMobile
            ? [
                "flex w-full cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-teal-200 bg-teal-50 p-8 transition active:scale-[0.99]",
                dragOver ? "border-teal-400 bg-teal-100/80" : "",
              ].join(" ")
            : [
                "upload-dropzone squircle-inner cursor-pointer border-none px-4 py-9 text-center transition active:scale-[0.99] lg:rounded-[14px] lg:py-10",
                dragOver ? "upload-dropzone--active" : "",
              ].join(" ")
        }
      >
        <FileUp
          className={isMobile ? "size-12 text-teal-600" : "mx-auto size-9 text-[#2d8f98]"}
          strokeWidth={isMobile ? 1.75 : 1.5}
        />
        <p
          className={
            isMobile
              ? "text-center text-[16px] font-semibold text-teal-900"
              : "mt-3 text-[15px] font-medium text-[#5b7f8a]"
          }
        >
          {selectedFile ? selectedFile.name : "Tap to scan or upload document"}
        </p>
        <p className={isMobile ? "text-[13px] text-teal-700/70" : "mt-1 text-[12px] text-[#8a9ea3]"}>
          PDF and image files only
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files?.[0])}
        />
      </div>

      <div>
        <FieldLabel htmlFor={`report-name-${layout}`} mobile={isMobile}>
          Report name
        </FieldLabel>
        <input
          id={`report-name-${layout}`}
          type="text"
          value={reportName}
          onChange={(e) => setReportName(e.target.value)}
          placeholder="Name this report"
          className={isMobile ? MOBILE_INPUT_CLASS : "upload-field-input"}
        />
      </div>

      <div>
        <FieldLabel htmlFor={`report-date-${layout}`} mobile={isMobile}>
          Date of report
        </FieldLabel>
        <div className="relative">
          <input
            id={`report-date-${layout}`}
            type="text"
            inputMode="numeric"
            value={reportDateText}
            onChange={(e) => setReportDateText(e.target.value)}
            placeholder="dd/mm/yyyy"
            className={isMobile ? `${MOBILE_INPUT_CLASS} pr-14` : "upload-field-input pr-12"}
          />
          <button
            type="button"
            onClick={openDatePicker}
            aria-label="Open calendar"
            className={
              isMobile
                ? "absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 transition active:bg-teal-50"
                : "absolute right-1 top-1/2 flex size-11 min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-[10px] text-[#5b7f8a] transition active:bg-[rgba(26,160,140,0.08)]"
            }
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
        {isMobile ? (
          <p className="mb-2 text-[14px] font-bold text-gray-900">Requested by</p>
        ) : (
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a9e9a]">
            Requested by
          </span>
        )}
        <div className="grid grid-cols-2 gap-3">
          {REQUESTED_BY_OPTIONS.map((source) => {
            const isActive = requestedBySource === source;
            return (
              <button
                key={source}
                type="button"
                onClick={() => setRequestedBySource(source)}
                className={
                  isMobile
                    ? [
                        "h-14 rounded-xl border px-3 text-[14px] font-semibold transition",
                        isActive
                          ? "border-teal-500 bg-teal-500/10 text-teal-800"
                          : "border-gray-200 bg-gray-50 text-gray-600",
                      ].join(" ")
                    : [
                        "upload-toggle-btn squircle-inner px-3 py-3 text-[13px] font-semibold transition",
                        isActive ? "upload-toggle-btn-active" : "upload-toggle-btn-inactive",
                      ].join(" ")
                }
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
          className={isMobile ? `${MOBILE_INPUT_CLASS} mt-3` : "upload-field-input mt-3"}
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

  const mobileSheetPaddingBottom = keyboardInset.bottom
    ? `calc(max(env(safe-area-inset-bottom, 0px), 12px) + ${keyboardInset.bottom}px)`
    : undefined;

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

      {/* Mobile — immersive bottom sheet */}
      <div
        className="upload-sheet animate-sheet-up relative flex max-h-[min(92dvh,100dvh-env(safe-area-inset-bottom,0px))] w-full flex-col rounded-t-3xl bg-white lg:hidden"
        style={{
          transform: keyboardInset.top ? `translateY(-${keyboardInset.top}px)` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="mx-auto my-3 block h-1.5 w-12 shrink-0 rounded-full bg-gray-300"
          aria-hidden="true"
        />

        <div className="flex shrink-0 items-center justify-between px-6 pb-4">
          <h2 className="text-[20px] font-bold text-gray-900">Upload Medical Report</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            aria-label="Close upload sheet"
            className="flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-400 transition active:bg-gray-100 active:text-gray-700 disabled:opacity-50"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleSubmit}
        >
          <div className="upload-sheet-scroll flex-1 overflow-y-auto overscroll-contain px-6 pb-4">
            <div className="space-y-5">
              <UploadFormFields layout="mobile" {...formFieldsProps} />
            </div>
          </div>

          <div
            className="shrink-0 border-t border-gray-100 px-6 pt-4 pb-safe"
            style={mobileSheetPaddingBottom ? { paddingBottom: mobileSheetPaddingBottom } : undefined}
          >
            <button
              type="submit"
              disabled={!canSubmit || isUploading}
              className="flex h-14 w-full items-center justify-center rounded-xl bg-brand-orange text-[16px] font-bold text-white shadow-[0_4px_16px_rgba(232,160,32,0.3)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUploading ? "Uploading…" : "Upload Report"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={isUploading}
              className="mt-3 flex h-12 w-full items-center justify-center text-[15px] font-medium text-gray-500 transition active:text-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
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
              <UploadFormFields layout="desktop" {...formFieldsProps} />
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
