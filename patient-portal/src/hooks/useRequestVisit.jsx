import { createContext, useCallback, useContext, useMemo, useState } from "react";
import toast from "react-hot-toast";
import RequestDoctorSheet from "../components/request-visit/RequestDoctorSheet.jsx";
import { ACCOUNT_NOT_LINKED_MESSAGE, getPatientLinkBlockMessage, isPatientAccountLinked } from "../lib/patientAccountLink.js";
import { useActiveVisitGuard } from "./useActiveVisitGuard.js";
import { usePatientAuth } from "./usePatientAuth.jsx";

const RequestVisitContext = createContext(null);

export function RequestVisitProvider({ children }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { user } = usePatientAuth();
  const guardActiveVisit = useActiveVisitGuard();

  const openRequestSheet = useCallback(async () => {
    if (!isPatientAccountLinked(user)) {
      toast.error(getPatientLinkBlockMessage(user) || ACCOUNT_NOT_LINKED_MESSAGE);
      return false;
    }

    const canProceed = await guardActiveVisit();
    if (canProceed) {
      setSheetOpen(true);
    }
    return canProceed;
  }, [guardActiveVisit, user]);

  const closeRequestSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  const value = useMemo(
    () => ({ openRequestSheet, closeRequestSheet, sheetOpen }),
    [openRequestSheet, closeRequestSheet, sheetOpen],
  );

  return (
    <RequestVisitContext.Provider value={value}>
      {children}
      <RequestDoctorSheet open={sheetOpen} onClose={closeRequestSheet} />
    </RequestVisitContext.Provider>
  );
}

export function useRequestVisit() {
  const context = useContext(RequestVisitContext);
  if (!context) {
    throw new Error("useRequestVisit must be used within RequestVisitProvider");
  }
  return context;
}
