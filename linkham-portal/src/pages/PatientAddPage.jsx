import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import LoadingState from "../components/LoadingState.jsx";
import { PatientFormModal } from "../components/PatientIntakeForm.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";

function PatientAddPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const isMobile = useIsMobile();
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const data = await api.get("/doctors");
        if (!ignore) {
          setDoctors(data);
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

    load();
    return () => {
      ignore = true;
    };
  }, []);

  async function handleSubmit(payload) {
    setIsSaving(true);
    try {
      const created = await api.post("/patients", payload);
      toast.success("Patient added successfully.");
      navigate(`/patients/${created.id}`, { replace: true });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading form" />;
  }

  return (
    <PatientFormModal
      canEditPatientIdentifier={user.role === "admin"}
      canSelectAssignedDoctor={user.role === "admin" || user.role === "operator"}
      doctors={doctors}
      isSaving={isSaving}
      layout={isMobile ? "page" : "modal"}
      mode="create"
      open
      patient={null}
      onClose={() => navigate(-1)}
      onSubmit={handleSubmit}
    />
  );
}

export default PatientAddPage;
