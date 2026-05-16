import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Upload } from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { pageContainerClass } from "../lib/utils.js";

function AdminRosterPage() {
  const [rosterMeta, setRosterMeta] = useState(null);
  const [rosterUploadFile, setRosterUploadFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isUploadingRoster, setIsUploadingRoster] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadRosterMeta() {
      try {
        const data = await api.get("/dashboard/roster");
        if (!ignore) {
          setRosterMeta(data);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadRosterMeta();

    return () => {
      ignore = true;
    };
  }, []);

  async function handleUploadRoster(event) {
    event.preventDefault();

    if (!rosterUploadFile) {
      toast.error("Select a roster PDF first.");
      return;
    }

    setIsUploadingRoster(true);

    try {
      const formData = new FormData();
      formData.append("roster", rosterUploadFile);
      const payload = await api.postForm("/dashboard/roster", formData);
      setRosterMeta(payload);
      setRosterUploadFile(null);
      toast.success("Roster PDF uploaded.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsUploadingRoster(false);
    }
  }

  async function handleDownloadRoster() {
    if (!rosterMeta?.has_roster) {
      toast.error("Roster PDF is not uploaded yet.");
      return;
    }

    try {
      const file = await api.getBlob("/dashboard/roster/file");
      const blobUrl = window.URL.createObjectURL(file.blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60 * 1000);
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (loading) {
    return <LoadingState label="Loading roster" />;
  }

  return (
    <div className={pageContainerClass}>
      <PageHeader
        title="Roster management"
        description="Upload and distribute the current operations roster PDF."
        actions={
          <Link
            to="/"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-teal-300"
          >
            Back to dashboard
          </Link>
        }
      />

      <div className="mt-6 max-w-2xl rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <form className="space-y-4" onSubmit={handleUploadRoster}>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-white">
            <Upload className="size-4" />
            Select PDF
            <input
              accept="application/pdf"
              type="file"
              className="hidden"
              onChange={(event) => setRosterUploadFile(event.target.files?.[0] || null)}
            />
          </label>
          <button
            type="submit"
            disabled={!rosterUploadFile || isUploadingRoster}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploadingRoster ? "Uploading..." : "Upload current_roster.pdf"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleDownloadRoster}
          disabled={!rosterMeta?.has_roster}
          className="mt-4 flex w-full items-center justify-center rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          📥 Download Current Roster PDF
        </button>

        <p className="mt-3 text-sm text-slate-500">
          {rosterMeta?.has_roster
            ? `Last updated ${dayjs(rosterMeta.updated_at).format("MMM D, YYYY [at] h:mm A")}`
            : "No roster PDF uploaded yet"}
        </p>
      </div>
    </div>
  );
}

export default AdminRosterPage;
