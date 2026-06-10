import { createContext, useCallback, useContext, useMemo, useState } from "react";
import RequestDoctorSheet from "../components/request-visit/RequestDoctorSheet.jsx";
import { useActiveVisitGuard } from "./useActiveVisitGuard.js";

const RequestVisitContext = createContext(null);

export function RequestVisitProvider({ children }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const guardActiveVisit = useActiveVisitGuard();

  const openRequestSheet = useCallback(async () => {
    const canProceed = await guardActiveVisit();
    if (canProceed) {
      setSheetOpen(true);
    }
    return canProceed;
  }, [guardActiveVisit]);

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
