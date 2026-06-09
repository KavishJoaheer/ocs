import { useRef, useState } from "react";
import dayjs from "dayjs";
import { FileUp } from "lucide-react";

function UploadReportModal({ open, onClose, onUpload }) {
  const fileInputRef = useRef(null);
  const [reportName, setReportName] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [requestedBySource, setRequestedBySource] = useState("OCS Doctor");
  const [requestedByName, setRequestedByName] = useState("");

  if (!open) return null;

  function resetForm() {
    setReportName("");
    setReportDate("");
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

  function handleSubmit(e) {
    e.preventDefault();
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(34,72,91,0.25)] p-4 backdrop-blur-sm sm:items-center"
      onClick={handleClose}
    >
      <div
        className="squircle-outer ocs-elevate w-full max-w-md bg-white"
        style={{ padding: "var(--native-pad-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="native-display text-[20px] text-[#22485b]">Upload a Medical Report</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[#8a9e9a]">
          Add test results, specialist reports, or any health documents.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
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
              "squircle-inner cursor-pointer px-4 py-8 text-center transition active:scale-[0.99]",
              dragOver ? "bg-[rgba(26,160,140,0.14)]" : "bg-[rgba(65,200,198,0.08)]",
            ].join(" ")}
          >
            <FileUp className="mx-auto size-8 text-[#2d8f98]" strokeWidth={1.5} />
            <p className="mt-3 text-[14px] text-[#5b7f8a]">
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
            <label htmlFor="report-name" className="native-label text-[12px] uppercase tracking-wide text-[#8a9e9a]">
              Report name
            </label>
            <input
              id="report-name"
              type="text"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="Name this report"
              className="squircle-inner mt-2 w-full bg-[rgba(65,200,198,0.08)] px-4 py-3 text-[14px] text-[#22485b] outline-none focus:bg-white focus:shadow-[0_0_0_2px_rgba(65,200,198,0.35)]"
            />
          </div>

          <div>
            <label htmlFor="report-date" className="native-label text-[12px] uppercase tracking-wide text-[#8a9e9a]">
              Date of report
            </label>
            <input
              id="report-date"
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="squircle-inner mt-2 w-full bg-[rgba(65,200,198,0.08)] px-4 py-3 text-[14px] text-[#22485b] outline-none focus:bg-white focus:shadow-[0_0_0_2px_rgba(65,200,198,0.35)]"
            />
          </div>

          <div>
            <span className="native-label text-[12px] uppercase tracking-wide text-[#8a9e9a]">
              Requested by
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {["OCS Doctor", "External Doctor"].map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => setRequestedBySource(source)}
                  className={[
                    "squircle-inner px-3 py-2.5 text-[13px] transition",
                    requestedBySource === source
                      ? "native-label bg-[rgba(26,160,140,0.12)] text-[#1a5c52]"
                      : "text-[#5b7f8a]",
                  ].join(" ")}
                >
                  {source}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={!selectedFile || !reportName.trim() || !reportDate}
              className="squircle-inner bg-[#e8a020] px-5 py-3.5 text-[14px] font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              Upload Report
            </button>
            <button type="button" onClick={handleClose} className="text-[14px] text-[#5b7f8a]">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default UploadReportModal;
